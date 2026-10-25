/**
 * Dashboard page. Every KPI and chart is computed from DB.* arrays, which
 * js/store.js fills from Supabase after login.
 */

const DASHBOARD_PERIODS = [[3, 'Last 3 Months'], [6, 'Last 6 Months'], [12, 'Last 12 Months']];

const DashboardPage = {
  filterPeriod: 6,     // months shown in the charts and period totals
  filterBrand: 'all',  // brand key (lower-case brand name), or 'all'

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
    const brandOk = (name) => this.filterBrand === 'all' || this.brandKeyOf(name) === this.filterBrand;
    const inventory = DB.inventory.filter((i) => brandOk(i.brand));
    const salesSeries = DB.salesSeries.filter((s) => this.filterBrand === 'all' || s.brandKey === this.filterBrand); // monthly revenue incl. imported history

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
    const activeConsignedItems = this.filterBrand === 'all'
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

    return { itemsSold, activeConsignedItems, thisMonthTotal, growthPercent, periodTotal, periodUnits, avgDisplayDuration, turnoverRate, totalInquiries: DB.inquiryCount, fastMovingCount, slowMovingCount, monthLabels, monthlyTotals, statusCounts };
  },

  buildInsights(stats) {
    const insights = [];
    if (this.filterBrand !== 'all') {
      const found = this.brandOptions().find(([k]) => k === this.filterBrand);
      insights.push(`Showing ${found ? found[1] : this.filterBrand} only (${this.periodLabel().toLowerCase()}).`);
    }
    if (stats.thisMonthTotal > 0 || stats.growthPercent !== 0) {
      const dir = stats.growthPercent >= 0 ? 'up' : 'down';
      insights.push(`Sales revenue is ${dir} ${Math.abs(stats.growthPercent).toFixed(1)}% compared to last month.`);
    }
    if (stats.avgDisplayDuration !== null) {
      insights.push(`Items typically sell after ${Math.round(stats.avgDisplayDuration)} days in inventory.`);
    }
    if (stats.fastMovingCount > 0 || stats.slowMovingCount > 0) {
      insights.push(`${stats.fastMovingCount} item(s) sold within a month of being added; ${stats.slowMovingCount} took over two months.`);
    }
    insights.push(`${(stats.turnoverRate * 100).toFixed(1)}% of current inventory has sold so far.`);
    if (stats.activeConsignedItems > 0) insights.push(`${stats.activeConsignedItems} consigned item(s) are still active.`);
    return insights;
  },

  render() {
    const brands = this.brandOptions();
    if (this.filterBrand !== 'all' && !brands.some(([k]) => k === this.filterBrand)) this.filterBrand = 'all';
    const filtered = this.filterBrand !== 'all' || this.filterPeriod !== 6;
    const stats = this.computeStats();
    const insights = this.buildInsights(stats);
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
          <select class="sort-select" id="dashboard-period" aria-label="Period">
            ${DASHBOARD_PERIODS.map(([v, l]) => `<option value="${v}" ${this.filterPeriod === v ? 'selected' : ''}>Period: ${l}</option>`).join('')}
          </select>
          <select class="sort-select" id="dashboard-brand" aria-label="Brand">
            <option value="all">Brand: All Brands</option>
            ${brands.map(([k, name]) => `<option value="${escapeHtml(k)}" ${this.filterBrand === k ? 'selected' : ''}>Brand: ${escapeHtml(name)}</option>`).join('')}
          </select>
        </div>
        ${filtered ? '<button type="button" class="btn-secondary" id="dashboard-reset-filters" style="padding:6px 14px; font-size:12.5px;">Reset Filters</button>' : ''}
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-title">Total Sales (${escapeHtml(this.periodLabel())})</div><div class="stat-value-row"><span class="stat-prefix">₱</span><span class="stat-value">${formatAmount(stats.periodTotal)}</span></div></div>
        <div class="stat-card"><div class="stat-title">Items Sold (${escapeHtml(this.periodLabel())})</div><div class="stat-value-row"><span class="stat-value">${stats.periodUnits}</span></div></div>
        <div class="stat-card"><div class="stat-title">Active Consigned Items</div><div class="stat-value-row"><span class="stat-value">${stats.activeConsignedItems}</span></div></div>
        <div class="stat-card"><div class="stat-title">Monthly Sales Growth</div><div class="stat-value-row">${stats.growthPercent >= 0 ? '<span class="stat-trend">↑</span>' : ''}<span class="stat-value">${stats.growthPercent.toFixed(1)}%</span></div></div>
      </div>

      <div class="chart-row">
        <div class="chart-card">
          <div class="chart-card-title"><span>Sales Overview</span><span class="period-chip">${this.filterPeriod} Months</span></div>
          <div class="chart-canvas-wrap"><canvas id="chart-sales-overview"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-card-title"><span>Monthly Sales Revenue</span></div>
          <div class="chart-canvas-wrap"><canvas id="chart-monthly-revenue"></canvas></div>
        </div>
      </div>

      <div class="stat-grid cols-5" style="margin-bottom:20px;">
        <div class="stat-card"><div class="stat-title">Average Display Duration</div><div class="stat-value-row"><span class="stat-value">${stats.avgDisplayDuration === null ? '—' : Math.round(stats.avgDisplayDuration)}</span>${stats.avgDisplayDuration === null ? '' : '<span class="stat-suffix">days</span>'}</div></div>
        <div class="stat-card"><div class="stat-title">Inventory Turnover Rate</div><div class="stat-value-row"><span class="stat-value">${stats.turnoverRate.toFixed(2)}x</span></div></div>
        <div class="stat-card"><div class="stat-title">Total Item Inquiries</div><div class="stat-value-row"><span class="stat-value">${stats.totalInquiries}</span></div></div>
        <div class="stat-card"><div class="stat-title">Fast Moving Items</div><div class="stat-value-row"><span class="stat-value">${stats.fastMovingCount}</span></div></div>
        <div class="stat-card"><div class="stat-title">Slow Moving Items</div><div class="stat-value-row"><span class="stat-value">${stats.slowMovingCount}</span></div></div>
      </div>

      <div class="section-grid">
        <div class="chart-card col-narrow">
          <div class="chart-card-title">
            <span>Inventory Performance</span>
            <div>
              ${Object.keys(stats.statusCounts).filter(k => stats.statusCounts[k] > 0).map((k, i) =>
                `<div class="legend-item"><span class="legend-dot sm" style="background:${['#10184F','#3247C5','#6C86FF','#B7B7C0'][i % 4]}"></span>${k}</div>`).join('')}
            </div>
          </div>
          <div class="chart-canvas-wrap short"><canvas id="chart-inventory-performance"></canvas></div>
        </div>
        <div class="chart-card col-wide">
          <div class="chart-card-title"><span>Actual vs ${this.filterPeriod}-Month Average</span><span class="period-chip">${this.filterPeriod} Months</span></div>
          <div class="chart-canvas-wrap short"><canvas id="chart-actual-vs-average"></canvas></div>
        </div>
        <div class="key-insights col-narrow">
          <div class="key-insights-title">Key Insights</div>
          <ul>${insights.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        </div>
      </div>
    `;
  },

    afterRender() {
    document.getElementById('dashboard-period')?.addEventListener('change', (e) => {
      this.filterPeriod = parseInt(e.target.value, 10) || 6;
      Router.rerender();
    });
    document.getElementById('dashboard-brand')?.addEventListener('change', (e) => {
      this.filterBrand = e.target.value;
      Router.rerender();
    });
    document.getElementById('dashboard-reset-filters')?.addEventListener('click', () => {
      this.filterPeriod = 6;
      this.filterBrand = 'all';
      Router.rerender();
    });

    const stats = this.computeStats();
    DataStore.refreshIfStale();

    makeLineChart('chart-sales-overview', stats.monthLabels, [{
      data: stats.monthlyTotals, borderColor: '#3247C5', backgroundColor: 'rgba(50,71,197,0.12)',
      fill: true, tension: 0.35, pointBackgroundColor: '#3247C5', pointRadius: 4,
    }]);

    makeBarChart('chart-monthly-revenue', stats.monthLabels, [{
      data: stats.monthlyTotals, backgroundColor: '#10184F', borderRadius: 3, maxBarThickness: 28,
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
  },
};
