/**
 * Thin Chart.js wrappers so each page module just passes data in.
 * Chart instances are tracked by canvas id so re-rendering a page (the
 * router re-fills #page-content's innerHTML on every navigation) doesn't
 * leak old Chart.js instances or throw "canvas already in use" errors.
 */

const _chartRegistry = {};

function destroyChart(canvasId) {
  if (_chartRegistry[canvasId]) {
    _chartRegistry[canvasId].destroy();
    delete _chartRegistry[canvasId];
  }
}

/** True once the Chart.js CDN script (see index.html <head>) has loaded.
 * If it hasn't — no internet, ad-blocker, offline use — chart calls
 * below no-op instead of throwing, and the surrounding canvas area is
 * just left blank rather than breaking the rest of the page. */
function chartJsReady() {
  return typeof Chart !== 'undefined';
}

/** Shown in place of a chart when Chart.js never manages to load (e.g.
 * both CDNs blocked by a network filter) — better than a silently blank
 * box with no explanation. */
function showChartUnavailable(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !canvas.parentElement) return;
  if (canvas.parentElement.querySelector('.chart-unavailable-msg')) return;
  const msg = document.createElement('div');
  msg.className = 'chart-empty chart-unavailable-msg';
  msg.style.position = 'absolute';
  msg.style.inset = '0';
  msg.textContent = window.__chartJsFailed
    ? 'Charts couldn\'t load — no internet connection.'
    : 'Loading charts…';
  canvas.parentElement.style.position = 'relative';
  canvas.parentElement.appendChild(msg);
}

const CHART_FONT = { family: 'Poppins', size: 11 };

function makeLineChart(canvasId, labels, datasets, { yPrefix = '' } = {}) {
  if (!chartJsReady()) { showChartUnavailable(canvasId); return; }
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _chartRegistry[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#E6E3DA' },
          ticks: { font: CHART_FONT, color: '#7A7A88', callback: (v) => yPrefix + v },
        },
        x: { grid: { display: false }, ticks: { font: CHART_FONT, color: '#7A7A88' } },
      },
    },
  });
}

function makeBarChart(canvasId, labels, datasets, { yPrefix = '' } = {}) {
  if (!chartJsReady()) { showChartUnavailable(canvasId); return; }
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _chartRegistry[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#E6E3DA' },
          ticks: { font: CHART_FONT, color: '#7A7A88', callback: (v) => yPrefix + v },
        },
        x: { grid: { display: false }, ticks: { font: CHART_FONT, color: '#7A7A88' } },
      },
    },
  });
}

function makeDoughnutChart(canvasId, labels, data, colors) {
  if (!chartJsReady()) { showChartUnavailable(canvasId); return; }
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  _chartRegistry[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: { legend: { display: false } },
    },
  });
}
