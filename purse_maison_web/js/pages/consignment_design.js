/**
 * Design & Listing page — connected to Supabase.
 * Load after consignment_photo.js; it adds the 'consignment-design' page to ConsignmentFlow.
 *
 *   Stage 14  Photo Editing & Approval: upload edited versions, tick the editing checklist,
 *             choose one cover photo, then approve (the database sends the item to the manager)
 *             or return it to the photographer with a reason. (Modules 8 and 21)
 *   Stage 17  Listing Creation: the database builds a draft when the item reaches this stage;
 *             the designer completes it and submits it for the manager to publish. (Modules 10 and 21)
 */

const PHOTO_CHECKLIST = {
  background_removal: 'Background removal', color_correction: 'Color correction', cropping: 'Cropping',
  watermark: 'Watermark', quality_check: 'Quality check',
};
const SALES_CHANNELS = { website: 'Website', live_selling: 'Live Selling', social_media: 'Social Media' };
const LAYAWAY_MIN_PRICE = 200000;

Object.assign(ConsignmentFlow, {
  selectedDesignItem: null,

  isDesigner() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'designer' || role === 'superAdmin';
  },

  coverPhoto(i) { return (i.listingPhotoList || []).find((p) => p.is_primary) || null; },

  /** The current photo per angle (newest upload wins), in display order. */
  currentListingPhotos(i) {
    const order = Object.keys(LISTING_PHOTO_TYPES).concat(Object.keys(OPTIONAL_LISTING_PHOTOS), ['side_right']);
    const seen = new Set();
    const out = [];
    for (const t of order) {
      const p = i.listingPhotos[t];
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
    return out;
  },

  photoLabel(type) {
    return LISTING_PHOTO_TYPES[type] || OPTIONAL_LISTING_PHOTOS[type] || (type === 'side_right' ? 'Side' : type);
  },

  async updateListingPhoto(id, changes) {
    const { data, error } = await sbClient.from('listing_photos').update(changes).eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Your role is not allowed to edit listing photos.');
  },

  async updateListing(id, changes) {
    const { data, error } = await sbClient.from('listings').update(changes).eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Your role is not allowed to edit this listing.');
  },

  /** A fuller description from the item record, per the client's Step 17 outline. */
  composeDescription(i) {
    const lines = [
      this.itemName(i),
      '',
      i.microchip ? `Microchip: ${i.microchip}` : null,
      i.serial ? `Serial number: ${i.serial}` : null,
      i.dateCode ? `Date code: ${i.dateCode}` : null,
      i.price != null ? `Price: ${this.peso(i.price)}` : null,
      '',
      'Condition:',
      i.conditionNotes || '—',
      '',
      `Inclusions: ${i.accessories.filter((a) => a !== 'None').join(', ') || 'None'}`,
    ];
    return lines.filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n');
  },

  // ------------------------------------------------------------------ render
  renderDesign() {
    const editing = DB.pipelineItems.filter((i) => i.stage === 'photo_editing_approval')
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    const listing = DB.pipelineItems.filter((i) => i.stage === 'listing_creation')
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    const all = editing.concat(listing);
    if (this.selectedDesignItem && !all.some((i) => i.id === this.selectedDesignItem)) this.selectedDesignItem = null;
    const sel = this.item(this.selectedDesignItem);

    return `
      <h1 class="page-title" style="margin-bottom:4px;">Design & Listing</h1>
      <p class="cell-muted" style="margin:0 0 16px;">Edit and approve listing photos, then write the listing once pricing is done.</p>
      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:12px;">Photo Editing & Approval (${editing.length})</div>
          ${this.queueTable(editing, this.selectedDesignItem, [
            ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
            ['Item', (i) => `<div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div>${i.managerReviews[0] && i.managerReviews[0].return_reason === 'photos' ? badge('Returned by manager', 'danger') : ''}`],
            ['Progress', (i) => `<div style="font-size:12px;">Checklist ${i.photoChecklist.length}/5</div>${this.coverPhoto(i) ? badge('Cover chosen', 'success') : '<span class="cell-muted" style="font-size:12px;">No cover</span>'}`],
          ], 'No photos waiting for editing.')}
        </div>
        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:12px;">Listing Creation (${listing.length})</div>
          ${listing.length === 0 ? '<p class="cell-muted" style="font-size:12.5px;">No listings to write yet. Items arrive here after pricing.</p>' :
            listing.map((i) => `
            <button data-select-item="${i.id}" style="display:block; width:100%; text-align:left; border:1px solid ${i.id === this.selectedDesignItem ? 'var(--card-navy-dark)' : '#E2E8F0'};
                    background:${i.id === this.selectedDesignItem ? '#EEF2FF' : '#fff'}; border-radius:8px; padding:8px 10px; margin-bottom:6px; cursor:pointer;">
              <strong>${escapeHtml(i.code)}</strong> · ${escapeHtml(this.itemName(i))}
              <span style="float:right;">${i.listing && i.listing.submitted_at ? badge('Submitted', 'success') : badge('Draft', 'warning')}</span>
            </button>`).join('')}
        </div>
      </div>
      ${sel ? (sel.stage === 'listing_creation' ? this.renderListingPanel(sel) : this.renderEditingPanel(sel)) : ''}`;
  },

  renderEditingPanel(i) {
    const act = this.isDesigner();
    const photos = this.currentListingPhotos(i);
    const cover = this.coverPhoto(i);
    const checklistDone = Object.keys(PHOTO_CHECKLIST).every((k) => i.photoChecklist.includes(k));
    const ready = checklistDone && !!cover;
    const returned = i.managerReviews[0] && i.managerReviews[0].return_reason === 'photos' ? i.managerReviews[0] : null;

    return `
      <div class="section-grid" style="align-items:flex-start; margin-top:18px;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:6px;">${escapeHtml(i.code)} · ${escapeHtml(this.itemName(i))}</div>
          ${returned ? `<div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:8px; padding:10px; font-size:12.5px; margin:8px 0 12px;">
            <strong style="color:var(--danger-red);">Returned by the manager</strong> (${escapeHtml(this.fmtDate(returned.reviewed_at))})${returned.notes ? `: ${escapeHtml(returned.notes)}` : ''}</div>` : ''}
          <p class="cell-muted" style="font-size:12px; margin:4px 0 12px;">Upload the edited version of each shot, then choose the single best image as the cover.</p>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:10px;">
            ${photos.map((p) => `
              <div style="border:${p.is_primary ? '2px solid var(--card-navy-dark)' : '1px solid #E2E8F0'}; padding:8px; border-radius:8px; text-align:center;">
                <div style="font-size:12px; font-weight:600;">${escapeHtml(this.photoLabel(p.photo_type))}
                  ${p.edited ? badge('Edited', 'success') : ''} ${p.is_primary ? badge('Cover', 'info') : ''}</div>
                <div style="margin:6px 0; height:130px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:6px; overflow:hidden;">
                  <img data-photo-bucket="listing-photos" data-photo-path="${escapeHtml(p.storage_path)}" alt="" style="max-width:100%; max-height:130px; object-fit:contain;">
                </div>
                ${act ? `
                  <label class="btn-secondary" style="display:inline-block; padding:3px 8px; font-size:11px; cursor:pointer;">
                    <span>${p.edited ? 'Replace edit' : 'Upload edited'}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" data-edit-upload="${p.id}" style="display:none;">
                  </label>
                  ${p.is_primary ? '' : `<button class="btn-secondary" data-set-cover="${p.id}" style="padding:3px 8px; font-size:11px;">Set as cover</button>`}` : ''}
              </div>`).join('')}
          </div>
        </div>

        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">Editing Checklist</div>
          ${Object.entries(PHOTO_CHECKLIST).map(([k, l]) => `
            <label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:3px 0;">
              <input type="checkbox" data-check-step="${k}" ${i.photoChecklist.includes(k) ? 'checked' : ''} ${act ? '' : 'disabled'}> ${l}
            </label>`).join('')}
          <div style="margin-top:12px;">${this.checklistHtml([
            [checklistDone, 'All editing steps done'],
            [!!cover, 'Cover photo chosen'],
          ])}</div>
          ${act ? `
            <button class="btn-confirm" id="design-approve" style="width:100%; margin-top:12px;${ready ? '' : ' opacity:.5; cursor:not-allowed;'}" ${ready ? '' : 'disabled'}>Approve Photos → Manager</button>
            <div style="margin-top:18px; padding-top:12px; border-top:1px solid #E2E8F0;">
              <div class="card-title" style="margin-bottom:8px;">Needs Revision?</div>
              <textarea class="field-input" id="design-revision-note" rows="2" placeholder="What the photographer should reshoot, e.g. Front shot is blurry"></textarea>
              <button class="btn-secondary" id="design-return" style="width:100%; margin-top:6px; color:var(--danger-red);">Return to Photographer</button>
            </div>` : ''}
          <button class="btn-secondary" id="design-history" style="width:100%; margin-top:14px;">View Activity Log</button>
        </div>
      </div>`;
  },

  renderListingPanel(i) {
    const act = this.isDesigner();
    const l = i.listing;
    if (!l) return '<div class="card" style="margin-top:18px;"><p class="cell-muted">The listing draft has not been created yet. Reload the page in a moment.</p></div>';
    const dis = act ? '' : 'disabled';
    const cover = this.coverPhoto(i);
    const layaway = i.price != null && i.price >= LAYAWAY_MIN_PRICE;
    const channels = l.sales_channels || [];

    return `
      <div class="section-grid" style="align-items:flex-start; margin-top:18px;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:10px;">Listing — ${escapeHtml(i.code)}</div>
          <form id="listing-form">
            <div class="field-group"><label class="field-label">Title</label>
              <input class="field-input" name="title" value="${escapeHtml(l.title || '')}" ${dis}></div>
            <div class="field-group"><label class="field-label" style="display:flex; justify-content:space-between;">
                <span>Product Description</span>
                ${act ? '<button type="button" class="btn-secondary" id="listing-fill" style="padding:2px 8px; font-size:11px;">Fill from item details</button>' : ''}</label>
              <textarea class="field-input" name="description" rows="9" ${dis}>${escapeHtml(l.description || '')}</textarea></div>
            <div class="field-group"><label class="field-label">Specifications</label>
              <textarea class="field-input" name="specifications" rows="6" ${dis}>${escapeHtml(l.specifications || '')}</textarea></div>
            <div class="section-grid">
              <div class="field-group col-wide"><label class="field-label">SEO Title</label>
                <input class="field-input" name="seo_title" value="${escapeHtml(l.seo_title || '')}" ${dis}></div>
              <div class="field-group col-wide"><label class="field-label">SEO Description</label>
                <input class="field-input" name="seo_description" value="${escapeHtml(l.seo_description || '')}" ${dis}></div>
            </div>
            <div class="field-group"><label class="field-label">Sales Channels</label>
              <div style="display:flex; gap:16px; flex-wrap:wrap;">
                ${Object.entries(SALES_CHANNELS).map(([v, lab]) => `<label style="font-size:13px; display:flex; gap:6px; align-items:center;">
                  <input type="checkbox" name="channel" value="${v}" ${channels.includes(v) ? 'checked' : ''} ${dis}> ${lab}</label>`).join('')}
              </div>
            </div>
            <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; font-size:12px; color:#475569;">
              <div><strong>Added automatically:</strong> ${escapeHtml(l.authenticity_footer || '(authenticity footer not set)')}</div>
              <div style="margin-top:4px;">${layaway ? `<strong>Layaway clause (price ₱200,000+):</strong> ${escapeHtml(l.layaway_clause || '(layaway wording not set)')}` : 'No layaway clause (price below ₱200,000).'}</div>
            </div>
            ${act ? '<button type="submit" class="btn-secondary" style="margin-top:12px;">Save Draft</button>' : ''}
          </form>
        </div>

        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">Preview</div>
          <div style="height:180px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:8px; overflow:hidden; margin-bottom:8px;">
            ${cover ? `<img data-photo-bucket="listing-photos" data-photo-path="${escapeHtml(cover.storage_path)}" alt="Cover" style="max-width:100%; max-height:180px; object-fit:contain;">` : '<span class="cell-muted">No cover photo</span>'}
          </div>
          <div style="font-weight:700;">${escapeHtml(l.title || '')}</div>
          <div style="font-size:15px; font-weight:700; color:var(--card-navy-dark); margin:4px 0 12px;">${this.peso(i.price)}</div>
          <div class="card-title" style="margin:6px 0 8px;">Submit for Publishing</div>
          ${this.checklistHtml([
            [!!(l.title && l.title.trim()), 'Title'],
            [!!(l.description && l.description.trim()), 'Description'],
            [channels.length > 0, 'At least one sales channel'],
          ])}
          ${l.submitted_at ? `<div style="font-size:12.5px; color:var(--green); margin-top:10px;">✓ Submitted ${escapeHtml(this.fmtDate(l.submitted_at))}. Waiting for the manager to publish. Saving changes withdraws the submission.</div>` :
            (act ? '<button class="btn-confirm" id="listing-submit" style="width:100%; margin-top:12px;">Submit for Publishing</button><small class="cell-muted">Save your changes first.</small>' : '')}
          <button class="btn-secondary" id="design-history" style="width:100%; margin-top:14px;">View Activity Log</button>
        </div>
      </div>`;
  },

  // -------------------------------------------------------------------- bind
  bindDesign() {
    document.querySelectorAll('[data-select-item]').forEach((btn) => {
      btn.addEventListener('click', () => { this.selectedDesignItem = btn.dataset.selectItem; Router.rerender(); });
    });
    const i = this.item(this.selectedDesignItem);
    if (!i) return;
    this.fillPhotos('listing-photos');
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => fn(el)); };
    on('design-history', () => this.showHistory(i));

    // ---- stage 14
    document.querySelectorAll('[data-edit-upload]').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const photo = i.listingPhotoList.find((p) => p.id === input.dataset.editUpload);
        const problem = this.checkFile(file, false);
        if (problem) return showToast(problem);
        const span = input.parentElement.querySelector('span');
        if (span) span.textContent = 'Uploading…';
        await this.save(null, `Edited ${this.photoLabel(photo.photo_type)} shot saved.`, async () => {
          const path = `${i.id}/${photo.photo_type}-edited-${Date.now()}.${this.extOf(file)}`;
          const up = await sbClient.storage.from('listing-photos').upload(path, file, { contentType: file.type });
          if (up.error) throw up.error;
          await this.updateListingPhoto(photo.id, { storage_path: path, edited: true });
        });
      });
    });

    document.querySelectorAll('[data-set-cover]').forEach((btn) => btn.addEventListener('click', () => {
      const current = this.coverPhoto(i);
      this.save(btn, 'Cover photo set.', async () => {
        if (current) await this.updateListingPhoto(current.id, { is_primary: false });
        await this.updateListingPhoto(btn.dataset.setCover, { is_primary: true });
      });
    }));

    document.querySelectorAll('[data-check-step]').forEach((box) => box.addEventListener('change', () => {
      const steps = Array.from(document.querySelectorAll('[data-check-step]:checked')).map((b) => b.dataset.checkStep);
      this.save(null, null, () => this.updateItem(i.id, { photo_edit_checklist: steps }));
    }));

    on('design-approve', (btn) => this.save(btn, `${i.code} photos approved and sent to the manager.`,
      () => this.updateItem(i.id, { photos_approved: true })));

    on('design-return', (btn) => {
      const note = document.getElementById('design-revision-note').value.trim();
      if (!note) return showToast('Write what needs to be reshot.');
      this.save(btn, `${i.code} returned to the photographer.`,
        () => this.updateItem(i.id, { current_stage: 'photography', photo_revision_note: note }));
    });

    // ---- stage 17
    const form = document.getElementById('listing-form');
    if (form && i.listing) {
      on('listing-fill', () => {
        form.querySelector('[name="description"]').value = this.composeDescription(i);
        showToast('Description filled in. Review it, then Save Draft.');
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const t = (k) => String(fd.get(k) || '').trim() || null;
        this.save(form.querySelector('button[type="submit"]'), 'Listing draft saved.', () => this.updateListing(i.listing.id, {
          title: t('title'), description: t('description'), specifications: t('specifications'),
          seo_title: t('seo_title'), seo_description: t('seo_description'), sales_channels: fd.getAll('channel'),
        }));
      });
      on('listing-submit', (btn) => {
        const l = i.listing;
        const missing = [];
        if (!(l.title && l.title.trim())) missing.push('title');
        if (!(l.description && l.description.trim())) missing.push('description');
        if (!(l.sales_channels || []).length) missing.push('a sales channel');
        if (missing.length) return showToast(`Save the listing with ${missing.join(', ')} first.`);
        this.save(btn, `${i.code} listing submitted. The manager can now publish it.`,
          () => this.updateListing(l.id, { submitted_at: new Date().toISOString() }));
      });
    }
  },
});

ConsignmentFlow.pages['consignment-design'] = ['renderDesign', 'bindDesign'];
