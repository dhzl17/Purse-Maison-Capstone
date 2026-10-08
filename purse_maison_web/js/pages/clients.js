/**
 * Client Assignment page — connected to Supabase.
 *
 * Inquiries are saved to the `inquiries` table. When a new inquiry has no associate chosen, the database
 * assigns the sales associate with the lowest current workload (open inquiries + open consignments).
 * Staff can also pick an associate by hand. Sales associates themselves are created in Settings.
 * Inquiries cannot be deleted, and a resolved inquiry cannot be reopened (database rules).
 */

const CLIENT_WRITE_ROLES = ['consignmentTeam', 'salesAssociate', 'manager', 'superAdmin'];

const ClientsPage = {
  searchKeyword: '',
  sortBy: 'recently',

  canWrite() {
    const role = Session.currentUser && Session.currentUser.role;
    return CLIENT_WRITE_ROLES.includes(role);
  },

  inquiryStatusBadge(status) {
    const map = { pending: ['Pending', 'info'], assigned: ['Assigned', 'warning'], resolved: ['Resolved', 'success'] };
    const [label, tone] = map[status] || ['Unknown', 'info'];
    return badge(label, tone);
  },
  transactionResultCell(result) {
    if (result === 'none' || !result) return '<span class="cell-muted">-</span>';
    return result === 'purchased' ? badge('Purchased', 'success') : badge('No Purchase', 'danger');
  },
  associateStatusBadge(status) {
    return status === 'assigned' ? badge('Assigned', 'warning') : badge('Available', 'success');
  },

  filterAndSortInquiries(items) {
    let list = [...items];
    if (this.searchKeyword) {
      const kw = this.searchKeyword.toLowerCase();
      list = list.filter(i =>
        String(i.clientName || '').toLowerCase().includes(kw) ||
        String(i.clientType || '').toLowerCase().includes(kw) ||
        String(i.clientRole || '').toLowerCase().includes(kw) ||
        String(i.inquirySource || '').toLowerCase().includes(kw) ||
        String(i.assignedName || '').toLowerCase().includes(kw)
      );
    }
    if (this.sortBy === 'alphabetical') list.sort((a, b) => (a.clientName || '').localeCompare(b.clientName || ''));
    else if (this.sortBy === 'oldest') list.sort((a, b) => a.no - b.no);
    else list.sort((a, b) => b.no - a.no);
    return list;
  },

  render() {
    const inquiries = this.filterAndSortInquiries(DB.clientInquiries);
    const associates = DB.salesAssociates;
    const activity = DB.assignmentActivity;
    const canWrite = this.canWrite();

    return `
      <h1 class="page-title">Client Assignment</h1>

      <div class="filter-toolbar-row" style="margin-bottom:14px;">
        <div class="filter-controls-group">
          ${renderUniversalSearchBar('clients-search-input', 'Search by Name, Type, Source, Associate...')}
          <select class="sort-select" id="clients-sort-select">
            <option value="recently" ${this.sortBy === 'recently' ? 'selected' : ''}>Sort: Recently Added</option>
            <option value="oldest" ${this.sortBy === 'oldest' ? 'selected' : ''}>Sort: Oldest First</option>
            <option value="alphabetical" ${this.sortBy === 'alphabetical' ? 'selected' : ''}>Sort: Name A-Z</option>
          </select>
        </div>
      </div>

      <div class="section-grid">
        <div class="chart-card col-wide">
          <div class="toolbar-row" style="margin-bottom:12px;">
            <span class="card-title">Client Inquiries</span>
            ${canWrite ? '<button class="btn-add" id="btn-add-inquiry">+ Add Inquiry</button>' : ''}
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="text-align: center;">No.</th>
                  <th style="text-align: center;">Client Name</th>
                  <th style="text-align: center;">Type</th>
                  <th style="text-align: center;">Role</th>
                  <th style="text-align: center;">Status</th>
                  <th style="text-align: center;">Source</th>
                  <th style="text-align: center;">Assigned To</th>
                  <th style="text-align: center;">Result</th>
                  ${canWrite ? '<th style="text-align: center;">Actions</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${inquiries.length === 0 ? `<tr><td colspan="${canWrite ? 9 : 8}" class="cell-center cell-muted" style="padding:18px; text-align: center;">${DB.clientInquiries.length === 0 ? 'No inquiries yet.' : 'No inquiries match your search.'}</td></tr>` :
                  inquiries.map((i) => `
                  <tr style="text-align: center; vertical-align: middle;">
                    <td style="text-align: center; vertical-align: middle;">${i.no}</td>
                    <td class="cell-bold" style="text-align: center; vertical-align: middle;">${escapeHtml(i.clientName)}${i.isVip ? ' <span title="VIP client" style="color:#b8860b;">★</span>' : ''}</td>
                    <td class="cell-center" style="text-align: center; vertical-align: middle; white-space: nowrap;">${escapeHtml(i.clientType)}</td>
                    <td class="cell-center" style="text-align: center; vertical-align: middle;">${escapeHtml(i.clientRole)}</td>
                    <td class="cell-center" style="text-align: center; vertical-align: middle;">${this.inquiryStatusBadge(i.inquiryStatus)}</td>
                    <td class="cell-center" style="text-align: center; vertical-align: middle;">${escapeHtml(i.inquirySource)}</td>
                    <td class="${i.assignedName ? '' : 'cell-muted'}" style="text-align: center; vertical-align: middle; white-space: nowrap;">${i.assignedName ? escapeHtml(i.assignedName) : 'Unassigned'}</td>
                    <td class="cell-center" style="text-align: center; vertical-align: middle;">${this.transactionResultCell(i.transactionResult)}</td>
                    ${canWrite ? `<td style="text-align: center; vertical-align: middle;"><div class="row-actions" style="justify-content: center;">
                        <button class="icon-btn" data-edit-inquiry="${escapeHtml(i.id)}" title="Edit">
                          <i class="fa-solid fa-pen"></i>
                        </button>
                    </div></td>` : ''}
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="chart-card col-narrow">
          <div class="toolbar-row" style="margin-bottom:12px;">
            <span class="card-title">Sales Associates</span>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="text-align: center;">Name</th>
                  <th style="text-align: center;">Status</th>
                  <th style="text-align: center;">Client</th>
                  <th style="text-align: center;" title="Open inquiries / open consignments">Workload</th>
                </tr>
              </thead>
              <tbody>
                ${associates.length === 0 ? '<tr><td colspan="4" class="cell-center cell-muted" style="padding:18px; text-align: center;">No active sales associates.</td></tr>' :
                  associates.map((a) => `
                  <tr style="text-align: center; vertical-align: middle;">
                    <td class="cell-bold" style="text-align: center; vertical-align: middle; white-space: nowrap;">${escapeHtml(a.associateName)}</td>
                    <td class="cell-center" style="text-align: center; vertical-align: middle;">${this.associateStatusBadge(a.status)}</td>
                    <td class="${a.currentClient === '-' ? 'cell-muted' : ''}" style="text-align: center; vertical-align: middle;">${escapeHtml(a.currentClient)}</td>
                    <td style="text-align: center; vertical-align: middle; white-space: nowrap;">${a.openInquiries} inq · ${a.openConsignments} cons</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="section-grid">
        ${canWrite ? `
        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:16px;">Quick Actions</div>
          <button class="quick-action-btn" id="btn-quick-walkin">+ Add Walk In Client</button>
          <button class="quick-action-btn" id="btn-quick-online">+ Add Online Inquiry</button>
        </div>` : ''}
        <div class="chart-card col-wide">
          <div class="card-title" style="margin-bottom:14px;">Recent Assignment Activity</div>
          ${activity.map((a) => `
            <div class="feed-item">
              <div class="feed-desc">${escapeHtml(a.description)}</div>
              <div class="feed-time">${escapeHtml(a.timestamp)}</div>
            </div>`).join('') || '<p class="cell-muted">No activity yet.</p>'}
        </div>
      </div>
    `;
  },

  afterRender() {
    DataStore.refreshIfStale();

    const searchInput = document.getElementById('clients-search-input');
    if (searchInput) {
      searchInput.value = this.searchKeyword;
      searchInput.addEventListener('input', debounce((e) => {
        this.searchKeyword = e.target.value;
        Router.rerender();
        const newInput = document.getElementById('clients-search-input');
        if (newInput) { newInput.focus(); newInput.setSelectionRange(newInput.value.length, newInput.value.length); }
      }, 300));
    }

    const sortSelect = document.getElementById('clients-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.sortBy = e.target.value;
        Router.rerender();
      });
    }

    if (!this.canWrite()) return;

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('btn-add-inquiry', () => this.openInquiryForm(null));
    on('btn-quick-walkin', () => this.openInquiryForm(null, 'walk_in'));
    on('btn-quick-online', () => this.openInquiryForm(null, 'website'));

    document.querySelectorAll('[data-edit-inquiry]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = DB.clientInquiries.find((i) => i.id === btn.dataset.editInquiry);
        if (item) this.openInquiryForm(item);
      });
    });
  },

  openInquiryForm(existing, initialChannel) {
    const isEdit = !!existing;
    const resolved = isEdit && existing.inquiryStatus === 'resolved';
    const sel = (cond) => (cond ? 'selected' : '');
    const channelValue = existing?.channel || initialChannel || 'walk_in';

    const associateOptions = [];
    if (!isEdit) associateOptions.push(['', 'Automatic (least busy associate)']);
    else if (!existing.assignedId) associateOptions.push(['', 'Unassigned']);
    const known = new Set(DB.salesAssociates.map((a) => a.id));
    if (isEdit && existing.assignedId && !known.has(existing.assignedId)) {
      associateOptions.push([existing.assignedId, existing.assignedName]);
    }
    for (const a of DB.salesAssociates) {
      associateOptions.push([a.id, `${a.associateName} (${a.openInquiries + a.openConsignments} open)`]);
    }
    const currentAssignee = existing?.assignedId || '';

    const statusOptions = [];
    if (isEdit) {
      if (existing.inquiryStatus === 'pending') statusOptions.push(['pending', 'Pending']);
      statusOptions.push(['assigned', 'Assigned'], ['resolved', 'Resolved']);
    }

    const html = `
      <form id="inquiry-form">
        <div class="field-group"><label class="field-label">Client Name</label><input class="field-input" name="clientName" required value="${escapeHtml(existing?.clientName || '')}"></div>
        <div class="field-group"><label class="field-label">Phone (optional)</label><input class="field-input" name="phone" value="${escapeHtml(existing?.phone || '')}"></div>
        <div class="field-group"><label class="field-label">Email (optional)</label><input class="field-input" name="email" type="email" value="${escapeHtml(existing?.email || '')}"></div>
        <div class="field-group"><label class="field-label">Client Role</label>
          <select class="field-input" name="clientRole">
            <option value="buyer" ${sel((existing?.clientRoleValue || 'buyer') === 'buyer')}>Buyer</option>
            <option value="consignor" ${sel(existing?.clientRoleValue === 'consignor')}>Consignor</option>
          </select>
        </div>
        <div class="field-group"><label class="field-label">Inquiry Source</label>
          <select class="field-input" name="channel">
            ${Object.entries(INQUIRY_CHANNELS).map(([v, l]) => `<option value="${v}" ${sel(channelValue === v)}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="field-group"><label class="field-label"><input type="checkbox" name="isVip" ${existing?.isVip ? 'checked' : ''}> VIP client</label></div>
        <div class="field-group"><label class="field-label">Assigned Associate</label>
          <select class="field-input" name="associate" ${resolved ? 'disabled' : ''}>
            ${associateOptions.map(([v, l]) => `<option value="${escapeHtml(v)}" ${sel(v === currentAssignee)}>${escapeHtml(l)}</option>`).join('')}
          </select>
        </div>
        ${isEdit ? `
        <div class="field-group"><label class="field-label">Inquiry Status</label>
          <select class="field-input" name="inquiryStatus" ${resolved ? 'disabled' : ''}>
            ${resolved ? '<option value="resolved" selected>Resolved</option>' :
              statusOptions.map(([v, l]) => `<option value="${v}" ${sel(existing.inquiryStatus === v)}>${l}</option>`).join('')}
          </select>
          ${resolved ? '<small class="cell-muted">A resolved inquiry cannot be reopened.</small>' : ''}
        </div>
        <div class="field-group"><label class="field-label">Transaction Result</label>
          <select class="field-input" name="transactionResult">
            ${[['none', 'None'], ['no_purchase', 'No Purchase'], ['purchased', 'Purchased']].map(([v, l]) => `<option value="${v}" ${sel(existing.transactionResult === v)}>${l}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-modal>Cancel</button>
          <button type="submit" class="btn-confirm">${isEdit ? 'Save Changes' : 'Add Inquiry'}</button>
        </div>
      </form>`;
    const overlay = openModal({ title: isEdit ? 'Edit Client Inquiry' : 'Add Client Inquiry', bodyHtml: html });
    overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    overlay.querySelector('#inquiry-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      const ok = await this.saveInquiry(existing, new FormData(form));
      if (ok) {
        closeModal();
      } else {
        submit.disabled = false;
      }
    });
  },

  /** Saves a new or edited inquiry. Returns true on success. */
  async saveInquiry(existing, fd) {
    const text = (k) => String(fd.get(k) || '').trim();
    const name = text('clientName');
    if (!name) { showToast('Please enter the client name.'); return false; }

    try {
      if (!existing) {
        const row = {
          client_name: name,
          client_phone: text('phone') || null,
          client_email: text('email') || null,
          client_role: text('clientRole') || 'buyer',
          inquiry_channel: text('channel') || 'walk_in',
          is_vip: fd.get('isVip') === 'on',
          created_by: Session.currentUser.uid,
        };
        if (text('associate')) row.assigned_associate_id = text('associate');
        const { error } = await sbClient.from('inquiries').insert(row);
        if (error) throw error;
      } else {
        const changes = {};
        const setIf = (col, val, old) => { if (val !== old) changes[col] = val; };
        setIf('client_name', name, existing.clientName);
        setIf('client_phone', text('phone') || null, existing.phone || null);
        setIf('client_email', text('email') || null, existing.email || null);
        setIf('client_role', text('clientRole'), existing.clientRoleValue);
        setIf('inquiry_channel', text('channel'), existing.channel);
        setIf('is_vip', fd.get('isVip') === 'on', existing.isVip);
        setIf('transaction_result', text('transactionResult') || existing.transactionResult, existing.transactionResult);
        if (existing.inquiryStatus !== 'resolved') {
          const assignee = text('associate');
          if (assignee && assignee !== (existing.assignedId || '')) changes.assigned_associate_id = assignee;
          const status = text('inquiryStatus');
          if (status && status !== existing.inquiryStatus) changes.inquiry_status = status;
        }
        if (Object.keys(changes).length === 0) { showToast('No changes to save.'); return true; }

        const { data, error } = await sbClient.from('inquiries').update(changes).eq('id', existing.id).select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('You do not have permission to change this inquiry.');
      }
    } catch (err) {
      console.error('Saving inquiry failed:', err);
      showToast(`Could not save the inquiry: ${err.message || 'unknown error'}`);
      return false;
    }

    showToast(existing ? 'Inquiry updated.' : 'Inquiry added.');
    try { await DataStore.loadClients(); } catch (err) { console.error(err); showToast('Saved, but the list could not be refreshed. Reload the page.'); }
    Router.rerender();
    return true;
  },
};
