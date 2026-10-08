/**
 * Session + role permissions.
 * Login goes through Supabase Auth (see js/supabase.js). Staff type a username;
 * it is converted to username@<STAFF_EMAIL_DOMAIN> for Supabase. The role and
 * active flag come from the database `profiles` table, never from the browser.
 * Note: the ROLES table below only controls which pages and buttons are shown.
 * The real security is Row Level Security in the database.
 */

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
    defaultRoute: 'dashboard',
    allowedRoutes: [
      'dashboard', 
      'consignment-overview', 
      'clients', 
      'inventory', 
      'settings', 
      'help'
    ],
    inventoryViewOnly: true,
    forecastingViewOnly: true,
    canManageStaff: false,
  },
};

const Session = {
  currentUser: null,

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
   * Logs in through Supabase Auth, then loads the staff profile (role, name).
   * Returns null on success, or an error message string on failure.
   */
  async login(username, password) {
    try {
      const { data, error } = await sbClient.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (error || !data || !data.user) return 'Invalid username or password';

      const profile = await loadCurrentStaffProfile(data.user);
      if (!profile) {
        await sbClient.auth.signOut();
        return 'This account does not have active staff access.';
      }
      this.currentUser = profile;
      return null;
    } catch (err) {
      console.error('Login failed:', err);
      return 'Could not reach the server. Check your connection and try again.';
    }
  },

  /**
   * Restores a saved Supabase session after a page refresh.
   * Returns true when a valid staff session was found.
   */
  async restore() {
    try {
      const { data } = await sbClient.auth.getSession();
      if (!data || !data.session) return false;
      const profile = await loadCurrentStaffProfile(data.session.user);
      if (!profile) {
        await sbClient.auth.signOut();
        return false;
      }
      this.currentUser = profile;
      return true;
    } catch (err) {
      console.error('Could not restore session:', err);
      return false;
    }
  },

  updateProfile({ fullName, email, role }) {
    if (!this.currentUser) return;
    if (fullName) this.currentUser.fullName = fullName;
    if (email) this.currentUser.email = email;
    if (role && ROLES[role]) this.currentUser.role = role;

    const acc = DB.accounts.find(a => a.uid === this.currentUser.uid);
    if (acc) {
      acc.fullName = this.currentUser.fullName;
      acc.email = this.currentUser.email;
      acc.role = this.currentUser.role;
    }
  },

  async logout() {
    this.currentUser = null;
    try { await sbClient.auth.signOut(); } catch (err) { console.error('Sign-out failed:', err); }
  },
};

