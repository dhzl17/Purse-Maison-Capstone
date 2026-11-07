/**
 * Dashboard page. Every KPI and chart is computed from DB.* arrays, which
 * js/store.js fills from Supabase after login.
 */

const DASHBOARD_DEFAULT_RANGE = '6m'; 

const INTERACTION_SERIES = [
  ['consigned', 'Consigned', '#10184F'],
  ['consignorNotProceeded', 'Consignor did not proceed', '#C9A24A'],
  ['buyerPurchased', 'Buyer purchased', '#3247C5'],
  ['buyerNotProceeded', 'Buyer only inquired', '#B7B7C0'],
];

const DashboardPage = {
  filterRange: null,      
  filterBrands: null,

  /** Same key the database uses for brands (lower-case, trimmed). */
  brandKeyOf(name) {
    return String(name || '').trim().toLowerCase();
  },

  /** [brandKey, brand name] pairs from sales history and inventory, sorted by name. */
  brandOptions() {
    const map = new Map();
    for (const s of DB.salesSeries) if (s.brandKey) map.set(s.brandKey, s.brand);
    for (const i of DB.inventory) {
      const k = this.brandKeyOf(i.brand);
      if (k && k !== '—' && !map.has(k)) map.set(k, i.brand);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  },

  range() {
    const r = resolveDateRange(this.filterRange, 'day', DASHBOARD_DEFAULT_RANGE);
    const t = drToday();
    const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    if (!r.start) { 
      const dates = [...(DB.dailySales || []), ...(DB.salesSeries || [])]
        .map((s) => s.date).filter((d) => d && !Number.isNaN(d.getTime()));
      const first = dates.length ? new Date(Math.min(...dates)) : new Date(t.getFullYear(), t.getMonth() - 5, 1);
      r.start = new Date(first.getFullYear(), first.getMonth(), 1);
      r.end = tomorrow;
    }
    if (r.end > tomorrow) r.end = tomorrow;
    return r;
  },

  /** Number of days in the selected period. */
  periodDays() {
    const { start, end } = this.range();
    return Math.max(1, Math.round((end - start) / 86400000));
  },

  /**
   * The steps the charts are drawn in: days (up to 5 weeks), weeks (up to about 4 months) or months.
   * Each step: { start, end, unit, label (axis), name (for sentences), at ('on' or 'in') }
   */
  periodBuckets() {
    const { start, end } = this.range();
    const days = this.periodDays();
    const unit = days <= 35 ? 'day' : days <= 124 ? 'week' : 'month';
    const crossYear = start.getFullYear() !== new Date(end - 1).getFullYear();
    const yr = (d) => (crossYear ? ` '${String(d.getFullYear()).slice(2)}` : '');
    const fullYr = (d) => (crossYear ? ` ${d.getFullYear()}` : '');
    const buckets = [];
    for (let s = new Date(start); s < end;) {
      let e;
      if (unit === 'day') e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
      else if (unit === 'week') e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 - ((s.getDay() + 6) % 7)); // to next Monday
      else e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
      if (e > end) e = new Date(end);
      const day = `${s.getDate()} ${DR_MONTHS_FULL[s.getMonth()]}${fullYr(s)}`;
      buckets.push({
        start: s,
        end: e,
        unit,
        label: unit === 'month' ? MONTH_ABBREV[s.getMonth()] + yr(s) : `${s.getDate()} ${MONTH_ABBREV[s.getMonth()]}${yr(s)}`,
        name: unit === 'month' ? DR_MONTHS_FULL[s.getMonth()] + fullYr(s) : unit === 'week' ? `the week of ${day}` : day,
        at: unit === 'day' ? 'on' : 'in',
      });
      s = e;
    }
    return buckets;
  },

  /** Short name for the period: "Last 6 months", "7 – 11 Oct 2026". */
  periodLabel() { return dateRangeLabel(this.filterRange, 'day', DASHBOARD_DEFAULT_RANGE); },

  /** The period inside a sentence: "the last 30 days", "this month", "the period from 7 October 2026 to 11 October 2026". */
  periodPhrase() {
    const r = this.range();
        const phrases = { today: 'today', this_month: 'this month', last_month: 'last month', this_year: 'this year', last_year: 'last year', all: 'all time' };
    if (r.preset && /^y\d{4}$/.test(r.preset)) return r.preset.slice(1);
    if (r.preset) return phrases[r.preset] || `the ${this.periodLabel().toLowerCase()}`;
    const full = (key) => { const d = drParse(key); return `${d.getDate()} ${DR_MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`; };
    const { from, to } = this.filterRange;
    return from === to ? full(from) : `the period from ${full(from)} to ${full(to)}`;
  },

  /** The period with a preposition: periodWith('in') -> "in the last 30 days", or just "today". */
  periodWith(prep) {
    return this.range().preset === 'today' ? 'today' : `${prep} ${this.periodPhrase()}`;
  },

  /** Chip shown on the charts: "30 Days", "13 Weeks", "6 Months". */
  periodChip() {
    const b = this.periodBuckets();
    const unit = b.length ? b[0].unit : 'day';
    return `${b.length} ${unit.charAt(0).toUpperCase()}${unit.slice(1)}${b.length === 1 ? '' : 's'}`;
  },

  /** Short period for the KPI card titles: the preset's name, or "5 Days" for a custom range (fits the card). */
  kpiPeriod() {
    if (!(this.filterRange && this.filterRange.from)) return this.periodLabel();
    const d = this.periodDays();
    return `${d} ${d === 1 ? 'Day' : 'Days'}`;
  },

  /** Average per month for periods of 4 weeks or more, otherwise per day: [amount, 'month' | 'day']. */
  pace(total) {
    const d = this.periodDays();
    return d >= 28 ? [total / (d / 30.44), 'month'] : [total / d, 'day'];
  },

  computeStats() {
    const brandSet = this.filterBrands === null ? null : new Set(this.filterBrands);
    const brandOk = (name) => brandSet === null || brandSet.has(this.brandKeyOf(name));
    const inventory = DB.inventory.filter((i) => brandOk(i.brand));
    const salesSeries = DB.salesSeries.filter((s) => brandSet === null || brandSet.has(s.brandKey)); // monthly (for Monthly Sales Growth)
    const dailySales = (DB.dailySales || []).filter((s) => brandSet === null || brandSet.has(s.brandKey)); // per day, incl. imported history

    // The charts are drawn per day, week or month depending on how long the period is
    const { start: periodStart, end: periodEnd } = this.range();
    const buckets = this.periodBuckets();
    const sumIn = (rows, b, field) => rows.filter((r) => r.date >= b.start && r.date < b.end).reduce((sum, r) => sum + (r[field] || 0), 0);
    const monthLabels = buckets.map((b) => b.label);                          // chart labels (one per step)
    const monthlyTotals = buckets.map((b) => sumIn(dailySales, b, 'amount')); // revenue per step
    const periodTotal = monthlyTotals.reduce((a, b) => a + b, 0);
    const periodUnits = dailySales.filter((s) => s.date >= periodStart && s.date < periodEnd).reduce((sum, s) => sum + (s.units || 0), 0);

    const inventoryById = Object.fromEntries(DB.inventory.map((i) => [i.id, i]));
    const transactions = DB.salesTransactions.filter((t) => {
      const item = inventoryById[t.itemId];
      return item && brandOk(item.brand) && t.date >= periodStart && t.date < periodEnd;
    });

    const itemsSold = inventory.filter((i) => i.status === 'sold').length;
    const activeConsignedItems = brandSet === null
      ? DB.activeConsignedCount
      : DB.pipelineItems.filter((i) => brandOk(i.brand) && !FINISHED_STAGES.includes(i.stage)).length;

    const now = new Date();
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    let thisMonthTotal = 0, lastMonthTotal = 0;
    for (const t of salesSeries) {
      if (t.date.getFullYear() === now.getFullYear() && t.date.getMonth() === now.getMonth()) thisMonthTotal += t.amount;
      else if (t.date.getFullYear() === lastMonthDate.getFullYear() && t.date.getMonth() === lastMonthDate.getMonth()) lastMonthTotal += t.amount;
    }
    const growthPercent = lastMonthTotal === 0 ? 0 : ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100;

    const displayDurations = [];
    for (const t of transactions) {
      const item = inventoryById[t.itemId];
      const added = parseDateAdded(item.dateAdded);
      if (!added) continue;
      const days = Math.round((t.date - added) / 86400000);
      if (days >= 0) displayDurations.push(days);
    }
    const avgDisplayDuration = displayDurations.length ? displayDurations.reduce((a, b) => a + b, 0) / displayDurations.length : null;
    const fastMovingCount = displayDurations.filter((d) => d <= 30).length;
    const slowMovingCount = displayDurations.filter((d) => d > 60).length;
    const turnoverRate = inventory.length ? itemsSold / inventory.length : 0;

    const statusCounts = {
      Available: inventory.filter((i) => i.status === 'available').length,
      Reserved: inventory.filter((i) => i.status === 'reserved').length,
      Rejected: inventory.filter((i) => i.status === 'rejected').length,
      Sold: itemsSold,
    };

    // Customer interactions per step (all brands: inquiries are not filtered by brand)
    const interactionRows = DB.dailyInteractions || [];
    const interactions = {};
    for (const [field] of INTERACTION_SERIES) interactions[field] = buckets.map((b) => sumIn(interactionRows, b, field));
    const sumOf = (field) => interactions[field].reduce((a, b) => a + b, 0);
    const interactionTotals = Object.fromEntries(INTERACTION_SERIES.map(([field]) => [field, sumOf(field)]));
    const openInquiries = interactionRows.filter((r) => r.date >= periodStart && r.date < periodEnd).reduce((sum, r) => sum + (r.inProgress || 0), 0);

    return { buckets, itemsSold, activeConsignedItems, thisMonthTotal, lastMonthTotal, growthPercent, periodTotal, periodUnits, avgDisplayDuration, soldWithDates: displayDurations.length, turnoverRate, totalInquiries: DB.inquiryCount, fastMovingCount, slowMovingCount, monthLabels, monthlyTotals, statusCounts, interactions, interactionTotals, openInquiries };
  },

    /**
   * Key Insights: one plain-language line per KPI card, as [label, text]. Rule-based (no AI):
   * the sentences are fixed templates filled in with the same numbers the cards show.
   */
  buildInsights(stats) {
    const peso = (v) => `₱${formatAmount(v)}`;
    const pct = (v) => `${Math.abs(v).toFixed(1)}%`;
    const days = this.periodDays();
    const inPeriod = this.periodWith('in');     // "in the last 30 days" / "today"
    const overPeriod = this.periodWith('over'); // "over the last 30 days" / "today"
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    const rate = (v) => (v >= 10 ? Math.round(v).toLocaleString('en-PH') : v.toFixed(1));
    const [moneyPace, paceUnit] = this.pace(stats.periodTotal);
    const [unitPace] = this.pace(stats.periodUnits);
    const insights = [];

    if (this.filterBrands !== null) {
      const names = this.brandOptions().filter(([k]) => this.filterBrands.includes(k)).map(([, name]) => name);
      const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
      insights.push(['Filter', `Showing ${shown || 'no brands'} only.`]);
    }

    insights.push(['Total Sales', stats.periodTotal > 0
      ? `${peso(stats.periodTotal)} ${overPeriod}${days > 1 ? `, about ${peso(moneyPace)} a ${paceUnit}` : ''}.`
      : `No sales ${inPeriod}.`]);
    insights.push(['Items Sold', stats.periodUnits > 0
      ? `${plural(stats.periodUnits, 'item')} sold${days > 1 ? `, about ${rate(unitPace)} a ${paceUnit}` : ''} at an average of ${peso(stats.periodTotal / stats.periodUnits)} each.`
      : 'No items sold in this period.']);

    // Months of stock only make sense from a period of at least 4 weeks
    const perMonth = days >= 28 ? stats.periodUnits / (days / 30.44) : 0;
    insights.push(['Active Consigned Items', stats.activeConsignedItems > 0
      ? `${plural(stats.activeConsignedItems, 'item')} still moving through consignment${perMonth > 0 ? `, about ${(stats.activeConsignedItems / perMonth).toFixed(1)} months of stock at the recent selling pace` : ''}.`
      : 'No items are moving through consignment right now.']);

    if (stats.lastMonthTotal > 0) {
      insights.push(['Monthly Sales Growth', `This month's sales so far are ${pct(stats.growthPercent)} ${stats.growthPercent >= 0 ? 'above' : 'below'} last month's total of ${peso(stats.lastMonthTotal)}. The month is not over yet, so the figure can still rise.`]);
    } else {
      insights.push(['Monthly Sales Growth', 'No sales last month to compare with.']);
    }

    if (stats.avgDisplayDuration !== null) {
      const days = Math.round(stats.avgDisplayDuration);
      insights.push(['Average Display Duration', `Items sell after ${plural(days, 'day')} on average, ${days <= 60 ? 'within' : 'longer than'} the 60-day consignment period.`]);
    } else {
      insights.push(['Average Display Duration', 'Not enough recorded sales to measure yet.']);
    }

    insights.push(['Inventory Turnover Rate', `${stats.turnoverRate.toFixed(2)}x means ${(stats.turnoverRate * 100).toFixed(1)}% of the items in inventory have sold.`]);

    const t = stats.interactionTotals;
    const buyers = t.buyerPurchased + t.buyerNotProceeded;
    const consignors = t.consigned + t.consignorNotProceeded;
    insights.push(['Total Item Inquiries', `${stats.totalInquiries.toLocaleString('en-PH')} client inquiries recorded in total. ${cap(inPeriod)}, ${buyers} came from buyers and ${consignors} from consignors.`]);

    const known = stats.soldWithDates;
    insights.push(['Fast Moving Items', known
      ? `${plural(stats.fastMovingCount, 'item')} (${Math.round((stats.fastMovingCount / known) * 100)}% of recorded sales) sold within 30 days of being added.`
      : 'No recorded sales to measure yet.']);
    insights.push(['Slow Moving Items', known
      ? (stats.slowMovingCount
        ? `${plural(stats.slowMovingCount, 'item')} (${Math.round((stats.slowMovingCount / known) * 100)}% of recorded sales) took over 60 days to sell. Similar items may need a price review.`
        : 'No items took over 60 days to sell.')
      : 'No recorded sales to measure yet.']);
    return insights;
  },

  chartNotes(stats) {
    const short = (v) => (v >= 1e6 ? `₱${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `₱${(v / 1e3).toFixed(0)}K` : `₱${formatAmount(v)}`);
    const pct = (v) => `${Math.abs(v).toFixed(0)}%`;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const bs = stats.buckets;                      // the chart steps (days, weeks or months), oldest first
    const unit = bs.length ? bs[0].unit : 'day';    // 'day' | 'week' | 'month'
    const unitly = { day: 'daily', week: 'weekly', month: 'monthly' }[unit];
    const name = (i) => bs[i].name;                 // "7 October", "the week of 6 October", "October"
    const at = (i) => `${bs[i].at} ${bs[i].name}`;  // "on 7 October", "in the week of …", "in October"
    const span = (a, b) => (b > a ? `${name(a)} to ${name(b)}` : name(a));
    const totals = stats.monthlyTotals;
    const now = new Date();
    const last = bs[bs.length - 1];
    // When the period ends with today, the last step (today, this week or this month) is still in progress
    const inProgress = !!last && now >= last.start && now < last.end;
    const cur = inProgress ? totals.length - 1 : -1;
    const doneCount = inProgress ? totals.length - 1 : totals.length;
    const done = totals.slice(0, doneCount);
    const inPeriod = this.periodWith('in');
    const overPeriod = this.periodWith('over');

    let scope = '';
    if (this.filterBrands !== null) {
      const names = this.brandOptions().filter(([k]) => this.filterBrands.includes(k)).map(([, n]) => n);
      scope = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `the ${names.length} selected brands`;
    }
    const notes = {};
    const curName = inProgress ? (unit === 'day' ? `today (${name(cur)})` : name(cur)) : '';
    const curText = inProgress ? `${cap(curName)} is still in progress, with ${short(totals[cur])} recorded so far.` : '';
    const curOwn = inProgress ? (unit === 'day' ? "today's" : `${name(cur)}'s`) : '';

    if (!done.length) {
      // Only the current day / week / month is selected
      notes.overview = scope ? `For ${scope}, ${curName} is still in progress, with ${short(totals[cur])} recorded so far.` : curText;
      notes.average = notes.overview;
    } else if (!done.some((v) => v > 0)) {
      notes.overview = `No revenue was recorded${scope ? ` for ${scope}` : ''} in ${inProgress ? `the completed ${unit}s of this period` : 'the selected period'}.${curText ? ` ${curText}` : ''}`;
      notes.average = notes.overview;
    } else {
      const avgDone = done.reduce((a, b) => a + b, 0) / done.length;
      const hi = done.indexOf(Math.max(...done));
      const lo = done.indexOf(Math.min(...done));
      const zeros = done.filter((v) => v === 0).length;
      let text;
      if (done.length === 1) {
        text = `${scope ? `For ${scope}, r` : 'R'}evenue reached ${short(done[0])} ${at(0)}.`;
      } else {
        text = `${scope ? `For ${scope}, r` : 'R'}evenue averaged ${short(avgDone)} per ${unit} from ${span(0, done.length - 1)}`;
        if (hi === lo) text += '.';
        else if (zeros > 1) text += `, peaking at ${short(done[hi])} ${at(hi)}. No sales were recorded in ${zeros} of the ${done.length} ${unit}s.`;
        else text += `, peaking at ${short(done[hi])} ${at(hi)} and reaching a low of ${short(done[lo])} ${at(lo)}.`;
      }
      if (done.length >= 2) {
        // Direction: average of the later steps against the earlier ones (less misleading than first vs last)
        const split = Math.ceil(done.length / 2);
        const early = done.slice(0, split);
        const late = done.slice(split);
        const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
        if (avg(early) > 0) {
          const change = ((avg(late) - avg(early)) / avg(early)) * 100;
          text += Math.abs(change) < 5
            ? ` Average ${unitly} revenue stayed about the same between the first half (${span(0, split - 1)}) and the second half (${span(split, done.length - 1)}).`
            : (early.length === 1 && late.length === 1
              ? ` Revenue ${at(1)} was ${pct(change)} ${change > 0 ? 'higher' : 'lower'} than ${at(0)}.`
              : ` Average ${unitly} revenue for ${span(split, done.length - 1)} was ${pct(change)} ${change > 0 ? 'higher' : 'lower'} than for ${span(0, split - 1)}.`);
        }
      }
      if (curText) text += ` ${curText}`;
      notes.overview = text;

      // Actual vs Average: the same average the chart draws (every step in the period)
      const average = totals.reduce((a, b) => a + b, 0) / totals.length;
      const lastDone = done.length - 1;
      const above = done.filter((v) => v > average).length;
      const diff = average > 0 ? ((done[lastDone] - average) / average) * 100 : 0;
      let avgText = `${scope ? `For ${scope}, ${unitly}` : cap(unitly)} revenue averaged ${short(average)} ${overPeriod}${inProgress ? `, including ${curOwn} partial figures` : ''}. `
        + `${above} of ${done.length} ${inProgress ? 'completed ' : ''}${unit}${done.length === 1 ? '' : 's'} exceeded this average, `
        + (done[lastDone] === 0 ? `and there were no sales ${at(lastDone)}.` : `with ${name(lastDone)} finishing ${pct(diff)} ${diff >= 0 ? 'above' : 'below'} it.`);
      if (inProgress) {
        const curDiff = average > 0 ? ((totals[cur] - average) / average) * 100 : 0;
        avgText += ` ${cap(curName)} currently stands at ${short(totals[cur])}, ${pct(curDiff)} ${curDiff >= 0 ? 'above' : 'below'} the average.`;
      }
      notes.average = avgText;
    }

    // Customer Interactions ("Volume first")
    const t = stats.interactionTotals;
    const buyers = t.buyerPurchased + t.buyerNotProceeded;
    const consignors = t.consigned + t.consignorNotProceeded;
    if (!buyers && !consignors) {
      notes.interactions = `No client inquiries were completed ${inPeriod}.`;
    } else {
      const share = (part, whole) => Math.round((part / whole) * 100);
      const portion = (p) => (p >= 90 ? 'nearly all' : p >= 70 ? 'most' : p >= 56 ? 'more than half'
        : p > 50 ? 'just over half' : p === 50 ? 'half' : p >= 25 ? 'fewer than half' : 'a small share');
      const group = (p, noun) => (['nearly all', 'most'].includes(portion(p)) ? `${portion(p)} ${noun}` : `${portion(p)} of ${noun}`);
      const total = buyers + consignors;
      const mix = [consignors ? `${consignors} from consignors` : null, buyers ? `${buyers} from buyers` : null].filter(Boolean).join(' and ');
      let text = `A total of ${total} ${total === 1 ? 'inquiry was' : 'inquiries were'} completed ${inPeriod}: ${mix}.`;

      const outcomes = [];
      if (consignors) {
        const p = share(t.consigned, consignors);
        outcomes.push(`${group(p, 'consignors')} proceeded with a consignment (${p}%)`);
      }
      if (buyers) {
        const p = share(t.buyerPurchased, buyers);
        outcomes.push(`${group(p, 'buyers')} made a purchase (${p}%)`);
      }
      const sentence = outcomes.join(', while ');
      text += ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;

      const perStep = bs.map((_, i) => INTERACTION_SERIES.reduce((sum, [field]) => sum + stats.interactions[field][i], 0));
      const doneSteps = perStep.slice(0, doneCount);
      if (doneSteps.length > 1 && doneSteps.some((v) => v > 0)) {
        const top = doneSteps.indexOf(Math.max(...doneSteps));
        text += ` ${cap(name(top))} recorded the highest volume with ${perStep[top]} ${perStep[top] === 1 ? 'inquiry' : 'inquiries'}.`;
      }
      if (stats.openInquiries) text += ` ${stats.openInquiries} ${stats.openInquiries === 1 ? 'inquiry remains' : 'inquiries remain'} open.`;
      if (this.filterBrands !== null) text += ' Inquiry figures include all brands.';
      notes.interactions = text;
    }

    // Inventory Performance
    const entries = Object.entries(stats.statusCounts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, v]) => sum + v, 0);
    if (!total) {
      notes.inventory = `No inventory items${scope ? ` for ${scope}` : ''} to report yet.`;
    } else {
      const verb = {
        Sold: ['has been sold', 'have been sold'], Available: ['is available', 'are available'],
        Reserved: ['is reserved', 'are reserved'], Rejected: ['was rejected', 'were rejected'],
      };
      const list = entries.map(([k, v]) => `${v} ${(verb[k] || [k, k])[v === 1 ? 0 : 1]} (${Math.round((v / total) * 100)}%)`);
      const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
      let text = `${scope ? `For ${scope}, o` : 'O'}f the ${total} ${total === 1 ? 'item' : 'items'} listed, ${joined}.`;
      const available = stats.statusCounts.Available || 0;
      const days = this.periodDays();
      const perMonth = days >= 28 ? stats.periodUnits / (days / 30.44) : 0; // pace only from 4+ weeks of sales
      if (available && perMonth > 0) {
        text += ` At the recent pace of about ${Math.round(perMonth)} sales per month, available stock would last roughly ${(available / perMonth).toFixed(1)} months.`;
      }
      notes.inventory = text;
    }
    return notes;
  },

  pipelineByStage() {
    const brandSet = this.filterBrands === null ? null : new Set(this.filterBrands);
    const items = DB.pipelineItems.filter((i) => brandSet === null || brandSet.has(this.brandKeyOf(i.brand)));
    const rows = OVERVIEW_STAGE_GROUPS
      .filter(([key]) => key !== 'closed')
      .map(([key, label, stages]) => {
        const live = key === 'live';
        const keep = live ? ['publish_item'] : stages;
        return { label: live ? 'Live (Published)' : label, count: items.filter((i) => keep.includes(i.stage)).length };
      });
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const top = rows.reduce((best, r) => (r.count > best.count ? r : best), rows[0]);
    const piling = total > 0 && top.label !== 'Live (Published)' && top.count / total >= 0.4;
        let scope = '';
    if (this.filterBrands !== null) {
      const names = this.brandOptions().filter(([k]) => this.filterBrands.includes(k)).map(([, n]) => n);
      scope = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `the ${names.length} selected brands`;
    }
    let note = `No items${scope ? ` for ${scope}` : ''} are in progress right now.`;
    if (total) {
      const entries = rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
      const where = (r) => (r.label === 'Live (Published)'
        ? `${r.count} ${r.count === 1 ? 'is' : 'are'} live`
        : `${r.count} ${r.count === 1 ? 'is' : 'are'} at ${r.label}`);
      const list = entries.map((r) => `${where(r)} (${Math.round((r.count / total) * 100)}%)`);
      const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
      note = `${scope ? `For ${scope}, o` : 'O'}f the ${total} ${total === 1 ? 'item' : 'items'} currently in consignment, ${joined}.`;
      const early = rows.filter((r) => r.label !== 'Live (Published)');
      const prep = early.reduce((sum, r) => sum + r.count, 0);
      if (prep > 0) {
        const busiest = early.reduce((best, r) => (r.count > best.count ? r : best), early[0]);
        note += ` Of these, ${prep} ${prep === 1 ? 'is' : 'are'} still being prepared before listing, with the most at ${busiest.label} (${busiest.count}).`;
      }
      if (piling) note += ' Work may be piling up at this stage.';
    }
    return { rows, total, note, topLabel: piling ? top.label : '' };
  },

  render() {
    const brands = this.brandOptions();
    if (this.filterBrands !== null) {
      this.filterBrands = this.filterBrands.filter((k) => brands.some(([b]) => b === k));
      if (!this.filterBrands.length) this.filterBrands = null;
    }
    const filtered = this.filterBrands !== null || !isDefaultDateRange(this.filterRange, DASHBOARD_DEFAULT_RANGE);
    const stats = this.computeStats();
    const insights = this.buildInsights(stats);
    const notes = this.chartNotes(stats);
    const pipeline = this.pipelineByStage();
    const user = Session.currentUser;
    const roleConfig = ROLES[user.role] || ROLES.salesAssociate;

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:24px;">
        <div>
          <h1 class="welcome-title" style="margin-bottom:4px;">Welcome, ${escapeHtml(user.fullName || user.username)}!</h1>
        </div>
        <span class="role-badge-tag" style="background:${roleConfig.badgeColor}; font-size:12px; padding:6px 14px;">
          ${escapeHtml(roleConfig.label)}
        </span>
            </div>

      <div class="filter-toolbar-row">
        <div class="filter-controls-group">
          ${renderDateRangeFilter('dashboard-period', {
            label: 'Period',
            value: this.filterRange,
            presets: DASHBOARD_RANGE_PRESETS,
            defaultPreset: DASHBOARD_DEFAULT_RANGE,
            min: (DB.dailySales || []).length ? drDayKey(DB.dailySales[0].date) : '',
          })}
          ${renderTreeFilter('dashboard-brand', {
            label: 'Brand',
            items: brands.map(([k, name]) => ({ value: k, label: name })),
            selected: this.filterBrands,
            searchPlaceholder: 'Search brand',
            emptyText: 'No brands yet.',
          })}
        </div>
        <div class="report-actions">
          ${filtered ? '<button type="button" class="btn-secondary" id="dashboard-reset-filters" style="padding:6px 14px; font-size:12.5px;">Reset Filters</button>' : ''}
          <button type="button" class="btn-secondary report-btn" id="dashboard-report"><i class="fa-solid fa-download"></i> Download Report</button>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-title">Total Sales (${escapeHtml(this.kpiPeriod())})</div><div class="stat-value-row"><span class="stat-prefix">₱</span><span class="stat-value">${formatAmount(stats.periodTotal)}</span></div></div>
        <div class="stat-card"><div class="stat-title">Items Sold (${escapeHtml(this.kpiPeriod())})</div><div class="stat-value-row"><span class="stat-value">${stats.periodUnits}</span></div></div>
        <div class="stat-card"><div class="stat-title">Active Consigned Items</div><div class="stat-value-row"><span class="stat-value">${stats.activeConsignedItems}</span></div></div>
        <div class="stat-card"><div class="stat-title">Monthly Sales Growth</div><div class="stat-value-row">${stats.growthPercent >= 0 ? '<span class="stat-trend">↑</span>' : ''}<span class="stat-value">${stats.growthPercent.toFixed(1)}%</span></div></div>
      </div>

      <div class="chart-row chart-row-equal">
        <div class="chart-card">
          <div class="chart-card-title"><span>Sales Overview</span><span class="period-chip">${this.periodChip()}</span></div>
          <div class="chart-canvas-wrap"><canvas id="chart-sales-overview"></canvas></div>
          <p class="chart-insight">${escapeHtml(notes.overview)}</p>
          </div>
        <div class="chart-card">
          <div class="chart-card-title">
            <span>Customer Interactions</span>
            <span class="period-chip">${this.periodChip()}${this.filterBrands !== null ? ' · All brands' : ''}</span>
          </div>
          <div class="legend-row">
            ${INTERACTION_SERIES.map(([field, label, color]) => `<div class="legend-item"><span class="legend-dot" style="background:${color}"></span>${escapeHtml(label)} (${stats.interactionTotals[field]})</div>`).join('')}
          </div>
          <div class="chart-canvas-wrap"><canvas id="chart-customer-interactions"></canvas></div>
          <p class="chart-insight">${escapeHtml(notes.interactions)}</p>
          </div>
      </div>

      <div class="stat-grid cols-5" style="margin-bottom:20px;">
        <div class="stat-card"><div class="stat-title">Average Display Duration</div><div class="stat-value-row"><span class="stat-value">${stats.avgDisplayDuration === null ? '—' : Math.round(stats.avgDisplayDuration)}</span>${stats.avgDisplayDuration === null ? '' : '<span class="stat-suffix">days</span>'}</div></div>
        <div class="stat-card"><div class="stat-title">Inventory Turnover Rate</div><div class="stat-value-row"><span class="stat-value">${stats.turnoverRate.toFixed(2)}x</span></div></div>
        <div class="stat-card"><div class="stat-title">Total Item Inquiries</div><div class="stat-value-row"><span class="stat-value">${stats.totalInquiries}</span></div></div>
        <div class="stat-card"><div class="stat-title">Fast Moving Items</div><div class="stat-value-row"><span class="stat-value">${stats.fastMovingCount}</span></div></div>
        <div class="stat-card"><div class="stat-title">Slow Moving Items</div><div class="stat-value-row"><span class="stat-value">${stats.slowMovingCount}</span></div></div>
      </div>

      <div class="section-grid dash-bottom-row">
        <div class="chart-card col-narrow">
          <div class="chart-card-title">
            <span>Inventory Performance</span>
            <div>
              ${Object.keys(stats.statusCounts).filter(k => stats.statusCounts[k] > 0).map((k, i) =>
                `<div class="legend-item"><span class="legend-dot sm" style="background:${['#10184F','#3247C5','#6C86FF','#B7B7C0'][i % 4]}"></span>${k}</div>`).join('')}
            </div>
          </div>
          <div class="chart-canvas-wrap short"><canvas id="chart-inventory-performance"></canvas></div>
          <p class="chart-insight">${escapeHtml(notes.inventory)}</p>
          </div>
        <div class="chart-card col-wide">
          <div class="chart-card-title"><span>Actual vs Period Average</span><span class="period-chip">${this.periodChip()}</span></div>
          <div class="chart-canvas-wrap short"><canvas id="chart-actual-vs-average"></canvas></div>
          <p class="chart-insight">${escapeHtml(notes.average)}</p>
          </div>
        <div class="key-insights col-narrow key-insights-scroll">
          <div class="key-insights-title">Key Insights</div>
          <div class="key-insights-body">
            <ul>${insights.map(([label, text]) => `<li><span><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}</span></li>`).join('')}</ul>
          </div>
        </div>
      </div>

      <div class="chart-row" style="margin-top:20px;">
        <div class="chart-card">
          <div class="chart-card-title"><span>Consignment Workflow Status</span><span class="period-chip">Right now${this.filterBrands !== null ? ' · Selected brands' : ''}</span></div>
          <div class="chart-canvas-wrap" style="height:${Math.max(200, pipeline.rows.length * 40 + 30)}px;"><canvas id="chart-pipeline"></canvas></div>
          <p class="chart-insight">${escapeHtml(pipeline.note)}</p>
        </div>
      </div>
    `;
  },
    afterRender() {
    bindDateRangeFilter('dashboard-period', (value) => {
      this.filterRange = value;
      Router.rerender();
    });
    bindTreeFilter('dashboard-brand', (brandKeys) => {
      this.filterBrands = brandKeys;
      Router.rerender();
    });
    document.getElementById('dashboard-reset-filters')?.addEventListener('click', () => {
      this.filterRange = null;
      this.filterBrands = null;
      Router.rerender();
    });

    document.getElementById('dashboard-report')?.addEventListener('click', () => ReportExport.dashboard());

    const stats = this.computeStats();
    DataStore.refreshIfStale();

    makeLineChart('chart-sales-overview', stats.monthLabels, [{
      data: stats.monthlyTotals, borderColor: '#3247C5', backgroundColor: 'rgba(50,71,197,0.12)',
      fill: true, tension: 0.35, pointBackgroundColor: '#3247C5', pointRadius: 4,
    }]);

    const statusEntries = Object.entries(stats.statusCounts).filter(([, v]) => v > 0);
    if (statusEntries.length) {
      makeDoughnutChart('chart-inventory-performance', statusEntries.map(([k]) => k), statusEntries.map(([, v]) => v), ['#10184F', '#3247C5', '#6C86FF', '#B7B7C0']);
    }

    const average = stats.monthlyTotals.length ? stats.monthlyTotals.reduce((a, b) => a + b, 0) / stats.monthlyTotals.length : 0;
    makeLineChart('chart-actual-vs-average', stats.monthLabels, [
      { data: stats.monthLabels.map(() => average), borderColor: '#B7B7C0', borderDash: [6, 4], pointRadius: 0, fill: false },
      { data: stats.monthlyTotals, borderColor: '#3247C5', backgroundColor: 'rgba(50,71,197,0.25)', fill: true, tension: 0.35, pointRadius: 0 },
    ]);

    makeBarChart('chart-customer-interactions', stats.monthLabels,
      INTERACTION_SERIES.map(([field, label, color]) => ({
        label, data: stats.interactions[field], backgroundColor: color, borderRadius: 2, maxBarThickness: 36,
      })),
      { stacked: true });

    const pipeline = this.pipelineByStage();
    makeHorizontalBarChart('chart-pipeline',
      pipeline.rows.map((r) => `${r.label} (${r.count})`),
      pipeline.rows.map((r) => r.count),
      pipeline.rows.map((r) => (r.label === pipeline.topLabel ? '#C9A24A' : '#10184F')),
      { signed: false });
  },
};
