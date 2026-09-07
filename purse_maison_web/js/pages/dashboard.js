/**
 * Dashboard page — mirrors screens/dashboard_page.dart. Every KPI and
 * chart here is computed live from DB.* arrays, nothing hardcoded.
 */

const DashboardPage = {
  computeStats() {
    const inventory = DB.inventory;
    const consignments = DB.consignments;
    const transactions = DB.salesTransactions;
    const inquiries = DB.clientInquiries;

    const itemsSold = inventory.filter((i) => i.status === 'sold').length;
    const activeConsignedItems = consignments.filter((c) => c.payoutStatus !== 'cancelled').length;

    const now = new Date();
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    let thisMonthTotal = 0, lastMonthTotal = 0;
    for (const t of transactions) {
      if (t.date.getFullYear() === now.getFullYear() && t.date.getMonth() === now.getMonth()) thisMonthTotal += t.amount;
      else if (t.date.getFullYear() === lastMonthDate.getFullYear() && t.date.getMonth() === lastMonthDate.getMonth()) lastMonthTotal += t.amount;
    }
    const growthPercent = lastMonthTotal === 0 ? 0 : ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100;

    const inventoryById = Object.fromEntries(inventory.map((i) => [i.id, i]));
    const displayDurations = [];
    for (const t of transactions) {
      if (!t.itemId) continue;
      const item = inventoryById[t.itemId];
      if (!item) continue;
      const added = parseDateAdded(item.dateAdded);
      if (!added) continue;
      const days = Math.round((t.date - added) / 86400000);
      if (days >= 0) displayDurations.push(days);
    }
    const avgDisplayDuration = displayDurations.length ? displayDurations.reduce((a, b) => a + b, 0) / displayDurations.length : null;
    const fastMovingCount = displayDurations.filter((d) => d <= 30).length;
    const slowMovingCount = displayDurations.filter((d) => d > 60).length;
    const turnoverRate = inventory.length ? itemsSold / inventory.length : 0;

    const months = lastNMonths(6);
    const monthLabels = months.map((m) => m.label);
    const monthlyTotals = monthlySalesTotals(transactions, months);

    const statusCounts = {
      Available: inventory.filter((i) => i.status === 'available').length,
      Reserved: inventory.filter((i) => i.status === 'reserved').length,
      Rejected: inventory.filter((i) => i.status === 'rejected').length,
      Sold: itemsSold,
    };

    return { itemsSold, activeConsignedItems, thisMonthTotal, growthPercent, avgDisplayDuration, turnoverRate, totalInquiries: inquiries.length, fastMovingCount, slowMovingCount, monthLabels, monthlyTotals, statusCounts };
  },

  buildInsights(stats) {
    const insights = [];
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
    const stats = this.computeStats();
    const insights = this.buildInsights(stats);
    const user = Session.currentUser;
    const roleConfig = ROLES[user.role] || ROLES.salesAssociate;

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:24px;">
        <div>
          <h1 class="welcome-title" style="margin-bottom:4px;">Welcome, ${escapeHtml(user.fullName || user.username)}!</h1>
          <div style="font-size:13px; color:var(--text-muted);">Purse Maison Management Portal Overview</div>
        </div>
        <span class="role-badge-tag" style="background:${roleConfig.badgeColor}; font-size:12px; padding:6px 14px;">
          ${escapeHtml(roleConfig.label)}
        </span>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-title">Total Sales</div><div class="stat-value-row"><span class="stat-prefix">₱</span><span class="stat-value">${formatAmount(stats.thisMonthTotal)}</span></div></div>
        <div class="stat-card"><div class="stat-title">Number of Items Sold</div><div class="stat-value-row"><span class="stat-value">${stats.itemsSold}</span></div></div>
        <div class="stat-card"><div class="stat-title">Active Consigned Items</div><div class="stat-value-row"><span class="stat-value">${stats.activeConsignedItems}</span></div></div>
        <div class="stat-card"><div class="stat-title">Monthly Sales Growth</div><div class="stat-value-row">${stats.growthPercent >= 0 ? '<span class="stat-trend">↑</span>' : ''}<span class="stat-value">${stats.growthPercent.toFixed(1)}%</span></div></div>
      </div>

      <div class="chart-row">
        <div class="chart-card">
          <div class="chart-card-title"><span>Sales Overview</span><span class="period-chip">6 Months</span></div>
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
          <div class="chart-card-title"><span>Actual vs 6-Month Average</span><span class="period-chip">6 Months</span></div>
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
    const stats = this.computeStats();

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
