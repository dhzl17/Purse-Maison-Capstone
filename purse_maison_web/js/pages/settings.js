/**
 * Settings page — mirrors screens/settings_page.dart. Password change and
 * account-info save are mocked (no backend to persist to), but Team
 * Accounts is a fully working local mock of the Add-Staff-Account /
 * Remove-Access feature from the Flutter app.
 */

const SettingsPage = {
  render() {
    const user = Session.currentUser;
    const canManageStaff = Session.canManageStaff();

    return `
      <div style="margin-bottom:24px;">
        <h1 class="page-title" style="margin-bottom:4px;">Settings</h1>
        <p class="cell-muted" style="font-size:14px;">Manage your account, notifications, and security preferences.</p>
      </div>

      <div class="section-grid" style="margin-bottom:24px;">
        <!-- Account Settings -->
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:18px;">Account Settings</div>
          <form id="account-info-form">
            <div class="field-group">
              <label class="field-label">Full Name</label>
              <input class="field-input" id="settings-fullname" value="${escapeHtml(user.fullName || user.username)}" placeholder="Enter full name" required />
            </div>
            <div class="field-group">
              <label class="field-label">Email Address</label>
              <input class="field-input" type="email" id="settings-email" value="${escapeHtml(user.email || '')}" placeholder="Enter email address" required />
            </div>
            <div class="field-group">
              <label class="field-label">Role</label>
              <input class="field-input" value="${escapeHtml(Session.roleLabel())}" readonly style="background:var(--chip-bg); font-weight:600; color:var(--card-navy-dark);" />
            </div>
            <button type="submit" class="btn-confirm" style="margin-top:8px;">Save Changes</button>
          </form>
        </div>

        <!-- Security Settings -->
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:18px;">Security Settings</div>
          <form id="password-form">
            <div class="cell-muted" style="font-size:12.5px; margin-bottom:14px; font-weight:500;">Change Password</div>
            <div class="field-group">
              <label class="field-label">Current Password</label>
              <div class="field-input-wrap">
                <input class="field-input" name="current" type="password" placeholder="Enter current password" required />
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">New Password</label>
              <div class="field-input-wrap">
                <input class="field-input" name="new" type="password" placeholder="Enter new password" required minlength="6" />
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">Confirm New Password</label>
              <div class="field-input-wrap">
                <input class="field-input" name="confirm" type="password" placeholder="Confirm new password" required minlength="6" />
              </div>
            </div>
            <button type="submit" class="btn-confirm" style="margin-top:8px;">Update Password</button>
          </form>
        </div>
      </div>

      <!-- Notification Settings Card -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-title" style="margin-bottom:18px;">Notification Settings</div>
        <form id="notification-settings-form">
          <div class="setting-row">
            <div class="setting-label-group">
              <span class="setting-title">Sales Updates</span>
              <span class="setting-desc">Receive notifications about sales performance and reports.</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="pref-sales" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label-group">
              <span class="setting-title">Inventory Alerts</span>
              <span class="setting-desc">Receive alerts for low stock and inventory updates.</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="pref-inventory" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <div class="setting-label-group">
              <span class="setting-title">System Announcement</span>
              <span class="setting-desc">Receive important system announcements and updates.</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="pref-system" checked />
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div style="margin-top:20px; text-align:center;">
            <button type="submit" class="btn-add" style="padding:10px 24px;">Save Preferences</button>
          </div>
        </form>
      </div>

      <!-- Team RBAC Management (Admin/Manager) -->
      ${canManageStaff ? `
        <div class="card">
          <div class="toolbar-row" style="margin-bottom:8px;">
            <div class="card-title">Team Accounts & Role Permissions</div>
            <button class="btn-add" id="btn-add-staff">+ Add Staff Account</button>
          </div>
          <p class="cell-muted" style="font-size:13px; margin-bottom:18px;">Manage workspace accounts and assigned RBAC permissions across all 8 operational roles.</p>
          <div id="staff-list">${this.renderStaffList()}</div>
        </div>
      ` : ''}
    `;
  },

  renderStaffList() {
    const myUid = Session.currentUser.uid;
    return DB.accounts.map((a) => {
      const roleConfig = ROLES[a.role] || ROLES.salesAssociate;
      return `
        <div class="staff-row">
          <div>
            <span class="staff-name">${escapeHtml(a.fullName || a.username)}</span>
            <span style="font-size:12px; color:var(--text-muted);">(@${escapeHtml(a.username)})</span>
            ${a.uid === myUid ? '<span class="staff-you">(you)</span>' : ''}
          </div>
          <div class="flex-spacer"></div>
          <span class="role-badge-tag" style="background:${roleConfig.badgeColor}">${escapeHtml(roleConfig.label)}</span>
          ${a.uid === myUid ? '<span style="width:32px;display:inline-block;"></span>' : `<button class="icon-btn danger" data-remove-staff="${a.uid}" title="Remove Access">🚫</button>`}
        </div>`;
    }).join('');
  },

  afterRender() {
    // Account info form submit
    document.getElementById('account-info-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fullName = document.getElementById('settings-fullname').value.trim();
      const email = document.getElementById('settings-email').value.trim();
      
      Session.updateProfile({ fullName, email });
      showToast('Account information saved successfully.');
      Router.rerender();
    });

    // Password form submit
    document.getElementById('password-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (fd.get('new') !== fd.get('confirm')) {
        showToast('New passwords do not match.');
        return;
      }
      e.target.reset();
      showToast('Password updated successfully.');
    });

    // Notifications preferences submit
    document.getElementById('notification-settings-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('Notification preferences saved.');
    });

    // Staff creation & removal
    const addStaffBtn = document.getElementById('btn-add-staff');
    if (addStaffBtn) addStaffBtn.addEventListener('click', () => this.openAddStaffForm());

    document.querySelectorAll('[data-remove-staff]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const acc = DB.accounts.find((a) => a.uid === btn.dataset.removeStaff);
        confirmDelete(acc.fullName || acc.username, () => {
          DB.accounts = DB.accounts.filter((a) => a.uid !== acc.uid);
          showToast('Staff access removed.');
          Router.rerender();
        });
      });
    });
  },

  openAddStaffForm() {
    const roleOptions = Object.keys(ROLES).map(key => `
      <option value="${key}">${escapeHtml(ROLES[key].label)}</option>
    `).join('');

    const html = `
      <form id="staff-form">
        <div class="field-group">
          <label class="field-label">Full Name</label>
          <input class="field-input" name="fullname" placeholder="e.g. Sarah Connor" required />
        </div>
        <div class="field-group">
          <label class="field-label">Username (no spaces — used for login)</label>
          <input class="field-input" name="username" placeholder="e.g. sconnor" required pattern="\\S+" />
        </div>
        <div class="field-group">
          <label class="field-label">Work Email</label>
          <input class="field-input" type="email" name="email" placeholder="e.g. sconnor@pursemaison.com" required />
        </div>
        <div class="field-group">
          <label class="field-label">Temporary Password</label>
          <input class="field-input" name="password" type="password" required minlength="6" />
        </div>
        <div class="field-group">
          <label class="field-label">Assigned Role (RBAC)</label>
          <select class="field-input" name="role">
            ${roleOptions}
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-modal>Cancel</button>
          <button type="submit" class="btn-confirm">Create Staff Account</button>
        </div>
      </form>`;
    const overlay = openModal({ title: 'Add Staff Account', bodyHtml: html });
    overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    overlay.querySelector('#staff-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const username = fd.get('username').trim();
      if (DB.accounts.some((a) => a.username.toLowerCase() === username.toLowerCase())) {
        showToast('That username is already taken.');
        return;
      }
      const fullName = fd.get('fullname').trim();
      const email = fd.get('email').trim();
      const password = fd.get('password');
      const role = fd.get('role');
      
      DB.accounts.push({ uid: nextId('acc'), username, fullName, email, password, role });
      closeModal();
      this.showCredentials(username, password, role, fullName);
    });
  },

  showCredentials(username, password, role, fullName) {
    const html = `
      <p>Share these credentials with <strong>${escapeHtml(fullName)}</strong> — this is the only time the password is displayed.</p>
      <div style="margin-top:14px; background:var(--chip-bg); padding:16px; border-radius:10px;">
        <div class="credential-row"><span class="credential-label">Full Name</span><span>${escapeHtml(fullName)}</span></div>
        <div class="credential-row"><span class="credential-label">Username</span><span class="credential-value">${escapeHtml(username)}</span></div>
        <div class="credential-row"><span class="credential-label">Password</span><span class="credential-value">${escapeHtml(password)}</span></div>
        <div class="credential-row"><span class="credential-label">Role</span><span>${escapeHtml(ROLES[role].label)}</span></div>
      </div>
      <div class="modal-actions" style="margin-top:20px;">
        <button class="btn-confirm" data-close-modal>Done</button>
      </div>`;
    const overlay = openModal({ title: 'Account Created Successfully', bodyHtml: html });
    overlay.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', () => { closeModal(); Router.rerender(); }));
  },
};
