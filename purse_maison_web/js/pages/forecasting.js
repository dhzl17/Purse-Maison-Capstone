/**
 * Sales Forecasting page. Shows the latest ARIMA forecast saved in Supabase
 * (loaded by js/store.js). The model itself runs as a scheduled job; owners and
 * managers can request a new run with the button below.
 */

const ForecastingPage = {
  selectedBrands: null,
  selectedTrends: null,   
  selectedMonths: 'all',
  page: 1,
  pageSize: 6,
  alertPage: 1,
  alertPageSize: 5,

  trendBadge(trend) {
    const map = { increasing: ['▲ Increasing', 'success'], decreasing: ['▼ Decreasing', 'danger'], stable: ['▬ Stable', 'warning'] };
    const [label, tone] = map[trend] || map.stable;
    return badge(label, tone);
  },

    /** How many forecast months are shown (the full forecast unless a shorter period is picked). */
  monthsShown() {
    const max = DB.forecastMeta.horizon || 0;
    return this.selectedMonths === 'all' ? max : Math.min(Number(this.selectedMonths) || max, max);
  },

  /** Shorter forecast periods to offer (the full forecast is always the last choice). */
  monthOptions() {
    const max = DB.forecastMeta.horizon || 0;
    return [3, 6, 12].filter((n) => n < max);
  },

  /**
   * Brand summaries for the first n forecast months. Uses the same rules as store.js:
   * historical = the same number of months just before the forecast starts, and growth
   * beyond +/-GROWTH_STABLE_BAND % counts as increasing or decreasing.
   */
  summaryFor(n) {
    if (!n || n >= (DB.forecastMeta.horizon || 0)) return DB.salesForecasts;
    return DB.salesForecasts.map((f) => {
      const rows = DB.forecastRows.filter((r) => r.brandKey === f.brandKey)
        .sort((a, b) => a.month - b.month)
        .slice(0, n);
      if (!rows.length) return f;
      const first = rows[0].month;
      const histStart = new Date(first.getFullYear(), first.getMonth() - rows.length, 1);
      const historical = DB.salesSeries
        .filter((s) => s.brandKey === f.brandKey && s.date >= histStart && s.date < first)
        .reduce((sum, s) => sum + s.amount, 0);
      const projected = rows.reduce((sum, r) => sum + r.revenue, 0);
      const growth = historical > 0 ? Math.round(((projected - historical) / historical) * 1000) / 10 : null;
      let trend = 'stable';
      if (growth !== null && growth > GROWTH_STABLE_BAND) trend = 'increasing';
      else if (growth !== null && growth < -GROWTH_STABLE_BAND) trend = 'decreasing';
      return Object.assign({}, f, {
        months: rows.length,
        historicalValue: historical,
        projectedValue: projected,
        historicalSales: formatAmount(historical),
        projectedSales: formatAmount(projected),
        projectedGrowthPercent: growth,
        trend,
      });
    });
  },

  /** Brands that match every filter, highest projected sales first. */
  visibleRows() {
    return this.summaryFor(this.monthsShown())
      .filter((f) => this.selectedBrands === null || this.selectedBrands.includes(f.brandKey))
      .filter((f) => this.selectedTrends === null || this.selectedTrends.includes(f.trend))
      .sort((a, b) => b.projectedValue - a.projectedValue);
  },

  visibleAlerts(rows) {
    if (!this.hasActiveFilter()) return DB.predictionAlerts;
    const meta = DB.forecastMeta;
    const when = meta.generatedAt ? DataStore.formatDateTime(meta.generatedAt) : '';
    const alerts = [];
    for (const s of rows) {
      if (s.projectedGrowthPercent === null) continue;
      if (s.projectedGrowthPercent >= ALERT_GROWTH_PERCENT) {
        alerts.push(`Demand for ${s.brand} is projected to rise ${s.projectedGrowthPercent}% over the next ${s.months} months.`);
      } else if (s.projectedGrowthPercent <= -ALERT_GROWTH_PERCENT) {
        alerts.push(`Demand for ${s.brand} is projected to fall ${Math.abs(s.projectedGrowthPercent)}% over the next ${s.months} months. Consider reducing inventory.`);
      }
    }
    if (meta.skipped && meta.skipped.length) {
      const names = meta.skipped.map((k) => k.brand).sort((a, b) => a.localeCompare(b));
      alerts.push(`${names.length} brand(s) were not forecast because they had too few months with sales: ${names.join(', ')}.`);
    }
    if (meta.latestRun && meta.latestRun.status === 'failed') {
      alerts.push(`The last forecast run failed: ${meta.latestRun.error_message || 'no details recorded'}.`);
    }
    return alerts.map((description, i) => ({ id: `pa-f-${i}`, description, timestamp: when }));
  },

  hasActiveFilter() {
    return this.selectedBrands !== null || this.selectedTrends !== null || this.selectedMonths !== 'all';
  },

  canRequestForecast() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'superAdmin' || role === 'manager';
  },

  runIsBusy() {
    const run = DB.forecastMeta.latestRun;
    return !!run && (run.status === 'queued' || run.status === 'running');
  },

  render() {
    if (this.selectedBrands !== null) {
      this.selectedBrands = this.selectedBrands.filter((k) => DB.salesForecasts.some((f) => f.brandKey === k));
      if (!this.selectedBrands.length) this.selectedBrands = null;
    }
    if (this.selectedMonths !== 'all' && !this.monthOptions().includes(this.selectedMonths)) this.selectedMonths = 'all';
    const meta = DB.forecastMeta;
    const hasForecast = DB.salesForecasts.length > 0;
    const rows = this.visibleRows();
    const run = meta.latestRun;
    const horizon = this.monthsShown() || meta.horizon || 6;
    const busy = this.runIsBusy();

    const totalPages = Math.max(1, Math.ceil(rows.length / this.pageSize));
    this.page = Math.min(Math.max(1, this.page), totalPages);
    const pageRows = rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize);

    const alerts = this.visibleAlerts(rows);
    const alertPages = Math.max(1, Math.ceil(alerts.length / this.alertPageSize));
    this.alertPage = Math.min(Math.max(1, this.alertPage), alertPages);
    const pageAlerts = alerts.slice((this.alertPage - 1) * this.alertPageSize, this.alertPage * this.alertPageSize);

    const runBadge = run && run.status !== 'completed'
      ? ' ' + badge(run.status === 'failed' ? 'Last run failed' : run.status === 'running' ? 'Running now' : 'Queued',
                    run.status === 'failed' ? 'danger' : 'warning')
      : '';
    const statusLine = hasForecast
      ? `Last updated ${escapeHtml(DataStore.formatDateTime(meta.generatedAt))} · Model: ARIMA${meta.avgMae !== null ? ` · Average error (MAE): ₱${formatAmount(meta.avgMae)}` : ''}`
      : 'No forecast has been generated yet.';

    return `
      <h1 class="page-title">Sales Forecasting</h1>

    <div class="card" style="margin-bottom:20px;">
      <div class="card-title" style="margin-bottom:14px;">Forecast Status &amp; Filter</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
          <div class="filter-controls-group">
            ${renderTreeFilter('forecast-brand', {
              label: 'Brand',
              items: DB.salesForecasts.map((f) => ({ value: f.brandKey, label: f.brand })),
              selected: this.selectedBrands,
              searchPlaceholder: 'Search brand',
              emptyText: 'No forecast yet.',
            })}
            ${renderTreeFilter('forecast-trend', {
              label: 'Trend',
              items: [['increasing', 'Increasing'], ['stable', 'Stable'], ['decreasing', 'Decreasing']].map(([v, l]) => ({ value: v, label: l })),
              selected: this.selectedTrends,
            })}
            ${hasForecast ? renderTreeFilter('forecast-months', {
              label: 'Forecast Period',
              items: [
                ...this.monthOptions().map((n) => ({ value: n, label: `Next ${n} Months` })),
                { value: 'all', label: meta.horizon ? `Next ${meta.horizon} Months` : 'All Months' },
              ],
              selected: this.selectedMonths,
              single: true,
              defaultValue: 'all',
            }) : ''}
            ${this.hasActiveFilter() ? '<button type="button" class="btn-secondary" id="forecast-reset-filters" style="padding:6px 14px; font-size:12.5px;">Reset Filters</button>' : ''}
          </div>
          ${this.canRequestForecast() ? `<button class="btn-confirm" id="btn-request-forecast" ${busy ? 'disabled' : ''}>${busy ? 'Forecast in progress…' : 'Request New Forecast'}</button>` : ''}
        </div>
        <div class="cell-muted" style="margin-top:12px;font-size:12.5px;">${statusLine}${runBadge}</div>
        ${hasForecast ? '' : `<div class="cell-muted" style="margin-top:8px;font-size:12.5px;">A forecast needs enough monthly sales history per brand (12 months or more). It will appear here once the client's historical sales are imported and the forecast job has run.</div>`}
      </div>

      <div class="chart-row">
        <div class="chart-card">
          <div class="card-title" style="margin-bottom:14px;">Sales Trend (Actual vs Projected)</div>
          <div class="legend-row">
            <div class="legend-item"><span class="legend-dot" style="background:#3247C5"></span>Actual</div>
            <div class="legend-item"><span class="legend-dot" style="background:#fff;border:2px solid #3247C5;box-sizing:border-box;"></span>This month so far</div>
            <div class="legend-item"><span class="legend-dot" style="background:#8D8D99"></span>Projected (ARIMA)</div>
            <div class="legend-item"><span class="legend-dot" style="background:rgba(50,71,197,0.18);border-radius:3px;"></span>Likely range (95%)</div>
          </div>
          <div class="chart-canvas-wrap"><canvas id="chart-sales-trend"></canvas></div>
                    <p class="chart-insight" id="trend-insight"></p>
        </div>
        <div class="chart-card">
          <div class="card-title" style="margin-bottom:14px;">Projected Growth by Brand</div>
          <div class="legend-row">
            <div class="legend-item"><span class="legend-dot" style="background:#2FB344"></span>Increasing</div>
            <div class="legend-item"><span class="legend-dot" style="background:#C98A1B"></span>Stable (within ±${GROWTH_STABLE_BAND}%)</div>
            <div class="legend-item"><span class="legend-dot" style="background:#D64545"></span>Decreasing</div>
          </div>
          <div class="chart-canvas-wrap"><canvas id="chart-brand-forecast"></canvas></div>
          <p class="chart-insight" id="growth-insight"></p>
        </div>
      </div>

      <div class="section-grid">
        <div class="chart-card col-wide">
          <div class="toolbar-row" style="margin-bottom:12px;">
            <span class="card-title">Brand Forecasts</span>
          </div>
          <div class="table-scroll">
            <table class="data-table forecast-table">
              <thead><tr><th class="fc-brand">Brand</th><th class="fc-hist">Historical (₱)</th><th class="fc-proj">Projected (₱)</th><th class="fc-growth">Growth %</th><th class="fc-trend">Trend</th><th class="fc-mae">Avg. Error (MAE)</th></tr></thead>
              <tbody>
                ${rows.length === 0 ? `<tr><td colspan="6" class="cell-center cell-muted" style="padding:24px;text-align:center;">${hasForecast ? 'No brands match the selected filters.' : 'No forecast to show yet.'}</td></tr>` : pageRows.map((f) => {
                  const g = f.projectedGrowthPercent;
                  return `
                  <tr>
                    <td class="fc-brand cell-bold">${escapeHtml(f.brand)}</td>
                    <td class="fc-hist">${escapeHtml(f.historicalSales)}</td>
                    <td class="fc-proj">${escapeHtml(f.projectedSales)}</td>
                    <td class="fc-growth" style="color:${g === null ? 'inherit' : g >= 0 ? 'var(--green)' : 'var(--danger-red)'};font-weight:600;">${g === null ? '—' : `${g >= 0 ? '+' : ''}${g}%`}</td>
                    <td class="fc-trend">${this.trendBadge(f.trend)}</td>
                    <td class="fc-mae">${f.mae === null ? '—' : '₱' + formatAmount(f.mae)}</td>
                  </tr>`;
                }).join('')}${fillerRows(pageRows.length, this.pageSize, 6, totalPages)}
              </tbody>
            </table>
          </div>
          ${totalPages > 1 ? `<div class="pagination" id="forecast-pagination">${renderPaginationButtons(this.page, totalPages)}</div>` : ''}
        </div>
        <div class="chart-card col-narrow">
          <div class="card-title" style="margin-bottom:14px;">Prediction Alerts</div>
          <div class="alerts-list">${pageAlerts.map((a) => `
            <div class="feed-item">
              <div class="feed-desc">${escapeHtml(a.description)}</div>
              <div class="feed-time">${escapeHtml(a.timestamp)}</div>
            </div>`).join('') || `<p class="cell-muted">${this.hasActiveFilter() ? 'No alerts for the selected filters.' : 'No alerts yet.'}</p>`}</div>
          ${alertPages > 1 ? `<div class="pagination" id="alerts-pagination">${renderPaginationButtons(this.alertPage, alertPages)}</div>` : ''}
        </div>
      </div>
    `;
  },

  afterRender() {
    bindTreeFilter('forecast-brand', (brandKeys) => {
      this.selectedBrands = brandKeys;
      this.page = 1;
      this.alertPage = 1;
      Router.rerender();
    });
    bindTreeFilter('forecast-trend', (trends) => {
      this.selectedTrends = trends;
      this.page = 1;
      this.alertPage = 1;
      Router.rerender();
    });
    bindTreeFilter('forecast-months', (value) => {
      this.selectedMonths = value === 'all' ? 'all' : parseInt(value, 10);
      this.page = 1;
      this.alertPage = 1;
      Router.rerender();
    });
    document.getElementById('forecast-reset-filters')?.addEventListener('click', () => {
      this.selectedBrands = null;
      this.selectedTrends = null;
      this.selectedMonths = 'all';
      this.page = 1;
      this.alertPage = 1;
      Router.rerender();
    });
    document.getElementById('forecast-pagination')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      this.page = parseInt(btn.dataset.page, 10);
      Router.rerender();
    });
    document.getElementById('alerts-pagination')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      this.alertPage = parseInt(btn.dataset.page, 10);
      Router.rerender();
    });
    document.getElementById('btn-request-forecast')?.addEventListener('click', () => this.requestForecast());

    this.drawTrendChart();

    this.drawGrowthChart();

    DataStore.refreshIfStale();
  },

   /** Projected growth % per brand (ARIMA forecast vs the same number of months before it), highest first. */
  drawGrowthChart() {
    const rows = this.visibleRows()
      .filter((f) => f.projectedGrowthPercent !== null)
      .sort((a, b) => b.projectedGrowthPercent - a.projectedGrowthPercent);
    const colours = { increasing: '#2FB344', stable: '#C98A1B', decreasing: '#D64545' };
    makeHorizontalBarChart('chart-brand-forecast',
      rows.map((f) => f.brand),
      rows.map((f) => f.projectedGrowthPercent),
      rows.map((f) => colours[f.trend] || colours.stable),
      { valueSuffix: '%' });
    const growthNote = document.getElementById('growth-insight');
    if (growthNote) growthNote.textContent = this.growthInsight(rows);
  },

  /** Plain-language summary under the Sales Trend chart, built from the ARIMA numbers (no AI). */
  trendInsight(labels, actual, projected, upper, lower, lastActual) {
    const peso = (v) => `₱${formatAmount(v)}`;
    const ahead = projected.map((v, i) => i).filter((i) => i > lastActual && projected[i] !== null);
    if (!ahead.length) return 'No forecast to describe yet. Run a forecast to see the projected trend.';
    const first = ahead[0];
    const last = ahead[ahead.length - 1];
    const parts = [];
    let sentence = `Sales for ${labels[first]} are projected at about ${peso(projected[first])}`;
    if (lastActual >= 0 && actual[lastActual] > 0) {
      const change = ((projected[first] - actual[lastActual]) / actual[lastActual]) * 100;
      sentence += Math.abs(change) < 0.5
        ? `, about the same as ${labels[lastActual]}`
        : `, ${Math.abs(change).toFixed(1)}% ${change > 0 ? 'higher' : 'lower'} than ${labels[lastActual]} (${peso(actual[lastActual])})`;
    }
    parts.push(`${sentence}.`);
    if (upper[first] !== null && lower[first] !== null) {
      parts.push(`Actual sales will most likely fall between ${peso(lower[first])} and ${peso(upper[first])}.`);
    }
    if (ahead.length > 1 && projected[first] > 0) {
      const drift = ((projected[last] - projected[first]) / projected[first]) * 100;
      parts.push(Math.abs(drift) <= GROWTH_STABLE_BAND
        ? `Over the next ${ahead.length} months the projection stays fairly steady, so plan for similar sales each month.`
        : `Over the next ${ahead.length} months the projection ${drift > 0 ? 'rises' : 'falls'} by about ${Math.abs(drift).toFixed(1)}% by ${labels[last]}.`);
    }
    return parts.join(' ');
  },

  /** Plain-language summary under the Growth by Brand chart (rows are sorted highest growth first). */
  growthInsight(rows) {
    if (!rows.length) return 'No brand forecasts to compare yet.';
    const fmt = (v) => `${v > 0 ? '+' : ''}${v}%`;
    if (rows.length === 1) return `${rows[0].brand} is projected at ${fmt(rows[0].projectedGrowthPercent)} compared with the same number of months before the forecast.`;
    const count = (t) => rows.filter((f) => f.trend === t).length;
    const top = rows[0];
    const bottom = rows[rows.length - 1];
    const parts = [`Of ${rows.length} brands, ${count('increasing')} are projected to grow, ${count('stable')} to stay stable and ${count('decreasing')} to decline.`];
    if (top.projectedGrowthPercent > 0) parts.push(`${top.brand} leads at ${fmt(top.projectedGrowthPercent)}, making it a strong brand to prioritise for new consignments.`);
    if (bottom.trend === 'decreasing') parts.push(`${bottom.brand} shows the largest drop (${fmt(bottom.projectedGrowthPercent)}); consider reviewing its pricing or how many items are accepted.`);
    return parts.join(' ');
  },

  /**
   * Last 6 complete months of actual sales, then the forecast months, as one timeline.
   * The current month is still in progress, so its sales so far are shown as a separate hollow
   * point instead of a drop in the line, and the forecast line joins the last complete month.
   * The shaded band is the likely range (95%) saved by the forecast job.
   */
  drawTrendChart() {
    const keyOf = (y, m) => `${y}-${m}`;
    const visible = new Set(this.visibleRows().map((f) => f.brandKey));
    const narrowed = this.selectedBrands !== null || this.selectedTrends !== null;
    const brandOk = (b) => (narrowed ? visible.has(b) : true);

    const firstForecast = DB.forecastRows.reduce((min, r) => (!min || r.month < min ? r.month : min), null);
    const cutoff = firstForecast ? new Date(firstForecast.getFullYear(), firstForecast.getMonth() + this.monthsShown(), 1) : null;

    const recent = lastNMonths(7);            // 6 complete months + the current month
    const actualMonths = recent.slice(0, 6);
    const current = recent[6];
    const series = DB.salesSeries.filter((s) => brandOk(s.brandKey));
    const actualByKey = new Map(actualMonths.map((m) => [keyOf(m.year, m.month), monthlySalesTotals(series, [m])[0]]));
    const currentSoFar = monthlySalesTotals(series, [current])[0];

    const forecastByKey = new Map();
    const spreadByKey = new Map();
    for (const r of DB.forecastRows) {
      if (!brandOk(r.brandKey)) continue;
      if (cutoff && r.month >= cutoff) continue;
      const k = keyOf(r.month.getFullYear(), r.month.getMonth() + 1);
      forecastByKey.set(k, (forecastByKey.get(k) || 0) + r.revenue);
      if (r.lower !== null && r.upper !== null) {
        const half = (r.upper - r.lower) / 2;
        spreadByKey.set(k, (spreadByKey.get(k) || 0) + half * half);
      }
    }

    const timeline = new Map();
    actualMonths.forEach((m) => timeline.set(keyOf(m.year, m.month), { year: m.year, month: m.month }));
    timeline.set(keyOf(current.year, current.month), { year: current.year, month: current.month });
    for (const k of forecastByKey.keys()) {
      const [y, m] = k.split('-').map(Number);
      timeline.set(k, { year: y, month: m });
    }
    const ordered = [...timeline.entries()].sort((a, b) => a[1].year - b[1].year || a[1].month - b[1].month);
    const currentKey = keyOf(current.year, current.month);

    const thisYear = new Date().getFullYear();
    const labels = ordered.map(([k, t]) => MONTH_ABBREV[t.month - 1] + (t.year !== thisYear ? ` '${String(t.year).slice(2)}` : '') + (k === currentKey ? ' (so far)' : ''));
    const actual = ordered.map(([k]) => (actualByKey.has(k) ? actualByKey.get(k) : null));
    const partial = ordered.map(([k]) => (k === currentKey && currentSoFar > 0 ? currentSoFar : null));
    const projected = ordered.map(([k]) => (forecastByKey.has(k) ? forecastByKey.get(k) : null));
    const upper = ordered.map(([k]) => (spreadByKey.has(k) ? forecastByKey.get(k) + Math.sqrt(spreadByKey.get(k)) : null));
    const lower = ordered.map(([k]) => (spreadByKey.has(k) ? Math.max(0, forecastByKey.get(k) - Math.sqrt(spreadByKey.get(k))) : null));

    let lastActual = -1;
    actual.forEach((v, i) => { if (v !== null) lastActual = i; });
    if (lastActual >= 0 && projected[lastActual] === null && projected.some((v) => v !== null)) {
      projected[lastActual] = actual[lastActual];
      if (upper.some((v) => v !== null)) {
        upper[lastActual] = actual[lastActual];
        lower[lastActual] = actual[lastActual];
      }
    }
    const trendNote = document.getElementById('trend-insight');
    if (trendNote) trendNote.textContent = this.trendInsight(labels, actual, projected, upper, lower, lastActual);
    makeLineChart('chart-sales-trend', labels, [
      { label: 'Likely high', data: upper, borderColor: 'rgba(50,71,197,0.25)', borderWidth: 1, backgroundColor: 'rgba(50,71,197,0.12)', pointRadius: 0, fill: '+1', tension: 0.35, spanGaps: true },
      { label: 'Likely low', data: lower, borderColor: 'rgba(50,71,197,0.25)', borderWidth: 1, pointRadius: 0, fill: false, tension: 0.35, spanGaps: true },
      { label: 'Projected', data: projected, borderColor: '#8D8D99', borderDash: [6, 4], pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: '#8D8D99', fill: false, tension: 0.35, spanGaps: true },
      { label: 'Actual', data: actual, borderColor: '#3247C5', pointRadius: 4, pointBackgroundColor: '#3247C5', fill: false, tension: 0.35 },
      { label: 'This month so far', data: partial, showLine: false, pointRadius: 5, pointBackgroundColor: '#fff', pointBorderColor: '#3247C5', pointBorderWidth: 2 },
    ]);
  },

  async requestForecast() {
    const btn = document.getElementById('btn-request-forecast');
    if (btn) btn.disabled = true;

    const { error } = await sbClient.from('forecast_runs').insert({ status: 'queued' });
    if (error) {
      showToast(error.code === '23505'
        ? 'A forecast is already queued or running.'
        : `Could not request a forecast: ${error.message}`);
      if (btn && error.code !== '23505') btn.disabled = false;
      return;
    }

    showToast('Forecast requested. It will run at the next scheduled job.');
    await DataStore.loadAll();
    Router.rerender();
  },
};
