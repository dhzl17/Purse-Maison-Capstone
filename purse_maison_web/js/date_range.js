const DAY_RANGE_PRESETS = [
  ['all', 'All time'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'],
  ['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year'],
];
const MONTH_RANGE_PRESETS = [
  ['1m', 'This month'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['ytd', 'This year'],
];

const DASHBOARD_RANGE_PRESETS = [
  ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['this_month', 'This month'], ['last_month', 'Last month'],
  ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['this_year', 'This year'],
];

const DR_MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DR_WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DR_MAX_MONTHS = 24; // longest custom month range (keeps the monthly charts readable)

const drPad = (n) => String(n).padStart(2, '0');
const drDayKey = (d) => `${d.getFullYear()}-${drPad(d.getMonth() + 1)}-${drPad(d.getDate())}`;
const drMonthKey = (d) => `${d.getFullYear()}-${drPad(d.getMonth() + 1)}`;
function drParse(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function drToday() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }

/** { start, end, preset } for a filter value. end is exclusive; both null for "All time". */
function resolveDateRange(value, mode, defaultPreset) {
  const v = value || { preset: defaultPreset };
  const today = drToday();
  const y = today.getFullYear();
  const m = today.getMonth();
  if (v.from && v.to) {
    const start = drParse(v.from);
    const last = drParse(v.to);
    const end = mode === 'month' ? new Date(last.getFullYear(), last.getMonth() + 1, 1)
      : new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    return { start, end, preset: null };
  }
  const p = v.preset || defaultPreset;
  const nextMonth = new Date(y, m + 1, 1);
  const ranges = {
    all: [null, null],
    today: [today, new Date(y, m, today.getDate() + 1)],
    '7d': [new Date(y, m, today.getDate() - 6), new Date(y, m, today.getDate() + 1)],
    '30d': [new Date(y, m, today.getDate() - 29), new Date(y, m, today.getDate() + 1)],
    this_month: [new Date(y, m, 1), nextMonth],
    last_month: [new Date(y, m - 1, 1), new Date(y, m, 1)],
    this_year: [new Date(y, 0, 1), new Date(y + 1, 0, 1)],
    '1m': [new Date(y, m, 1), nextMonth],
    '3m': [new Date(y, m - 2, 1), nextMonth],
    '6m': [new Date(y, m - 5, 1), nextMonth],
    '12m': [new Date(y, m - 11, 1), nextMonth],
    ytd: [new Date(y, 0, 1), nextMonth],
  };
  const [start, end] = ranges[p] || ranges[defaultPreset];
  return { start, end, preset: ranges[p] ? p : defaultPreset };
}

/** True when the date falls inside the range ("All time" matches everything, missing dates only match "All time"). */
function inDateRange(date, range) {
  if (!range.start) return true;
  if (!date || Number.isNaN(date.getTime())) return false;
  return date >= range.start && date < range.end;
}

/** The months a range covers (oldest first), shaped like lastNMonths(); labels get the year when the range crosses years. */
function dateRangeMonths(range) {
  const start = range.start || new Date(drToday().getFullYear(), drToday().getMonth() - 5, 1);
  const end = range.end || new Date(drToday().getFullYear(), drToday().getMonth() + 1, 1);
  const months = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  const crossYear = months.length && months[0].year !== months[months.length - 1].year;
  return months.map((x) => ({
    ...x,
    label: MONTH_ABBREV[x.month - 1] + (crossYear ? ` '${String(x.year).slice(2)}` : ''),
    fullLabel: DR_MONTHS_FULL[x.month - 1] + (crossYear ? ` ${x.year}` : ''),
  }));
}

/** Button text: the preset's name, or the custom dates ("7 – 11 Apr 2026", "Jan – Mar 2026"). */
function dateRangeLabel(value, mode, defaultPreset) {
  const presets = [...DAY_RANGE_PRESETS, ...DASHBOARD_RANGE_PRESETS, ...MONTH_RANGE_PRESETS];
  if (!value || !value.from) {
    const key = (value && value.preset) || defaultPreset;
    const found = presets.find(([k]) => k === key);
    return found ? found[1] : '';
  }
  const a = drParse(value.from);
  const b = drParse(value.to);
  const mon = (d) => MONTH_ABBREV[d.getMonth()];
  if (mode === 'month') {
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${mon(a)} ${a.getFullYear()}`;
    return a.getFullYear() === b.getFullYear()
      ? `${mon(a)} – ${mon(b)} ${b.getFullYear()}`
      : `${mon(a)} ${a.getFullYear()} – ${mon(b)} ${b.getFullYear()}`;
  }
  if (drDayKey(a) === drDayKey(b)) return `${a.getDate()} ${mon(a)} ${a.getFullYear()}`;
  if (a.getFullYear() !== b.getFullYear()) return `${a.getDate()} ${mon(a)} ${a.getFullYear()} – ${b.getDate()} ${mon(b)} ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)} ${b.getFullYear()}`;
  return `${a.getDate()} – ${b.getDate()} ${mon(b)} ${b.getFullYear()}`;
}

/** True when the value is the page's default (so the page can hide its Reset button). */
function isDefaultDateRange(value, defaultPreset) {
  return !value || (!value.from && (value.preset || defaultPreset) === defaultPreset);
}

/**
 * options: label, value, mode ('day' | 'month'), defaultPreset, min ('YYYY-MM-DD' or 'YYYY-MM', optional)
 * Dates after today can't be picked.
 */
function renderDateRangeFilter(id, { label, value = null, mode = 'day', defaultPreset = mode === 'month' ? '6m' : 'all', min = '', presets: presetList = null }) {
  const presets = presetList || (mode === 'month' ? MONTH_RANGE_PRESETS : DAY_RANGE_PRESETS);
  const current = value && value.from ? 'custom' : ((value && value.preset) || defaultPreset);
  const active = !isDefaultDateRange(value, defaultPreset);
  return `
    <div class="tree-filter date-range" id="${escapeHtml(id)}" data-mode="${mode}" data-default="${escapeHtml(defaultPreset)}"
         data-min="${escapeHtml(min)}" data-from="${escapeHtml((value && value.from) || '')}" data-to="${escapeHtml((value && value.to) || '')}">
      <button type="button" class="tree-filter-button${active ? ' is-active' : ''}" aria-haspopup="true" aria-expanded="false">
        <svg class="date-range-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <span class="tree-filter-button-label">${escapeHtml(label)}:</span>
        <span class="tree-filter-button-value">${escapeHtml(dateRangeLabel(value, mode, defaultPreset))}</span>
        <svg class="tree-filter-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="tree-filter-panel date-range-panel" role="dialog" aria-label="${escapeHtml(label)} filter" hidden>
        <div class="date-range-presets">
          ${presets.map(([k, l]) => `<button type="button" class="date-range-preset${current === k ? ' is-current' : ''}" data-dr-preset="${k}">${escapeHtml(l)}</button>`).join('')}
          <button type="button" class="date-range-preset date-range-custom-btn${current === 'custom' ? ' is-current' : ''}" data-dr-custom>Custom range…</button>
        </div>
        <div class="date-range-custom" hidden>
          <div class="date-range-custom-head">
            <button type="button" class="date-range-x" data-dr-close aria-label="Close custom range">×</button>
            <span>Custom range</span>
          </div>
          <div class="date-range-nav">
            <button type="button" class="date-range-step" data-dr-step="-1" aria-label="Previous">‹</button>
            <span class="date-range-title"></span>
            <button type="button" class="date-range-step" data-dr-step="1" aria-label="Next">›</button>
          </div>
          <div class="date-range-grid ${mode === 'month' ? 'is-months' : 'is-days'}"></div>
          <p class="date-range-hint"></p>
          <div class="tree-filter-footer">
            <button type="button" class="tree-filter-clear" data-dr-cancel>Cancel</button>
            <button type="button" class="tree-filter-apply" data-dr-apply disabled>Apply</button>
          </div>
        </div>
      </div>
    </div>`;
}

function bindDateRangeFilter(id, onApply) {
  const root = document.getElementById(id);
  if (!root) return;
  const mode = root.dataset.mode;
  const isMonth = mode === 'month';
  const button = root.querySelector('.tree-filter-button');
  const panel = root.querySelector('.tree-filter-panel');
  const custom = root.querySelector('.date-range-custom');
  const grid = root.querySelector('.date-range-grid');
  const title = root.querySelector('.date-range-title');
  const hint = root.querySelector('.date-range-hint');
  const applyBtn = root.querySelector('[data-dr-apply]');
  const keyOf = isMonth ? drMonthKey : drDayKey;
  const maxKey = keyOf(drToday());
  const minKey = root.dataset.min ? keyOf(drParse(root.dataset.min)) : '';

  let from = root.dataset.from || '';
  let to = root.dataset.to || '';
  let hover = '';
  const startView = from ? drParse(from) : drToday();
  let view = isMonth ? new Date(startView.getFullYear(), 0, 1) : new Date(startView.getFullYear(), startView.getMonth(), 1);

  const fmt = (key) => {
    const d = drParse(key);
    return isMonth ? `${MONTH_ABBREV[d.getMonth()]} ${d.getFullYear()}` : `${d.getDate()} ${MONTH_ABBREV[d.getMonth()]} ${d.getFullYear()}`;
  };
  const monthsBetween = (a, b) => {
    const x = drParse(a);
    const y = drParse(b);
    return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()) + 1;
  };

  // Calendar cells (rebuilt only when the month/year changes; clicks just repaint the classes)
  const build = () => {
    if (isMonth) {
      title.textContent = String(view.getFullYear());
      grid.innerHTML = MONTH_ABBREV.map((m, i) => {
        const key = drMonthKey(new Date(view.getFullYear(), i, 1));
        const off = key > maxKey || (minKey && key < minKey);
        return `<button type="button" class="date-range-cell" data-dr-key="${key}" ${off ? 'disabled' : ''}>${m}</button>`;
      }).join('');
    } else {
      title.textContent = `${DR_MONTHS_FULL[view.getMonth()]} ${view.getFullYear()}`;
      const first = new Date(view.getFullYear(), view.getMonth(), 1);
      const lead = (first.getDay() + 6) % 7; // weeks start on Monday
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(view.getFullYear(), view.getMonth(), 1 - lead + i);
        const key = drDayKey(d);
        const off = key > maxKey || (minKey && key < minKey);
        const outside = d.getMonth() !== view.getMonth();
        cells.push(`<button type="button" class="date-range-cell${outside ? ' is-outside' : ''}" data-dr-key="${key}" ${off ? 'disabled' : ''}>${d.getDate()}</button>`);
      }
      grid.innerHTML = DR_WEEKDAYS.map((w) => `<span class="date-range-weekday">${w}</span>`).join('') + cells.join('');
    }
    const nextStart = isMonth ? drMonthKey(new Date(view.getFullYear() + 1, 0, 1)) : drDayKey(new Date(view.getFullYear(), view.getMonth() + 1, 1));
    const prevEnd = isMonth ? drMonthKey(new Date(view.getFullYear() - 1, 11, 1)) : drDayKey(new Date(view.getFullYear(), view.getMonth(), 0));
    root.querySelector('[data-dr-step="1"]').disabled = nextStart > maxKey;
    root.querySelector('[data-dr-step="-1"]').disabled = !!minKey && prevEnd < minKey;
    paint();
  };

  const paint = () => {
    const end = to || hover;
    const [a, b] = from && end ? [from, end].sort() : [from, from];
    grid.querySelectorAll('[data-dr-key]').forEach((c) => {
      const k = c.dataset.drKey;
      c.classList.toggle('is-edge', !!from && (k === a || k === b));
      c.classList.toggle('is-in', !!from && !!end && k > a && k < b);
      c.classList.toggle('is-today', k === maxKey);
    });
    const tooLong = isMonth && from && to && monthsBetween(...[from, to].sort()) > DR_MAX_MONTHS;
    if (!from) hint.textContent = isMonth ? 'Click a start month, then an end month.' : 'Click a start date, then an end date.';
    else if (!to) hint.textContent = `From ${fmt(from)}. Now click the end ${isMonth ? 'month' : 'date'}.`;
    else if (tooLong) hint.textContent = `Choose ${DR_MAX_MONTHS} months or fewer.`;
    else {
      const [x, y] = [from, to].sort();
      hint.textContent = dateRangeLabel({ from: x, to: y }, mode);
    }
    hint.classList.toggle('is-error', !!tooLong);
    applyBtn.disabled = !(from && to) || tooLong;
  };

  const openCustom = () => {
    custom.hidden = false;
    root.classList.add('is-custom');
    build();
  };
  const closeCustom = () => {
    custom.hidden = true;
    root.classList.remove('is-custom');
  };
  const close = () => {
    closeCustom();
    closeTreeFilter(root);
  };

  button.addEventListener('click', () => {
    if (panel.hidden) {
      document.querySelectorAll('.tree-filter.is-open').forEach((r) => { if (r !== root) closeTreeFilter(r); });
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      root.classList.add('is-open');
      closeCustom();
      if (root.dataset.from) openCustom();
    } else close();
  });

  // Same page-wide "click outside closes it" listener the other filters use
  if (!_treeFilterDocBound) {
    _treeFilterDocBound = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.tree-filter.is-open').forEach((r) => { if (!r.contains(e.target)) closeTreeFilter(r); });
    });
  }
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); button.focus(); }
  });

  root.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-dr-preset]');
    if (preset) { close(); onApply({ preset: preset.dataset.drPreset }); return; }
    if (e.target.closest('[data-dr-custom]')) { if (custom.hidden) openCustom(); else closeCustom(); return; }
    if (e.target.closest('[data-dr-close]') || e.target.closest('[data-dr-cancel]')) { closeCustom(); return; }
    const step = e.target.closest('[data-dr-step]');
    if (step) {
      const n = Number(step.dataset.drStep);
      view = isMonth ? new Date(view.getFullYear() + n, 0, 1) : new Date(view.getFullYear(), view.getMonth() + n, 1);
      build();
      return;
    }
    const cell = e.target.closest('[data-dr-key]');
    if (cell && !cell.disabled) {
      const k = cell.dataset.drKey;
      if (!from || to) { from = k; to = ''; } else { to = k; }
      hover = '';
      paint();
      return;
    }
    if (e.target.closest('[data-dr-apply]') && from && to) {
      const [x, y] = [from, to].sort();
      close();
      onApply({ from: x, to: y });
    }
  });

  grid.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('[data-dr-key]');
    if (!cell || cell.disabled || !from || to) return;
    hover = cell.dataset.drKey;
    paint();
  });
  grid.addEventListener('mouseleave', () => { if (hover) { hover = ''; paint(); } });
}