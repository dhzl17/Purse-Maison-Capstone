/**
 * Supabase client + small helpers shared by the whole app.
 * Requires the supabase-js CDN script and js/config.js to be loaded first.
 */

const sbClient = window.supabase.createClient(
  PM_CONFIG.SUPABASE_URL,
  PM_CONFIG.SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } },
);

// Database role names -> the role keys the frontend already uses (see ROLES in auth.js)
const DB_ROLE_TO_UI_ROLE = {
  super_admin: 'superAdmin',
  manager: 'manager',
  consignment_team: 'consignmentTeam',
  authenticator: 'authenticator',
  photographer: 'photographer',
  designer: 'designer',
  pricing_team: 'pricingTeam',
  sales_associate: 'salesAssociate',
};

function usernameToEmail(username) {
  const clean = String(username || '').trim().toLowerCase();
  return clean.includes('@') ? clean : `${clean}@${PM_CONFIG.STAFF_EMAIL_DOMAIN}`;
}

/**
 * Loads the logged-in user's profile row (full_name, role, is_active)
 * and returns the shape Session.currentUser expects, or null if there is none.
 */
async function loadCurrentStaffProfile(authUser) {
  const { data, error } = await sbClient
    .from('profiles')
    .select('full_name, role, is_active')
    .eq('id', authUser.id)
    .maybeSingle();

  if (error || !data || !data.is_active) return null;

  const uiRole = DB_ROLE_TO_UI_ROLE[data.role];
  if (!uiRole) return null;

  const username = (authUser.email || '').split('@')[0];
  return {
    uid: authUser.id,
    username,
    email: authUser.email,
    fullName: data.full_name || username,
    role: uiRole,
  };
}
