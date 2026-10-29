/**
 * Dashboard page. Every KPI and chart is computed from DB.* arrays, which
 * js/store.js fills from Supabase after login.
 */

const DASHBOARD_PERIODS = [[3, 'Last 3 Months'], [6, 'Last 6 Months'], [12, 'Last 12 Months']];

// Customer Interactions chart: [field in DB.customerInteractions, legend label, colour]
const INTERACTION_SERIES = [
  ['consigned', 'Consigned', '#10184F'],
  ['consignorNotProceeded', 'Consignor did not proceed', '#C9A24A'],
  ['buyerPurchased', 'Buyer purchased', '#3247C5'],
  ['buyerNotProceeded', 'Buyer only inquired', '#B7B7C0'],
];

const DashboardPage = {
  filterPeriod: 6,     
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

  periodLabel() {
    const found = DASHBOARD_PERIODS.find(([v]) => v === this.filterPeriod);
    return found ? found[1] : `Last ${this.filterPeriod} Months`;
  },

  computeStats() {
    const brandSet = this.filterBrands === null ? null : new Set(this.filterBrands);
    const brandOk = (name) => brandSet === null || brandSet.has(this.brandKeyOf(name));
    const inventory = DB.inventory.filter((i) => brandOk(i.brand));
    const salesSeries = DB.salesSeries.filter((s) => brandSet === null || brandSet.has(s.brandKey)); // monthly revenue incl. imported history

    const months = lastNMonths(this.filterPeriod);
    const monthLabels = months.map((m) => m.label);
    const monthlyTotals = monthlySalesTotals(salesSeries, months);
    const periodStart = new Date(months[0].year, months[0].month - 1, 1);
    const periodTotal = monthlyTotals.reduce((a, b) => a + b, 0);
    const periodUnits = salesSeries.filter((s) => s.date >= periodStart).reduce((sum, s) => sum + (s.units || 0), 0);

    // Verified sales in the system, for the selected brand and period (used for display duration)
    const inventoryById = Object.fromEntries(DB.inventory.map((i) => [i.id, i]));
    const transactions = DB.salesTransactions.filter((t) => {
      const item = inventoryById[t.itemId];
      return item && brandOk(item.brand) && t.date >= periodStart;
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

    // Customer interactions per month (all brands: inquiries are not filtered by brand)
    const interactionRows = DB.customerInteractions || [];
    const interactions = {};
    for (const [field] of INTERACTION_SERIES) {
      interactions[field] = months.map((m) => interactionRows
        .filter((r) => r.date.getFullYear() === m.year && r.date.getMonth() + 1 === m.month)
        .reduce((sum, r) => sum + r[field], 0));
    }
    const sumOf = (field) => interactions[field].reduce((a, b) => a + b, 0);
    const interactionTotals = Object.fromEntries(INTERACTION_SERIES.map(([field]) => [field, sumOf(field)]));

    return { itemsSold, activeConsignedItems, thisMonthTotal, lastMonthTotal, growthPercent, periodTotal, periodUnits, avgDisplayDuration, soldWithDates: displayDurations.length, turnoverRate, totalInquiries: DB.inquiryCount, fastMovingCount, slowMovingCount, monthLabels, monthlyTotals, statusCounts, interactions, interactionTotals };
  },

    /**
   * Key Insights: one plain-language line per KPI card, as [label, text]. Rule-based (no AI):
   * the sentences are fixed templates filled in with the same numbers the cards show.
   */
  buildInsights(stats) {
    const peso = (v) => `₱${formatAmount(v)}`;
    const pct = (v) => `${Math.abs(v).toFixed(1)}%`;
    const months = this.filterPeriod;
    const period = this.periodLabel().toLowerCase();
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const insights = [];

    if (this.filterBrands !== null) {
      const names = this.brandOptions().filter(([k]) => this.filterBrands.includes(k)).map(([, name]) => name);
      const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
      insights.push(['Filter', `Showing ${shown || 'no brands'} only.`]);
    }

    insights.push(['Total Sales', stats.periodTotal > 0
      ? `${peso(stats.periodTotal)} over the ${period}, about ${peso(stats.periodTotal / months)} a month.`
      : `No sales in the ${period}.`]);
    insights.push(['Items Sold', stats.periodUnits > 0
      ? `${plural(stats.periodUnits, 'item')} sold, about ${Math.round(stats.periodUnits / months)} a month at an average of ${peso(stats.periodTotal / stats.periodUnits)} each.`
      : 'No items sold in this period.']);

    const perMonth = stats.periodUnits / months;
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
    insights.push(['Total Item Inquiries', `${stats.totalInquiries.toLocaleString('en-PH')} client inquiries recorded in total. In the ${period}, ${buyers} came from buyers and ${consignors} from consignors.`]);

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
    const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const full = (abbr) => FULL[MONTH_ABBREV.indexOf(abbr)] || abbr;
    const range = (list) => (list.length > 1 ? `${full(list[0])} to ${full(list[list.length - 1])}` : full(list[0]));
    const labels = stats.monthLabels;
    const totals = stats.monthlyTotals;
    const cur = totals.length - 1;           // the current month (still in progress)
    const done = totals.slice(0, cur);       // complete months only
    const doneLabels = labels.slice(0, cur);
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const progress = `day ${today.getDate()} of ${daysInMonth}`;

    let scope = '';
    if (this.filterBrands !== null) {
      const names = this.brandOptions().filter(([k]) => this.filterBrands.includes(k)).map(([, name]) => name);
      scope = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `the ${names.length} selected brands`;
    }
    const notes = {};

    if (!done.some((v) => v > 0)) {
      notes.overview = `No revenue was recorded${scope ? ` for ${scope}` : ''} in the completed months of this period.`;
      notes.average = notes.overview;
    } else {
      const avgDone = done.reduce((a, b) => a + b, 0) / done.length;
      const hi = done.indexOf(Math.max(...done));
      const lo = done.indexOf(Math.min(...done));
      const span = done.length > 6 ? `over the past ${done.length} completed months` : `from ${range(doneLabels)}`;
      let text = `${scope ? `For ${scope}, r` : 'R'}evenue averaged ${short(avgDone)} per month ${span}`
        + (hi !== lo ? `, peaking at ${short(done[hi])} in ${full(doneLabels[hi])} and reaching a low of ${short(done[lo])} in ${full(doneLabels[lo])}.` : '.');
      if (done.length >= 2) {
        const split = Math.ceil(done.length / 2);
        const early = done.slice(0, split);
        const late = done.slice(split);
        const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
        if (avg(early) > 0) {
          const change = ((avg(late) - avg(early)) / avg(early)) * 100;
          const earlyName = range(doneLabels.slice(0, split));
          const lateName = range(doneLabels.slice(split));
          text += Math.abs(change) < 5
            ? ` Average monthly revenue remained stable between ${earlyName} and ${lateName}.`
            : (early.length === 1 && late.length === 1
              ? ` Revenue in ${lateName} was ${pct(change)} ${change > 0 ? 'higher' : 'lower'} than in ${earlyName}.`
              : ` Average monthly revenue for ${lateName} was ${pct(change)} ${change > 0 ? 'higher' : 'lower'} than for ${earlyName}.`);
        }
      }
      text += ` ${full(labels[cur])} is in progress (${progress}), with ${short(totals[cur])} recorded to date.`;
      notes.overview = text;

      const average = totals.reduce((a, b) => a + b, 0) / totals.length;
      const last = done.length - 1;
      const above = done.filter((v) => v > average).length;
      const diff = average > 0 ? ((done[last] - average) / average) * 100 : 0;
      const curDiff = average > 0 ? ((totals[cur] - average) / average) * 100 : 0;
      const daysLeft = daysInMonth - today.getDate();
      notes.average = `${scope ? `For ${scope}, m` : 'M'}onthly revenue averaged ${short(average)} over the ${this.periodLabel().toLowerCase()}, including ${full(labels[cur])}'s partial figures. `
        + `${above} of ${done.length} completed ${done.length === 1 ? 'month' : 'months'} exceeded this average, with ${full(doneLabels[last])} finishing ${pct(diff)} ${diff >= 0 ? 'above' : 'below'} it. `
        + `${full(labels[cur])} currently stands at ${short(totals[cur])}, ${pct(curDiff)} ${curDiff >= 0 ? 'above' : 'below'} the average, `
        + `${daysLeft ? `with ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} remaining` : 'on the last day of the month'}.`;
    }

    const t = stats.interactionTotals;
    const buyers = t.buyerPurchased + t.buyerNotProceeded;
    const consignors = t.consigned + t.consignorNotProceeded;
    if (!buyers && !consignors) {
      notes.interactions = `No client inquiries were completed in the ${this.periodLabel().toLowerCase()}.`;
    } else {
      const share = (part, whole) => Math.round((part / whole) * 100);
      const portion = (p) => (p >= 90 ? 'nearly all' : p >= 70 ? 'most' : p >= 56 ? 'more than half'
        : p > 50 ? 'just over half' : p === 50 ? 'half' : p >= 25 ? 'fewer than half' : 'a small share');
      const group = (p, noun) => (['nearly all', 'most'].includes(portion(p)) ? `${portion(p)} ${noun}` : `${portion(p)} of ${noun}`);
      const total = buyers + consignors;
      const mix = [consignors ? `${consignors} from consignors` : null, buyers ? `${buyers} from buyers` : null].filter(Boolean).join(' and ');
      let text = `A total of ${total} ${total === 1 ? 'inquiry was' : 'inquiries were'} completed in the ${this.periodLabel().toLowerCase()}: ${mix}.`;

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

      const perMonth = labels.map((_, i) => INTERACTION_SERIES.reduce((sum, [field]) => sum + stats.interactions[field][i], 0));
      const doneMonths = perMonth.slice(0, cur);
      if (doneMonths.some((v) => v > 0)) {
        const top = doneMonths.indexOf(Math.max(...doneMonths));
        text += ` ${full(labels[top])} recorded the highest volume with ${perMonth[top]} inquiries.`;
      }

      const months = lastNMonths(this.filterPeriod);
      const open = (DB.customerInteractions || [])
        .filter((r) => months.some((m) => r.date.getFullYear() === m.year && r.date.getMonth() + 1 === m.month))
        .reduce((sum, r) => sum + (r.inProgress || 0), 0);
      if (open) text += ` ${open} ${open === 1 ? 'inquiry remains' : 'inquiries remain'} open.`;
      if (this.filterBrands !== null) text += ' Inquiry figures include all brands.';
      notes.interactions = text;
    }

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
      const perMonth = stats.periodUnits / this.filterPeriod;
      if (available && perMonth > 0) {
        text += ` At the recent pace of about ${Math.round(perMonth)} sales per month, available stock would last roughly ${(available / perMonth).toFixed(1)} months.`;
      }
      notes.inventory = text;
    }
    return notes;
  },

  render() {
    const brands = this.brandOptions();
    if (this.filterBrands !== null) {
      this.filterBrands = this.filterBrands.filter((k) => brands.some(([b]) => b === k));
      if (!this.filterBrands.length) this.filterBrands = null;
    }
    const filtered = this.filterBrands !== null || this.filterPeriod !== 6;
    const stats = this.computeStats();
    const insights = this.buildInsights(stats);
    const notes = this.chartNotes(stats);
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
          ${renderTreeFilter('dashboard-period', {
            label: 'Period',
            items: DASHBOARD_PERIODS.map(([v, l]) => ({ value: v, label: l })),
            selected: this.filterPeriod,
            single: true,
            defaultValue: 6,
          })}
          ${renderTreeFilter('dashboard-brand', {
            label: 'Brand',
            items: brands.map(([k, name]) => ({ value: k, label: name })),
            selected: this.filterBrands,
            searchPlaceholder: 'Search brand',
            emptyText: 'No brands yet.',
          })}
        </div>
        ${filtered ? '<button type="button" class="btn-secondary" id="dashboard-reset-filters" style="padding:6px 14px; font-size:12.5px;">Reset Filters</button>' : ''}
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-title">Total Sales (${escapeHtml(this.periodLabel())})</div><div class="stat-value-row"><span class="stat-prefix">₱</span><span class="stat-value">${formatAmount(stats.periodTotal)}</span></div></div>
        <div class="stat-card"><div class="stat-title">Items Sold (${escapeHtml(this.periodLabel())})</div><div class="stat-value-row"><span class="stat-value">${stats.periodUnits}</span></div></div>
        <div class="stat-card"><div class="stat-title">Active Consigned Items</div><div class="stat-value-row"><span class="stat-value">${stats.activeConsignedItems}</span></div></div>
        <div class="stat-card"><div class="stat-title">Monthly Sales Growth</div><div class="stat-value-row">${stats.growthPercent >= 0 ? '<span class="stat-trend">↑</span>' : ''}<span class="stat-value">${stats.growthPercent.toFixed(1)}%</span></div></div>
      </div>

      <div class="chart-row chart-row-equal">
        <div class="chart-card">
          <div class="chart-card-title"><span>Sales Overview</span><span class="period-chip">${this.filterPeriod} Months</span></div>
          <div class="chart-canvas-wrap"><canvas id="chart-sales-overview"></canvas></div>
          <p class="chart-insight">${escapeHtml(notes.overview)}</p>
          </div>
        <div class="chart-card">
          <div class="chart-card-title">
            <span>Customer Interactions</span>
            <span class="period-chip">${this.filterPeriod} Months${this.filterBrands !== null ? ' · All brands' : ''}</span>
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
          <div class="chart-card-title"><span>Actual vs ${this.filterPeriod}-Month Average</span><span class="period-chip">${this.filterPeriod} Months</span></div>
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
    `;
  },
    afterRender() {
    bindTreeFilter('dashboard-period', (value) => {
      this.filterPeriod = parseInt(value, 10) || 6;
      Router.rerender();
    });
    bindTreeFilter('dashboard-brand', (brandKeys) => {
      this.filterBrands = brandKeys;
      Router.rerender();
    });
    document.getElementById('dashboard-reset-filters')?.addEventListener('click', () => {
      this.filterPeriod = 6;
      this.filterBrands = null;
      Router.rerender();
    });

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
  },
};
