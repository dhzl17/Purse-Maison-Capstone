/**
 * Sales Forecasting page. Shows the latest ARIMA forecast saved in Supabase
 * (loaded by js/store.js). The model itself runs as a scheduled job; owners and
 * managers can request a new run with the button below.
 */

const ForecastingPage = {
  selectedBrand: 'all',

  trendBadge(trend) {
    const map = { increasing: ['▲ Increasing', 'success'], decreasing: ['▼ Decreasing', 'danger'], stable: ['▬ Stable', 'warning'] };
    const [label, tone] = map[trend] || map.stable;
    return badge(label, tone);
  },

  visibleRows() {
    const all = DB.salesForecasts;
    return this.selectedBrand === 'all' ? all : all.filter((f) => f.brandKey === this.selectedBrand);
  },

  // Matches the database rule: only managers and owners may request a forecast run.
  canRequestForecast() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'superAdmin' || role === 'manager';
  },

  runIsBusy() {
    const run = DB.forecastMeta.latestRun;
    return !!run && (run.status === 'queued' || run.status === 'running');
  },

  render() {
    const meta = DB.forecastMeta;
    const hasForecast = DB.salesForecasts.length > 0;
    const rows = this.visibleRows();
    const run = meta.latestRun;
    const horizon = meta.horizon || 6;
    const busy = this.runIsBusy();

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
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div class="field-group" style="margin-bottom:0;flex:1;min-width:200px;">
            <label class="field-label">Brand</label>
            <select class="field-input" id="forecast-brand">
              <option value="all">All Brands</option>
              ${DB.salesForecasts.map((f) => `<option value="${escapeHtml(f.brandKey)}" ${this.selectedBrand === f.brandKey ? 'selected' : ''}>${escapeHtml(f.brand)}</option>`).join('')}
            </select>
          </div>
          ${this.canRequestForecast() ? `<button class="btn-confirm" id="btn-request-forecast" style="height:44px;" ${busy ? 'disabled' : ''}>${busy ? 'Forecast in progress…' : 'Request New Forecast'}</button>` : ''}
        </div>
        <div class="cell-muted" style="margin-top:12px;font-size:12.5px;">${statusLine}${runBadge}</div>
        ${hasForecast ? '' : `<div class="cell-muted" style="margin-top:8px;font-size:12.5px;">A forecast needs enough monthly sales history per brand (12 months or more). It will appear here once the client's historical sales are imported and the forecast job has run.</div>`}
      </div>

      <div class="chart-row">
        <div class="chart-card">
          <div class="card-title" style="margin-bottom:14px;">Sales Trend (Actual vs Projected)</div>
          <div class="legend-row">
            <div class="legend-item"><span class="legend-dot" style="background:#3247C5"></span>Actual</div>
            <div class="legend-item"><span class="legend-dot" style="background:#B7B7C0"></span>Projected (ARIMA)</div>
          </div>
          <div class="chart-canvas-wrap"><canvas id="chart-sales-trend"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="card-title" style="margin-bottom:14px;">Historical vs Projected Sales by Brand</div>
          <div class="legend-row">
            <div class="legend-item"><span class="legend-dot" style="background:#6C86FF"></span>Historical (last ${horizon} mo)</div>
            <div class="legend-item"><span class="legend-dot" style="background:#10184F"></span>Projected (next ${horizon} mo)</div>
          </div>
          <div class="chart-canvas-wrap"><canvas id="chart-brand-forecast"></canvas></div>
        </div>
      </div>

      <div class="section-grid">
        <div class="chart-card col-wide">
          <div class="toolbar-row" style="margin-bottom:12px;">
            <span class="card-title">Brand Forecasts</span>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Brand</th><th>Historical (₱)</th><th>Projected (₱)</th><th>Growth %</th><th>Trend</th><th>Avg. Error (MAE)</th></tr></thead>
              <tbody>
                ${rows.length === 0 ? `<tr><td colspan="6" class="cell-center cell-muted" style="padding:24px;text-align:center;">No forecast to show yet.</td></tr>` : rows.map((f) => {
                  const g = f.projectedGrowthPercent;
                  return `
                  <tr>
                    <td class="cell-bold">${escapeHtml(f.brand)}</td>
                    <td>${escapeHtml(f.historicalSales)}</td>
                    <td>${escapeHtml(f.projectedSales)}</td>
                    <td style="color:${g === null ? 'inherit' : g >= 0 ? 'var(--green)' : 'var(--danger-red)'};font-weight:600;">${g === null ? '—' : `${g >= 0 ? '+' : ''}${g}%`}</td>
                    <td class="cell-center">${this.trendBadge(f.trend)}</td>
                    <td>${f.mae === null ? '—' : '₱' + formatAmount(f.mae)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="chart-card col-narrow">
          <div class="card-title" style="margin-bottom:14px;">Prediction Alerts</div>
          ${DB.predictionAlerts.map((a) => `
            <div class="feed-item">
              <div class="feed-desc">${escapeHtml(a.description)}</div>
              <div class="feed-time">${escapeHtml(a.timestamp)}</div>
            </div>`).join('') || '<p class="cell-muted">No alerts yet.</p>'}
        </div>
      </div>
    `;
  },

  afterRender() {
    document.getElementById('forecast-brand')?.addEventListener('change', (e) => {
      this.selectedBrand = e.target.value;
      Router.rerender();
    });
    document.getElementById('btn-request-forecast')?.addEventListener('click', () => this.requestForecast());

    this.drawTrendChart();

    // Historical vs projected, one pair of bars per brand
    const all = DB.salesForecasts;
    makeBarChart('chart-brand-forecast', all.map((f) => f.brand), [
      { label: 'Historical', data: all.map((f) => f.historicalValue), backgroundColor: '#6C86FF', borderRadius: 2, maxBarThickness: 18 },
      { label: 'Projected', data: all.map((f) => f.projectedValue), backgroundColor: '#10184F', borderRadius: 2, maxBarThickness: 18 },
    ]);

    DataStore.refreshIfStale();
  },

  /** Last 6 months of actual sales, followed by the forecast months, as one timeline. */
  drawTrendChart() {
    const keyOf = (y, m) => `${y}-${m}`;
    const brandOk = (b) => this.selectedBrand === 'all' || b === this.selectedBrand;

    const actualMonths = lastNMonths(6);
    const series = DB.salesSeries.filter((s) => brandOk(s.brandKey));
    const actualByKey = new Map(actualMonths.map((m) => [keyOf(m.year, m.month), monthlySalesTotals(series, [m])[0]]));

    const forecastByKey = new Map();
    for (const r of DB.forecastRows) {
      if (!brandOk(r.brandKey)) continue;
      const k = keyOf(r.month.getFullYear(), r.month.getMonth() + 1);
      forecastByKey.set(k, (forecastByKey.get(k) || 0) + r.revenue);
    }

    const timeline = new Map();
    actualMonths.forEach((m) => timeline.set(keyOf(m.year, m.month), { year: m.year, month: m.month }));
    for (const k of forecastByKey.keys()) {
      const [y, m] = k.split('-').map(Number);
      timeline.set(k, { year: y, month: m });
    }
    const ordered = [...timeline.entries()].sort((a, b) => a[1].year - b[1].year || a[1].month - b[1].month);

    const thisYear = new Date().getFullYear();
    const labels = ordered.map(([, t]) => MONTH_ABBREV[t.month - 1] + (t.year !== thisYear ? ` '${String(t.year).slice(2)}` : ''));
    const actual = ordered.map(([k]) => (actualByKey.has(k) ? actualByKey.get(k) : null));
    const projected = ordered.map(([k]) => (forecastByKey.has(k) ? forecastByKey.get(k) : null));

    // Join the two lines so the projection starts where the actuals end
    let lastActual = -1;
    actual.forEach((v, i) => { if (v !== null) lastActual = i; });
    if (lastActual >= 0 && projected[lastActual] === null && projected.some((v) => v !== null)) {
      projected[lastActual] = actual[lastActual];
    }

    makeLineChart('chart-sales-trend', labels, [
      { data: projected, borderColor: '#B7B7C0', borderDash: [6, 4], pointRadius: 3, fill: false, tension: 0.35 },
      { data: actual, borderColor: '#3247C5', pointRadius: 4, pointBackgroundColor: '#3247C5', fill: false, tension: 0.35 },
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
