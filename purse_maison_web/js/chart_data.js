/**
 * Shared helpers for turning raw mock-data records into chart-ready
 * shapes. Mirrors services/chart_data.dart from the Flutter app.
 */

const MONTH_ABBREV = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Last n months (oldest first), ending at the current month. */
function lastNMonths(n) {
  const now = new Date();
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: MONTH_ABBREV[d.getMonth()], year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return months;
}

function monthlySalesTotals(transactions, months) {
  return months.map((m) =>
    transactions
      .filter((t) => t.date.getFullYear() === m.year && t.date.getMonth() + 1 === m.month)
      .reduce((sum, t) => sum + t.amount, 0),
  );
}

function monthlySoldCounts(transactions, months) {
  return months.map((m) =>
    transactions.filter((t) => t.date.getFullYear() === m.year && t.date.getMonth() + 1 === m.month).length,
  );
}
