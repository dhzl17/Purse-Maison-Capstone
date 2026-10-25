/**
 * Sales Forecasting page. Shows the latest ARIMA forecast saved in Supabase
 * (loaded by js/store.js). The model itself runs as a scheduled job; owners and
 * managers can request a new run with the button below.
 */

const ForecastingPage = {
  selectedBrand: 'all',
  selectedTrend: 'all',   
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
      .filter((f) => this.selectedBrand === 'all' || f.brandKey === this.selectedBrand)
      .filter((f) => this.selectedTrend === 'all' || f.trend === this.selectedTrend)
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
    return this.selectedBrand !== 'all' || this.selectedTrend !== 'all' || this.selectedMonths !== 'all';
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
    if (this.selectedBrand !== 'all' && !DB.salesForecasts.some((f) => f.brandKey === this.selectedBrand)) this.selectedBrand = 'all';
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
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div class="field-group" style="margin-bottom:0;flex:1;min-width:200px;">
            <label class="field-label">Brand</label>
            <select class="field-input" id="forecast-brand">
              <option value="all">All Brands</option>
              ${DB.salesForecasts.map((f) => `<option value="${escapeHtml(f.brandKey)}" ${this.selectedBrand === f.brandKey ? 'selected' : ''}>${escapeHtml(f.brand)}</option>`).join('')}
            </select>
          </div>
          <div class="field-group" style="margin-bottom:0;flex:1;min-width:180px;">
            <label class="field-label">Trend</label>
            <select class="field-input" id="forecast-trend">
              ${[['all', 'All Trends'], ['increasing', 'Increasing'], ['stable', 'Stable'], ['decreasing', 'Decreasing']]
                .map(([v, l]) => `<option value="${v}" ${this.selectedTrend === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="field-group" style="margin-bottom:0;flex:1;min-width:180px;">
            <label class="field-label">Forecast Period</label>
            <select class="field-input" id="forecast-months" ${hasForecast ? '' : 'disabled'}>
              ${this.monthOptions().map((n) => `<option value="${n}" ${String(this.selectedMonths) === String(n) ? 'selected' : ''}>Next ${n} Months</option>`).join('')}
              <option value="all" ${this.selectedMonths === 'all' ? 'selected' : ''}>${meta.horizon ? `Next ${meta.horizon} Months` : 'All Months'}</option>
            </select>
          </div>
          ${this.hasActiveFilter() ? '<button type="button" class="btn-secondary" id="forecast-reset-filters" style="height:44px;">Reset Filters</button>' : ''}
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
          ${pageAlerts.map((a) => `
            <div class="feed-item">
              <div class="feed-desc">${escapeHtml(a.description)}</div>
              <div class="feed-time">${escapeHtml(a.timestamp)}</div>
            </div>`).join('') || `<p class="cell-muted">${this.hasActiveFilter() ? 'No alerts for the selected filters.' : 'No alerts yet.'}</p>`}
          ${alertPages > 1 ? `<div class="pagination" id="alerts-pagination">${renderPaginationButtons(this.alertPage, alertPages)}</div>` : ''}
        </div>
      </div>
    `;
  },

  afterRender() {
    document.getElementById('forecast-brand')?.addEventListener('change', (e) => {
      this.selectedBrand = e.target.value;
      this.page = 1;
      this.alertPage = 1;
      Router.rerender();
    });
    document.getElementById('forecast-trend')?.addEventListener('change', (e) => {
      this.selectedTrend = e.target.value;
      this.page = 1;
      this.alertPage = 1;
      Router.rerender();
    });
    document.getElementById('forecast-months')?.addEventListener('change', (e) => {
      this.selectedMonths = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
      this.page = 1;
      this.alertPage = 1;
      Router.rerender();
    });
    document.getElementById('forecast-reset-filters')?.addEventListener('click', () => {
      this.selectedBrand = 'all';
      this.selectedTrend = 'all';
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

    const shown = this.visibleRows();
    makeBarChart('chart-brand-forecast', shown.map((f) => f.brand), [
      { label: 'Historical', data: shown.map((f) => f.historicalValue), backgroundColor: '#6C86FF', borderRadius: 2, maxBarThickness: 18 },
      { label: 'Projected', data: shown.map((f) => f.projectedValue), backgroundColor: '#10184F', borderRadius: 2, maxBarThickness: 18 },
    ]);

    DataStore.refreshIfStale();
  },

  /** Last 6 months of actual sales, followed by the forecast months, as one timeline. */
  drawTrendChart() {
    const keyOf = (y, m) => `${y}-${m}`;
    const visible = new Set(this.visibleRows().map((f) => f.brandKey));
    const narrowed = this.selectedBrand !== 'all' || this.selectedTrend !== 'all';
    const brandOk = (b) => (narrowed ? visible.has(b) : true);

    const firstForecast = DB.forecastRows.reduce((min, r) => (!min || r.month < min ? r.month : min), null);
    const cutoff = firstForecast ? new Date(firstForecast.getFullYear(), firstForecast.getMonth() + this.monthsShown(), 1) : null;

    const actualMonths = lastNMonths(6);
    const series = DB.salesSeries.filter((s) => brandOk(s.brandKey));
    const actualByKey = new Map(actualMonths.map((m) => [keyOf(m.year, m.month), monthlySalesTotals(series, [m])[0]]));

    const forecastByKey = new Map();
    for (const r of DB.forecastRows) {
      if (!brandOk(r.brandKey)) continue;
      if (cutoff && r.month >= cutoff) continue;
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
