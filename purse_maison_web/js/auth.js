/**
 * Session + role permissions — mirrors AppSession + UserRole from the
 * Flutter app. Passwords are hashed client-side using Web Crypto API
 * (SHA-256 + per-user salt) before comparison. No plaintext passwords
 * are stored or transmitted. When moving to a real backend, replace
 * hashPassword() + Session.login() with an API call to POST /auth/login.
 */

// ---- Password Hashing (Web Crypto API — SHA-256 + salt) ------------------
/**
 * Returns a SHA-256 hex digest of (salt + password).
 * Using the browser's built-in SubtleCrypto — no external libraries needed.
 * @param {string} salt   - per-user salt stored in DB.accounts
 * @param {string} password - raw password entered by user
 * @returns {Promise<string>} hex hash string
 */
async function hashPassword(salt, password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const ROLES = {
  superAdmin: {
    label: 'Super Admin (Owner)',
    badgeColor: '#10184F',
    defaultRoute: 'dashboard',
    allowedRoutes: [
      'dashboard',
      'consignment-overview', 'consignment-preintake', 'consignment-intake', 'consignment-auth', 'consignment-photo', 'consignment-design', 'consignment-pricing', 'consignment-approval',
      'inventory', 'clients', 'forecasting', 'settings', 'help'
    ],
    inventoryViewOnly: false,
    forecastingViewOnly: false,
    canManageStaff: true,
  },
  manager: {
    label: 'Manager',
    badgeColor: '#1B2478',
    defaultRoute: 'dashboard',
    allowedRoutes: [
      'dashboard',
      'consignment-overview', 'consignment-approval',
      'inventory', 'settings', 'help'
    ],
    inventoryViewOnly: false,
    forecastingViewOnly: false,
    canManageStaff: true,
  },
  consignmentTeam: {
    label: 'Consignment Team',
    badgeColor: '#2563EB',
    defaultRoute: 'consignment-overview',
    allowedRoutes: [
      'dashboard', 'consignment-overview', 'consignment-preintake', 'consignment-intake',
      'inventory', 'settings', 'help'
    ],
    inventoryViewOnly: false,
    forecastingViewOnly: true,
    canManageStaff: false,
  },
  authenticator: {
    label: 'Authenticator',
    badgeColor: '#059669',
    defaultRoute: 'consignment-auth',
    allowedRoutes: [
      'consignment-auth', 'inventory', 'settings', 'help'
    ],
    inventoryViewOnly: true,
    forecastingViewOnly: true,
    canManageStaff: false,
  },
  photographer: {
    label: 'Photographer',
    badgeColor: '#D97706',
    defaultRoute: 'consignment-photo',
    allowedRoutes: [
      'consignment-photo', 'settings', 'help'
    ],
    inventoryViewOnly: true,
    forecastingViewOnly: true,
    canManageStaff: false,
  },
  designer: {
    label: 'Designer',
    badgeColor: '#7C3AED',
    defaultRoute: 'consignment-design',
    allowedRoutes: [
      'consignment-design', 'settings', 'help'
    ],
    inventoryViewOnly: true,
    forecastingViewOnly: true,
    canManageStaff: false,
  },
  pricingTeam: {
    label: 'Pricing Team',
    badgeColor: '#DC2626',
    defaultRoute: 'consignment-pricing',
    allowedRoutes: [
      'consignment-pricing', 'forecasting', 'inventory', 'settings', 'help'
    ],
    inventoryViewOnly: false,
    forecastingViewOnly: false,
    canManageStaff: false,
  },
  salesAssociate: {
    label: 'Sales Associate',
    badgeColor: '#4B5563',
    defaultRoute: 'clients',
    allowedRoutes: [
      'dashboard', 'clients', 'inventory', 'settings', 'help'
    ],
    inventoryViewOnly: true,
    forecastingViewOnly: true,
    canManageStaff: false,
  },
};

const Session = {
  currentUser: null, // { uid, username, email, fullName, role }

  isLoggedIn() {
    return this.currentUser !== null;
  },

  canAccess(route) {
    if (!this.currentUser) return false;
    const roleConfig = ROLES[this.currentUser.role] || ROLES.salesAssociate;
    return roleConfig.allowedRoutes.includes(route);
  },

  defaultRoute() {
    if (!this.currentUser) return 'dashboard';
    const roleConfig = ROLES[this.currentUser.role] || ROLES.salesAssociate;
    return roleConfig.defaultRoute || 'dashboard';
  },

  inventoryViewOnly() {
    if (!this.currentUser) return true;
    const roleConfig = ROLES[this.currentUser.role] || ROLES.salesAssociate;
    return roleConfig.inventoryViewOnly;
  },

  forecastingViewOnly() {
    if (!this.currentUser) return true;
    const roleConfig = ROLES[this.currentUser.role] || ROLES.salesAssociate;
    return roleConfig.forecastingViewOnly;
  },

  canManageStaff() {
    if (!this.currentUser) return false;
    const roleConfig = ROLES[this.currentUser.role] || ROLES.salesAssociate;
    return !!roleConfig.canManageStaff;
  },

  roleLabel() {
    if (!this.currentUser) return '';
    const roleConfig = ROLES[this.currentUser.role];
    return roleConfig ? roleConfig.label : this.currentUser.role;
  },

  /**
   * Async login — hashes the entered password with the account's salt,
   * then compares against the stored SHA-256 hash. No plaintext comparison.
   * Returns null on success, or an error message string on failure.
   * When moving to a real backend: replace this entire method with
   * fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
   */
  async login(username, password) {
    const match = DB.accounts.find(
      (a) => a.username.toLowerCase() === username.trim().toLowerCase(),
    );
    if (!match) return 'Invalid username or password';

    const inputHash = await hashPassword(match.salt, password);

    if (inputHash !== match.passwordHash) {
      return 'Invalid username or password';
    }

    this.currentUser = {
      uid: match.uid,
      username: match.username,
      email: match.email || `${match.username}@pursemaison.com`,
      fullName: match.fullName || match.username,
      role: match.role,
    };
    return null;
  },

  updateProfile({ fullName, email, role }) {
    if (!this.currentUser) return;
    if (fullName) this.currentUser.fullName = fullName;
    if (email) this.currentUser.email = email;
    if (role && ROLES[role]) this.currentUser.role = role;

    // Also sync back to DB.accounts
    const acc = DB.accounts.find(a => a.uid === this.currentUser.uid);
    if (acc) {
      acc.fullName = this.currentUser.fullName;
      acc.email = this.currentUser.email;
      acc.role = this.currentUser.role;
    }
  },

  logout() {
    this.currentUser = null;
  },
};

