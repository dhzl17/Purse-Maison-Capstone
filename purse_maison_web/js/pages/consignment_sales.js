/**
 * Sales & Payouts page — connected to Supabase.
 * Load after consignment_design.js; it adds the 'consignment-sales' page to ConsignmentFlow.
 *
 * Built on the existing database rules (Modules 11 and 13):
 *   - Record a sale on a live listing. Price, commission and payout are copied from the item by the database.
 *     Full payment marks the item Sold; layaway reserves it until the installments cover the total due.
 *   - The manager verifies the buyer's payment (payout due within 14 banking days), then releases the payout.
 *   - Live listings show the 60-day contract countdown and can be extended (consignor must agree)
 *     or withdrawn (the ₱2,500 pull-out fee inside the window is calculated by the database).
 */

const WITHDRAW_REASONS = ['Consignor request', 'Unsatisfied with pricing', 'Sold elsewhere', 'Contract expired', 'Other'];

Object.assign(ConsignmentFlow, {
  salesTab: 'live',
  salesPageSize: 6,
  salesPage: { live: 1, sales: 1, done: 1, withdrawals: 1 },

  role() { return Session.currentUser && Session.currentUser.role; },
  canSell() { return ['salesAssociate', 'manager', 'superAdmin'].includes(this.role()); },
  canVerify() { return ['manager', 'superAdmin'].includes(this.role()); },
  canManageContract() { return ['consignmentTeam', 'manager', 'superAdmin'].includes(this.role()); },

  contractInfo(i) {
    const l = i.listing;
    if (!l || !l.published_at) return null;
    const start = DataStore.parseDateOnly(new Date(l.published_at).toISOString());
    const end = new Date(start); end.setDate(end.getDate() + (l.contract_days || 60));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const left = Math.round((end - today) / 86400000);
    const posted = Math.round((today - start) / 86400000);
    return { end, left, posted, days: l.contract_days || 60 };
  },

  contractBadge(c) {
    if (!c) return '<span class="cell-muted">—</span>';
    if (c.left <= 0) return badge('Expired', 'danger');
    if (c.left <= 7) return badge(`${c.left} day(s) left`, 'warning');
    return badge(`${c.left} days left`, 'success');
  },

  paidSoFar(sale) { return (sale.layaway_payments || []).reduce((s, p) => s + Number(p.amount || 0), 0); },
  paginate(list, key) {
    const size = this.salesPageSize;
    const totalPages = Math.max(1, Math.ceil(list.length / size));
    const page = Math.min(Math.max(1, this.salesPage[key] || 1), totalPages);
    this.salesPage[key] = page;
    return { items: list.slice((page - 1) * size, page * size), page, totalPages };
  },

  pagerHtml(key, pg) {
    if (pg.totalPages <= 1) return '';
    return `<div class="pagination" data-sales-pager="${key}">${renderPaginationButtons(pg.page, pg.totalPages)}</div>`;
  },
  saleStatus(sale) {
    if (sale.payout_status === 'released') return badge('Payout released', 'success');
    if (sale.payment_status === 'verified') return badge('Payout pending', 'warning');
    return badge('Payment pending', 'info');
  },


  menuItem(label, attr, id, { primary = false, danger = false, disabledReason = '' } = {}) {
    const off = !!disabledReason;
    return `<button type="button" class="row-menu-item${primary ? ' primary' : ''}${danger ? ' danger' : ''}${off ? ' disabled' : ''}" ${attr}="${id}" ${off ? 'disabled' : ''}>${label}${off ? `<small>${escapeHtml(disabledReason)}</small>` : ''}</button>`;
  },

  rowMenu(items) {
    if (!items.length) return '';
    return `<div class="row-menu">
      <button type="button" class="row-menu-toggle manage-btn" aria-haspopup="true">Manage <span class="manage-chev">▾</span></button>
      <div class="row-menu-panel" hidden>${items.join('')}</div>
    </div>`;
  },

  closeRowMenus() {
    document.querySelectorAll('.row-menu-panel:not([hidden])').forEach((p) => { p.hidden = true; });
  },

  bindRowMenus() {
    document.querySelectorAll('.row-menu-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = btn.nextElementSibling;
        const wasOpen = !panel.hidden;
        this.closeRowMenus();
        if (wasOpen) return;
        panel.hidden = false;
        const r = btn.getBoundingClientRect();
        const w = panel.offsetWidth;
        const h = panel.offsetHeight;
        panel.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
        panel.style.top = `${r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
      });
    });

    if (!this._rowMenuBound) {
      this._rowMenuBound = true;
      document.addEventListener('click', () => this.closeRowMenus());
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeRowMenus(); });
      window.addEventListener('resize', () => this.closeRowMenus());
      document.addEventListener('scroll', () => this.closeRowMenus(), true);
    }
  },

  // ------------------------------------------------------------------ render
  renderSales() {
    const live = DB.pipelineItems.filter((i) => i.listing && i.listing.inventory_status === 'published' && !i.sale && !i.withdrawal);
    const sales = DB.pipelineItems.filter((i) => i.sale);
    const openSales = sales.filter((i) => i.sale.payout_status !== 'released')
      .sort((a, b) => new Date(a.sale.sold_at) - new Date(b.sale.sold_at));
    const doneSales = sales.filter((i) => i.sale.payout_status === 'released')
      .sort((a, b) => new Date(b.sale.payout_released_at) - new Date(a.sale.payout_released_at)).slice(0, 20);
    const withdrawals = DB.pipelineItems.filter((i) => i.withdrawal && i.withdrawal.status !== 'released');
    const expired = live.filter((i) => { const c = this.contractInfo(i); return c && c.left <= 0; }).length;
        const tab = (key, label, n) => `<button type="button" class="sales-tab${this.salesTab === key ? ' active' : ''}" data-sales-tab="${key}" aria-pressed="${this.salesTab === key}">${label} (${n})</button>`;

    let body = '';
    if (this.salesTab === 'live') body = this.renderLiveListings(live);
    else if (this.salesTab === 'sales') body = this.renderSalesTable(openSales, true) + `<div class="card-title" style="margin:22px 0 10px;">Completed (latest 20)</div>` + this.renderSalesTable(doneSales, false);
    else body = this.renderWithdrawals(withdrawals);

    return `
      <h1 class="page-title" style="margin-bottom:4px;">Sales & Payouts</h1>
      ${expired ? `<div class="card" style="margin-bottom:14px; border-left:4px solid var(--danger-red); padding:10px 14px; font-size:13px;"><strong style="color:var(--danger-red);">${expired} listing(s) past the consignment period.</strong> Extend them with the consignor's agreement, or process a withdrawal.</div>` : ''}
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
        ${tab('live', 'Live Listings', live.length)}
        ${tab('sales', 'Sales & Payouts', openSales.length)}
        ${tab('withdrawals', 'Withdrawals', withdrawals.length)}
      </div>
      <div class="card">${body}</div>`;
  },

  renderLiveListings(list) {
    const pg = this.paginate(list, 'live');
    const rows = pg.items.map((i) => {
      const c = this.contractInfo(i);
      const items = [];
      if (this.canSell()) items.push(this.menuItem('Record sale', 'data-sell', i.id, { primary: true }));
      if (this.canManageContract()) {
        items.push(this.menuItem('Extend contract', 'data-extend', i.id));
        items.push('<div class="row-menu-sep"></div>');
        items.push(this.menuItem('Withdraw item', 'data-withdraw', i.id, { danger: true }));
      }
      return `
        <tr style="vertical-align:middle;">
          <td class="lv-id"><strong>${escapeHtml(i.code)}</strong></td>
          <td class="lv-listing"><div style="font-weight:600;">${escapeHtml((i.listing && i.listing.title) || this.itemName(i))}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(i.consignor.full_name)}</div></td>
          <td class="lv-price"><strong>${this.peso(i.price)}</strong></td>
          <td class="lv-payout">${this.peso(i.consignorPayout)}</td>
          <td class="lv-published" style="font-size:12px;">${c ? escapeHtml(DataStore.formatMDY(i.listing.published_at)) : '—'}</td>
          <td class="lv-contract">${this.contractBadge(c)}${c ? `<div class="cell-muted" style="font-size:11px;">${c.days}-day term</div>` : ''}</td>
          <td class="lv-actions"><div class="sp-actions-wrap">${this.rowMenu(items) || '<span class="cell-muted">View only</span>'}</div></td>
        </tr>`;
    }).join('');
    return `
      <div class="table-scroll"><table class="data-table sales-table sales-table-live">
        <thead><tr><th class="lv-id">Item ID</th><th class="lv-listing">Listing</th><th class="lv-price">Price</th><th class="lv-payout">Consignor Payout</th><th class="lv-published">Published</th><th class="lv-contract">Contract</th><th class="lv-actions">Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="cell-muted" style="text-align:center; padding:18px;">No live listings. Items appear here after the manager publishes them.</td></tr>'}</tbody>
      </table></div>${this.pagerHtml('live', pg)}`;
  },

  renderSalesTable(list, open) {
    const pg = this.paginate(list, open ? 'sales' : 'done');
    const rows = pg.items.map((i) => {
      const s = i.sale;
      const layaway = s.sale_type === 'layaway';
      const paid = this.paidSoFar(s);
      const ready = !layaway || paid >= Number(s.total_due);
      const canAdd = open && layaway && s.payment_status !== 'verified' && this.canSell();
      const canVerify = open && s.payment_status !== 'verified' && this.canVerify();
      const canRelease = open && s.payment_status === 'verified' && this.canVerify();

      const items = [];
      if (canVerify && ready) items.push(this.menuItem('Verify payment', 'data-verify', i.id, { primary: true }));
      if (canAdd) items.push(this.menuItem('Add layaway payment', 'data-installment', i.id, { primary: !(canVerify && ready) }));
      if (canVerify && !ready) items.push(this.menuItem('Verify payment', 'data-verify', i.id, { disabledReason: 'Layaway not fully paid yet' }));
      if (canRelease) items.push(this.menuItem('Release payout', 'data-release', i.id, { primary: true }));

      return `
        <tr style="vertical-align:middle;">
          <td class="sl-id"><strong>${escapeHtml(i.code)}</strong><div class="cell-muted" style="font-size:11px;">${escapeHtml(DataStore.formatMDY(s.sold_at))}</div></td>
          <td class="sl-item"><div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div><div class="cell-muted" style="font-size:11.5px;">Buyer: ${escapeHtml(s.buyer_name)}${s.buyer_phone ? ` · ${escapeHtml(s.buyer_phone)}` : ''} · <strong>${layaway ? `Layaway · ${s.layaway_months} mo` : 'Full payment'}</strong></div></td>
          <td class="sl-due"><strong>${this.peso(s.total_due)}</strong>${Number(s.layaway_interest) ? `<div class="cell-muted" style="font-size:11px;">incl. ${this.peso(s.layaway_interest)} interest</div>` : ''}
            ${layaway ? `<div style="font-size:11px; color:${paid >= Number(s.total_due) ? 'var(--green)' : 'var(--warning-amber)'};">Paid ${this.peso(paid)}</div>` : ''}</td>
          <td class="sl-payout">${this.peso(s.consignor_payout)}${s.payout_due_by && s.payout_status !== 'released' ? `<div class="cell-muted" style="font-size:11px;">due by ${escapeHtml(DataStore.formatMDY(s.payout_due_by + 'T12:00:00'))}</div>` : ''}</td>
          <td class="sl-status">${this.saleStatus(s)}</td>
          ${open ? `<td class="sl-actions"><div class="sp-actions-wrap">${this.rowMenu(items) || '<span class="cell-muted">—</span>'}</div></td>` : ''}
        </tr>`;
    }).join('');
    return `
      <div class="table-scroll"><table class="data-table sales-table ${open ? 'sales-table-open' : 'sales-table-done'}">
        <thead><tr><th class="sl-id">Item ID</th><th class="sl-item">Item & Buyer</th><th class="sl-due">Total Due</th><th class="sl-payout">Consignor Payout</th><th class="sl-status">Status</th>${open ? '<th class="sl-actions">Actions</th>' : ''}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${open ? 6 : 5}" class="cell-muted" style="text-align:center; padding:18px;">${open ? 'No open sales.' : 'No completed payouts yet.'}</td></tr>`}</tbody>
      </table></div>${this.pagerHtml(open ? 'sales' : 'done', pg)}`;
  },

  renderWithdrawals(list) {
    const pg = this.paginate(list, 'withdrawals');
    const rows = pg.items.map((i) => {
      const w = i.withdrawal;
      const items = [];
      if (this.canVerify() && !w.fee_paid) items.push(this.menuItem('Mark fee paid', 'data-fee-paid', i.id, { primary: true }));
      if (this.canVerify()) {
        if (items.length) items.push('<div class="row-menu-sep"></div>');
        items.push(this.menuItem('Release item', 'data-release-item', i.id,
          w.fee_paid ? { primary: true } : { disabledReason: 'Pull-out fee not paid' }));
      }
      return `
        <tr style="vertical-align:middle;">
          <td class="wd-id"><strong>${escapeHtml(i.code)}</strong></td>
          <td class="wd-item"><div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(i.consignor.full_name)}</div></td>
          <td class="wd-reason">${escapeHtml(w.reason || '—')}</td>
          <td class="wd-since">${w.days_since_posting == null ? '—' : `${w.days_since_posting} day(s)`}</td>
                    <td class="wd-fee"><strong>${this.peso(w.pull_out_fee)}</strong><div style="font-size:11px; color:${w.fee_paid ? 'var(--green)' : 'var(--danger-red)'};">${w.fee_paid ? (Number(w.pull_out_fee) ? 'Paid' : 'No fee') : 'Unpaid'}</div></td>
          <td class="wd-actions"><div class="sp-actions-wrap">${this.rowMenu(items) || '<span class="cell-muted">Waiting for manager</span>'}</div></td>
        </tr>`;
    }).join('');
    return `
      <div class="table-scroll"><table class="data-table sales-table sales-table-wd">
        <thead><tr><th class="wd-id">Item ID</th><th class="wd-item">Item</th><th class="wd-reason">Reason</th><th class="wd-since">Since Posting</th><th class="wd-fee">Pull-out Fee</th><th class="wd-actions">Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="cell-muted" style="text-align:center; padding:18px;">No pending withdrawals.</td></tr>'}</tbody>
      </table></div>
      ${this.pagerHtml('withdrawals', pg)}
      <p class="cell-muted" style="font-size:12px; margin-top:8px;">Releasing returns the item to the consignor and archives it.</p>`;
  },

  // ------------------------------------------------------------------ modals
  openSaleModal(i) {
    const allowLayaway = i.price != null && i.price >= LAYAWAY_MIN_PRICE;
    const overlay = openModal({
      title: `Record Sale — ${i.code}`,
      bodyHtml: `
        <div style="font-size:13px; margin-bottom:10px;"><strong>${escapeHtml((i.listing && i.listing.title) || this.itemName(i))}</strong> · ${this.peso(i.price)}</div>
        <div class="field-group"><label class="field-label">Buyer Name</label><input class="field-input" id="sale-buyer" required></div>
        <div class="field-group"><label class="field-label">Buyer Phone Number</label><input class="field-input" id="sale-phone"></div>
        <div class="field-group"><label class="field-label">Payment Type</label>
          <select class="field-input" id="sale-type">
            <option value="full_payment">Full payment</option>
            ${allowLayaway ? '<option value="layaway">Layaway (1% interest per month, max 3 months)</option>' : ''}
          </select>
          ${allowLayaway ? '' : '<small class="cell-muted">Layaway is offered for items ₱200,000 and above.</small>'}
        </div>
        <div class="field-group" id="sale-months-group" style="display:none;"><label class="field-label">Layaway Term</label>
          <select class="field-input" id="sale-months">
            <option value="1">1 month (no interest)</option><option value="2">2 months</option><option value="3">3 months</option>
          </select>
        </div>
        <div id="sale-summary" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; font-size:12.5px;"></div>
        <div class="modal-actions">
          <button class="btn-secondary" data-close-modal>Cancel</button>
          <button class="btn-confirm" id="sale-save">Record Sale</button>
        </div>`,
    });
    const type = overlay.querySelector('#sale-type');
    const months = overlay.querySelector('#sale-months');
    const summary = () => {
      const lay = type.value === 'layaway';
      overlay.querySelector('#sale-months-group').style.display = lay ? '' : 'none';
      const m = Number(months.value);
      const interest = lay && m > 1 ? Math.round(i.price * 0.01 * m * 100) / 100 : 0;
      overlay.querySelector('#sale-summary').innerHTML = `
        <div>Sale price: <strong>${this.peso(i.price)}</strong></div>
        ${lay ? `<div>Layaway interest: <strong>${this.peso(interest)}</strong>${m === 1 ? ' (waived for 1 month)' : ''}</div>` : ''}
        <div>Total due from buyer: <strong>${this.peso(i.price + interest)}</strong></div>
        <div>Consignor payout: <strong>${this.peso(i.consignorPayout)}</strong> · Company commission: <strong>${this.peso(i.markup)}</strong></div>`;
    };
    type.addEventListener('change', summary); months.addEventListener('change', summary); summary();
    overlay.querySelector('#sale-save').addEventListener('click', (e) => {
      const buyer = overlay.querySelector('#sale-buyer').value.trim();
      if (!buyer) return showToast("Enter the buyer's name.");
      const buyerPhone = Validate.normalizePhone(overlay.querySelector('#sale-phone').value);
      const problem = Validate.first(Validate.personName(buyer, 'Buyer name'), Validate.phone(buyerPhone, 'Buyer phone number'));
      if (problem) return showToast(problem);
      const lay = type.value === 'layaway';
      this.save(e.target, `Sale recorded for ${i.code}.`, async () => {
        const { error } = await sbClient.from('sales_transactions').insert({
          item_id: i.id, buyer_name: buyer, buyer_phone: buyerPhone || null,
          sale_type: type.value, layaway_months: lay ? Number(months.value) : null,
        });
        if (error) throw error;
        closeModal();
        this.salesTab = 'sales';
        DataStore.loadedAt = 0;
      });
    });
  },

  openInstallmentModal(i) {
    const s = i.sale;
    const remaining = Math.max(0, Number(s.total_due) - this.paidSoFar(s));
    const overlay = openModal({
      title: `Layaway Payment — ${i.code}`,
      bodyHtml: `
        <div style="font-size:12.5px; margin-bottom:10px;">Total due ${this.peso(s.total_due)} · paid ${this.peso(this.paidSoFar(s))} · <strong>remaining ${this.peso(remaining)}</strong></div>
        ${(s.layaway_payments || []).length ? `<div style="font-size:11.5px; color:#475569; margin-bottom:10px;">${s.layaway_payments.map((p) => `${escapeHtml(DataStore.formatMDY(p.paid_at))}: ${this.peso(p.amount)}`).join('<br>')}</div>` : ''}
        <div class="field-group"><label class="field-label">Amount Received (₱)</label><input class="field-input" id="inst-amount" type="number" min="1" value="${remaining || ''}"></div>
        <div class="modal-actions">
          <button class="btn-secondary" data-close-modal>Cancel</button>
          <button class="btn-confirm" id="inst-save">Record Payment</button>
        </div>`,
    });
    overlay.querySelector('#inst-save').addEventListener('click', (e) => {
      const amount = Number(overlay.querySelector('#inst-amount').value);
      if (!(amount > 0)) return showToast('Enter the amount received.');
      const problem = Validate.amount(overlay.querySelector('#inst-amount').value, 'Amount received', true, 2);
      if (problem) return showToast(problem);
      this.save(e.target, `Payment of ${this.peso(amount)} recorded.`, async () => {
        const { error } = await sbClient.from('layaway_payments').insert({ sale_id: s.id, amount });
        if (error) throw error;
        closeModal();
      });
    });
  },

  openExtendModal(i) {
    const c = this.contractInfo(i);
    const overlay = openModal({
      title: `Extend Contract — ${i.code}`,
      bodyHtml: `
        <div style="font-size:12.5px; margin-bottom:10px;">Current term: ${c ? c.days : 60} days · ${c ? (c.left > 0 ? `${c.left} day(s) left` : 'expired') : ''}</div>
        ${i.extensions.length ? `<div style="font-size:11.5px; color:#475569; margin-bottom:10px;">Earlier: ${i.extensions.map((x) => `+${x.extra_days} days (${escapeHtml(DataStore.formatMDY(x.created_at))})`).join(', ')}</div>` : ''}
        <div class="field-group"><label class="field-label">Extend by</label>
          <select class="field-input" id="ext-days"><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></div>
        <div class="field-group"><label class="field-label">Notes</label><input class="field-input" id="ext-notes" placeholder="e.g. Agreed by phone on Oct 9"></div>
        <label style="display:flex; gap:8px; align-items:center; font-size:13px;"><input type="checkbox" id="ext-agreed"> The consignor agreed to this extension</label>
        <div class="modal-actions">
          <button class="btn-secondary" data-close-modal>Cancel</button>
          <button class="btn-confirm" id="ext-save">Submit</button>
        </div>`,
    });
    overlay.querySelector('#ext-save').addEventListener('click', (e) => {
      if (!overlay.querySelector('#ext-agreed').checked) return showToast('An extension needs the consignor\'s agreement.');
      const problem = Validate.notes(overlay.querySelector('#ext-notes').value, 'Notes');
      if (problem) return showToast(problem);
      const days = Number(overlay.querySelector('#ext-days').value);
      this.save(e.target, `${i.code} extended by ${days} days.`, async () => {
        const { error } = await sbClient.from('contract_extensions').insert({
          item_id: i.id, extra_days: days, consignor_agreed: true, notes: overlay.querySelector('#ext-notes').value.trim() || null,
        });
        if (error) throw error;
        closeModal();
      });
    });
  },

  openWithdrawModal(i) {
    const c = this.contractInfo(i);
    const inWindow = c && c.posted < 60;
    const overlay = openModal({
      title: `Withdraw Item — ${i.code}`,
      bodyHtml: `
        <div style="font-size:12.5px; margin-bottom:10px;">${escapeHtml(this.itemName(i))} · ${escapeHtml(i.consignor.full_name)}<br>
          Posted ${c ? `${c.posted} day(s) ago` : '—'}. Expected pull-out fee: <strong style="color:${inWindow ? 'var(--danger-red)' : 'var(--green)'};">${inWindow ? '₱2,500' : '₱0 (past 60 days)'}</strong>
          <div class="cell-muted">The system calculates the final fee from the current settings.</div></div>
        <div class="field-group"><label class="field-label">Reason</label>
          <select class="field-input" id="wd-reason">${WITHDRAW_REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
        <div class="modal-actions">
          <button class="btn-secondary" data-close-modal>Cancel</button>
          <button class="btn-confirm btn-danger" id="wd-save">Request Withdrawal</button>
        </div>`,
    });
    overlay.querySelector('#wd-save').addEventListener('click', (e) => {
      this.save(e.target, `Withdrawal requested for ${i.code}. The manager releases it once any fee is paid.`, async () => {
        const { error } = await sbClient.from('item_withdrawals').insert({ item_id: i.id, reason: overlay.querySelector('#wd-reason').value });
        if (error) throw error;
        closeModal();
        this.salesTab = 'withdrawals';
      });
    });
  },

  async updateRow(table, id, changes, deniedMessage) {
    const { data, error } = await sbClient.from(table).update(changes).eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error(deniedMessage);
  },

  // -------------------------------------------------------------------- bind
    bindSales() {
    const all = (sel, fn) => document.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => fn(b)));
    this.bindRowMenus();
    document.querySelectorAll('[data-sales-pager]').forEach((pager) => {
      pager.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-page]');
        if (!btn || btn.disabled) return;
        this.salesPage[pager.dataset.salesPager] = parseInt(btn.dataset.page, 10);
        Router.rerender();
      });
    });
    all('[data-sales-tab]', (b) => { this.salesTab = b.dataset.salesTab; Router.rerender(); });
        all('[data-sell]', (b) => this.openSaleModal(this.item(b.dataset.sell)));
    all('[data-extend]', (b) => this.openExtendModal(this.item(b.dataset.extend)));
    all('[data-withdraw]', (b) => this.openWithdrawModal(this.item(b.dataset.withdraw)));
    all('[data-installment]', (b) => this.openInstallmentModal(this.item(b.dataset.installment)));
    all('[data-verify]', (b) => {
      const i = this.item(b.dataset.verify);
      this.confirm('Verify payment?', `Confirm the buyer's payment of ${this.peso(i.sale.total_due)} for ${i.code} was received. The consignor payout becomes due within 14 banking days. This cannot be undone.`,
        'Verify Payment', () => this.save(b, `Payment verified for ${i.code}.`, async () => {
          await this.updateRow('sales_transactions', i.sale.id, { payment_status: 'verified' }, 'Only the manager or owner can verify payments.');
          DataStore.loadedAt = 0;
        }));
    });
    all('[data-release]', (b) => {
      const i = this.item(b.dataset.release);
      this.confirm('Release payout?', `Confirm ${this.peso(i.sale.consignor_payout)} was paid out to ${i.consignor.full_name} for ${i.code}. This cannot be undone.`,
        'Release Payout', () => this.save(b, `Payout released for ${i.code}.`,
          () => this.updateRow('sales_transactions', i.sale.id, { payout_status: 'released' }, 'Only the manager or owner can release payouts.')));
    });
    all('[data-fee-paid]', (b) => {
      const i = this.item(b.dataset.feePaid);
      this.save(b, `Pull-out fee marked paid for ${i.code}.`,
        () => this.updateRow('item_withdrawals', i.withdrawal.id, { fee_paid: true }, 'Only the manager or owner can process withdrawals.'));
    });
    all('[data-release-item]', (b) => {
      const i = this.item(b.dataset.releaseItem);
      this.confirm('Release item to consignor?', `${i.code} will be handed back to ${i.consignor.full_name} and archived. This cannot be undone.`,
        'Release Item', () => this.save(b, `${i.code} released and archived.`, async () => {
          await this.updateRow('item_withdrawals', i.withdrawal.id, { status: 'released' }, 'Only the manager or owner can process withdrawals.');
          DataStore.loadedAt = 0;
        }));
    });
  },
});

ConsignmentFlow.pages['consignment-sales'] = ['renderSales', 'bindSales'];
