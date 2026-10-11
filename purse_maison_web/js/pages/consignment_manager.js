/**
 * Manager Approvals page — connected to Supabase.
 * Load after consignment_design.js; it adds the 'consignment-approval' page to ConsignmentFlow.
 *
 *   Stage 15  Manager Approval: review authentication, photos and item details, then record a decision
 *             in manager_reviews. The database routes the item (Module 9):
 *               Approve -> Pricing & Markup · Reject -> Closed – Not Accepted
 *               Return (photos) -> Photo Editing · Return (item details) -> Receiving, for the Consignment Team
 *   Stage 18  Publish: listings the designer has submitted can be published. Publishing makes the listing
 *             live, starts the 60-day contract and queues the consignor notification (Modules 10, 13, 21).
 */

const RETURN_REASONS = { photos: 'Photos (back to Design)', item_details: 'Item details (back to Consignment Team)' };

Object.assign(ConsignmentFlow, {
  selectedManagerItem: null,

  isManager() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'manager' || role === 'superAdmin';
  },

  readyToPublish(i) {
    return i.stage === 'listing_creation' && i.listing && !!i.listing.submitted_at;
  },

  // ------------------------------------------------------------------ render
  renderManager() {
    const review = DB.pipelineItems.filter((i) => i.stage === 'manager_approval')
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    const publish = DB.pipelineItems.filter((i) => this.readyToPublish(i))
      .sort((a, b) => new Date(a.listing.submitted_at) - new Date(b.listing.submitted_at));
    const all = review.concat(publish);
    if (this.selectedManagerItem && !all.some((i) => i.id === this.selectedManagerItem)) this.selectedManagerItem = null;
    const sel = this.item(this.selectedManagerItem);

    return `
      <h1 class="page-title" style="margin-bottom:4px;">Manager Approvals</h1>
      <p class="cell-muted" style="margin:0 0 16px;">Review items before pricing, and publish finished listings.</p>
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">Awaiting Review (${review.length})</div>
        ${this.queueTable(review, this.selectedManagerItem, [
          ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
          ['Item', (i) => `<div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(i.consignor.full_name)}</div>`],
          ['Authentication', (i) => this.authCell(i)],
          ['Photos', (i) => (i.photosApproved ? badge('Approved', 'success') : badge('Not approved', 'danger'))],
          ['Agreed Payout', (i) => this.peso(i.agreedPayout)],
          ['Waiting Since', (i) => `<span style="font-size:12px;">${escapeHtml(this.fmtDate(i.updatedAt))}</span>`],
        ], 'Nothing waiting for review.')}
      </div>
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">Ready to Publish (${publish.length})</div>
        ${this.queueTable(publish, this.selectedManagerItem, [
          ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
          ['Listing Title', (i) => escapeHtml(i.listing.title || '—')],
          ['Price', (i) => `<strong>${this.peso(i.price)}</strong>`],
          ['Channels', (i) => escapeHtml((i.listing.sales_channels || []).map((c) => SALES_CHANNELS[c] || c).join(', ') || '—')],
          ['Submitted', (i) => `<span style="font-size:12px;">${escapeHtml(this.fmtDate(i.listing.submitted_at))}</span>`],
        ], 'No listings waiting to be published. Listings appear here after Pricing and Design.')}
      </div>
      ${sel ? (sel.stage === 'manager_approval' ? this.renderReviewPanel(sel) : this.renderPublishPanel(sel)) : ''}`;
  },

  renderReviewPanel(i) {
    const a = i.auth || {};
    const act = this.isManager();
    const photos = this.currentListingPhotos(i);
    const past = i.managerReviews || [];

    return `
      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:10px;">${escapeHtml(i.code)} · ${escapeHtml(this.itemName(i))}</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:8px; font-size:12.5px; margin-bottom:14px;">
            <div><span class="cell-muted">Consignor</span><br><strong>${escapeHtml(i.consignor.full_name)}</strong></div>
            <div><span class="cell-muted">Category</span><br><strong>${escapeHtml(i.category || '—')}</strong></div>
            <div><span class="cell-muted">Serial number</span><br><strong style="font-family:monospace;">${escapeHtml(i.serial || '—')}</strong></div>
            <div><span class="cell-muted">Microchip</span><br><strong style="font-family:monospace;">${escapeHtml(i.microchip || '—')}</strong></div>
            <div><span class="cell-muted">Hardware</span><br><strong>${escapeHtml(i.hardware || '—')}</strong></div>
            <div><span class="cell-muted">Accessories</span><br><strong>${escapeHtml(i.accessories.join(', ') || '—')}</strong></div>
            <div><span class="cell-muted">Asking price</span><br><strong>${this.peso(i.askingPrice)}</strong></div>
            <div><span class="cell-muted">Agreed payout</span><br><strong>${this.peso(i.agreedPayout)}</strong></div>
          </div>
          <div style="font-size:12.5px; margin-bottom:14px;"><span class="cell-muted">Condition notes:</span> ${escapeHtml(i.conditionNotes || '—')}</div>

          <h3 style="font-size:14px; margin:0 0 8px;">Authentication</h3>
          <div style="font-size:12.5px; margin-bottom:14px; line-height:1.7;">
            Final result: ${this.authCell(i)}<br>
            1st check: ${escapeHtml(a.primary_authenticator_id ? this.staffName(a.primary_authenticator_id) : '—')} — ${this.resultBadge(a.primary_result)}<br>
            2nd check: ${escapeHtml(a.secondary_authenticator_id ? this.staffName(a.secondary_authenticator_id) : '—')} — ${this.resultBadge(a.secondary_result)}<br>
            ${a.certificate_url ? '<button class="btn-secondary" id="mgr-view-cert" style="padding:3px 10px; font-size:12px; margin-top:4px;">View Certificate</button>' : '<span class="cell-muted">No certificate on file</span>'}
          </div>

          <h3 style="font-size:14px; margin:0 0 8px;">Listing Photos</h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:10px;">
            ${photos.map((p) => `
              <div style="border:${p.is_primary ? '2px solid var(--card-navy-dark)' : '1px solid #E2E8F0'}; border-radius:8px; padding:6px; text-align:center;">
                <div style="font-size:11.5px; font-weight:600;">${escapeHtml(this.photoLabel(p.photo_type))} ${p.is_primary ? badge('Cover', 'info') : ''}</div>
                <div style="height:110px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:6px; overflow:hidden; margin-top:4px;">
                  <img data-photo-bucket="listing-photos" data-photo-path="${escapeHtml(p.storage_path)}" alt="" style="max-width:100%; max-height:110px; object-fit:contain;">
                </div>
              </div>`).join('')}
          </div>
        </div>

        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">Decision</div>
          ${act ? `
            <button class="btn-confirm" id="mgr-approve" style="width:100%;">Approve → Pricing</button>
            <div style="margin-top:16px; padding-top:12px; border-top:1px solid #E2E8F0;">
              <div class="field-group">
                <label class="field-label">Return for revision</label>
                <select class="field-input" id="mgr-return-reason">
                  <option value="">— What needs fixing? —</option>
                  ${Object.entries(RETURN_REASONS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
              </div>
              <textarea class="field-input" id="mgr-notes" rows="3" placeholder="Notes for the team (required to return or reject)"></textarea>
              <button class="btn-secondary" id="mgr-return" style="width:100%; margin-top:6px;">Return for Revision</button>
              <button class="btn-secondary" id="mgr-reject" style="width:100%; margin-top:6px; color:var(--danger-red);">Reject Item</button>
            </div>` : '<p class="cell-muted">Only the manager or owner can decide.</p>'}
          ${past.length ? `
            <div style="margin-top:16px; padding-top:12px; border-top:1px solid #E2E8F0;">
              <div class="card-title" style="margin-bottom:6px;">Earlier Decisions</div>
              ${past.map((r) => `<div style="font-size:11.5px; color:#475569; border-bottom:1px dashed #E2E8F0; padding:3px 0;">
                ${escapeHtml(this.fmtDate(r.reviewed_at))} — ${escapeHtml(r.decision.replace(/_/g, ' '))}${r.return_reason ? ` (${escapeHtml(r.return_reason.replace('_', ' '))})` : ''}${r.notes ? `: ${escapeHtml(r.notes)}` : ''}</div>`).join('')}
            </div>` : ''}
          <button class="btn-secondary" id="mgr-history" style="width:100%; margin-top:14px;">View Activity Log</button>
        </div>
      </div>`;
  },

  renderPublishPanel(i) {
    const l = i.listing;
    const act = this.isManager();
    const cover = this.coverPhoto(i);
    const layaway = i.price != null && i.price >= LAYAWAY_MIN_PRICE;

    return `
      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:10px;">Listing Preview — ${escapeHtml(i.code)}</div>
          <div style="display:flex; gap:16px; flex-wrap:wrap;">
            <div style="width:220px; height:220px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:8px; overflow:hidden;">
              ${cover ? `<img data-photo-bucket="listing-photos" data-photo-path="${escapeHtml(cover.storage_path)}" alt="Cover" style="max-width:100%; max-height:220px; object-fit:contain;">` : '<span class="cell-muted">No cover</span>'}
            </div>
            <div style="flex:1; min-width:240px;">
              <div style="font-size:17px; font-weight:700;">${escapeHtml(l.title || '')}</div>
              <div style="font-size:16px; font-weight:700; color:var(--card-navy-dark); margin:4px 0 10px;">${this.peso(i.price)}</div>
              <div style="font-size:12.5px; white-space:pre-wrap; color:#334155;">${escapeHtml(l.description || '')}</div>
            </div>
          </div>
          <div style="font-size:12.5px; white-space:pre-wrap; margin-top:12px; color:#475569;">${escapeHtml(l.specifications || '')}</div>
          <div style="font-size:12px; margin-top:12px; color:#475569;">${escapeHtml(l.authenticity_footer || '')}</div>
          ${layaway ? `<div style="font-size:12px; margin-top:4px; color:#475569;">${escapeHtml(l.layaway_clause || '')}</div>` : ''}
          <div style="font-size:12px; margin-top:12px;"><span class="cell-muted">SEO:</span> ${escapeHtml(l.seo_title || '—')} — ${escapeHtml(l.seo_description || '—')}</div>
        </div>
        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">Publish</div>
          <div style="font-size:12.5px; line-height:1.7;">
            <div><span class="cell-muted">Channels:</span> ${escapeHtml((l.sales_channels || []).map((c) => SALES_CHANNELS[c] || c).join(', '))}</div>
            <div><span class="cell-muted">Consignor payout:</span> ${this.peso(i.consignorPayout)}</div>
            <div><span class="cell-muted">Company markup:</span> ${this.peso(i.markup)}</div>
          </div>
          <p class="cell-muted" style="font-size:12px;">Publishing makes the item available for sale, starts the 60-day consignment period, and notifies the consignor.</p>
          ${act ? `
            <button class="btn-confirm" id="mgr-publish" style="width:100%;">Publish Item</button>
            <button class="btn-secondary" id="mgr-send-back" style="width:100%; margin-top:6px;">Send Back to Designer</button>` : ''}
          <button class="btn-secondary" id="mgr-history" style="width:100%; margin-top:14px;">View Activity Log</button>
        </div>
      </div>`;
  },

  // -------------------------------------------------------------------- bind
  bindManager() {
    document.querySelectorAll('[data-select-item]').forEach((btn) => {
      btn.addEventListener('click', () => { this.selectedManagerItem = btn.dataset.selectItem; Router.rerender(); });
    });
    const i = this.item(this.selectedManagerItem);
    if (!i) return;
    this.fillPhotos('listing-photos');
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => fn(el)); };
    on('mgr-history', () => this.showHistory(i));

    const decide = (btn, decision, extra, message) => this.save(btn, message, async () => {
      const { error } = await sbClient.from('manager_reviews').insert(Object.assign({ item_id: i.id, decision }, extra));
      if (error) throw error;
    });
    const notes = () => (document.getElementById('mgr-notes') || {}).value ? document.getElementById('mgr-notes').value.trim() : '';

    on('mgr-view-cert', async () => {
      const { data, error } = await sbClient.storage.from('certificates').createSignedUrls([i.auth.certificate_url], 300);
      const url = !error && data && data[0] && data[0].signedUrl;
      if (url) window.open(url, '_blank', 'noopener'); else showToast('Could not open the certificate.');
    });

    on('mgr-approve', (btn) => decide(btn, 'approved', { notes: notes() || null }, `${i.code} approved and sent to Pricing.`));

    on('mgr-return', (btn) => {
      const reason = document.getElementById('mgr-return-reason').value;
      if (!reason) return showToast('Choose what needs fixing: Photos or Item details.');
      const n = notes();
      if (!n) return showToast('Write a note so the team knows what to fix.');
      decide(btn, 'returned_for_revision', { return_reason: reason, notes: n },
        reason === 'photos' ? `${i.code} returned to Design.` : `${i.code} returned to the Consignment Team for item details.`);
    });

    on('mgr-reject', (btn) => {
      const n = notes();
      if (!n) return showToast('Write the reason for rejecting this item.');
      this.confirm('Reject this item?', `${i.code} will be closed as not accepted and should be returned to the consignor. This cannot be undone.`,
        'Reject Item', () => decide(btn, 'rejected', { notes: n }, `${i.code} rejected.`));
    });

    on('mgr-publish', (btn) => {
      this.confirm('Publish this item?', `${i.code} will go live at ${this.peso(i.price)} and the consignor will be notified.`, 'Publish',
        () => this.save(btn, `${i.code} published. It now appears in Inventory.`, async () => {
          await this.updateItem(i.id, { current_stage: 'publish_item' });
          DataStore.loadedAt = 0; // refresh inventory and dashboard numbers on the next page
        }));
    });

    on('mgr-send-back', (btn) => this.save(btn, `${i.code} sent back to the designer.`,
      () => this.updateListing(i.listing.id, { submitted_at: null })));
  },
});

ConsignmentFlow.pages['consignment-approval'] = ['renderManager', 'bindManager'];
