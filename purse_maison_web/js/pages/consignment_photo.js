/**
 * Photography Tasks page (stage 13) — connected to Supabase.
 * Load after consignment_intake.js; it adds the 'consignment-photo' page to ConsignmentFlow.
 *
 * Items arrive here automatically once both authenticators say Authentic.
 * A photographer takes the item, uploads the listing shots to the private listing-photos bucket,
 * and submits it to Design. The database blocks the hand-off until all 7 required shots are uploaded
 * (Module 19): front, back, side, interior, hardware, serial number, accessories. Lifestyle is optional.
 */

const LISTING_PHOTO_TYPES = {
  front: 'Front', back: 'Back', side_left: 'Side', inside: 'Interior',
  hardware: 'Hardware', serial_number: 'Serial number', accessories: 'Accessories',
};
const OPTIONAL_LISTING_PHOTOS = { lifestyle: 'Lifestyle' };

Object.assign(ConsignmentFlow, {
  selectedPhotoItem: null,

  isPhotographer() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'photographer' || role === 'superAdmin';
  },

  listingPhotoCount(i) {
    const lp = i.listingPhotos || {};
    const side = lp.side_left || lp.side_right;
    return Object.keys(LISTING_PHOTO_TYPES).filter((t) => (t === 'side_left' ? side : lp[t])).length;
  },

  canShoot(i) {
    return this.isOwner() || (i.photographerId && i.photographerId === this.myId());
  },

  async uploadListingPhoto(item, type, file) {
    const problem = this.checkFile(file, false);
    if (problem) throw new Error(problem);
    const path = `${item.id}/${type}-${Date.now()}.${this.extOf(file)}`;
    const up = await sbClient.storage.from('listing-photos').upload(path, file, { contentType: file.type });
    if (up.error) throw up.error;
    const { error } = await sbClient.from('listing_photos').insert({
      item_id: item.id, photo_type: type, storage_path: path, uploaded_by: this.myId(),
    });
    if (error) throw error;
  },

  renderListingPhotoGrid(i, editable) {
    const lp = i.listingPhotos || {};
    const slot = (type, label, optional) => {
      const p = lp[type] || (type === 'side_left' ? lp.side_right : null);
      return `
        <div style="border:1px solid #E2E8F0; padding:8px; border-radius:6px; text-align:center;">
          <div style="font-size:12px; font-weight:600;">${escapeHtml(label)}${optional ? ' <span class="cell-muted">(optional)</span>' : ''}</div>
          <div style="margin:6px 0; height:120px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:6px; overflow:hidden;">
            ${p ? `<img data-photo-bucket="listing-photos" data-photo-path="${escapeHtml(p.storage_path)}" alt="${escapeHtml(label)}" style="max-width:100%; max-height:120px; object-fit:contain;">` : ''}
          </div>
          <div style="font-size:11px; font-weight:600; color:${p ? 'var(--green)' : (optional ? 'var(--text-muted)' : 'var(--danger-red)')};">${p ? 'Uploaded' : 'Missing'}</div>
          ${editable ? `
            <label class="btn-secondary" style="display:inline-block; margin-top:6px; padding:3px 8px; font-size:11px; cursor:pointer;">
              <span>${p ? 'Replace' : 'Upload'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" data-listing-upload="${type}" style="display:none;">
            </label>` : ''}
        </div>`;
    };
    const n = this.listingPhotoCount(i);
    return `
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:10px;">
        ${Object.entries(LISTING_PHOTO_TYPES).map(([t, l]) => slot(t, l, false)).join('')}
        ${Object.entries(OPTIONAL_LISTING_PHOTOS).map(([t, l]) => slot(t, l, true)).join('')}
      </div>
      <div style="font-size:12.5px; margin-top:8px; font-weight:600; color:${n === 7 ? 'var(--green)' : 'var(--danger-red)'};">${n} / 7 required shots uploaded</div>`;
  },

  // ------------------------------------------------------------------ render
  renderPhoto() {
    const queue = DB.pipelineItems.filter((i) => i.stage === 'photography')
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    if (this.selectedPhotoItem && !queue.some((i) => i.id === this.selectedPhotoItem)) this.selectedPhotoItem = null;
    const sel = this.item(this.selectedPhotoItem);
    const mine = queue.filter((i) => i.photographerId === this.myId()).length;

    return `
      <h1 class="page-title" style="margin-bottom:4px;">Photography Tasks</h1>
      <p class="cell-muted" style="margin:0 0 16px;">Authenticated items waiting for listing photos. Oldest first.${mine ? ` You have ${mine} item(s) assigned.` : ''}</p>
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">Photography Queue (${queue.length})</div>
        ${this.queueTable(queue, this.selectedPhotoItem, [
          ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
          ['Item', (i) => `<div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(i.category || '—')}</div>`],
          ['Photographer', (i) => (i.photographerId ? escapeHtml(this.staffName(i.photographerId)) + (i.photographerId === this.myId() ? ' (you)' : '') : '<span class="cell-muted">Unassigned</span>')],
          ['Shots', (i) => {
            const n = this.listingPhotoCount(i);
            return badge(`${n}/7`, n === 7 ? 'success' : (n ? 'warning' : 'info'));
          }],
          ['Waiting Since', (i) => `<span style="font-size:12px;">${escapeHtml(this.fmtDate(i.updatedAt))}</span>`],
        ], 'No items waiting for photography.')}
      </div>
      ${sel ? this.renderPhotoPanel(sel) : ''}`;
  },

  renderPhotoPanel(i) {
    const canShoot = this.canShoot(i);
    const n = this.listingPhotoCount(i);
    const photographers = (DB.staffDirectory || []).filter((s) => s.is_active && (s.role === 'photographer' || s.role === 'super_admin'));

    return `
      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:6px;">${escapeHtml(i.code)} · ${escapeHtml(this.itemName(i))}</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:8px; font-size:12.5px; margin:10px 0 14px;">
            <div><span class="cell-muted">Category</span><br><strong>${escapeHtml(i.category || '—')}</strong></div>
            <div><span class="cell-muted">Color</span><br><strong>${escapeHtml(i.color || '—')}</strong></div>
            <div><span class="cell-muted">Hardware</span><br><strong>${escapeHtml(i.hardware || '—')}</strong></div>
            <div><span class="cell-muted">Accessories</span><br><strong>${escapeHtml(i.accessories.join(', ') || '—')}</strong></div>
          </div>
          ${i.conditionNotes ? `<div style="font-size:12.5px; margin-bottom:14px;"><span class="cell-muted">Condition notes:</span> ${escapeHtml(i.conditionNotes)}</div>` : ''}

          <h3 style="font-size:14px; margin:0 0 8px;">Listing Shots</h3>
          ${canShoot ? '' : '<p class="cell-muted" style="font-size:12px;">Take this item to upload photos.</p>'}
          ${this.renderListingPhotoGrid(i, canShoot)}

          <details style="margin-top:16px;">
            <summary style="font-weight:600; cursor:pointer; font-size:13px;">Intake photos (for reference)</summary>
            <div style="margin-top:8px;">${this.renderPhotoGrid(i, false)}</div>
          </details>
        </div>

        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">Photographer</div>
          ${i.photographerId ? `
            <div style="font-size:13px; font-weight:600;">${escapeHtml(this.staffName(i.photographerId))}${i.photographerId === this.myId() ? ' (you)' : ''}</div>
            ${i.photographerId === this.myId() || this.isOwner() ? '<button class="btn-secondary" id="photo-release" style="margin-top:6px; font-size:11.5px; padding:3px 8px;">Unassign</button>' : ''}` : `
            <div class="cell-muted" style="font-size:12px; margin-bottom:8px;">Not assigned yet.</div>
            ${this.isPhotographer() ? '<button class="btn-confirm" id="photo-claim" style="width:100%; margin-bottom:8px;">Take This Item</button>' : ''}
            ${this.isOwner() ? `
              <div style="display:flex; gap:6px;">
                <select class="field-input" id="photo-assign-who">
                  ${photographers.map((s) => `<option value="${s.id}">${escapeHtml(s.full_name || '(unnamed)')}</option>`).join('')}
                </select>
                <button class="btn-secondary" id="photo-assign">Assign</button>
              </div>` : ''}`}

          <div class="card-title" style="margin:20px 0 10px;">Hand-off to Design</div>
          ${this.checklistHtml([
            [!!i.photographerId, 'Photographer assigned'],
            [n === 7, `Required shots (${n}/7)`],
          ])}
          ${canShoot ? `<button class="btn-confirm" id="photo-submit" style="width:100%; margin-top:12px;${n === 7 ? '' : ' opacity:.5; cursor:not-allowed;'}" ${n === 7 ? '' : 'disabled'}>Submit to Design</button>` : ''}
          <small class="cell-muted">Design edits the shots, picks the cover photo and approves the set.</small>
          <button class="btn-secondary" id="photo-history" style="width:100%; margin-top:14px;">View Activity Log</button>
        </div>
      </div>`;
  },

  // -------------------------------------------------------------------- bind
  bindPhoto() {
    document.querySelectorAll('[data-select-item]').forEach((btn) => {
      btn.addEventListener('click', () => { this.selectedPhotoItem = btn.dataset.selectItem; Router.rerender(); });
    });
    const i = this.item(this.selectedPhotoItem);
    if (!i) return;
    this.fillPhotos('listing-photos');
    this.fillPhotos('intake-photos');
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => fn(el)); };

    on('photo-history', () => this.showHistory(i));
    on('photo-claim', (btn) => this.save(btn, `${i.code} is now yours to photograph.`,
      () => this.updateItem(i.id, { assigned_photographer_id: this.myId() })));
    on('photo-assign', (btn) => {
      const who = document.getElementById('photo-assign-who').value;
      if (!who) return showToast('No photographer account to assign.');
      this.save(btn, `${this.staffName(who)} assigned to ${i.code}.`, () => this.updateItem(i.id, { assigned_photographer_id: who }));
    });
    on('photo-release', (btn) => this.save(btn, `${i.code} unassigned.`, () => this.updateItem(i.id, { assigned_photographer_id: null })));
    on('photo-submit', (btn) => this.save(btn, `${i.code} sent to Design for editing and approval.`,
      () => this.updateItem(i.id, { current_stage: 'photo_editing_approval' })));

    document.querySelectorAll('[data-listing-upload]').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const type = input.dataset.listingUpload;
        const label = LISTING_PHOTO_TYPES[type] || OPTIONAL_LISTING_PHOTOS[type];
        const span = input.parentElement.querySelector('span');
        if (span) span.textContent = 'Uploading…';
        await this.save(null, `${label} shot uploaded.`, () => this.uploadListingPhoto(i, type, file));
      });
    });
  },
});

ConsignmentFlow.pages['consignment-photo'] = ['renderPhoto', 'bindPhoto'];
