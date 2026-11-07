/**
 * Settings page — connected to Supabase.
 *   Account:   change your display name (update_my_profile, Module 23). Username, login email and role are fixed.
 *   Security:  change your password (Supabase Auth; the current password is checked first).
 *   Session:   auto-logout after inactivity, for shared staff terminals (saved to your profile).
 *   Notifications: your preferences, saved to your profile.
 *   Team Accounts (owner only): create staff logins, change roles, deactivate/reactivate, reset passwords.
 *   Creating logins and setting passwords go through the staff-admin Edge Function, which holds the secret key.
 */

const MIN_PASSWORD_LENGTH = 12;
const AUTO_LOGOUT_CHOICES = [[0, 'Never'], [15, 'After 15 minutes'], [30, 'After 30 minutes'], [60, 'After 1 hour']];
const DEFAULT_AUTO_LOGOUT = 30;
const NOTIFICATION_PREFS = [
  ['notify_sales', 'Sales Updates', 'When you open the system, shows how many new verified sales were recorded since your last visit.'],
  ['notify_inventory', 'Inventory Alerts', 'When you open the system, warns you about live listings that are ending soon or expired on their contract.'],
];
const UI_ROLE_TO_DB_ROLE = Object.fromEntries(Object.entries(DB_ROLE_TO_UI_ROLE).map(([db, ui]) => [ui, db]));

const EYE_ICON = '<svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg class="eye-off-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function passwordField(inputAttrs) {
  return `
    <div class="field-input-wrap">
      <input class="field-input" type="password" ${inputAttrs} style="padding-right:50px;" />
      <button type="button" class="field-toggle" data-toggle-password title="Show password" aria-label="Show password">${EYE_ICON}${EYE_OFF_ICON}</button>
    </div>`;
}

const IdleLogout = {
  minutes: DEFAULT_AUTO_LOGOUT,
  last: Date.now(),
  loadedFor: null,

  start() {
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((ev) =>
      document.addEventListener(ev, () => { this.last = Date.now(); }, { passive: true }));
    setInterval(() => this.tick(), 30000);
  },

  setMinutes(m) { this.minutes = m; this.last = Date.now(); },

  async ensureLoaded() {
    const u = Session.currentUser;
    if (!u || this.loadedFor === u.uid) return;
    this.loadedFor = u.uid;
    this.last = Date.now();
    try {
      const { data } = await sbClient.from('profiles').select('preferences').eq('id', u.uid).maybeSingle();
      const m = data && data.preferences ? data.preferences.auto_logout_minutes : undefined;
      this.minutes = m === 0 ? 0 : (Number(m) || DEFAULT_AUTO_LOGOUT);
    } catch (err) { console.error(err); }
  },

  async tick() {
    if (!Session.isLoggedIn()) { this.loadedFor = null; return; }
    await this.ensureLoaded();
    if (this.minutes > 0 && Date.now() - this.last > this.minutes * 60000) {
      showToast('You were logged out after a period of inactivity.');
      await Session.logout();
      setTimeout(() => window.location.reload(), 1500);
    }
  },
};
IdleLogout.start();

const LoginAlerts = {
  async show() {
    const u = Session.currentUser;
    if (!u) return;
    let prefs = {};
    try {
      const { data } = await sbClient.from('profiles').select('preferences').eq('id', u.uid).maybeSingle();
      prefs = (data && data.preferences) || {};
    } catch (err) { console.error(err); }

    const alerts = [];

    if (prefs.notify_inventory !== false && Session.canAccess('inventory') && ConsignmentFlow.canManageContract()) {
      let ending = 0;
      let expired = 0;
      DB.pipelineItems.forEach((i) => {
        if (!i.listing || i.listing.inventory_status !== 'published' || i.sale || i.withdrawal) return;
        const c = ConsignmentFlow.contractInfo(i);
        if (!c) return;
        if (c.left <= 0) expired += 1;
        else if (c.left <= 7) ending += 1;
      });
      const route = Session.canAccess('consignment-sales') ? 'consignment-sales' : 'inventory';
      const plural = (n) => `listing${n === 1 ? '' : 's'}`;
      if (ending) {
        alerts.push({ label: 'Ending soon', text: `${ending} live ${plural(ending)} ${ending === 1 ? 'has' : 'have'} 7 days or fewer left on the contract.`, route });
      }
      if (expired) {
        alerts.push({ label: 'Expired', text: `${expired} live ${plural(expired)} ${expired === 1 ? 'has' : 'have'} passed the contract period.`, route });
      }
      if (ending || expired) {
        const parts = [];
        if (ending) parts.push(`${ending} ending soon`);
        if (expired) parts.push(`${expired} expired`);
        showToast(`Inventory alert: ${parts.join(', ')}.`);
      }
    }

    if (prefs.notify_sales !== false && Session.canAccess('dashboard')) {
      const key = `purseMaisonLastSalesCheck:${u.uid}`;
      let last = null;
      try { last = localStorage.getItem(key); } catch (_) { /* storage blocked */ }
      const since = last ? new Date(last) : null;
      if (since && !Number.isNaN(since.getTime())) {
        const fresh = DB.salesTransactions.filter((s) => s.date > since).length;
        if (fresh) {
          const text = `${fresh} new verified sale${fresh === 1 ? '' : 's'} since your last visit.`;
          const canSales = Session.canAccess('consignment-sales');
          alerts.push({
            label: 'Sales update',
            text,
            route: canSales ? 'consignment-sales' : 'dashboard',
            onOpen: canSales ? () => {
              ConsignmentFlow.salesTab = 'sales';
              ConsignmentFlow.saleStatuses = null;
              ConsignmentFlow.salesRange = null;
              ConsignmentFlow.salesPage.sales = 1;
              ConsignmentFlow.salesPage.done = 1;
            } : null,
          });
          showToast(`Sales update: ${text}`);
        }
      }
      try { localStorage.setItem(key, new Date().toISOString()); } catch (_) { /* storage blocked */ }
    }

    TicketBell.setAlerts(alerts);
  },
};

const SettingsPage = {
  prefs: null,         // this user's saved preferences (loaded on first visit)
  team: null,          // owner only: all staff profiles
  teamError: null,
  loadedFor: null,

  isOwner() { return !!Session.currentUser && Session.currentUser.role === 'superAdmin'; },

  render() {
    const user = Session.currentUser;
    const prefs = this.prefs || {};
    const autoLogout = prefs.auto_logout_minutes === 0 ? 0 : (Number(prefs.auto_logout_minutes) || DEFAULT_AUTO_LOGOUT);

    return `
      <div style="margin-bottom:24px;">
        <h1 class="page-title" style="margin-bottom:4px;">Settings</h1>
      </div>

      <div class="section-grid" style="margin-bottom:24px;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:18px;">Account Settings</div>
          <form id="account-info-form">
            <div class="field-group">
              <label class="field-label">Full Name</label>
              <input class="field-input" id="settings-fullname" value="${escapeHtml(user.fullName || user.username)}" maxlength="100" required />
            </div>
            <div class="field-group">
              <label class="field-label">Username (used to log in)</label>
              <input class="field-input" value="${escapeHtml(user.username)}" readonly style="background:var(--chip-bg);" />
            </div>
            <div class="field-group">
              <label class="field-label">Login Email</label>
              <input class="field-input" value="${escapeHtml(user.email || '')}" readonly style="background:var(--chip-bg);" />
            </div>
            <div class="field-group">
              <label class="field-label">Role</label>
              <input class="field-input" value="${escapeHtml(Session.roleLabel())}" readonly style="background:var(--chip-bg); font-weight:600; color:var(--card-navy-dark);" />
            </div>
            <button type="submit" class="btn-confirm" style="margin-top:8px;">Save Changes</button>
          </form>
        </div>

        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:18px;">Security Settings</div>
          <form id="password-form">
            <div class="cell-muted" style="font-size:12.5px; margin-bottom:14px; font-weight:500;">Change Password</div>
            <div class="field-group">
              <label class="field-label">Current Password</label>
              ${passwordField('name="current" autocomplete="current-password" required')}
            </div>
            <div class="field-group">
              <label class="field-label">New Password (at least ${MIN_PASSWORD_LENGTH} characters)</label>
              ${passwordField(`name="new" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}"`)}
            </div>
            <div class="field-group">
              <label class="field-label">Confirm New Password</label>
              ${passwordField(`name="confirm" autocomplete="new-password" required minlength="${MIN_PASSWORD_LENGTH}"`)}
            </div>
            <button type="submit" class="btn-confirm" style="margin-top:8px;">Update Password</button>
          </form>

          <div style="margin-top:22px; padding-top:16px; border-top:1px solid var(--border-light);">
            <div class="cell-muted" style="font-size:12.5px; margin-bottom:10px; font-weight:500;">Session</div>
            <div class="field-group">
              <label class="field-label">Log me out automatically when inactive</label>
              <select class="field-input" id="settings-auto-logout" ${this.prefs ? '' : 'disabled'}>
                ${AUTO_LOGOUT_CHOICES.map(([v, l]) => `<option value="${v}" ${autoLogout === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:24px;">
        <div class="card-title" style="margin-bottom:18px;">Notification Settings</div>
        <form id="notification-settings-form">
          ${NOTIFICATION_PREFS.map(([key, title, desc]) => `
            <div class="setting-row">
              <div class="setting-label-group">
                <span class="setting-title">${title}</span>
                <span class="setting-desc">${desc}</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" data-pref="${key}" ${prefs[key] === false ? '' : 'checked'} ${this.prefs ? '' : 'disabled'} />
                <span class="toggle-slider"></span>
              </label>
            </div>`).join('')}
          <div style="margin-top:20px; text-align:center;">
            <button type="submit" class="btn-add" style="padding:10px 24px;" ${this.prefs ? '' : 'disabled'}>Save Preferences</button>
          </div>
        </form>
      </div>

      ${ShopifySync.canSee() ? ShopifySync.render() : ''}

      ${this.isOwner() ? this.renderTeam() : ''}
    `;
  },

  renderTeam() {
    let body;
    if (this.teamError) body = `<p class="cell-muted">Could not load staff accounts: ${escapeHtml(this.teamError)}</p>`;
    else if (!this.team) body = '<p class="cell-muted">Loading staff accounts…</p>';
    else {
      const me = Session.currentUser.uid;
      body = this.team.map((a) => {
        const uiRole = DB_ROLE_TO_UI_ROLE[a.role];
        const cfg = ROLES[uiRole] || { label: a.role, badgeColor: '#4B5563' };
        const self = a.id === me;
        return `
          <div class="staff-row" style="flex-wrap:wrap; gap:8px; ${a.is_active ? '' : 'opacity:.55;'}">
            <div style="min-width:220px;">
              <span class="staff-name">${escapeHtml(a.full_name || a.username)}</span>
              <span style="font-size:12px; color:var(--text-muted);">(@${escapeHtml(a.username)})</span>
              ${self ? '<span class="staff-you">(you)</span>' : ''}
              ${a.is_active ? '' : badge('Deactivated', 'danger')}
            </div>
            <div class="flex-spacer"></div>
            ${self ? `<span class="role-badge-tag" style="background:${cfg.badgeColor}">${escapeHtml(cfg.label)}</span>` : `
              <select class="field-input" data-staff-role="${a.id}" style="max-width:200px; padding:6px 8px; font-size:12.5px;" ${a.is_active ? '' : 'disabled'}>
                ${Object.entries(ROLES).map(([ui, c]) => `<option value="${UI_ROLE_TO_DB_ROLE[ui]}" ${UI_ROLE_TO_DB_ROLE[ui] === a.role ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
              </select>
              <button class="btn-secondary" data-staff-password="${a.id}" style="padding:5px 10px; font-size:12px;" ${a.is_active ? '' : 'disabled'}>Reset Password</button>
              <button class="btn-secondary" data-staff-active="${a.id}" style="padding:5px 10px; font-size:12px; ${a.is_active ? 'color:var(--danger-red);' : ''}">${a.is_active ? 'Deactivate' : 'Reactivate'}</button>`}
          </div>`;
      }).join('');
    }
    return `
      <div class="card">
        <div class="toolbar-row" style="margin-bottom:8px;">
          <div class="card-title">Team Accounts & Role Permissions</div>
          <button class="btn-add" id="btn-add-staff">+ Add Staff Account</button>
        </div>
        <p class="cell-muted" style="font-size:13px; margin-bottom:18px;">Deactivated staff can no longer log in.</p>
        <div id="staff-list">${body}</div>
      </div>`;
  },

  // ----------------------------------------------------------------- data
  async loadPrefs() {
    const { data, error } = await sbClient.from('profiles').select('preferences').eq('id', Session.currentUser.uid).maybeSingle();
    this.prefs = (!error && data && data.preferences) || {};
    Router.rerender();
  },

  async loadTeam() {
    const { data, error } = await sbClient.from('profiles')
      .select('id, username, full_name, email, role, is_active, created_at')
      .order('is_active', { ascending: false })
      .order('full_name');
    this.teamError = error ? error.message : null;
    this.team = error ? [] : data;
    Router.rerender();
  },

  async savePrefs(changes, message) {
    const next = Object.assign({}, this.prefs || {}, changes);
    const { error } = await sbClient.rpc('update_my_profile', { new_full_name: null, new_preferences: next });
    if (error) { showToast(`Could not save: ${error.message}`); return false; }
    this.prefs = next;
    if (message) showToast(message);
    return true;
  },

  /** Calls the staff-admin Edge Function and returns its JSON, or throws with a readable message. */
  async callStaffAdmin(body) {
    const { data, error } = await sbClient.functions.invoke('staff-admin', { body });
    if (error) {
      let msg = error.message || 'Request failed';
      try {
        const detail = error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
        if (detail && detail.error) msg = detail.error;
      } catch (_) { /* keep the generic message */ }
      if (/Failed to send a request|not found|404/i.test(msg)) {
        msg = 'The staff-admin Edge Function is not deployed yet. See the setup steps for Step 5.';
      }
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  },

  generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  },

  // ----------------------------------------------------------------- bind
  afterRender() {
    ShopifySync.afterRender();
    // Cached data belongs to one user; start fresh if someone else logged in on this computer
    if (this.loadedFor !== Session.currentUser.uid) {
      this.loadedFor = Session.currentUser.uid;
      this.prefs = null; this.team = null; this.teamError = null;
      this.loadPrefs();
      if (this.isOwner()) this.loadTeam();
      return;
    }
    if (this.prefs === null) this.loadPrefs();
    if (this.isOwner() && this.team === null && !this.teamError) this.loadTeam();

    document.querySelectorAll('#password-form [data-toggle-password]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input');
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.querySelector('.eye-icon').style.display = showing ? '' : 'none';
        btn.querySelector('.eye-off-icon').style.display = showing ? 'none' : '';
        btn.title = showing ? 'Show password' : 'Hide password';
        btn.setAttribute('aria-label', btn.title);
      });
    });

    document.getElementById('account-info-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      const nameEl = document.getElementById('settings-fullname');
      const fullName = nameEl.value.trim();
      if (Validate.show(e.target, [[nameEl, Validate.personName(fullName, 'Full name')]])) return;
      btn.disabled = true;
      const { error } = await sbClient.rpc('update_my_profile', { new_full_name: fullName, new_preferences: null });
      btn.disabled = false;
      if (error) return showToast(`Could not save: ${error.message}`);
      Session.updateProfile({ fullName });
      showToast('Account information saved.');
      Router.rerender();
    });

    document.getElementById('password-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      const current = String(fd.get('current') || '');
      const next = String(fd.get('new') || '');
      const confirm = String(fd.get('confirm') || '');
      const field = (name) => form.querySelector(`[name="${name}"]`);
      if (Validate.show(form, [
        [field('current'), current ? null : 'Enter your current password.'],
        [field('new'), Validate.passwordRules(next, MIN_PASSWORD_LENGTH, current)],
        [field('confirm'), !confirm ? 'Type the new password again.' : (confirm !== next ? 'Passwords do not match.' : null)],
      ])) return;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const check = await sbClient.auth.signInWithPassword({ email: Session.currentUser.email, password: current });
        if (check.error) throw new Error('The current password is incorrect.');
        const { error } = await sbClient.auth.updateUser({ password: next });
        if (error) throw error;
        form.reset();
        form.querySelectorAll('[data-toggle-password]').forEach((b) => {
          if (b.parentElement.querySelector('input').type === 'text') b.click();
        });
        showToast('Password updated. Use the new password next time you log in.');
      } catch (err) {
        if (err.message === 'The current password is incorrect.') Validate.show(form, [[field('current'), err.message]]);
        else showToast(err.message || 'Could not update the password.');
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('settings-auto-logout')?.addEventListener('change', async (e) => {
      const minutes = Number(e.target.value);
      if (await this.savePrefs({ auto_logout_minutes: minutes }, minutes ? `You'll be logged out after ${minutes} minutes of inactivity.` : 'Auto-logout turned off.')) {
        IdleLogout.setMinutes(minutes);
      }
    });

    document.getElementById('notification-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const changes = {};
      document.querySelectorAll('[data-pref]').forEach((box) => { changes[box.dataset.pref] = box.checked; });
      await this.savePrefs(changes, 'Notification preferences saved.');
    });

    if (!this.isOwner()) return;

    document.getElementById('btn-add-staff')?.addEventListener('click', () => this.openAddStaffForm());

    document.querySelectorAll('[data-staff-role]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const person = this.team.find((a) => a.id === sel.dataset.staffRole);
        const newRole = sel.value;
        const label = (ROLES[DB_ROLE_TO_UI_ROLE[newRole]] || {}).label || newRole;
        const overlay = openModal({
          title: 'Change role?',
          bodyHtml: `<p>${escapeHtml(person.full_name || person.username)} will become <strong>${escapeHtml(label)}</strong> and will see that role's pages the next time they log in.</p>
            <div class="modal-actions"><button class="btn-secondary" data-close-modal>Cancel</button><button class="btn-confirm" id="role-ok">Change Role</button></div>`,
        });
        overlay.querySelector('[data-close-modal]').addEventListener('click', () => { closeModal(); Router.rerender(); });
        overlay.querySelector('#role-ok').addEventListener('click', async () => {
          closeModal();
          const { data, error } = await sbClient.from('profiles').update({ role: newRole }).eq('id', person.id).select('id');
          if (error || !data || !data.length) showToast(`Could not change the role: ${error ? error.message : 'not allowed'}`);
          else showToast(`${person.full_name || person.username} is now ${label}.`);
          this.loadTeam();
        });
      });
    });

    document.querySelectorAll('[data-staff-active]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const person = this.team.find((a) => a.id === btn.dataset.staffActive);
        const deactivate = person.is_active;
        const overlay = openModal({
          title: deactivate ? 'Deactivate account?' : 'Reactivate account?',
          bodyHtml: `<p>${deactivate
            ? `${escapeHtml(person.full_name || person.username)} will be locked out immediately and will no longer see any data. Their past work stays on record.`
            : `${escapeHtml(person.full_name || person.username)} will be able to log in again with their current password.`}</p>
            <div class="modal-actions"><button class="btn-secondary" data-close-modal>Cancel</button>
            <button class="btn-confirm ${deactivate ? 'btn-danger' : ''}" id="active-ok">${deactivate ? 'Deactivate' : 'Reactivate'}</button></div>`,
        });
        overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
        overlay.querySelector('#active-ok').addEventListener('click', async () => {
          closeModal();
          const { data, error } = await sbClient.from('profiles').update({ is_active: !deactivate }).eq('id', person.id).select('id');
          if (error || !data || !data.length) showToast(`Could not update the account: ${error ? error.message : 'not allowed'}`);
          else showToast(deactivate ? 'Access removed.' : 'Access restored.');
          this.loadTeam();
        });
      });
    });

    document.querySelectorAll('[data-staff-password]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const person = this.team.find((a) => a.id === btn.dataset.staffPassword);
        const overlay = openModal({
          title: 'Reset password?',
          bodyHtml: `<p>A new temporary password will be generated for ${escapeHtml(person.full_name || person.username)}. Their old password stops working, and they should change it in Settings after logging in.</p>
            <div class="modal-actions"><button class="btn-secondary" data-close-modal>Cancel</button><button class="btn-confirm" id="pw-ok">Reset Password</button></div>`,
        });
        overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
        overlay.querySelector('#pw-ok').addEventListener('click', async (e) => {
          e.target.disabled = true;
          const password = this.generatePassword();
          try {
            await this.callStaffAdmin({ action: 'set_password', user_id: person.id, password });
            closeModal();
            this.showCredentials(person.username, password, person.role, person.full_name || person.username, 'Password Reset');
          } catch (err) {
            closeModal();
            showToast(err.message);
          }
        });
      });
    });
  },

  openAddStaffForm() {
    const suggested = this.generatePassword();
    const html = `
      <form id="staff-form">
        <div class="field-group">
          <label class="field-label">Full Name</label>
          <input class="field-input" name="fullname" placeholder="e.g. Sarah Santos" required maxlength="100" />
        </div>
        <div class="field-group">
          <label class="field-label">Username</label>
          <input class="field-input" name="username" placeholder="e.g. ssantos" required pattern="[a-z0-9._\\-]{3,30}" title="3–30 lowercase letters, numbers, dots, dashes or underscores" />
          <small class="cell-muted">Used to log in.</small>
        </div>
        <div class="field-group">
          <label class="field-label">Temporary Password (at least ${MIN_PASSWORD_LENGTH} characters)</label>
          <input class="field-input" name="password" required minlength="${MIN_PASSWORD_LENGTH}" value="${escapeHtml(suggested)}" />
        </div>
        <div class="field-group">
          <label class="field-label">Role</label>
          <select class="field-input" name="role">
            ${Object.entries(ROLES).map(([ui, c]) => `<option value="${UI_ROLE_TO_DB_ROLE[ui]}" ${ui === 'salesAssociate' ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-modal>Cancel</button>
          <button type="submit" class="btn-confirm">Create Staff Account</button>
        </div>
      </form>`;
    const overlay = openModal({ title: 'Add Staff Account', bodyHtml: html });
    overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    overlay.querySelector('#staff-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const username = String(fd.get('username') || '').trim().toLowerCase();
      const fullName = String(fd.get('fullname') || '').trim();
      const password = String(fd.get('password') || '');
      const role = String(fd.get('role') || '');
      const btn = e.target.querySelector('button[type="submit"]');
      const form = e.target;
      const field = (name) => form.querySelector(`[name="${name}"]`);
      if (Validate.show(form, [
        [field('fullname'), Validate.personName(fullName, 'Full name')],
        [field('username'), !username ? 'Enter a username.'
          : (/^[a-z0-9._-]{3,30}$/.test(username) ? null : 'Use 3–30 lowercase letters, numbers, dots (.), dashes (-) or underscores (_). No spaces.')],
        [field('password'), Validate.passwordRules(password, MIN_PASSWORD_LENGTH)],
      ])) return;
      btn.disabled = true;
      try {
        await this.callStaffAdmin({ action: 'create', username, full_name: fullName, role, password });
        closeModal();
        this.showCredentials(username, password, role, fullName, 'Account Created');
        this.loadTeam();
      } catch (err) {
        btn.disabled = false;
        // Errors about one field from the staff-admin function are shown under that field
        const msg = err.message || 'Could not create the account.';
        if (/username/i.test(msg)) Validate.show(form, [[field('username'), msg]]);
        else if (/password/i.test(msg)) Validate.show(form, [[field('password'), msg]]);
        else if (/full name/i.test(msg)) Validate.show(form, [[field('fullname'), msg]]);
        else showToast(msg);
      }
    });
  },

  showCredentials(username, password, dbRole, fullName, title) {
    const label = (ROLES[DB_ROLE_TO_UI_ROLE[dbRole]] || {}).label || dbRole;
    const html = `
      <p>Give these to <strong>${escapeHtml(fullName)}</strong> in person. This is the only time the password is shown.</p>
      <div style="margin-top:14px; background:var(--chip-bg); padding:16px; border-radius:10px;">
        <div class="credential-row"><span class="credential-label">Full Name</span><span>${escapeHtml(fullName)}</span></div>
        <div class="credential-row"><span class="credential-label">Username</span><span class="credential-value">${escapeHtml(username)}</span></div>
        <div class="credential-row"><span class="credential-label">Password</span><span class="credential-value">${escapeHtml(password)}</span></div>
        <div class="credential-row"><span class="credential-label">Role</span><span>${escapeHtml(label)}</span></div>
      </div>
      <p class="cell-muted" style="font-size:12px; margin-top:10px;">Ask them to change the password in Settings after their first login.</p>
      <div class="modal-actions" style="margin-top:20px;">
        <button class="btn-confirm" data-close-modal>Done</button>
      </div>`;
    const overlay = openModal({ title, bodyHtml: html });
    overlay.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModal));
  },
};
