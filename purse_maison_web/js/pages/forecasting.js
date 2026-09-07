/**
 * Sales Forecasting page — mirrors screens/sales_forecasting_page.dart +
 * widgets/sales_forecast_table.dart + widgets/sales_forecast_charts.dart.
 */

const ForecastingPage = {
  trendBadge(trend) {
    const map = { increasing: ['▲ Increasing', 'success'], decreasing: ['▼ Decreasing', 'danger'], stable: ['▬ Stable', 'warning'] };
    const [label, tone] = map[trend];
    return badge(label, tone);
  },

  render() {
    const viewOnly = Session.forecastingViewOnly();
    const forecasts = DB.salesForecasts;
    const alerts = DB.predictionAlerts;

    return `
      <h1 class="page-title">Sales Forecasting</h1>

      <div class="card" style="margin-bottom:20px;">
        <div class="card-title" style="margin-bottom:14px;">Filter &amp; Generate Forecast</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div class="field-group" style="margin-bottom:0;flex:1;min-width:140px;">
            <label class="field-label">Period</label>
            <select class="field-input" id="forecast-period"><option>Monthly</option><option>Quarterly</option></select>
          </div>
          <div class="field-group" style="margin-bottom:0;flex:1;min-width:120px;">
            <label class="field-label">Year</label>
            <select class="field-input" id="forecast-year"><option>2026</option><option>2025</option></select>
          </div>
          <div class="field-group" style="margin-bottom:0;flex:1;min-width:160px;">
            <label class="field-label">Brand</label>
            <select class="field-input" id="forecast-brand"><option>All Brands</option>${forecasts.map((f) => `<option>${escapeHtml(f.brand)}</option>`).join('')}</select>
          </div>
          <button class="btn-confirm" id="btn-generate-forecast" style="height:44px;">Generate Forecast</button>
        </div>
      </div>

      <div class="chart-row">
        <div class="chart-card">
          <div class="card-title" style="margin-bottom:14px;">Sales Trend (Actual vs Projected)</div>
          <div class="legend-row">
            <div class="legend-item"><span class="legend-dot" style="background:#3247C5"></span>Actual</div>
            <div class="legend-item"><span class="legend-dot" style="background:#B7B7C0"></span>Projected (3-mo avg)</div>
          </div>
          <div class="chart-canvas-wrap"><canvas id="chart-sales-trend"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="card-title" style="margin-bottom:14px;">Historical vs Projected Sales by Brand</div>
          <div class="legend-row">
            <div class="legend-item"><span class="legend-dot" style="background:#6C86FF"></span>Historical (6mo)</div>
            <div class="legend-item"><span class="legend-dot" style="background:#10184F"></span>Projected (3mo)</div>
          </div>
          <div class="chart-canvas-wrap"><canvas id="chart-brand-forecast"></canvas></div>
        </div>
      </div>

      <div class="section-grid">
        <div class="chart-card col-wide">
          <div class="toolbar-row" style="margin-bottom:12px;">
            <span class="card-title">Brand Forecasts</span>
            ${viewOnly ? '' : `<button class="btn-add" id="btn-add-forecast">+ Add Forecast</button>`}
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Brand</th><th>Historical (6mo)</th><th>Projected (3mo)</th><th>Growth %</th><th>Trend</th>${viewOnly ? '' : '<th>Actions</th>'}</tr></thead>
              <tbody>
                ${forecasts.map((f) => `
                  <tr>
                    <td class="cell-bold">${escapeHtml(f.brand)}</td>
                    <td>${escapeHtml(f.historicalSales)}</td>
                    <td>${escapeHtml(f.projectedSales)}</td>
                    <td class="${f.projectedGrowthPercent >= 0 ? '' : ''}" style="color:${f.projectedGrowthPercent >= 0 ? 'var(--green)' : 'var(--danger-red)'};font-weight:600;">${f.projectedGrowthPercent >= 0 ? '+' : ''}${f.projectedGrowthPercent}%</td>
                    <td class="cell-center">${this.trendBadge(f.trend)}</td>
                    ${viewOnly ? '' : `<td><div class="row-actions">
                      <button class="icon-btn" data-edit-forecast="${escapeHtml(f.brand)}" title="Edit">✎</button>
                      <button class="icon-btn danger" data-delete-forecast="${escapeHtml(f.brand)}" title="Delete">🗑</button>
                    </div></td>`}
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="chart-card col-narrow">
          <div class="card-title" style="margin-bottom:14px;">Prediction Alerts</div>
          ${alerts.map((a) => `
            <div class="feed-item">
              <div class="feed-desc">${escapeHtml(a.description)}</div>
              <div class="feed-time">${escapeHtml(a.timestamp)}</div>
            </div>`).join('') || '<p class="cell-muted">No alerts yet.</p>'}
        </div>
      </div>
    `;
  },

  afterRender() {
    document.getElementById('btn-generate-forecast').addEventListener('click', () => {
      const period = document.getElementById('forecast-period').value;
      const year = document.getElementById('forecast-year').value;
      const brand = document.getElementById('forecast-brand').value;
      showToast(`Generating ${period} forecast for ${year} — ${brand}`);
    });

    const addBtn = document.getElementById('btn-add-forecast');
    if (addBtn) addBtn.addEventListener('click', () => this.openForm(null));
    document.querySelectorAll('[data-edit-forecast]').forEach((btn) => {
      btn.addEventListener('click', () => this.openForm(DB.salesForecasts.find((f) => f.brand === btn.dataset.editForecast)));
    });
    document.querySelectorAll('[data-delete-forecast]').forEach((btn) => {
      btn.addEventListener('click', () => {
        confirmDelete(btn.dataset.deleteForecast, () => {
          DB.salesForecasts = DB.salesForecasts.filter((f) => f.brand !== btn.dataset.deleteForecast);
          showToast('Forecast deleted.');
          Router.rerender();
        });
      });
    });

    // -- Sales Trend chart: actual monthly totals vs naive 3-month avg --
    const months = lastNMonths(6);
    const actualTotals = monthlySalesTotals(DB.salesTransactions, months);
    const lastThree = actualTotals.length >= 3 ? actualTotals.slice(-3) : actualTotals;
    const projectedFlat = lastThree.length ? lastThree.reduce((a, b) => a + b, 0) / lastThree.length : 0;
    makeLineChart('chart-sales-trend', months.map((m) => m.label), [
      { data: months.map(() => projectedFlat), borderColor: '#B7B7C0', borderDash: [6, 4], pointRadius: 0, fill: false },
      { data: actualTotals, borderColor: '#3247C5', pointRadius: 4, pointBackgroundColor: '#3247C5', fill: false, tension: 0.35 },
    ]);

    // -- Historical vs Projected by brand --
    const forecasts = DB.salesForecasts;
    makeBarChart('chart-brand-forecast', forecasts.map((f) => f.brand), [
      { label: 'Historical', data: forecasts.map((f) => parseAmountString(f.historicalSales)), backgroundColor: '#6C86FF', borderRadius: 2, maxBarThickness: 18 },
      { label: 'Projected', data: forecasts.map((f) => parseAmountString(f.projectedSales)), backgroundColor: '#10184F', borderRadius: 2, maxBarThickness: 18 },
    ]);
  },

  openForm(existing) {
    const isEdit = !!existing;
    const html = `
      <form id="forecast-form">
        <div class="field-group"><label class="field-label">Brand</label><input class="field-input" name="brand" required value="${escapeHtml(existing?.brand || '')}" ${isEdit ? 'readonly style="background:var(--chip-bg)"' : ''}></div>
        <div class="field-group"><label class="field-label">Historical Sales (last 6 months)</label><input class="field-input" name="historicalSales" required value="${escapeHtml(existing?.historicalSales || '')}"></div>
        <div class="field-group"><label class="field-label">Projected Sales (next 3 months)</label><input class="field-input" name="projectedSales" required value="${escapeHtml(existing?.projectedSales || '')}"></div>
        <div class="field-group"><label class="field-label">Projected Growth % (use - for a decline)</label><input class="field-input" name="projectedGrowthPercent" type="number" step="0.1" required value="${existing?.projectedGrowthPercent ?? ''}"></div>
        <div class="field-group"><label class="field-label">Demand Trend</label>
          <select class="field-input" name="trend">
            <option value="increasing" ${existing?.trend === 'increasing' ? 'selected' : ''}>Increasing</option>
            <option value="decreasing" ${existing?.trend === 'decreasing' ? 'selected' : ''}>Decreasing</option>
            <option value="stable" ${existing?.trend === 'stable' ? 'selected' : ''}>Stable</option>
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-modal>Cancel</button>
          <button type="submit" class="btn-confirm">${isEdit ? 'Save Changes' : 'Add Forecast'}</button>
        </div>
      </form>`;
    const overlay = openModal({ title: isEdit ? 'Edit Brand Forecast' : 'Add Brand Forecast', bodyHtml: html });
    overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    overlay.querySelector('#forecast-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const record = {
        brand: isEdit ? existing.brand : fd.get('brand').trim(),
        historicalSales: fd.get('historicalSales').trim(),
        projectedSales: fd.get('projectedSales').trim(),
        projectedGrowthPercent: parseFloat(fd.get('projectedGrowthPercent')) || 0,
        trend: fd.get('trend'),
      };
      if (isEdit) {
        const idx = DB.salesForecasts.findIndex((f) => f.brand === record.brand);
        DB.salesForecasts[idx] = record;
      } else {
        DB.salesForecasts.push(record);
      }
      closeModal();
      showToast(isEdit ? 'Forecast updated.' : 'Forecast added.');
      Router.rerender();
    });
  },
};
