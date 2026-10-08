/**
 * Shared in-memory data. Everything here is filled from Supabase by js/store.js after login;
 * the old demo accounts and sample records have been removed.
 */
const DB = {
  inventory: [],
  consignments: [],
  clientInquiries: [],
  consignorClients: [],
  consignorAssignments: [],
  salesAssociates: [],
  assignmentActivity: [],
  salesForecasts: [],
  predictionAlerts: [],
  salesTransactions: [],
};

let _idCounter = 1000;
function nextId(prefix) {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}

// Clear demo data the old version kept in this browser
try {
  localStorage.removeItem('consignments_data');
  localStorage.removeItem('inventory_data');
} catch (err) { /* storage unavailable: nothing to clear */ }
