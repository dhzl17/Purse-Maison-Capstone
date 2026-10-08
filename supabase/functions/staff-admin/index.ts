// Edge Function: staff-admin
// Lets the owner (super_admin) create staff logins and set a staff member's password.
// It runs on Supabase's servers, so the secret key never reaches the browser.
//
// Actions (POST JSON):
//   { action: 'create', username, full_name, role, password }
//   { action: 'set_password', user_id, password }
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor,
// name it exactly "staff-admin", paste this file, Deploy.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = ['super_admin', 'manager', 'consignment_team', 'authenticator', 'photographer',
  'designer', 'pricing_team', 'sales_associate'];
const EMAIL_DOMAIN = Deno.env.get('STAFF_EMAIL_DOMAIN') ?? 'pursemaison.com';
const MIN_PASSWORD = 12;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** The project's secret key: the new SUPABASE_SECRET_KEYS dictionary first, the legacy service role key second. */
function secretKey(): string | undefined {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const key = keys.default ?? Object.values(keys)[0];
    if (typeof key === 'string' && key) return key;
  } catch (_) { /* fall through */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });

  try {
    const key = secretKey();
    if (!key) return json(500, { error: 'The function has no secret key configured' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Who is calling? Only an active owner may continue.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller?.user) return json(401, { error: 'Your session has expired. Log in again.' });

    const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', caller.user.id).maybeSingle();
    if (!me || !me.is_active || me.role !== 'super_admin') {
      return json(403, { error: 'Only the owner can manage staff accounts.' });
    }

    const body = await req.json().catch(() => ({}));
    const password = String(body.password ?? '');
    if (password.length < MIN_PASSWORD) {
      return json(400, { error: `The password must be at least ${MIN_PASSWORD} characters.` });
    }

    if (body.action === 'create') {
      const username = String(body.username ?? '').trim().toLowerCase();
      const fullName = String(body.full_name ?? '').trim();
      const role = String(body.role ?? '');
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
        return json(400, { error: 'Usernames are 3–30 characters: lowercase letters, numbers, dots, dashes or underscores.' });
      }
      if (!fullName) return json(400, { error: 'Enter the full name.' });
      if (!ROLES.includes(role)) return json(400, { error: 'Choose a valid role.' });

      const email = `${username}@${EMAIL_DOMAIN}`;
      const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
      if (taken) return json(409, { error: 'That username is already taken.' });

      // The invite tells the database (handle_new_user) to create a staff profile with this role.
      const { error: inviteError } = await admin.from('staff_invites')
        .upsert({ email, role, full_name: fullName, created_by: caller.user.id });
      if (inviteError) return json(500, { error: inviteError.message });

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (createError || !created?.user) {
        await admin.from('staff_invites').delete().eq('email', email);
        const msg = createError?.message ?? 'Could not create the login';
        return json(400, { error: /already/i.test(msg) ? 'A login with that username already exists.' : msg });
      }

      const { data: profile } = await admin.from('profiles').select('id').eq('id', created.user.id).maybeSingle();
      if (!profile) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json(500, { error: 'The login was created but no staff profile was made, so it was removed. Check Module 17.' });
      }
      return json(200, { ok: true, user_id: created.user.id, username, email });
    }

    if (body.action === 'set_password') {
      const userId = String(body.user_id ?? '');
      const { data: target } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (!target) return json(404, { error: 'Staff member not found.' });
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }

    return json(400, { error: 'Unknown action' });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});
