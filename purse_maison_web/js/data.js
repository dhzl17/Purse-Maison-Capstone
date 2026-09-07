/**
 * In-memory mock "database" — stands in for the Firestore collections in
 * the real app. Everything lives in plain JS arrays, seeded once on load.
 * There is no backend: reloading the page resets all data back to this
 * seed state, same as the original app looked before it was ever
 * connected to Firebase.
 *
 * Shape of each record mirrors the Firestore documents the Flutter app
 * used, right down to the same sample data (see seed/seed.js).
 */


const DB = {
  accounts: [
    { uid: 'acc-1', username: 'superadmin', password: 'admin123', fullName: 'Super Admin Owner', email: 'admin@pursemaison.com', role: 'superAdmin' },
    { uid: 'acc-2', username: 'manager', password: 'manager123', fullName: 'Victoria Sterling', email: 'manager@pursemaison.com', role: 'manager' },
    { uid: 'acc-3', username: 'consignment', password: 'consignment123', fullName: 'Claire Vance', email: 'consignment@pursemaison.com', role: 'consignmentTeam' },
    { uid: 'acc-4', username: 'authenticator', password: 'auth123', fullName: 'Dr. Arthur Pendelton', email: 'authenticator@pursemaison.com', role: 'authenticator' },
    { uid: 'acc-5', username: 'photographer', password: 'photo123', fullName: 'Julian Mercer', email: 'photographer@pursemaison.com', role: 'photographer' },
    { uid: 'acc-6', username: 'designer', password: 'design123', fullName: 'Elena Rostova', email: 'designer@pursemaison.com', role: 'designer' },
    { uid: 'acc-7', username: 'pricing', password: 'price123', fullName: 'Marcus Chen', email: 'pricing@pursemaison.com', role: 'pricingTeam' },
    { uid: 'acc-8', username: 'salesassociate', password: 'sales123', fullName: 'Alex Rivera', email: 'sales@pursemaison.com', role: 'salesAssociate' },
  ],

  inventory: [],
  consignments: [],
  clientInquiries: [],
  salesAssociates: [],
  assignmentActivity: [],
  salesForecasts: [],
  predictionAlerts: [],
  salesTransactions: [],
};

function seedDatabase() {
  const INVENTORY_BASE = [
    { id: 'INV-001', brand: 'Hermès', category: 'Handbag', condition: 'Very Good', status: 'available', location: 'Showroom', dateAdded: '4/20/2024', transactionStatus: 'none', price: '₱720,000' },
    { id: 'INV-002', brand: 'Chanel', category: 'Shoulder Bag', condition: 'Excellent', status: 'reserved', location: 'Showroom', dateAdded: '4/18/2024', transactionStatus: 'pending', price: '₱265,000' },
    { id: 'INV-003', brand: 'Louis Vuitton', category: 'Tote', condition: 'Excellent', status: 'available', location: 'Showroom', dateAdded: '4/15/2024', transactionStatus: 'none', price: '₱165,000' },
    { id: 'INV-004', brand: 'Prada', category: 'Tote', condition: 'Excellent', status: 'rejected', location: 'For Return', dateAdded: '4/12/2024', transactionStatus: 'cancelled', price: '₱240,000' },
    { id: 'INV-005', brand: 'Gucci', category: 'Crossbody', condition: 'Good', status: 'sold', location: 'Released', dateAdded: '4/10/2024', transactionStatus: 'completed', price: '₱110,000' },
    { id: 'INV-006', brand: 'Dior', category: 'Shoulder Bag', condition: 'Excellent', status: 'available', location: 'Stockroom', dateAdded: '4/4/2024', transactionStatus: 'none', price: '₱240,000' },
  ];

  const items = [...INVENTORY_BASE];
  const extraBrands = ['Fendi', 'Bottega Veneta', 'Celine', 'Saint Laurent', 'Loewe', 'Balenciaga'];
  const extraCategories = ['Handbag', 'Shoulder Bag', 'Tote', 'Crossbody', 'Clutch'];
  const extraConditions = ['Very Good', 'Excellent', 'Good'];
  const extraLocations = ['Showroom', 'Released', 'Stockroom', 'For Return'];
  const extraStatuses = ['available', 'reserved', 'sold', 'available', 'rejected', 'sold'];
  const extraTransactions = ['none', 'pending', 'completed', 'none', 'cancelled', 'completed'];
  const extraDates = ['3/2/2024', '3/8/2024', '3/14/2024', '3/20/2024', '3/26/2024', '4/1/2024'];
  const extraPrices = ['₱310,000', '₱185,000', '₱95,000', '₱420,000', '₱150,000', '₱88,000'];
  for (let i = 0; i < 30; i++) {
    items.push({
      id: `INV-${String(items.length + 1).padStart(3, '0')}`,
      brand: extraBrands[i % extraBrands.length],
      category: extraCategories[i % extraCategories.length],
      condition: extraConditions[i % extraConditions.length],
      status: extraStatuses[i % extraStatuses.length],
      location: extraLocations[i % extraLocations.length],
      dateAdded: extraDates[i % extraDates.length],
      transactionStatus: extraTransactions[i % extraTransactions.length],
      price: extraPrices[i % extraPrices.length],
    });
  }
  DB.inventory = items;

  DB.consignments = [
    { id: '1101', brand: 'Hermès', itemName: 'Kelly 28 Epsom Noir', image: 'hermes_kelly.png', category: 'Handbag', condition: 'Very Good', authentication: 'verified', status: 'Received', price: '₱720,000', payoutStatus: 'notYetSold' },
    { id: '1102', brand: 'Chanel', itemName: 'Chanel Boy Bag Small', image: 'chanel_boy_bag_small.png', category: 'Shoulder Bag', condition: 'Excellent', authentication: 'verified', status: 'For Photography', price: '₱265,000', payoutStatus: 'notYetSold' },
    { id: '1103', brand: 'Louis Vuitton', itemName: 'LV OnTheGo MM', image: 'lv_onthego_mm.png', category: 'Tote', condition: 'Excellent', authentication: 'verified', status: 'Received', price: '₱165,000', payoutStatus: 'notYetSold' },
    { id: '1104', brand: 'Prada', itemName: 'Prada Galleria Saffiano', image: 'prada_galleria_saffiano.png', category: 'Tote', condition: 'Excellent', authentication: 'rejected', status: 'Return to Consignor', price: '₱110,000', payoutStatus: 'cancelled' },
    { id: '1105', brand: 'Gucci', itemName: 'Gucci Marmont Matelassé', image: 'gucci_marmont_matelasse.png', category: 'Crossbody', condition: 'Good', authentication: 'verified', status: 'Received', price: '₱92,000', payoutStatus: 'sold' },
    { id: '1106', brand: 'Dior', itemName: 'Dior Saddle Bag Oblique', image: 'dior_saddle_oblique.png', category: 'Shoulder Bag', condition: 'Excellent', authentication: 'verified', status: 'Received', price: '₱240,000', payoutStatus: 'notYetSold' },
    { id: '1107', brand: 'Fendi', itemName: 'Fendi Baguette Medium', image: 'fendi_baguette.png', category: 'Shoulder Bag', condition: 'Good', authentication: 'verified', status: 'Received', price: '₱135,000', payoutStatus: 'notYetSold' },
    { id: '1108', brand: 'Bottega Veneta', itemName: 'Bottega Jodie Small', image: 'bottega_jodie.png', category: 'Hobo', condition: 'Very Good', authentication: 'verified', status: 'For Photography', price: '₱178,000', payoutStatus: 'notYetSold' },
    { id: '1109', brand: 'Celine', itemName: 'Celine Triomphe Canvas', image: 'celine_triomphe_canvas.png', category: 'Shoulder Bag', condition: 'Excellent', authentication: 'verified', status: 'Received', price: '₱98,000', payoutStatus: 'sold' },
  ];

  DB.clientInquiries = [
    { id: 'ci-1', no: 1, clientName: 'Maria Santos', clientType: 'Walk-in', clientRole: 'Buyer', inquiryStatus: 'newInquiry', inquirySource: 'Facebook', transactionResult: 'none' },
    { id: 'ci-2', no: 2, clientName: 'John Cruz', clientType: 'Walk-in', clientRole: 'Buyer', inquiryStatus: 'closed', inquirySource: 'Facebook', transactionResult: 'noPurchase' },
    { id: 'ci-3', no: 3, clientName: 'Angelie Reyes', clientType: 'Walk-in', clientRole: 'Consignor', inquiryStatus: 'followedUp', inquirySource: 'Tiktok', transactionResult: 'none' },
    { id: 'ci-4', no: 4, clientName: 'Mark Tan', clientType: 'Walk-in', clientRole: 'Buyer', inquiryStatus: 'newInquiry', inquirySource: 'Instagram', transactionResult: 'none' },
    { id: 'ci-5', no: 5, clientName: 'Sofia Lim', clientType: 'Walk-in', clientRole: 'Buyer', inquiryStatus: 'followedUp', inquirySource: 'Tiktok', transactionResult: 'none' },
    { id: 'ci-6', no: 6, clientName: 'Lily Tiu', clientType: 'VIP', clientRole: 'Buyer', inquiryStatus: 'reserved', inquirySource: 'Facebook', transactionResult: 'purchased' },
    { id: 'ci-7', no: 7, clientName: 'Sophia Moore', clientType: 'Walk-in', clientRole: 'Consignor', inquiryStatus: 'followedUp', inquirySource: 'Tiktok', transactionResult: 'none' },
  ];

  DB.salesAssociates = [
    { id: 'sa-1', associateName: 'Alex Rivera', status: 'assigned', currentClient: 'Lily Tiu' },
    { id: 'sa-2', associateName: 'Bea Gonzales', status: 'available', currentClient: '-' },
    { id: 'sa-3', associateName: 'Carlo Mendoza', status: 'assigned', currentClient: 'John Cruz' },
    { id: 'sa-4', associateName: 'Denise Flores', status: 'assigned', currentClient: 'Angelie Reyes' },
    { id: 'sa-5', associateName: 'Ethan Lee', status: 'assigned', currentClient: 'Sophia Moore' },
    { id: 'sa-6', associateName: 'Franz Garcia', status: 'assigned', currentClient: 'Mark Tan' },
    { id: 'sa-7', associateName: 'Cris Vega', status: 'assigned', currentClient: 'Sofia Lim' },
  ];

  DB.assignmentActivity = [
    { id: 'act-1', description: 'Client "Lily Tiu" assigned to Associate "Alex Rivera"', timestamp: 'Today, 10:20 AM' },
    { id: 'act-2', description: 'Online inquiry from "Peter Tan" assigned to Associate "Cris Vega"', timestamp: 'Yesterday, 1:18 PM' },
    { id: 'act-3', description: 'Client "Sofia Lim" assigned to Associate "Cris Vega"', timestamp: 'Yesterday, 9:15 AM' },
  ];

  DB.salesForecasts = [
    { brand: 'Louis Vuitton', historicalSales: '4,850,000', projectedSales: '5,420,000', projectedGrowthPercent: 11.8, trend: 'increasing' },
    { brand: 'Chanel', historicalSales: '4,100,000', projectedSales: '4,650,000', projectedGrowthPercent: 13.4, trend: 'increasing' },
    { brand: 'Dior', historicalSales: '2,950,000', projectedSales: '3,550,000', projectedGrowthPercent: 13.6, trend: 'increasing' },
    { brand: 'Gucci', historicalSales: '2,300,000', projectedSales: '2,550,000', projectedGrowthPercent: 10.9, trend: 'increasing' },
    { brand: 'Prada', historicalSales: '1,600,000', projectedSales: '1,350,000', projectedGrowthPercent: -15.6, trend: 'decreasing' },
    { brand: 'YSL', historicalSales: '1,200,000', projectedSales: '1,250,000', projectedGrowthPercent: 4.2, trend: 'stable' },
  ];

  DB.predictionAlerts = [
    { id: 'pa-1', description: 'Demand for Chanel handbags is expected to increase significantly next month.', timestamp: 'Apr 28, 2024' },
    { id: 'pa-2', description: 'Louis Vuitton is projected to have sustained high demand in Q3.', timestamp: 'Apr 28, 2024' },
    { id: 'pa-3', description: 'Prada Handbags are projected to have lower demand. Consider reducing inventory.', timestamp: 'Apr 28, 2024' },
    { id: 'pa-4', description: 'Gucci wallets show steady growth. Maintain current inventory level.', timestamp: 'Apr 28, 2024' },
  ];

  const now = new Date();
  const thisMonth = (day, amount, label, itemId) => ({
    id: `seed-txn-this-${day}`, itemLabel: label, amount,
    date: new Date(now.getFullYear(), now.getMonth(), day), itemId: itemId || null,
  });
  const lastMonth = (day, amount, label, itemId) => ({
    id: `seed-txn-last-${day}`, itemLabel: label, amount,
    date: new Date(now.getFullYear(), now.getMonth() - 1, day), itemId: itemId || null,
  });
  DB.salesTransactions = [
    thisMonth(2, 110000, 'Gucci Marmont Matelasse (INV-005)', 'INV-005'),
    thisMonth(9, 98000, 'Celine Triomphe Canvas (1109)'),
    thisMonth(15, 240000, 'Dior Saddle Bag Oblique (INV-006)'),
    lastMonth(4, 92000, 'Gucci Marmont Matelasse (1105)'),
    lastMonth(11, 88000, 'Balenciaga sample sale (INV-030)'),
    lastMonth(19, 150000, 'Loewe sample sale (INV-024)'),
    lastMonth(26, 95000, 'Celine sample sale (INV-015)'),
  ];
}

let _idCounter = 1000;
function nextId(prefix) {
  _idCounter += 1;
  return `${prefix}-${_idCounter}`;
}

seedDatabase();

// ---- Restore saved consignments from browser localStorage ----
(function loadSavedConsignments() {
  const savedData = localStorage.getItem('consignments_data');
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        DB.consignments = parsed;
      }
    } catch (err) {
      console.error('Failed to parse saved consignment data:', err);
    }
  }
})();

// ---- Restore saved inventory from browser localStorage ----
(function loadSavedInventory() {
  const savedData = localStorage.getItem('inventory_data');
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        DB.inventory = parsed;
      }
    } catch (err) {
      console.error('Failed to parse saved inventory data:', err);
    }
  }
})();