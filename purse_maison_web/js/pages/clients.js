/**
 * Client Assignment page — mirrors screens/client_assignment_page.dart +
 * widgets/client_assignment_tables.dart + widgets/client_assignment_panels.dart.
 */

const ClientsPage = {
  inquiryStatusBadge(status) {
    const map = { newInquiry: ['New', 'info'], closed: ['Closed', 'danger'], followedUp: ['Followed-up', 'warning'], reserved: ['Reserved', 'success'] };
    const [label, tone] = map[status];
    return badge(label, tone);
  },
  transactionResultCell(result) {
    if (result === 'none') return '<span class="cell-muted">-</span>';
    return result === 'purchased' ? badge('Purchased', 'success') : badge('No Purchase', 'danger');
  },
  associateStatusBadge(status) {
    return status === 'assigned' ? badge('Assigned', 'warning') : badge('Available', 'success');
  },

  nextInquiryNo() {
    return DB.clientInquiries.reduce((max, i) => Math.max(max, i.no), 0) + 1;
  },

  render() {
    const inquiries = DB.clientInquiries;
    const associates = DB.salesAssociates;
    const activity = DB.assignmentActivity;

    return `
      <h1 class="page-title">Client Assignment</h1>
      <div class="sort-row" style="margin-bottom:14px;">Sort by: <strong style="color:var(--text-dark)">Recently</strong> ▾</div>

      <div class="section-grid">
        <div class="chart-card col-wide">
          <div class="toolbar-row" style="margin-bottom:12px;">
            <span class="card-title">Client Inquiries</span>
            <button class="btn-add" id="btn-add-inquiry">+ Add Inquiry</button>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>No.</th><th>Client Name</th><th>Type</th><th>Role</th><th>Status</th><th>Source</th><th>Result</th><th>Actions</th></tr></thead>
              <tbody>
                ${inquiries.map((i) => `
                  <tr>
                    <td>${i.no}</td>
                    <td class="cell-bold">${escapeHtml(i.clientName)}</td>
                    <td class="cell-center">${escapeHtml(i.clientType)}</td>
                    <td class="cell-center">${escapeHtml(i.clientRole)}</td>
                    <td class="cell-center">${this.inquiryStatusBadge(i.inquiryStatus)}</td>
                    <td class="cell-center">${escapeHtml(i.inquirySource)}</td>
                    <td class="cell-center">${this.transactionResultCell(i.transactionResult)}</td>
                    <td><div class="row-actions">
                      <button class="icon-btn" data-edit-inquiry="${i.id}" title="Edit">✎</button>
                      <button class="icon-btn danger" data-delete-inquiry="${i.id}" title="Delete">🗑</button>
                    </div></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="chart-card col-narrow">
          <div class="toolbar-row" style="margin-bottom:12px;">
            <span class="card-title">Sales Associates</span>
            <button class="btn-add" id="btn-add-associate">+ Add</button>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Name</th><th>Status</th><th>Client</th><th></th></tr></thead>
              <tbody>
                ${associates.map((a) => `
                  <tr>
                    <td class="cell-bold">${escapeHtml(a.associateName)}</td>
                    <td class="cell-center">${this.associateStatusBadge(a.status)}</td>
                    <td class="${a.currentClient === '-' ? 'cell-muted' : ''}">${escapeHtml(a.currentClient)}</td>
                    <td><div class="row-actions">
                      <button class="icon-btn" data-edit-assoc="${a.id}" title="Edit">✎</button>
                      <button class="icon-btn danger" data-delete-assoc="${a.id}" title="Delete">🗑</button>
                    </div></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="section-grid">
        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:16px;">Quick Actions</div>
          <button class="quick-action-btn" id="btn-quick-walkin">+ Add Walk In Client</button>
          <button class="quick-action-btn" id="btn-quick-online">+ Add Online Inquiry</button>
        </div>
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
    document.getElementById('btn-add-inquiry').addEventListener('click', () => this.openInquiryForm(null));
    document.getElementById('btn-add-associate').addEventListener('click', () => this.openAssociateForm(null));
    document.getElementById('btn-quick-walkin').addEventListener('click', () => this.openInquiryForm(null, 'Walk-in'));
    document.getElementById('btn-quick-online').addEventListener('click', () => this.openInquiryForm(null, 'Online'));

    document.querySelectorAll('[data-edit-inquiry]').forEach((btn) => {
      btn.addEventListener('click', () => this.openInquiryForm(DB.clientInquiries.find((i) => i.id === btn.dataset.editInquiry)));
    });
    document.querySelectorAll('[data-delete-inquiry]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = DB.clientInquiries.find((i) => i.id === btn.dataset.deleteInquiry);
        confirmDelete(item.clientName, () => {
          DB.clientInquiries = DB.clientInquiries.filter((i) => i.id !== item.id);
          showToast('Inquiry deleted.');
          Router.rerender();
        });
      });
    });
    document.querySelectorAll('[data-edit-assoc]').forEach((btn) => {
      btn.addEventListener('click', () => this.openAssociateForm(DB.salesAssociates.find((a) => a.id === btn.dataset.editAssoc)));
    });
    document.querySelectorAll('[data-delete-assoc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = DB.salesAssociates.find((a) => a.id === btn.dataset.deleteAssoc);
        confirmDelete(item.associateName, () => {
          DB.salesAssociates = DB.salesAssociates.filter((a) => a.id !== item.id);
          showToast('Associate removed.');
          Router.rerender();
        });
      });
    });
  },

  openInquiryForm(existing, initialClientType) {
    const isEdit = !!existing;
    const html = `
      <form id="inquiry-form">
        <div class="field-group"><label class="field-label">Client Name</label><input class="field-input" name="clientName" required value="${escapeHtml(existing?.clientName || '')}"></div>
        <div class="field-group"><label class="field-label">Client Type</label><input class="field-input" name="clientType" required value="${escapeHtml(existing?.clientType || initialClientType || 'Walk-in')}"></div>
        <div class="field-group"><label class="field-label">Client Role</label><input class="field-input" name="clientRole" required value="${escapeHtml(existing?.clientRole || 'Buyer')}"></div>
        <div class="field-group"><label class="field-label">Inquiry Status</label>
          <select class="field-input" name="inquiryStatus">
            ${[['newInquiry', 'New'], ['closed', 'Closed'], ['followedUp', 'Followed-up'], ['reserved', 'Reserved']].map(([v, l]) => `<option value="${v}" ${existing?.inquiryStatus === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="field-group"><label class="field-label">Inquiry Source</label><input class="field-input" name="inquirySource" required value="${escapeHtml(existing?.inquirySource || '')}"></div>
        <div class="field-group"><label class="field-label">Transaction Result</label>
          <select class="field-input" name="transactionResult">
            ${[['none', 'None'], ['noPurchase', 'No Purchase'], ['purchased', 'Purchased']].map(([v, l]) => `<option value="${v}" ${existing?.transactionResult === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-modal>Cancel</button>
          <button type="submit" class="btn-confirm">${isEdit ? 'Save Changes' : 'Add Inquiry'}</button>
        </div>
      </form>`;
    const overlay = openModal({ title: isEdit ? 'Edit Client Inquiry' : 'Add Client Inquiry', bodyHtml: html });
    overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    overlay.querySelector('#inquiry-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const record = {
        id: existing?.id || nextId('ci'), no: existing?.no || this.nextInquiryNo(),
        clientName: fd.get('clientName').trim(), clientType: fd.get('clientType').trim(),
        clientRole: fd.get('clientRole').trim(), inquiryStatus: fd.get('inquiryStatus'),
        inquirySource: fd.get('inquirySource').trim(), transactionResult: fd.get('transactionResult'),
      };
      if (isEdit) {
        const idx = DB.clientInquiries.findIndex((i) => i.id === record.id);
        DB.clientInquiries[idx] = record;
      } else {
        DB.clientInquiries.push(record);
      }
      closeModal();
      showToast(isEdit ? 'Inquiry updated.' : 'Inquiry added.');
      Router.rerender();
    });
  },

  openAssociateForm(existing) {
    const isEdit = !!existing;
    const html = `
      <form id="associate-form">
        <div class="field-group"><label class="field-label">Associate Name</label><input class="field-input" name="associateName" required value="${escapeHtml(existing?.associateName || '')}"></div>
        <div class="field-group"><label class="field-label">Status</label>
          <select class="field-input" name="status">
            <option value="assigned" ${existing?.status === 'assigned' ? 'selected' : ''}>Assigned</option>
            <option value="available" ${existing?.status === 'available' ? 'selected' : ''}>Available</option>
          </select>
        </div>
        <div class="field-group"><label class="field-label">Current Client (leave blank if none)</label><input class="field-input" name="currentClient" value="${escapeHtml(existing?.currentClient === '-' ? '' : (existing?.currentClient || ''))}"></div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-modal>Cancel</button>
          <button type="submit" class="btn-confirm">${isEdit ? 'Save Changes' : 'Add Associate'}</button>
        </div>
      </form>`;
    const overlay = openModal({ title: isEdit ? 'Edit Sales Associate' : 'Add Sales Associate', bodyHtml: html });
    overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    overlay.querySelector('#associate-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const client = fd.get('currentClient').trim();
      const record = {
        id: existing?.id || nextId('sa'), associateName: fd.get('associateName').trim(),
        status: fd.get('status'), currentClient: client === '' ? '-' : client,
      };
      if (isEdit) {
        const idx = DB.salesAssociates.findIndex((a) => a.id === record.id);
        DB.salesAssociates[idx] = record;
      } else {
        DB.salesAssociates.push(record);
      }
      closeModal();
      showToast(isEdit ? 'Associate updated.' : 'Associate added.');
      Router.rerender();
    });
  },
};
