const DB = {
  accounts: [
    { uid: 'acc-1', username: 'superadmin',    salt: 'pm-salt-acc-1', passwordHash: 'cec75a715f3eb53cb8259c2708ed520947b075a81d6b6bdb6026f7e508bbf2d7', fullName: 'Super Admin Owner',     email: 'admin@pursemaison.com',         role: 'superAdmin' },
    { uid: 'acc-2', username: 'manager',        salt: 'pm-salt-acc-2', passwordHash: '9ffc996c3890acb7a1efb63e1ab5539b2a3081c635b2d7c1a4677692597a6e1e', fullName: 'Victoria Sterling',       email: 'manager@pursemaison.com',       role: 'manager' },
    { uid: 'acc-3', username: 'consignment',    salt: 'pm-salt-acc-3', passwordHash: '24b1eaa019c3cb19f6faaee104ae04be09d1908702a8093e4cd675229389d62b', fullName: 'Claire Vance',             email: 'consignment@pursemaison.com',   role: 'consignmentTeam' },
    { uid: 'acc-4', username: 'authenticator',  salt: 'pm-salt-acc-4', passwordHash: '472b391506d1944a9ed12e4a3eb654c5eec17c445c91d11489e796f99ad51da5', fullName: 'Dr. Arthur Pendelton',    email: 'authenticator@pursemaison.com', role: 'authenticator' },
    { uid: 'acc-5', username: 'photographer',   salt: 'pm-salt-acc-5', passwordHash: '4d851cdc5e6e78462793a35eb64a994bdacd0a2b2003634802d893058c0b5bab', fullName: 'Julian Mercer',           email: 'photographer@pursemaison.com',  role: 'photographer' },
    { uid: 'acc-6', username: 'designer',       salt: 'pm-salt-acc-6', passwordHash: '05f4cf5a9894dc0a1ee1a5a08992ec2af3a8e87a5a97bf7e0f1fef531beec890', fullName: 'Elena Rostova',           email: 'designer@pursemaison.com',      role: 'designer' },
    { uid: 'acc-7', username: 'pricing',        salt: 'pm-salt-acc-7', passwordHash: '99aba899d322364323d8027b2fcff4daae324ed35a65912e28653d822c7807fb', fullName: 'Marcus Chen',             email: 'pricing@pursemaison.com',       role: 'pricingTeam' },
    { uid: 'acc-8', username: 'salesassociate', salt: 'pm-salt-acc-8', passwordHash: '7960396f4a9cab140c1bae7003402563279b1477e90e2bc8489a5f86eb5822ce', fullName: 'Alex Rivera',             email: 'sales@pursemaison.com',         role: 'salesAssociate' },
  ],

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

  const nowMs = Date.now();
  const dayMs = 86400000;

  DB.consignments = [
    { id: '1101', brand: 'Hermès', itemName: 'Kelly 28 Epsom Noir', image: 'hermes_kelly.png', category: 'Handbag', condition: 'Very Good', authentication: 'verified', primaryAuthStatus: 'verified', secondaryAuthStatus: 'verified', status: 'Available', price: '₱720,000', payoutStatus: 'notYetSold', consignorName: 'Maria Santos', consignorPhone: '0917-555-0101', serialNumber: 'HM-88912', microchipNumber: 'MC-HM-88912', postingDate: '2026-08-01', createdAtMs: nowMs - (10 * dayMs), contractDays: 60, shopifyProductId: 'gid://shopify/Product/98421049101', shopifySyncStatus: 'synced', assignedAssociate: 'Alex Rivera' },
    { id: '1102', brand: 'Chanel', itemName: 'Chanel Boy Bag Small', image: 'chanel_boy_bag_small.png', category: 'Shoulder Bag', condition: 'Excellent', authentication: 'verified', primaryAuthStatus: 'verified', secondaryAuthStatus: 'verified', status: 'For Photography', price: '₱265,000', payoutStatus: 'notYetSold', consignorName: 'Elena Rostova', consignorPhone: '0918-555-0102', serialNumber: 'CH-44102', microchipNumber: 'MC-CH-44102', postingDate: '2026-08-20', createdAtMs: nowMs - (5 * dayMs), contractDays: 60, shopifyProductId: '', shopifySyncStatus: 'pending', assignedAssociate: 'Bea Gonzales' },
    { id: '1103', brand: 'Louis Vuitton', itemName: 'LV OnTheGo MM', image: 'lv_onthego_mm.png', category: 'Tote', condition: 'Excellent', authentication: 'verified', primaryAuthStatus: 'verified', secondaryAuthStatus: 'verified', status: 'Available', price: '₱165,000', payoutStatus: 'notYetSold', consignorName: 'John Cruz', consignorPhone: '0919-555-0103', serialNumber: 'LV-99210', microchipNumber: 'MC-LV-99210', postingDate: '2026-07-10', createdAtMs: nowMs - (65 * dayMs), contractDays: 60, shopifyProductId: 'gid://shopify/Product/98421049103', shopifySyncStatus: 'synced', assignedAssociate: 'Carlo Mendoza' },
    { id: '1104', brand: 'Prada', itemName: 'Prada Galleria Saffiano', image: 'prada_galleria_saffiano.png', category: 'Tote', condition: 'Excellent', authentication: 'rejected', primaryAuthStatus: 'rejected', secondaryAuthStatus: 'rejected', status: 'Return to Consignor', price: '₱110,000', payoutStatus: 'cancelled', consignorName: 'Sophia Moore', consignorPhone: '0920-555-0104', serialNumber: 'PR-10293', microchipNumber: 'MC-PR-10293', postingDate: '2026-08-15', createdAtMs: nowMs - (12 * dayMs), contractDays: 60, shopifyProductId: '', shopifySyncStatus: 'not_applicable', assignedAssociate: 'Ethan Lee' },
    { id: '1105', brand: 'Gucci', itemName: 'Gucci Marmont Matelassé', image: 'gucci_marmont_matelasse.png', category: 'Crossbody', condition: 'Good', authentication: 'verified', primaryAuthStatus: 'verified', secondaryAuthStatus: 'verified', status: 'Sold', price: '₱92,000', payoutStatus: 'sold', consignorName: 'Angelie Reyes', consignorPhone: '0921-555-0105', serialNumber: 'GC-55102', microchipNumber: 'MC-GC-55102', postingDate: '2026-07-01', createdAtMs: nowMs - (70 * dayMs), contractDays: 60, shopifyProductId: 'gid://shopify/Product/98421049105', shopifySyncStatus: 'archived_sold', assignedAssociate: 'Denise Flores' },
    { id: '1106', brand: 'Dior', itemName: 'Dior Saddle Bag Oblique', image: 'dior_saddle_oblique.png', category: 'Shoulder Bag', condition: 'Excellent', authentication: 'verified', primaryAuthStatus: 'verified', secondaryAuthStatus: 'verified', status: 'Available', price: '₱240,000', payoutStatus: 'notYetSold', consignorName: 'Claire Vance', consignorPhone: '0922-555-0106', serialNumber: 'DR-77812', microchipNumber: 'MC-DR-77812', postingDate: '2026-08-10', createdAtMs: nowMs - (15 * dayMs), contractDays: 60, shopifyProductId: 'gid://shopify/Product/98421049106', shopifySyncStatus: 'synced', assignedAssociate: 'Franz Garcia' },
    { id: '1107', brand: 'Fendi', itemName: 'Fendi Baguette Medium', image: 'fendi_baguette.png', category: 'Shoulder Bag', condition: 'Good', authentication: 'pending', primaryAuthStatus: 'verified', secondaryAuthStatus: 'pending', status: 'Pending Authentication Payment', price: '₱135,000', payoutStatus: 'notYetSold', consignorName: 'Lily Tiu', consignorPhone: '0923-555-0107', serialNumber: 'FD-33201', microchipNumber: 'MC-FD-33201', postingDate: '2026-09-10', createdAtMs: nowMs - (14 * 3600 * 1000), contractDays: 60, shopifyProductId: '', shopifySyncStatus: 'pending', assignedAssociate: 'Cris Vega' },
    { id: '1108', brand: 'Bottega Veneta', itemName: 'Bottega Jodie Small', image: 'bottega_jodie.png', category: 'Hobo', condition: 'Very Good', authentication: 'pending', primaryAuthStatus: 'pending', secondaryAuthStatus: 'pending', status: 'Pending Authentication Payment', price: '₱178,000', payoutStatus: 'notYetSold', consignorName: 'Mark Tan', consignorPhone: '0924-555-0108', serialNumber: 'BV-66192', microchipNumber: 'MC-BV-66192', postingDate: '2026-09-11', createdAtMs: nowMs - (21 * 3600 * 1000), contractDays: 60, shopifyProductId: '', shopifySyncStatus: 'pending', assignedAssociate: 'Alex Rivera' },
    { id: '1109', brand: 'Celine', itemName: 'Celine Triomphe Canvas', image: 'celine_triomphe_canvas.png', category: 'Shoulder Bag', condition: 'Excellent', authentication: 'verified', primaryAuthStatus: 'verified', secondaryAuthStatus: 'verified', status: 'Sold', price: '₱98,000', payoutStatus: 'sold', consignorName: 'Sofia Lim', consignorPhone: '0925-555-0109', serialNumber: 'CL-88210', microchipNumber: 'MC-CL-88210', postingDate: '2026-08-05', createdAtMs: nowMs - (25 * dayMs), contractDays: 60, shopifyProductId: 'gid://shopify/Product/98421049109', shopifySyncStatus: 'archived_sold', assignedAssociate: 'Cris Vega' },
  ];

  DB.consignorClients = [
    { id: 'con-1', name: 'Maria Santos', phone: '0917-555-0101', email: 'maria.santos@gmail.com', activeCount: 1, totalValue: '₱720,000', channel: 'Instagram', assignedAssociate: 'Alex Rivera' },
    { id: 'con-2', name: 'Elena Rostova', phone: '0918-555-0102', email: 'elena.rostova@gmail.com', activeCount: 1, totalValue: '₱265,000', channel: 'Website', assignedAssociate: 'Bea Gonzales' },
    { id: 'con-3', name: 'John Cruz', phone: '0919-555-0103', email: 'john.cruz@gmail.com', activeCount: 1, totalValue: '₱165,000', channel: 'Walk-in', assignedAssociate: 'Carlo Mendoza' },
    { id: 'con-4', name: 'Angelie Reyes', phone: '0921-555-0105', email: 'angelie.reyes@gmail.com', activeCount: 1, totalValue: '₱92,000', channel: 'Tiktok', assignedAssociate: 'Denise Flores' },
    { id: 'con-5', name: 'Claire Vance', phone: '0922-555-0106', email: 'claire.vance@gmail.com', activeCount: 1, totalValue: '₱240,000', channel: 'FB Messenger', assignedAssociate: 'Franz Garcia' },
    { id: 'con-6', name: 'Lily Tiu', phone: '0923-555-0107', email: 'lily.tiu@vip.com', activeCount: 1, totalValue: '₱135,000', channel: 'WhatsApp', assignedAssociate: 'Cris Vega' },
    { id: 'con-7', name: 'Mark Tan', phone: '0924-555-0108', email: 'mark.tan@gmail.com', activeCount: 1, totalValue: '₱178,000', channel: 'Instagram', assignedAssociate: 'Alex Rivera' },
  ];

  DB.consignorAssignments = [
    { id: 'asg-1', itemId: '1101', itemName: 'Kelly 28 Epsom Noir', consignorName: 'Maria Santos', associateName: 'Alex Rivera', status: 'Completed', dateAssigned: '8/1/2026' },
    { id: 'asg-2', itemId: '1102', itemName: 'Chanel Boy Bag Small', consignorName: 'Elena Rostova', associateName: 'Bea Gonzales', status: 'In Progress', dateAssigned: '8/20/2026' },
    { id: 'asg-3', itemId: '1107', itemName: 'Fendi Baguette Medium', consignorName: 'Lily Tiu', associateName: 'Cris Vega', status: 'Pending', dateAssigned: '9/10/2026' },
    { id: 'asg-4', itemId: '1108', itemName: 'Bottega Jodie Small', consignorName: 'Mark Tan', associateName: 'Alex Rivera', status: 'Pending', dateAssigned: '9/11/2026' },
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