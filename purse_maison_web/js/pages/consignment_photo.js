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
const MIN_LISTING_PHOTOS = 7;

Object.assign(ConsignmentFlow, {
  selectedPhotoItem: null,

  isPhotographer() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'photographer' || role === 'superAdmin';
  },

  listingPhotoCount(i) {
    return this.orderedListingPhotos(i).length;
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

  orderedListingPhotos(i) {
    const rank = (p) => (p.is_primary ? -1 : (p.sort_order == null ? 1e9 : p.sort_order));
    const angles = Object.values(i.listingPhotos || {}).filter((p) => p.photo_type !== 'extra');
    const extras = (i.listingPhotoList || []).filter((p) => p.photo_type === 'extra');
    return angles.concat(extras)
      .sort((a, b) => rank(a) - rank(b) || new Date(a.uploaded_at) - new Date(b.uploaded_at));
  },

  async replaceListingPhoto(item, photo, file) {
    const problem = this.checkFile(file, false);
    if (problem) throw new Error(problem);
    const path = `${item.id}/${photo.photo_type}-${Date.now()}.${this.extOf(file)}`;
    const up = await sbClient.storage.from('listing-photos').upload(path, file, { contentType: file.type });
    if (up.error) throw up.error;
    await this.updateListingPhoto(photo.id, { storage_path: path, edited: false });
  },

  async saveListingOrder(i, ids) {
    const all = i.listingPhotoList || [];
    const byId = {};
    all.forEach((p) => { byId[p.id] = p; });
    const oldCover = all.find((p) => p.is_primary);
    if (oldCover && oldCover.id !== ids[0]) await this.updateListingPhoto(oldCover.id, { is_primary: false });
    const jobs = [];
    ids.forEach((id, n) => {
      const p = byId[id];
      const changes = {};
      if (!p || p.sort_order !== n) changes.sort_order = n;
      if (n === 0 && !(p && p.is_primary)) changes.is_primary = true;
      if (Object.keys(changes).length) jobs.push(this.updateListingPhoto(id, changes));
    });
    await Promise.all(jobs);
  },

  listingTileHtml(p, o) {
    const path = escapeHtml(p.storage_path);
    const buttons = [
      o.star ? `<button type="button" class="photo-media-btn" data-set-cover="${p.id}" title="Make this the cover photo"><i class="fa-solid fa-star" aria-hidden="true"></i></button>` : '',
      o.action ? `<label class="photo-media-btn" title="${o.action.title}"><i class="fa-solid ${o.action.icon}" aria-hidden="true"></i><input type="file" accept="image/jpeg,image/png,image/webp" ${o.action.attr}="${p.id}" hidden></label>` : '',
      o.remove ? `<button type="button" class="photo-media-btn" data-remove-photo="${p.id}" title="Remove this photo"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>` : '',
    ].join('');
    return `
      <div class="photo-media-tile${o.cover ? ' is-cover' : ''}"${o.drag ? ` draggable="true" data-photo-id="${p.id}"` : ''}>
        <div class="photo-media-img" data-photo-preview="1" data-photo-bucket="listing-photos" data-photo-path="${path}" title="Click to enlarge">
          <img data-photo-bucket="listing-photos" data-photo-path="${path}" alt="Listing photo">
        </div>
        ${o.cover ? '<span class="photo-media-cover">Cover</span>' : ''}
        ${p.edited ? '<span class="photo-media-mark is-edited" title="Edited"><i class="fa-solid fa-check" aria-hidden="true"></i></span>' : ''}
        ${buttons ? `<div class="photo-media-actions">${buttons}</div>` : ''}
      </div>`;
  },

  renderListingGrid(i, mode) {
    const photos = this.orderedListingPhotos(i);
    const editable = mode !== 'view';
    if (!photos.length && !editable) return '<p class="cell-muted" style="font-size:12.5px;">No listing photos yet.</p>';
    const coverId = mode === 'photographer'
      ? (photos[0] && photos[0].id)
      : (photos.find((p) => p.is_primary) || {}).id;
    const action = mode === 'photographer' ? { attr: 'data-replace-photo', icon: 'fa-arrows-rotate', title: 'Replace this photo' }
      : (mode === 'designer' ? { attr: 'data-edit-upload', icon: 'fa-pen', title: 'Upload the edited version' } : null);
    const tiles = photos.map((p) => this.listingTileHtml(p, {
      cover: p.id === coverId, drag: editable, action, star: mode === 'designer' && p.id !== coverId, remove: mode === 'photographer',
    })).join('');
    const add = mode === 'photographer'
      ? '<button type="button" class="photo-media-add" id="photo-media-add"><i class="fa-solid fa-plus" aria-hidden="true"></i><span>Add</span></button>' : '';

    let note = '';
    if (mode === 'photographer') {
      const n = photos.length;
      note = `<div class="photo-media-hint">Drag photos to arrange them. The first photo is the cover.</div>
        <div class="photo-progress ${n >= MIN_LISTING_PHOTOS ? 'is-complete' : ''}">${n} photo${n === 1 ? '' : 's'} uploaded${n < MIN_LISTING_PHOTOS ? ` · at least ${MIN_LISTING_PHOTOS} needed` : ''}</div>`;
    } else if (mode === 'designer') {
      note = '<div class="photo-media-hint">Drag to rearrange. The first photo is the cover. Use the pen to upload an edited version, or the star to make a photo the cover.</div>';
    }
    return `<div class="photo-media-grid" id="photo-media-grid">${tiles}${add}</div>${note}`;
  },

  bindListingDrag(i) {
    const grid = document.getElementById('photo-media-grid');
    if (!grid) return;
    let dragged = null;
    ['dragover', 'drop'].forEach((ev) => grid.addEventListener(ev, (e) => { if (!dragged) e.preventDefault(); }));
    grid.querySelectorAll('.photo-media-tile[draggable="true"]').forEach((tile) => {
      tile.addEventListener('dragstart', (e) => {
        dragged = tile;
        tile.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tile.dataset.photoId);
      });
      tile.addEventListener('dragend', () => {
        tile.classList.remove('is-dragging');
        grid.querySelectorAll('.is-over').forEach((t) => t.classList.remove('is-over'));
        dragged = null;
      });
      tile.addEventListener('dragover', (e) => { if (dragged) { e.preventDefault(); tile.classList.add('is-over'); } });
      tile.addEventListener('dragleave', () => tile.classList.remove('is-over'));
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        tile.classList.remove('is-over');
        if (!dragged || dragged === tile) return;
        const tiles = Array.from(grid.querySelectorAll('.photo-media-tile[draggable="true"]'));
        tiles.splice(tiles.indexOf(tile), 0, tiles.splice(tiles.indexOf(dragged), 1)[0]);
        const ids = tiles.map((t) => t.dataset.photoId);
        dragged = null;
        this.save(null, 'Photo order saved.', () => this.saveListingOrder(i, ids));
      });
    });
  },

  async removeListingPhoto(photo) {
    const { data, error } = await sbClient.from('listing_photos').delete().eq('id', photo.id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Your role is not allowed to remove listing photos.');
  },

  renderListingPhotoGrid(i, editable) {
    return `
            ${editable ? this.renderBulkPhotoUpload('listing', 'JPG, PNG and WEBP. Max 10 MB each.') : ''}
      ${this.renderListingGrid(i, editable ? 'photographer' : 'view')}`;
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
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">Photography Queue (${queue.length})</div>
        ${this.queueTable(queue, this.selectedPhotoItem, [
          ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
          ['Item', (i) => `<div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(i.category || '—')}</div>${i.photoRevisionNote ? badge('Revision requested', 'danger') : ''}`],
          ['Photographer', (i) => (i.photographerId ? escapeHtml(this.staffName(i.photographerId)) + (i.photographerId === this.myId() ? ' (you)' : '') : '<span class="cell-muted">Unassigned</span>')],
          ['Photos', (i) => {
            const n = this.listingPhotoCount(i);
            return badge(`${n}`, n >= MIN_LISTING_PHOTOS ? 'success' : (n ? 'warning' : 'info'));
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

          ${i.photoRevisionNote ? `<div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:8px; padding:10px; font-size:12.5px; margin-bottom:12px;">
            <strong style="color:var(--danger-red);">Returned by Design:</strong> ${escapeHtml(i.photoRevisionNote)}</div>` : ''}
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
            [n >= MIN_LISTING_PHOTOS, `Photos uploaded (${n} of at least ${MIN_LISTING_PHOTOS})`],
          ])}
          ${canShoot ? `<button class="btn-confirm" id="photo-submit" style="width:100%; margin-top:12px;${n >= MIN_LISTING_PHOTOS ? '' : ' opacity:.5; cursor:not-allowed;'}" ${n >= MIN_LISTING_PHOTOS ? '' : 'disabled'}>Submit to Design</button>` : ''}
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
    on('photo-submit', (btn) => this.save(btn, `${i.code} sent to Design for editing and approval.`, async () => {
      await this.saveListingOrder(i, this.orderedListingPhotos(i).map((p) => p.id));
      await this.updateItem(i.id, { current_stage: 'photo_editing_approval' });
    }));

    this.bindPhotoPreviews();
    document.querySelectorAll('[data-replace-photo]').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const photo = (i.listingPhotoList || []).find((p) => p.id === input.dataset.replacePhoto);
        if (!photo) return;
        const tile = input.closest('.photo-media-tile');
        if (tile) tile.classList.add('is-uploading');
        await this.save(null, 'Photo replaced.', () => this.replaceListingPhoto(i, photo, file));
      });
    });
    const addTile = document.getElementById('photo-media-add');
    if (addTile) addTile.addEventListener('click', () => {
      const zone = document.querySelector('#bulk-listing .bulk-dropzone');
      if (zone) zone.click();
    });
    this.bindListingDrag(i);

    document.querySelectorAll('[data-remove-photo]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const photo = (i.listingPhotoList || []).find((p) => p.id === btn.dataset.removePhoto);
        if (!photo) return;
        this.confirm('Remove photo', 'Remove this photo from the item? This cannot be undone.', 'Remove',
          () => this.save(null, 'Photo removed.', () => this.removeListingPhoto(photo)));
      });
    });

    this.bindBulkPhotoUpload('listing', {}, {}, (type, file) => this.uploadListingPhoto(i, type, file), 'extra');  },
});

ConsignmentFlow.pages['consignment-photo'] = ['renderPhoto', 'bindPhoto'];
