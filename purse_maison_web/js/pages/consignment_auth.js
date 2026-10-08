/**
 * Authentication Service page (stages 10-12) — connected to Supabase.
 * Load this file after consignment_intake.js; it adds the 'consignment-auth' page to ConsignmentFlow.
 *
 * How the database runs it (Modules 5, 6 and 20):
 *   - payment confirmed            -> item enters the queue, 24-hour SLA clock starts
 *   - an authenticator takes a check -> Authentication Process
 *   - certificate uploaded         -> Authentication Certificate
 *   - both results agree           -> Authentic: Photography / Fake: Closed – Fake (automatic)
 *   - results disagree             -> the owner settles it
 * Two different people must do the two checks, and each person can only record their own result.
 */

const AUTH_QUEUE_STAGES = ['authentication_service', 'authentication_process', 'authentication_certificate'];
const AUTH_RESULTS = { authentic: 'Authentic', fake: 'Fake' };

Object.assign(ConsignmentFlow, {
  selectedAuthItem: null,

  isAuthenticator() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'authenticator' || role === 'superAdmin';
  },
  isOwner() { return !!Session.currentUser && Session.currentUser.role === 'superAdmin'; },
  myId() { return Session.currentUser && Session.currentUser.uid; },
  staffName(id) {
    const p = (DB.staffDirectory || []).find((s) => s.id === id);
    return p ? (p.full_name || '(unnamed)') : '(unknown)';
  },
  eligibleAuthenticators() {
    return (DB.staffDirectory || []).filter((s) => s.is_active && (s.role === 'authenticator' || s.role === 'super_admin'));
  },

  /** SLA state from the deadline, same thresholds as the authentication_sla_status view. */
  slaInfo(a) {
    if (!a || !a.sla_deadline) return { state: 'not_started', html: badge('Not started', 'info') };
    if (a.final_result) return { state: 'completed', html: badge('Completed', 'success') };
    const ms = new Date(a.sla_deadline) - Date.now();
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    if (ms <= 0) return { state: 'breached', html: badge(`Overdue by ${h}h ${m}m`, 'danger') };
    if (ms <= 2 * 3600000) return { state: 'at_risk', html: badge(`${h}h ${m}m left`, 'warning') };
    return { state: 'on_track', html: badge(`${h}h ${m}m left`, 'success') };
  },

  resultBadge(r) {
    if (r === 'authentic') return badge('Authentic', 'success');
    if (r === 'fake') return badge('Fake', 'danger');
    return '<span class="cell-muted">Pending</span>';
  },

  /** Whether the viewer may see a slot's result (checks stay independent until both are in). */
  canSeeResult(a, slot) {
    if (a.final_result || this.isOwner()) return true;
    const other = slot === 'primary' ? 'secondary' : 'primary';
    if (a[`${slot}_authenticator_id`] === this.myId()) return true;
    if (a[`${other}_authenticator_id`] === this.myId() && a[`${other}_result`]) return true;
    return !this.isAuthenticator(); // other roles are only viewing
  },

  slotCell(a, slot) {
    const who = a[`${slot}_authenticator_id`];
    const res = a[`${slot}_result`];
    if (!who) return '<span class="cell-muted">Unassigned</span>';
    const shown = res ? (this.canSeeResult(a, slot) ? this.resultBadge(res) : badge('Recorded', 'info')) : '<span class="cell-muted">Pending</span>';
    return `<div style="font-size:12px; font-weight:600;">${escapeHtml(this.staffName(who))}</div>${shown}`;
  },

  async updateAuth(recordId, changes) {
    const { data, error } = await sbClient.from('authentication_records').update(changes).eq('id', recordId).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Your role is not allowed to change this authentication record.');
  },

  // ------------------------------------------------------------------ render
  renderAuth() {
    const queue = DB.pipelineItems
      .filter((i) => AUTH_QUEUE_STAGES.includes(i.stage) && i.auth)
      .sort((x, y) => new Date(x.auth.sla_deadline || 8.64e15) - new Date(y.auth.sla_deadline || 8.64e15));
    if (this.selectedAuthItem && !queue.some((i) => i.id === this.selectedAuthItem)) this.selectedAuthItem = null;
    const sel = this.item(this.selectedAuthItem);
    const breached = queue.filter((i) => this.slaInfo(i.auth).state === 'breached').length;
    const atRisk = queue.filter((i) => this.slaInfo(i.auth).state === 'at_risk').length;

    return `
      <h1 class="page-title" style="margin-bottom:4px;">Authentication Service</h1>
      <p class="cell-muted" style="margin:0 0 12px;">Double authentication within the 24-hour SLA. Items are ordered by deadline, most urgent first.</p>
      ${breached || atRisk ? `<div class="card" style="margin-bottom:14px; border-left:4px solid var(--danger-red); padding:10px 14px; font-size:13px;">
        ${breached ? `<strong style="color:var(--danger-red);">${breached} item(s) past the 24-hour SLA.</strong> ` : ''}
        ${atRisk ? `<strong style="color:var(--warning-amber);">${atRisk} item(s) due within 2 hours.</strong>` : ''}
      </div>` : ''}
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">Authentication Queue (${queue.length})</div>
        ${this.queueTable(queue, this.selectedAuthItem, [
          ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
          ['Item', (i) => `<div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div><div class="cell-muted" style="font-size:11.5px;">SN ${escapeHtml(i.serial || 'N/A')}</div>`],
          ['SLA', (i) => this.slaInfo(i.auth).html],
          ['1st Check', (i) => this.slotCell(i.auth, 'primary')],
          ['2nd Check', (i) => this.slotCell(i.auth, 'secondary')],
          ['Certificate', (i) => (i.auth.certificate_url ? badge('Uploaded', 'success') : '<span class="cell-muted">—</span>')],
          ['Stage', (i) => this.stageBadge(i.stage)],
        ], 'No items waiting for authentication. Items appear here once their authentication payment is confirmed.')}
      </div>
      ${sel ? this.renderAuthPanel(sel) : ''}`;
  },

  renderAuthPanel(i) {
    const a = i.auth;
    const act = this.isAuthenticator();
    const done = !!a.final_result;
    const disagree = a.primary_result && a.secondary_result && a.primary_result !== a.secondary_result && !done;

    return `
      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:6px;">${escapeHtml(i.code)} · ${escapeHtml(this.itemName(i))}</div>
          <div style="margin-bottom:12px;">${this.stageBadge(i.stage)}</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:8px; font-size:12.5px; margin-bottom:14px;">
            <div><span class="cell-muted">Category</span><br><strong>${escapeHtml(i.category || '—')}</strong></div>
            <div><span class="cell-muted">Serial number</span><br><strong style="font-family:monospace;">${escapeHtml(i.serial || '—')}</strong></div>
            <div><span class="cell-muted">Microchip</span><br><strong style="font-family:monospace;">${escapeHtml(i.microchip || '—')}</strong></div>
            <div><span class="cell-muted">Date code</span><br><strong style="font-family:monospace;">${escapeHtml(i.dateCode || '—')}</strong></div>
            <div><span class="cell-muted">Hardware</span><br><strong>${escapeHtml(i.hardware || '—')}</strong></div>
            <div><span class="cell-muted">Accessories</span><br><strong>${escapeHtml(i.accessories.join(', ') || '—')}</strong></div>
          </div>
          ${i.conditionNotes ? `<div style="font-size:12.5px; margin-bottom:14px;"><span class="cell-muted">Condition notes:</span> ${escapeHtml(i.conditionNotes)}</div>` : ''}
          <h3 style="font-size:14px; margin:0 0 8px;">Intake Photos</h3>
          ${this.renderPhotoGrid(i, false)}

          <h3 style="font-size:14px; margin:18px 0 8px;">Certificate of Authentication</h3>
          ${a.certificate_url ? `
            <div style="font-size:12.5px; margin-bottom:8px; color:var(--green);">✓ Uploaded ${escapeHtml(this.fmtDate(a.certificate_uploaded_at))}
              <button class="btn-secondary" id="auth-view-cert" style="margin-left:8px; padding:3px 10px; font-size:12px;">View</button></div>` : '<div class="cell-muted" style="font-size:12.5px; margin-bottom:8px;">Not uploaded yet. Required before the final result.</div>'}
          ${act && !done ? `
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <input class="field-input" type="file" id="auth-cert-file" accept="application/pdf,image/jpeg,image/png,image/webp" style="max-width:320px;">
              <button class="btn-secondary" id="auth-upload-cert">${a.certificate_url ? 'Replace Certificate' : 'Upload Certificate'}</button>
            </div>` : ''}
        </div>

        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">Service</div>
          <div style="font-size:12.5px; line-height:1.7;">
            <div><span class="cell-muted">Provider:</span> ${escapeHtml(FEE_LABELS[`${a.provider}/${a.category}`] || a.provider || '—')}</div>
            <div><span class="cell-muted">Fee paid:</span> ${this.peso(a.fee)} <span class="cell-muted">(ref ${escapeHtml(a.payment_reference || '—')})</span></div>
            <div><span class="cell-muted">Started:</span> ${escapeHtml(this.fmtDate(a.service_started_at))}</div>
            <div><span class="cell-muted">Est. completion:</span> ${escapeHtml(this.fmtDate(a.sla_deadline))}</div>
            <div style="margin-top:4px;">${this.slaInfo(a).html}</div>
          </div>

          ${this.renderSlot(i, 'primary', '1st Authenticator')}
          ${this.renderSlot(i, 'secondary', '2nd Authenticator')}

          <div style="margin-top:16px; padding-top:12px; border-top:1px solid #E2E8F0;">
            <div class="card-title" style="margin-bottom:8px;">Outcome</div>
            ${disagree ? `
              <div style="font-size:12.5px; color:var(--danger-red); font-weight:600; margin-bottom:8px;">The two results disagree.</div>
              ${this.isOwner() ? `
                <div class="field-group">
                  <label class="field-label">Owner's final decision</label>
                  <select class="field-input" id="auth-final">
                    <option value="authentic">Authentic → Photography</option>
                    <option value="fake">Fake → Close item</option>
                  </select>
                </div>
                <button class="btn-confirm" id="auth-settle" style="width:100%;">Record Final Decision</button>` :
                '<div class="cell-muted" style="font-size:12px;">The owner (Super Admin) decides the final result.</div>'}` :
              this.checklistHtml([
                [!!a.primary_result, '1st result recorded'],
                [!!a.secondary_result, '2nd result recorded'],
                [!!a.certificate_url, 'Certificate uploaded'],
              ]) + '<div class="cell-muted" style="font-size:12px; margin-top:6px;">When both results agree, the item moves on automatically: Authentic → Photography, Fake → closed.</div>'}
          </div>
          <button class="btn-secondary" id="auth-history" style="width:100%; margin-top:14px;">View Activity Log</button>
        </div>
      </div>`;
  },

  renderSlot(i, slot, title) {
    const a = i.auth;
    const other = slot === 'primary' ? 'secondary' : 'primary';
    const who = a[`${slot}_authenticator_id`];
    const res = a[`${slot}_result`];
    const mine = who && who === this.myId();
    const canRecord = !res && !a.final_result && (mine || this.isOwner());
    const canClaim = !who && this.isAuthenticator() && a[`${other}_authenticator_id`] !== this.myId();
    const canRelease = who && !res && (mine || this.isOwner());

    let body;
    if (!who) {
      body = `<div class="cell-muted" style="font-size:12px; margin-bottom:6px;">Not assigned yet.</div>
        ${canClaim ? `<button class="btn-confirm" data-auth-claim="${slot}" style="width:100%; margin-bottom:6px;">Take This Check</button>` : ''}
        ${this.isOwner() ? `
          <div style="display:flex; gap:6px;">
            <select class="field-input" id="auth-assign-${slot}">
              ${this.eligibleAuthenticators().filter((s) => s.id !== a[`${other}_authenticator_id`])
                .map((s) => `<option value="${s.id}">${escapeHtml(s.full_name || '(unnamed)')}</option>`).join('')}
            </select>
            <button class="btn-secondary" data-auth-assign="${slot}">Assign</button>
          </div>` : ''}`;
    } else {
      body = `<div style="font-size:12.5px; font-weight:600;">${escapeHtml(this.staffName(who))}${mine ? ' (you)' : ''}</div>
        <div style="margin:4px 0 6px;">${res ? (this.canSeeResult(a, slot) ? this.resultBadge(res) : badge('Result recorded (hidden until you record yours)', 'info')) : '<span class="cell-muted" style="font-size:12px;">Result pending</span>'}</div>
        ${canRecord ? `
          <div style="display:flex; gap:6px;">
            <select class="field-input" id="auth-result-${slot}">
              <option value="">— Result —</option>
              ${Object.entries(AUTH_RESULTS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
            <button class="btn-confirm" data-auth-record="${slot}" style="white-space:nowrap;">Record</button>
          </div>` : ''}
        ${canRelease ? `<button class="btn-secondary" data-auth-release="${slot}" style="margin-top:6px; font-size:11.5px; padding:3px 8px;">Unassign</button>` : ''}`;
    }
    return `<div style="margin-top:14px; padding-top:12px; border-top:1px solid #E2E8F0;">
      <div class="card-title" style="margin-bottom:6px;">${title}</div>${body}</div>`;
  },

  // -------------------------------------------------------------------- bind
  bindAuth() {
    document.querySelectorAll('[data-select-item]').forEach((btn) => {
      btn.addEventListener('click', () => { this.selectedAuthItem = btn.dataset.selectItem; Router.rerender(); });
    });
    const i = this.item(this.selectedAuthItem);
    if (!i) return;
    const a = i.auth;
    this.fillPhotos('intake-photos');
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => fn(el)); };
    const slotName = (slot) => (slot === 'primary' ? '1st' : '2nd');

    on('auth-history', () => this.showHistory(i));

    document.querySelectorAll('[data-auth-claim]').forEach((btn) => btn.addEventListener('click', () => {
      const slot = btn.dataset.authClaim;
      this.save(btn, `You are the ${slotName(slot)} authenticator for ${i.code}.`,
        () => this.updateAuth(a.id, { [`${slot}_authenticator_id`]: this.myId() }));
    }));

    document.querySelectorAll('[data-auth-assign]').forEach((btn) => btn.addEventListener('click', () => {
      const slot = btn.dataset.authAssign;
      const who = document.getElementById(`auth-assign-${slot}`).value;
      if (!who) return showToast('No eligible authenticator to assign.');
      this.save(btn, `${this.staffName(who)} assigned as ${slotName(slot)} authenticator.`,
        () => this.updateAuth(a.id, { [`${slot}_authenticator_id`]: who }));
    }));

    document.querySelectorAll('[data-auth-release]').forEach((btn) => btn.addEventListener('click', () => {
      const slot = btn.dataset.authRelease;
      this.save(btn, `${slotName(slot)} check unassigned.`, () => this.updateAuth(a.id, { [`${slot}_authenticator_id`]: null }));
    }));

    document.querySelectorAll('[data-auth-record]').forEach((btn) => btn.addEventListener('click', () => {
      const slot = btn.dataset.authRecord;
      const v = document.getElementById(`auth-result-${slot}`).value;
      if (!v) return showToast('Choose Authentic or Fake.');
      const go = () => this.save(btn, `${slotName(slot)} result recorded: ${AUTH_RESULTS[v]}.`, async () => {
        await this.updateAuth(a.id, { [`${slot}_result`]: v });
        const fresh = await sbClient.from('consignment_items').select('current_stage').eq('id', i.id).single();
        const st = fresh.data && fresh.data.current_stage;
        if (st === 'photography') setTimeout(() => showToast(`Both checks agree: ${i.code} is authentic and moved to Photography.`), 50);
        if (st === 'closed_fake') setTimeout(() => showToast(`Both checks agree: ${i.code} is fake and has been closed. Records are kept.`), 50);
      });
      if (v === 'fake') this.confirm('Record as Fake?', `If the other check also says Fake, ${i.code} will be closed as a fake item. This cannot be undone.`, 'Record Fake', go);
      else go();
    }));

    on('auth-upload-cert', (btn) => {
      const file = document.getElementById('auth-cert-file').files[0];
      const problem = this.checkFile(file, true);
      if (problem) return showToast(problem);
      this.save(btn, 'Certificate uploaded.', async () => {
        const path = `${i.id}/certificate-${Date.now()}.${this.extOf(file)}`;
        const up = await sbClient.storage.from('certificates').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        await this.updateAuth(a.id, { certificate_url: path });
      });
    });

    on('auth-view-cert', async () => {
      const { data, error } = await sbClient.storage.from('certificates').createSignedUrls([a.certificate_url], 300);
      const url = !error && data && data[0] && data[0].signedUrl;
      if (url) window.open(url, '_blank', 'noopener');
      else showToast('Could not open the certificate.');
    });

    on('auth-settle', (btn) => {
      const v = document.getElementById('auth-final').value;
      this.confirm('Record the final decision?', `${i.code} will be marked ${AUTH_RESULTS[v]}${v === 'fake' ? ' and closed' : ' and moved to Photography'}. This cannot be undone.`,
        'Record Decision', () => this.save(btn, `Final decision recorded: ${AUTH_RESULTS[v]}.`, () => this.updateAuth(a.id, { final_result: v })));
    });
  },
});

ConsignmentFlow.pages['consignment-auth'] = ['renderAuth', 'bindAuth'];
