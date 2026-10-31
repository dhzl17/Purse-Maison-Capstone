/**
 * Consignment pipeline, Consignment Team part — connected to Supabase.
 *   Overview & Status       (consignment-overview)   every item, read-only, with its activity log
 *   Inquiries & Pre-Intake  (consignment-preintake)  stages 1-7: inquiry, lead status, photos, negotiation,
 *                                                    approval, appointment, in transit
 *   Intake & Agreements     (consignment-intake)     stages 8-9: ID check, item details, e-signature,
 *                                                    receive item, authentication payment (QR PH reference)
 *
 * The database enforces every rule (hard blocks, automatic stage moves). This page shows the same
 * checklist so staff can see what is missing, and shows the database's message if a save is refused.
 * The other consignment sub-pages (authentication, photography, design, pricing, approvals) are still
 * handled by consignment.js until their own step.
 */

const STAGE_LABELS = {
  customer_inquiry: 'Customer Inquiry',
  lead_qualification: 'Lead Qualification',
  initial_photo_submission: 'Initial Photos',
  price_negotiation: 'Price Negotiation',
  consignment_approval: 'Consignment Approval',
  appointment_scheduling: 'Appointment Scheduling',
  dropoff_pickup_courier: 'In Transit to Receiving',
  arrivals_receiving: 'Received',
  authentication_payment: 'Awaiting Auth. Payment',
  authentication_service: 'Authentication Queue',
  authentication_process: 'Being Authenticated',
  authentication_certificate: 'Authentication Certificate',
  photography: 'Photography',
  photo_editing_approval: 'Photo Editing',
  manager_approval: 'Manager Approval',
  pricing_markup: 'Pricing & Markup',
  listing_creation: 'Listing Creation',
  publish_item: 'Published',
  closed_fake: 'Closed – Fake',
  closed_rejected: 'Closed – Not Accepted',
  sold: 'Sold',
  archived: 'Archived',
};
const STAGE_ORDER = Object.keys(STAGE_LABELS);
const PRE_INTAKE_STAGES = ['customer_inquiry', 'lead_qualification', 'initial_photo_submission', 'price_negotiation',
  'consignment_approval', 'appointment_scheduling', 'dropoff_pickup_courier'];
const INTAKE_STAGES = ['dropoff_pickup_courier', 'arrivals_receiving', 'authentication_payment'];

const OVERVIEW_STAGE_GROUPS = [
  ['preintake', 'Inquiries & Pre-Intake', ['customer_inquiry', 'lead_qualification', 'initial_photo_submission', 'price_negotiation',
    'consignment_approval', 'appointment_scheduling', 'dropoff_pickup_courier']],
  ['intake', 'Intake & Agreements', ['arrivals_receiving', 'authentication_payment']],
  ['auth', 'Authentication', ['authentication_service', 'authentication_process', 'authentication_certificate']],
  ['media', 'Photography & Design', ['photography', 'photo_editing_approval', 'listing_creation']],
  ['review', 'Approval & Pricing', ['manager_approval', 'pricing_markup']],
  ['live', 'Live & Sold', ['publish_item', 'sold', 'archived']],
  ['closed', 'Closed', ['closed_fake', 'closed_rejected']],
];

const LEAD_STATUSES = {
  new: 'New', qualified: 'Qualified', need_more_photos: 'Need More Photos',
  negotiation: 'Negotiation', rejected: 'Rejected', cancelled: 'Cancelled',
};
const FULFILLMENT_METHODS = { walk_in: 'Walk-in', drop_off: 'Drop-off', pickup: 'Pickup', courier: 'Courier' };
const ID_TYPES = {
  passport: 'Passport', drivers_license: "Driver's License", umid: 'UMID', prc_id: 'PRC ID', philsys_id: 'PhilSys National ID',
};
const INTAKE_PHOTO_TYPES = {
  front: 'Front', back: 'Back', side_left: 'Left side', side_right: 'Right side', underside: 'Bottom',
  inside: 'Inside', serial_number: 'Serial number', date_code: 'Date code', hardware: 'Hardware', accessories: 'Accessories',
};
const OPTIONAL_INTAKE_PHOTOS = { microchip: 'Microchip' };
const PHOTO_NAME_HINTS = [
  ['serial_number', ['serial']],
  ['date_code', ['datecode', 'date']],
  ['microchip', ['microchip', 'chip']],
  ['side_right', ['right']],
  ['side_left', ['left', 'side', 'right']],
  ['underside', ['bottom', 'underside', 'base']],
  ['inside', ['inside', 'interior']],
  ['accessories', ['accessories', 'accessory', 'dustbag', 'box']],
  ['hardware', ['hardware', 'clasp', 'zipper']],
  ['lifestyle', ['lifestyle', 'styled']],
  ['front', ['front']],
  ['back', ['back', 'rear']],
];
const ACCESSORY_OPTIONS = ['Dust bag', 'Box', 'Lock', 'Keys', 'Strap', 'Receipt'];
const ITEM_CATEGORIES = ['Handbag', 'Shoulder Bag', 'Tote', 'Crossbody', 'Backpack', 'Clutch', 'Small Leather Goods', 'Wallet', 'Shoes', 'Belt', 'Accessory'];
const FEE_LABELS = {
  'entrupy/standard': 'Entrupy — Standard',
  'entrupy/hermes_premium': 'Entrupy — Hermès premium',
  'legitgrail/footwear_standard': 'LegitGrail — Footwear & standard (existing Entrupy cert)',
  'legitgrail/chanel_hermes_premium': 'LegitGrail — Chanel & Hermès premium',
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

const ConsignmentFlow = {
  selected: { preintake: null, intake: null },
  overviewSearch: '',
  overviewSort: 'recently',
  overviewStages: null,
  overviewPage: 1,
  overviewPageSize: 10,
  photoUrls: {},

  /** route -> [render method, bind method]. Other files add their pages here (e.g. consignment_auth.js). */
  pages: {
    'consignment-overview': ['renderOverview', 'bindOverview'],
    'consignment-preintake': ['renderPreIntake', 'bindPreIntake'],
    'consignment-intake': ['renderIntake', 'bindIntake'],
  },

  handles(route) {
    return !route || route === 'consignment' || !!this.pages[route];
  },

  canEdit() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'consignmentTeam' || role === 'superAdmin';
  },

  render(route) {
    const [renderFn] = this.pages[route] || this.pages['consignment-overview'];
    return this[renderFn]();
  },

  afterRender(route) {
    DataStore.refreshIfStale();
    const [, bindFn] = this.pages[route] || this.pages['consignment-overview'];
    return this[bindFn]();
  },

  // ================================================================ helpers
  item(id) { return DB.pipelineItems.find((i) => i.id === id) || null; },
  peso(n) { return n == null ? '—' : `₱${formatAmount(Number(n))}`; },
  stageBadge(stage) {
    let tone = 'info';
    if (stage === 'closed_fake' || stage === 'closed_rejected') tone = 'danger';
    else if (stage === 'sold' || stage === 'publish_item') tone = 'success';
    else if (stage === 'archived') tone = 'warning';
    return badge(STAGE_LABELS[stage] || stage, tone);
  },
  itemName(i) { return [i.brand, i.model, i.color].filter(Boolean).join(' '); },
  fmtDate(iso) { return iso ? DataStore.formatDateTime(iso) : '—'; },
  photoCount(i) { return Object.keys(INTAKE_PHOTO_TYPES).filter((t) => i.photos[t]).length; },

  friendly(err) {
    const msg = (err && (err.message || err.error_description)) || 'Unknown error';
    if (/duplicate key/i.test(msg)) {
      if (/serial_number/i.test(msg)) return 'Another item already has this serial number.';
      if (/microchip/i.test(msg)) return 'Another item already has this microchip number.';
      if (/barcode/i.test(msg)) return 'Another item already has this barcode.';
      if (/one_primary_listing_photo/i.test(msg)) return 'Only one cover photo is allowed per item.';
      return 'This record already exists.';
    }
    if (/row-level security|permission denied/i.test(msg)) return 'Your role is not allowed to make this change.';
    return msg;
  },

  async save(button, successMessage, fn) {
    if (button) button.disabled = true;
    try {
      await fn();
    } catch (err) {
      console.error(err);
      showToast(this.friendly(err));
      if (button) button.disabled = false;
      return false;
    }
    if (successMessage) showToast(successMessage);
    try { await DataStore.loadPipeline(); } catch (err) { console.error(err); }
    Router.rerender();
    return true;
  },

  async updateItem(id, changes) {
    const { data, error } = await sbClient.from('consignment_items').update(changes).eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Your role is not allowed to change this item.');
  },

  checkFile(file, allowPdf) {
    if (!file) return 'Choose a file first.';
    const okTypes = ['image/jpeg', 'image/png', 'image/webp'].concat(allowPdf ? ['application/pdf'] : []);
    if (!okTypes.includes(file.type)) return `Only ${allowPdf ? 'JPG, PNG, WEBP or PDF' : 'JPG, PNG or WEBP'} files can be uploaded.`;
    if (file.size > MAX_UPLOAD_BYTES) return 'The file is larger than 10 MB.';
    return null;
  },

  extOf(file) {
    return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' })[file.type] || 'bin';
  },

  async uploadIntakePhoto(item, type, file) {
    const problem = this.checkFile(file, false);
    if (problem) throw new Error(problem);
    const path = `${item.id}/${type}-${Date.now()}.${this.extOf(file)}`;
    const up = await sbClient.storage.from('intake-photos').upload(path, file, { contentType: file.type });
    if (up.error) throw up.error;
    const { error } = await sbClient.from('item_photos').insert({
      item_id: item.id, photo_type: type, storage_path: path, uploaded_by: Session.currentUser.uid,
    });
    if (error) throw error;
  },

  /** Signature images: PNG, JPG or JPEG only, up to 2 MB (the bucket enforces the same limits). */
  checkSignatureFile(file) {
    if (!file) return 'Choose the signature image first.';
    if (!['image/png', 'image/jpeg'].includes(file.type) || !/\.(png|jpe?g)$/i.test(file.name)) {
      return 'Only PNG, JPG or JPEG images can be uploaded.';
    }
    if (file.size > MAX_SIGNATURE_BYTES) return 'The signature image is larger than 2 MB.';
    return null;
  },

  /** Uploads the signature under <consignor id>/<item id>/ and links a new agreement to this item. */
  async saveUploadedSignature(item, file) {
    const problem = this.checkSignatureFile(file);
    if (problem) throw new Error(problem);
    const path = `${item.consignor.id}/${item.id}/signature-${Date.now()}.${this.extOf(file)}`;
    const up = await sbClient.storage.from('signatures').upload(path, file, { contentType: file.type });
    if (up.error) throw up.error;
    const { data, error } = await sbClient.from('consignment_agreements').insert({
      consignor_id: item.consignor.id, item_id: item.id, signature_path: path, signature_method: 'uploaded',
    }).select('id').single();
    if (error) throw error;
    await this.updateItem(item.id, { agreement_id: data.id });
  },

  /** The upload box: instructions, drop zone, preview with Replace / Remove, consent, save. */
  renderSignatureUpload() {
    return `
      <div class="sig-upload">
        <input type="file" id="sig-file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" hidden>
        <div class="sig-dropzone" id="sig-dropzone" tabindex="0" role="button" aria-label="Upload e-signature image">
          <i class="fa-solid fa-signature sig-dropzone-icon"></i>
          <div class="sig-dropzone-title">Upload E-Signature</div>
          <div class="sig-dropzone-hint">Have the consignor sign on plain white paper in dark ink, then upload a clear photo or scan.<br>
            Click to choose or drag the image here · PNG, JPG or JPEG · up to 2 MB</div>
          <span class="btn-secondary sig-small-btn">Choose Image</span>
        </div>
        <div class="sig-preview" id="sig-preview" hidden>
          <img id="sig-preview-img" alt="Signature preview">
          <div class="sig-preview-meta">
            <span id="sig-preview-name"></span>
            <div class="sig-preview-actions">
              <button type="button" class="btn-secondary sig-small-btn" id="sig-replace">Replace</button>
              <button type="button" class="btn-secondary btn-danger sig-small-btn" id="sig-remove">Remove</button>
            </div>
          </div>
        </div>
        <label class="sig-consent"><input type="checkbox" id="sig-consent">
          <span>The consignor has read the key terms above and confirms this is their own signature.</span></label>
        <button class="btn-secondary" id="int-sign" style="margin-top:10px;">Save Signed Agreement</button>
      </div>`;
  },

  /** Signed view: the saved signature (click to enlarge), when it was signed, and Replace while at the door. */
  renderSignedAgreement(i, canReplace) {
    const path = i.agreementSignaturePath;
    return `
      <div class="sig-signed">
        <div class="sig-signed-thumb"${path ? ` data-photo-preview="1" data-photo-bucket="signatures" data-photo-path="${escapeHtml(path)}" title="Click to enlarge"` : ''}>
          ${path ? `<img data-photo-bucket="signatures" data-photo-path="${escapeHtml(path)}" alt="Consignor signature">`
            : '<img id="sig-legacy-img" alt="Consignor signature" hidden><span class="cell-muted" id="sig-legacy-note">Signature on file</span>'}
        </div>
        <div>
          <div style="font-size:12.5px; color:var(--green); font-weight:600;">✓ Signed on ${escapeHtml(this.fmtDate(i.agreementSignedAt))}</div>
          <div class="cell-muted" style="font-size:11.5px; margin-top:2px;">${path ? 'Uploaded e-signature' : 'Drawn on the signature pad'}</div>
          ${canReplace ? '<button type="button" class="btn-secondary sig-small-btn" id="int-sign-replace-toggle" style="margin-top:8px;">Replace Signature</button>' : ''}
        </div>
      </div>
      ${canReplace ? `<div id="int-sign-replace" hidden>${this.renderSignatureUpload()}</div>` : ''}`;
  },

  bindSignatureUpload(item) {
    // Saved signature: thumbnail, click to enlarge (intake photos already bind previews while at the door)
    const signed = document.querySelector('.sig-signed');
    if (signed && item.stage !== 'dropoff_pickup_courier') this.bindPhotoPreviews(signed);
    this.fillPhotos('signatures');

    // Agreements signed on the old pad keep their drawn image in signature_data
    const legacyImg = document.getElementById('sig-legacy-img');
    if (legacyImg && item.agreementId) {
      sbClient.from('consignment_agreements').select('signature_data').eq('id', item.agreementId).maybeSingle()
        .then(({ data }) => {
          const src = data && data.signature_data;
          if (!src || !/^data:image\/(png|jpeg);base64,/.test(src) || !legacyImg.isConnected) return;
          legacyImg.src = src;
          legacyImg.hidden = false;
          const note = document.getElementById('sig-legacy-note');
          if (note) note.remove();
        });
    }

    const toggle = document.getElementById('int-sign-replace-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const wrap = document.getElementById('int-sign-replace');
        wrap.hidden = !wrap.hidden;
        toggle.textContent = wrap.hidden ? 'Replace Signature' : 'Cancel Replace';
      });
    }

    const input = document.getElementById('sig-file');
    if (!input) return;
    const zone = document.getElementById('sig-dropzone');
    const preview = document.getElementById('sig-preview');
    const img = document.getElementById('sig-preview-img');
    let file = null;
    let objectUrl = null;

    const showError = (message) => Validate.show(null, [[file ? preview : zone, message]]);
    const reset = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      file = null;
      objectUrl = null;
      input.value = '';
      img.removeAttribute('src');
      preview.hidden = true;
      zone.hidden = false;
    };
    const pick = (chosen) => {
      if (!chosen) return;
      input.value = '';
      const problem = this.checkSignatureFile(chosen);
      if (problem) { showError(problem); return; }
      // Make sure the file really opens as an image before showing it
      const url = URL.createObjectURL(chosen);
      const probe = new Image();
      probe.onload = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        file = chosen;
        objectUrl = url;
        img.src = url;
        document.getElementById('sig-preview-name').textContent = `${chosen.name} · ${Math.max(1, Math.round(chosen.size / 1024))} KB`;
        Validate.unmark(zone);
        Validate.unmark(preview);
        zone.hidden = true;
        preview.hidden = false;
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        showError('This file could not be opened as an image. Try another photo or scan.');
      };
      probe.src = url;
    };

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', () => pick(input.files && input.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('is-dragover'); }));
    zone.addEventListener('drop', (e) => pick(e.dataTransfer.files && e.dataTransfer.files[0]));
    document.getElementById('sig-replace').addEventListener('click', () => input.click());
    document.getElementById('sig-remove').addEventListener('click', reset);

    document.getElementById('int-sign').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const consent = document.getElementById('sig-consent');
      if (Validate.show(null, [
        [zone, file ? null : "Upload the consignor's signature image first."],
        [consent, consent.checked ? null : 'Confirm the consignor has agreed to the key terms.'],
      ])) return;
      this.save(btn, 'Agreement signed and attached.', () => this.saveUploadedSignature(item, file));
    });
  },

  async fillPhotos(bucket) {
    const imgs = Array.from(document.querySelectorAll(`img[data-photo-bucket="${bucket}"]`));
    const needed = imgs.map((img) => img.dataset.photoPath).filter((p) => p && !this.photoUrls[p]);
    if (needed.length) {
      const { data, error } = await sbClient.storage.from(bucket).createSignedUrls(needed, 3600);
      if (!error && data) for (const d of data) if (d.signedUrl) this.photoUrls[d.path] = d.signedUrl;
    }
    for (const img of imgs) {
      const url = this.photoUrls[img.dataset.photoPath];
      if (url) img.src = url;
    }
  },


    photoCardHtml(bucket, type, path, label, optional, editable, uploadAttr) {
      const input = `<input type="file" accept="image/jpeg,image/png,image/webp" ${uploadAttr}="${type}" hidden>`;
      let body;
      if (path) {
        body = `
          <div class="photo-tile-img" data-photo-preview="1" data-photo-bucket="${bucket}" data-photo-path="${escapeHtml(path)}" title="Click to preview">
            <img data-photo-bucket="${bucket}" data-photo-path="${escapeHtml(path)}" alt="${escapeHtml(label)}">
          </div>
          ${editable ? `<label class="photo-tile-replace" title="Replace ${escapeHtml(label)}">
            <i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i><span class="photo-card-action-text">Replace</span>${input}</label>` : ''}`;
      } else if (editable) {
        body = `<label class="photo-tile-empty is-clickable" title="Upload ${escapeHtml(label)}">
            <i class="fa-regular fa-image" aria-hidden="true"></i><span class="photo-card-action-text">Upload</span>${input}</label>`;
      } else {
        body = '<div class="photo-tile-empty"><i class="fa-regular fa-image" aria-hidden="true"></i><span>Missing</span></div>';
      }
      return `
        <div class="photo-tile ${path ? 'is-uploaded' : (optional ? 'is-optional' : 'is-missing')}"${editable ? ` data-drop-slot="${type}"` : ''}>
          <div class="photo-tile-box">${body}</div>
          <div class="photo-tile-caption">${escapeHtml(label)}${optional ? ' <span class="cell-muted">(optional)</span>' : ''}</div>
        </div>`;
  },


  bindPhotoPreviews(container) {
    (container || document).querySelectorAll('[data-photo-preview]').forEach((el) => {
      el.addEventListener('click', () => {
        const bucket = el.dataset.photoBucket, path = el.dataset.photoPath;
        const url = this.photoUrls[path];
        const overlay = openModal({ title: 'Photo Preview', bodyHtml: url
          ? `<img src="${escapeHtml(url)}" alt="" style="width:100%; border-radius:10px; display:block;">`
          : '<p class="cell-muted">Loading…</p>' });
        if (!url) {
          sbClient.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => {
            if (data && overlay.isConnected) overlay.querySelector('.modal-body').innerHTML =
              `<img src="${escapeHtml(data.signedUrl)}" alt="" style="width:100%; border-radius:10px; display:block;">`;
          });
        }
      });
    });
  },

  renderPhotoGrid(item, editable) {
    const slot = (type, label, optional) =>
      this.photoCardHtml('intake-photos', type, item.photos[type], label, optional, editable, 'data-photo-upload');
    return `
      ${editable ? this.renderBulkPhotoUpload('intake') : ''}
      <div class="photo-tile-grid"${editable ? ' data-drop-key="intake"' : ''}>
        ${Object.entries(INTAKE_PHOTO_TYPES).map(([t, l]) => slot(t, l, false)).join('')}
        ${Object.entries(OPTIONAL_INTAKE_PHOTOS).map(([t, l]) => slot(t, l, true)).join('')}
      </div>
      <div class="photo-progress ${this.photoCount(item) === 10 ? 'is-complete' : ''}">
        ${this.photoCount(item)} / 10 required photos uploaded
      </div>`;
  },

  bindPhotoUploads(item) {
    this.bindPhotoPreviews();
    document.querySelectorAll('[data-photo-upload]').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const label = INTAKE_PHOTO_TYPES[input.dataset.photoUpload] || OPTIONAL_INTAKE_PHOTOS[input.dataset.photoUpload];
        input.closest('label').querySelector('.photo-card-action-text').textContent = 'Uploading…';
        await this.save(null, `${label} photo uploaded.`, () => this.uploadIntakePhoto(item, input.dataset.photoUpload, file));
      });
    });
    this.fillPhotos('intake-photos');
    this.bindBulkPhotoUpload('intake', { ...INTAKE_PHOTO_TYPES, ...OPTIONAL_INTAKE_PHOTOS }, item.photos,
      (type, file) => this.uploadIntakePhoto(item, type, file));
  },

  /** Upload box shown above an editable photo grid: one Upload button, or drag & drop several photos. */
  renderBulkPhotoUpload(key) {
    return `
      <div class="bulk-upload" id="bulk-${key}">
        <input type="file" class="bulk-file" accept="image/jpeg,image/png,image/webp" multiple hidden>
        <div class="bulk-dropzone" tabindex="0" role="button" aria-label="Upload photos">
          <span class="btn-secondary bulk-upload-btn"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i> Upload</span>
          <div class="bulk-dropzone-hint">Choose photos or drag &amp; drop them here.</div>
          <div class="bulk-dropzone-sub">JPG, JPEG, PNG and WEBP. Max 10 MB each. Photos fill the empty tiles in order.</div>
        </div>
      </div>`;
  },

  /**
   * types: { photo_type: label } for this grid. filled: which types already have a photo.
   * uploadOne(type, file): the existing single-photo upload (intake or listing), reused for each file.
   */
  bindBulkPhotoUpload(key, types, filled, uploadOne) {
    const root = document.getElementById(`bulk-${key}`);
    if (!root) return;
    const input = root.querySelector('.bulk-file');
    const zone = root.querySelector('.bulk-dropzone');
    const hint = root.querySelector('.bulk-dropzone-hint');
    const grid = document.querySelector(`[data-drop-key="${key}"]`);
    const order = Object.keys(types);
    let busy = false;

    const isImage = (file) => new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => { URL.revokeObjectURL(url); resolve(true); };
      probe.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      probe.src = url;
    });

    // slot: a tile the files were dropped on (that tile only). Without it, photos go by file name, then to empty tiles.
    const start = async (fileList, slot) => {
      if (busy || !fileList || !fileList.length) return;
      busy = true;
      const files = Array.from(fileList).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const skipped = [];
      const ok = [];
      for (const f of files) {
        const problem = this.checkFile(f, false);
        if (problem) skipped.push(`${f.name}: ${problem}`);
        else if (!(await isImage(f))) skipped.push(`${f.name}: this file could not be opened as an image.`);
        else ok.push(f);
      }

      const jobs = [];
      if (slot) {
        if (ok.length) jobs.push({ type: slot, file: ok[0] });
        ok.slice(1).forEach((f) => skipped.push(`${f.name}: drop one photo at a time on a tile.`));
      } else {
        const taken = new Set();
        const rest = [];
        ok.forEach((f) => {
          const words = ` ${f.name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, ' ')} `;
          const hit = PHOTO_NAME_HINTS.find(([t, kws]) => types[t] && !taken.has(t) && kws.some((k) => words.includes(` ${k} `)));
          if (hit) { taken.add(hit[0]); jobs.push({ type: hit[0], file: f }); } else rest.push(f);
        });
        rest.forEach((f) => {
          const t = order.find((x) => !filled[x] && !taken.has(x));
          if (t) { taken.add(t); jobs.push({ type: t, file: f }); }
          else skipped.push(`${f.name}: no empty tile left. Drop it on the tile you want to replace.`);
        });
        jobs.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
      }

      Validate.show(null, [[zone, skipped.length ? skipped : null]]);
      if (!jobs.length) { busy = false; return; }

      zone.classList.add('is-busy');
      const failed = [];
      for (let n = 0; n < jobs.length; n += 1) {
        const tile = grid && grid.querySelector(`[data-drop-slot="${jobs[n].type}"]`);
        if (tile) tile.classList.add('is-uploading');
        hint.textContent = `Uploading ${n + 1} of ${jobs.length}…`;
        try {
          await uploadOne(jobs[n].type, jobs[n].file);
        } catch (err) {
          console.error(err);
          failed.push(`${types[jobs[n].type]} (${this.friendly(err)})`);
        }
      }
      const done = jobs.length - failed.length;
      showToast(failed.length
        ? `${done} of ${jobs.length} photos uploaded. Not uploaded: ${failed.join(', ')}.`
        : `${done} photo${done === 1 ? '' : 's'} uploaded.`);
      try { await DataStore.loadPipeline(); } catch (err) { console.error(err); }
      Router.rerender();
      // Keep the list of skipped files visible after the page refreshes
      const newZone = document.querySelector(`#bulk-${key} .bulk-dropzone`);
      if (newZone && skipped.length) Validate.show(null, [[newZone, skipped]]);
    };

    const dropTarget = (el, slot) => {
      ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) el.classList.add('is-dragover');
      }));
      el.addEventListener('dragleave', () => el.classList.remove('is-dragover'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('is-dragover');
        start(e.dataTransfer.files, slot);
      });
    };

    dropTarget(zone, null);
    if (grid) grid.querySelectorAll('[data-drop-slot]').forEach((tile) => dropTarget(tile, tile.dataset.dropSlot));
    zone.addEventListener('click', () => { if (!busy) input.click(); });
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) input.click(); }
    });
    input.addEventListener('change', () => { const picked = input.files; start(picked, null); input.value = ''; });
  },

  confirm(title, message, okLabel, onConfirm) {
    const overlay = openModal({
      title,
      bodyHtml: `<p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn-secondary" data-close-modal>Cancel</button>
          <button class="btn-confirm btn-danger" id="flow-confirm-btn">${escapeHtml(okLabel)}</button>
        </div>`,
    });
    overlay.querySelector('#flow-confirm-btn').addEventListener('click', () => { closeModal(); onConfirm(); });
  },

  checklistHtml(rows) {
    return `<ul style="list-style:none; padding:0; margin:0; font-size:12.5px;">
      ${rows.map(([ok, text]) => `<li style="padding:3px 0; color:${ok ? 'var(--green)' : 'var(--danger-red)'};">${ok ? '✓' : '✗'} ${escapeHtml(text)}</li>`).join('')}
    </ul>`;
  },

  queueTable(items, selectedId, columns, emptyText) {
    return `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${columns.map((c) => `<th style="text-align:center;">${c[0]}</th>`).join('')}<th style="text-align:center;">Action</th></tr></thead>
          <tbody>
            ${items.length === 0 ? `<tr><td colspan="${columns.length + 1}" class="cell-muted" style="text-align:center; padding:18px;">${emptyText}</td></tr>` :
              items.map((i) => `
              <tr style="text-align:center; vertical-align:middle; ${i.id === selectedId ? 'background:#EEF2FF;' : ''}">
                ${columns.map((c) => `<td style="text-align:center; vertical-align:middle;">${c[1](i)}</td>`).join('')}
                <td style="text-align:center;"><button class="btn-add" data-select-item="${i.id}" style="padding:4px 10px; font-size:11px;">${i.id === selectedId ? 'Selected' : 'Select'}</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  },

  bindQueueSelect(key) {
    document.querySelectorAll('[data-select-item]').forEach((btn) => {
      btn.addEventListener('click', () => { this.selected[key] = btn.dataset.selectItem; Router.rerender(); });
    });
  },

  // ============================================================ OVERVIEW
  renderOverview() {
    let list = [...DB.pipelineItems];
    const kw = this.overviewSearch.trim().toLowerCase();
    if (kw) {
      list = list.filter((i) => [i.code, i.brand, i.model, i.serial, i.microchip, i.consignor.full_name, STAGE_LABELS[i.stage]]
        .some((v) => String(v || '').toLowerCase().includes(kw)));
    }
    if (this.overviewStages !== null) {
      const stages = new Set(this.overviewStages);
      list = list.filter((i) => stages.has(i.stage));
    }
    const priceOf = (i) => i.price ?? i.askingPrice ?? 0;
    if (this.overviewSort === 'oldest') list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (this.overviewSort === 'alphabetical') list.sort((a, b) => this.itemName(a).localeCompare(this.itemName(b)));
    else if (this.overviewSort === 'price-high') list.sort((a, b) => priceOf(b) - priceOf(a));
    else if (this.overviewSort === 'price-low') list.sort((a, b) => priceOf(a) - priceOf(b));
    else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const totalPages = Math.max(1, Math.ceil(list.length / this.overviewPageSize));
    this.overviewPage = Math.min(Math.max(1, this.overviewPage), totalPages);
    const pageStart = (this.overviewPage - 1) * this.overviewPageSize;
    const pageList = list.slice(pageStart, pageStart + this.overviewPageSize);

    const stagesPresent = STAGE_ORDER.filter((s) => DB.pipelineItems.some((i) => i.stage === s));
    const stageGroups = OVERVIEW_STAGE_GROUPS
      .map(([key, label, stages]) => ({
        key,
        label,
        items: stages.filter((s) => stagesPresent.includes(s)).map((s) => ({ value: s, label: STAGE_LABELS[s] })),
      }))
      .filter((g) => g.items.length);
    const canStart = Session.canAccess('consignment-preintake');

    return `
      <h1 class="page-title">Consignment Management</h1>
      <div class="filter-toolbar-row">
        <div class="filter-controls-group">
          ${renderUniversalSearchBar('cons-overview-search', 'Search by Item ID, Brand...')}
          ${renderTreeFilter('cons-overview-stage', {
            label: 'Stage',
            groups: stageGroups,
            selected: this.overviewStages,
            searchPlaceholder: 'Search stage',
            emptyText: 'No consignment items yet.',
          })}
          <select class="sort-select" id="cons-overview-sort">
            ${[['recently', 'Recently Added'], ['oldest', 'Oldest First'], ['price-high', 'Price High to Low'], ['price-low', 'Price Low to High'], ['alphabetical', 'Alphabetical A-Z']]
              .map(([v, l]) => `<option value="${v}" ${this.overviewSort === v ? 'selected' : ''}>Sort by: ${l}</option>`).join('')}
          </select>
        </div>
        ${canStart ? '<button class="btn-add" id="cons-new-inquiry">+ New Inquiry</button>' : ''}
      </div>
      <div class="table-scroll">
        <table class="data-table overview-table">
          <thead><tr>
            <th class="ov-id">Item ID</th><th class="ov-brand">Brand</th><th class="ov-details">Details</th>
            <th class="ov-consignor">Consignor</th><th class="ov-stage">Stage</th><th class="ov-auth">Authentication</th>
            <th class="ov-price">Price</th><th class="ov-updated">Last Update</th><th class="ov-history">History</th>
          </tr></thead>
          <tbody>
            ${list.length === 0 ? `<tr><td colspan="9" class="cell-muted" style="text-align:center; padding:24px;">${DB.pipelineItems.length ? 'No items match your search.' : 'No consignment items yet.'}</td></tr>` :
              pageList.map((i) => `
              <tr style="vertical-align:middle;">
                <td class="ov-id"><strong>${escapeHtml(i.code)}</strong></td>
                <td class="ov-brand cell-bold">${escapeHtml(i.brand)}</td>
                <td class="ov-details">
                  <div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div>
                  <div class="cell-muted" style="font-size:11.5px;">${escapeHtml(i.category || '—')}${i.serial ? ` · SN ${escapeHtml(i.serial)}` : ''}</div>
                </td>
                <td class="ov-consignor">${escapeHtml(i.consignor.full_name)}</td>
                <td class="ov-stage">${this.stageBadge(i.stage)}</td>
                <td class="ov-auth">${this.authCell(i)}</td>
                <td class="ov-price cell-bold">${i.price != null ? this.peso(i.price) : (i.askingPrice != null ? `<span class="cell-muted">Asking ${this.peso(i.askingPrice)}</span>` : '—')}</td>
                <td class="ov-updated" style="font-size:12px;">${escapeHtml(this.fmtDate(i.updatedAt))}</td>
                <td class="ov-history"><button class="icon-btn" data-history="${i.id}" title="View activity log"><i class="fa-solid fa-clock-rotate-left"></i></button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination" id="cons-overview-pagination">
        ${renderPaginationButtons(this.overviewPage, totalPages)}
      </div>`;
  },

  authCell(i) {
    if (!i.auth) return '<span class="cell-muted">—</span>';
    if (i.auth.final_result === 'authentic') return badge('Authentic', 'success');
    if (i.auth.final_result === 'fake') return badge('Fake', 'danger');
    if (i.auth.payment_status === 'confirmed') return badge('In Progress', 'warning');
    return badge('Awaiting Payment', 'info');
  },

  bindOverview() {
    const search = document.getElementById('cons-overview-search');
    if (search) {
      search.value = this.overviewSearch;
      search.addEventListener('input', debounce((e) => {
        this.overviewSearch = e.target.value;
        this.overviewPage = 1;
        Router.rerender();
        const s = document.getElementById('cons-overview-search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }, 300));
    }
    const sort = document.getElementById('cons-overview-sort');
    if (sort) sort.addEventListener('change', (e) => { this.overviewSort = e.target.value; this.overviewPage = 1; Router.rerender(); });
    bindTreeFilter('cons-overview-stage', (stages) => { this.overviewStages = stages; this.overviewPage = 1; Router.rerender(); });
    const pager = document.getElementById('cons-overview-pagination');
    if (pager) pager.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      this.overviewPage = parseInt(btn.dataset.page, 10);
      Router.rerender();
    });
    const newInquiryBtn = document.getElementById('cons-new-inquiry');
    if (newInquiryBtn) newInquiryBtn.addEventListener('click', () => Router.navigate('consignment-preintake'));

    document.querySelectorAll('.overview-table [data-history]').forEach((btn) => {
      btn.addEventListener('click', () => this.showHistory(this.item(btn.dataset.history)));
    });
  },

  async showHistory(item) {
    if (!item) return;
    const overlay = openModal({ title: `Activity Log — ${item.code}`, bodyHtml: '<p class="cell-muted">Loading…</p>' });
    const { data, error } = await sbClient.from('stage_history')
      .select('from_stage, to_stage, changed_at, notes, changed_by_profile:profiles(full_name)')
      .eq('item_id', item.id)
      .order('changed_at', { ascending: true });
    const rows = error ? [] : data;
    overlay.querySelector('.modal-body').innerHTML = `
      <div style="font-size:12.5px; margin-bottom:10px;"><strong>${escapeHtml(this.itemName(item))}</strong> · ${escapeHtml(item.consignor.full_name)}</div>
      ${error ? `<p class="cell-muted">Could not load the log: ${escapeHtml(this.friendly(error))}</p>` : ''}
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>When</th><th>From</th><th>To</th><th>By</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr><td style="font-size:12px;">${escapeHtml(this.fmtDate(r.changed_at))}</td>
              <td>${r.from_stage ? escapeHtml(STAGE_LABELS[r.from_stage] || r.from_stage) : '<span class="cell-muted">Created</span>'}</td>
              <td>${escapeHtml(STAGE_LABELS[r.to_stage] || r.to_stage)}</td>
              <td>${escapeHtml((DataStore.one(r.changed_by_profile) || {}).full_name || 'System')}</td></tr>`).join('')}
        </tbody></table></div>
      <div class="modal-actions"><button class="btn-secondary" data-close-modal>Close</button></div>`;
    overlay.querySelectorAll('.modal-body [data-close-modal]').forEach((b) => b.addEventListener('click', closeModal));
  },

  // ======================================================== PRE-INTAKE (1-7)
  renderPreIntake() {
    const queue = DB.pipelineItems.filter((i) => PRE_INTAKE_STAGES.includes(i.stage) && i.stage !== 'dropoff_pickup_courier');
    if (this.selected.preintake && !queue.some((i) => i.id === this.selected.preintake)) this.selected.preintake = null;
    const sel = this.item(this.selected.preintake);
    const editable = this.canEdit();

    return `
      <h1 class="page-title" style="margin-bottom:4px;">Inquiries & Pre-Intake</h1>

      ${editable ? this.renderInquiryForm() : ''}

      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:12px;">Pre-Intake Queue (${queue.length})</div>
          ${this.queueTable(queue, this.selected.preintake, [
            ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
            ['Consignor & Item', (i) => `<div style="font-weight:600;">${escapeHtml(i.consignor.full_name)}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(this.itemName(i))}</div>`],
            ['Source', (i) => escapeHtml(INQUIRY_CHANNELS[i.channel] || '—')],
            ['Asking', (i) => this.peso(i.askingPrice)],
            ['Lead', (i) => escapeHtml(LEAD_STATUSES[i.leadStatus] || i.leadStatus)],
            ['Stage', (i) => this.stageBadge(i.stage)],
          ], 'No open inquiries.')}
        </div>
        <div class="card col-narrow">
          ${sel ? this.renderPreIntakePanel(sel, editable) : '<p class="cell-muted">Select an inquiry to work on it.</p>'}
        </div>
      </div>`;
  },

  renderInquiryForm() {
    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">New Customer Inquiry</div>
        <form id="cons-inquiry-form">
          <datalist id="cons-consignor-list">
            ${DB.consignorList.map((c) => `<option value="${escapeHtml(this.consignorOption(c))}"></option>`).join('')}
          </datalist>
          <div class="section-grid">
            <div class="field-group col-wide">
              <label class="field-label">Consignor Name</label>
              <input class="field-input" name="consignor" list="cons-consignor-list" required placeholder="e.g. Maria Santos" autocomplete="off">
            </div>
            <div class="field-group col-wide">
              <label class="field-label">Source Channel</label>
              <select class="field-input" name="channel">
                ${Object.entries(INQUIRY_CHANNELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="section-grid">
            <div class="field-group col-wide"><label class="field-label">Phone</label><input class="field-input" name="phone" placeholder="e.g. 0917 123 4567"></div>
            <div class="field-group col-wide"><label class="field-label">Email</label><input class="field-input" name="email" type="email" placeholder="e.g. mariasantos@gmail.com"></div>
          </div>
          <div class="section-grid">
            <div class="field-group col-wide"><label class="field-label">Brand</label><input class="field-input" name="brand" required placeholder="e.g. Chanel"></div>
            <div class="field-group col-wide"><label class="field-label">Model</label><input class="field-input" name="model" placeholder="e.g. Boy Bag Small"></div>
            <div class="field-group col-wide"><label class="field-label">Category</label>
              <select class="field-input" name="category">${ITEM_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
            </div>
            <div class="field-group col-wide"><label class="field-label">Asking Price (₱)</label><input class="field-input" name="asking" type="number" min="1" step="1" placeholder="e.g. 150000"></div>
          </div>
          <div class="field-group">
            <label class="field-label">Internal Notes</label>
            <textarea class="field-input" name="notes" rows="2" placeholder="e.g. Caviar leather, light corner wear"></textarea>
          </div>
          <button type="submit" class="btn-confirm">Create</button>
        </form>
      </div>`;
  },

  consignorOption(c) {
    return [c.full_name, c.phone, c.email].filter(Boolean).join(' · ');
  },

  renderPreIntakePanel(i, editable) {
    const dis = editable ? '' : 'disabled';
    const canLead = PRE_INTAKE_STAGES.includes(i.stage);
    const next = {
      initial_photo_submission: ['price_negotiation', 'Submit'],
      price_negotiation: ['consignment_approval', 'Submit'],
      consignment_approval: ['appointment_scheduling', 'Approve'],
      appointment_scheduling: ['dropoff_pickup_courier', 'Submit'],
    }[i.stage];
    const local = i.appointmentAt ? new Date(new Date(i.appointmentAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

    return `
      <div style="border-bottom:1px solid #E2E8F0; padding-bottom:10px; margin-bottom:12px;">
        <div style="font-weight:700; color:var(--card-navy-dark);">${escapeHtml(i.code)} · ${escapeHtml(this.itemName(i))}</div>
        <div class="cell-muted" style="font-size:12px;">${escapeHtml(i.consignor.full_name)}${i.consignor.phone ? ` · ${escapeHtml(i.consignor.phone)}` : ''} · ${escapeHtml(INQUIRY_CHANNELS[i.channel] || '—')}</div>
        <div style="margin-top:6px;">${this.stageBadge(i.stage)}</div>
        ${i.notes ? `<div style="font-size:12px; margin-top:6px; color:#475569;">${escapeHtml(i.notes)}</div>` : ''}
      </div>

      <div class="field-group">
        <label class="field-label">Lead Status</label>
        <div style="display:flex; gap:6px;">
          <select class="field-input" id="pre-lead-status" ${dis || (canLead ? '' : 'disabled')}>
            ${Object.entries(LEAD_STATUSES).map(([v, l]) => `<option value="${v}" ${i.leadStatus === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          ${editable ? '<button class="btn-secondary" id="pre-save-lead" style="white-space:nowrap;">Save</button>' : ''}
        </div>
      </div>

      <details ${['initial_photo_submission', 'lead_qualification'].includes(i.stage) ? 'open' : ''} style="margin-bottom:12px;">
        <summary style="font-weight:600; cursor:pointer; font-size:13px;">Initial Photos (${this.photoCount(i)}/10)</summary>
        <div style="margin-top:8px;">${this.renderPhotoGrid(i, editable)}</div>
      </details>

      <details ${['price_negotiation', 'consignment_approval'].includes(i.stage) ? 'open' : ''} style="margin-bottom:12px;">
        <summary style="font-weight:600; cursor:pointer; font-size:13px;">Price Negotiation</summary>
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:10px; margin-top:8px;">
          <div style="font-size:12px; margin-bottom:6px;">Current asking: <strong>${this.peso(i.askingPrice)}</strong> · Agreed payout: <strong>${this.peso(i.agreedPayout)}</strong></div>
          ${editable ? `
          <div style="display:flex; gap:6px; margin-bottom:6px;">
            <input class="field-input" id="neg-asking" type="number" min="1" placeholder="Asking ₱">
            <input class="field-input" id="neg-counter" type="number" min="1" placeholder="Counteroffer ₱">
          </div>
          <input class="field-input" id="neg-notes" placeholder="Notes (optional)" style="margin-bottom:6px;">
          <button class="btn-secondary" id="neg-log" style="width:100%; font-size:12px;">Log Exchange</button>
          <div style="display:flex; gap:6px; margin-top:10px;">
            <input class="field-input" id="neg-payout" type="number" min="1" placeholder="Agreed payout ₱" value="${i.agreedPayout ?? ''}">
            <button class="btn-secondary" id="neg-save-payout" style="white-space:nowrap;">Save Payout</button>
          </div>` : ''}
          ${i.negotiations.length ? `
          <div style="margin-top:8px; max-height:110px; overflow-y:auto; font-size:11.5px;">
            ${i.negotiations.map((n) => `<div style="border-bottom:1px dashed #E2E8F0; padding:3px 0; color:#475569;">
              ${n.asking_price != null ? `Asking ${this.peso(n.asking_price)}` : ''}${n.asking_price != null && n.counter_offer != null ? ' · ' : ''}${n.counter_offer != null ? `Counter ${this.peso(n.counter_offer)}` : ''}
              ${n.notes ? ` — ${escapeHtml(n.notes)}` : ''} <span style="color:#94A3B8;">(${escapeHtml(this.fmtDate(n.logged_at))})</span></div>`).join('')}
          </div>` : '<div class="cell-muted" style="font-size:11.5px; margin-top:6px;">No exchanges logged yet.</div>'}
        </div>
      </details>

      <details ${i.stage === 'appointment_scheduling' ? 'open' : ''} style="margin-bottom:12px;">
        <summary style="font-weight:600; cursor:pointer; font-size:13px;">Appointment & Fulfillment</summary>
        <div style="margin-top:8px;">
          <div class="field-group">
            <label class="field-label">Method</label>
            <select class="field-input" id="pre-fulfillment" ${dis}>
              <option value="">— Choose —</option>
              ${Object.entries(FULFILLMENT_METHODS).map(([v, l]) => `<option value="${v}" ${i.fulfillment === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label class="field-label">Date & Time</label>
            <input type="datetime-local" class="field-input" id="pre-appointment" value="${local}" ${dis}>
          </div>
          ${editable ? '<button class="btn-secondary" id="pre-save-appointment" style="width:100%;">Save Appointment</button>' : ''}
        </div>
      </details>

      ${editable && next ? `<button class="btn-confirm" id="pre-advance" data-target="${next[0]}" style="width:100%; margin-top:6px;">${next[1]}</button>` : ''}
      ${editable && i.stage === 'consignment_approval' ? '<button class="btn-secondary" id="pre-not-approved" style="width:100%; margin-top:6px; color:var(--danger-red);">Not Approved</button>' : ''}
      ${['customer_inquiry', 'lead_qualification'].includes(i.stage) ? '<p class="cell-muted" style="font-size:12px; margin-top:8px;">Set the lead status to Qualified to continue.</p>' : ''}
      <button class="btn-secondary" id="pre-history" style="width:100%; margin-top:8px;">View Activity Log</button>`;
  },

  bindPreIntake() {
    this.bindQueueSelect('preintake');

    const form = document.getElementById('cons-inquiry-form');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); this.createInquiry(form); });

    const i = this.item(this.selected.preintake);
    if (!i) return;
    this.bindPhotoUploads(i);
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => fn(el)); };

    on('pre-history', () => this.showHistory(i));
    on('pre-save-lead', (btn) => {
      const v = document.getElementById('pre-lead-status').value;
      if (v === i.leadStatus) return showToast('Lead status is unchanged.');
      this.save(btn, `Lead status set to ${LEAD_STATUSES[v]}.`, () => this.updateItem(i.id, { lead_status: v }));
    });
    on('neg-log', (btn) => {
      const asking = Number(document.getElementById('neg-asking').value) || null;
      const counter = Number(document.getElementById('neg-counter').value) || null;
      const notes = document.getElementById('neg-notes').value.trim() || null;
      const askingEl = document.getElementById('neg-asking');
      const counterEl = document.getElementById('neg-counter');
      const neither = !askingEl.value.trim() && !counterEl.value.trim();
      if (Validate.show(null, [
        [askingEl, neither ? 'Enter an asking price or a counteroffer.' : Validate.amount(askingEl.value, 'Asking price', false)],
        [counterEl, neither ? null : Validate.amount(counterEl.value, 'Counteroffer', false)],
        [document.getElementById('neg-notes'), Validate.notes(notes, 'Notes')],
      ])) return;
      this.save(btn, 'Negotiation logged.', async () => {
        const { error } = await sbClient.from('price_negotiations').insert({ item_id: i.id, asking_price: asking, counter_offer: counter, notes });
        if (error) throw error;
      });
    });
    on('neg-save-payout', (btn) => {
      const payoutEl = document.getElementById('neg-payout');
      const v = Number(payoutEl.value);
      if (Validate.show(null, [[payoutEl, Validate.amount(payoutEl.value, 'Agreed payout')]])) return;
      this.save(btn, 'Agreed payout saved.', () => this.updateItem(i.id, { agreed_payout: v }));
    });
    const apptInput = document.getElementById('pre-appointment');
    const savedAppt = apptInput ? apptInput.value : '';
    Validate.limitToFuture(apptInput);
    on('pre-save-appointment', (btn) => {
      const method = document.getElementById('pre-fulfillment').value || null;
      const when = document.getElementById('pre-appointment').value;
      if (Validate.show(null, [
        [document.getElementById('pre-fulfillment'), method ? null : 'Choose a fulfillment method.'],
        [apptInput, !when ? 'Choose the appointment date and time.' : (when !== savedAppt ? Validate.futureDateTime(when, 'Appointment date and time') : null)],
      ])) return;
      this.save(btn, 'Appointment saved.', () => this.updateItem(i.id, { fulfillment_method: method, appointment_at: new Date(when).toISOString() }));
    });
    on('pre-advance', (btn) => {
      const target = btn.dataset.target;
      this.save(btn, `Moved to ${STAGE_LABELS[target]}.`, () => this.updateItem(i.id, { current_stage: target })).then((ok) => {
        if (ok && target === 'dropoff_pickup_courier') {
          this.selected.intake = i.id;
          showToast(`${i.code} is now in transit. Continue on Intake & Agreements when it arrives.`);
        }
      });
    });
    on('pre-not-approved', (btn) => {
      this.confirm('Close as not accepted?', `${i.code} will be closed and removed from the queue. This cannot be undone.`, 'Close Item', () => {
        this.save(btn, `${i.code} closed as not accepted.`, () => this.updateItem(i.id, { lead_status: 'rejected' }));
      });
    });
  },

  async createInquiry(form) {
    const fd = new FormData(form);
    const text = (k) => String(fd.get(k) || '').trim();
    const consignorText = text('consignor');
    const brand = text('brand');
    const phone = Validate.normalizePhone(text('phone'));
    const email = text('email').toLowerCase();
    const field = (name) => form.querySelector(`[name="${name}"]`);

    // Existing consignor picked from the list?
    let consignor = DB.consignorList.find((c) => this.consignorOption(c) === consignorText);
    if (Validate.show(form, [
      [field('consignor'), consignor ? null : Validate.personName(consignorText, 'Consignor name')],
      [field('phone'), consignor ? null : Validate.phone(phone)],
      [field('email'), consignor ? null : Validate.email(email)],
      [field('brand'), Validate.itemText(brand, 'Brand', true)],
      [field('model'), Validate.itemText(text('model'), 'Model')],
      [field('asking'), Validate.amount(text('asking'), 'Asking price', false)],
      [field('notes'), Validate.notes(text('notes'), 'Internal notes')],
    ])) return;
    if (!consignor) {
      // Duplicate detection for new consignors: same phone, email, or exact name
      const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
      const dup = DB.consignorList.find((c) =>
        (phone && norm(c.phone) === norm(phone)) || (email && norm(c.email) === norm(email)) || norm(c.full_name) === norm(consignorText));
      if (dup) {
        Validate.show(form, [[field('consignor'), `Possible duplicate: "${this.consignorOption(dup)}" already exists. Pick them from the consignor list instead.`]]);
        return;
      }
    }

    const btn = form.querySelector('button[type="submit"]');
    let newCode = null;
    const ok = await this.save(btn, null, async () => {
      if (!consignor) {
        const { data, error } = await sbClient.from('consignors')
          .insert({ full_name: consignorText, phone: phone || null, email: email || null })
          .select('id').single();
        if (error) throw error;
        consignor = { id: data.id };
      }
      const asking = Number(text('asking')) || null;
      const { data, error } = await sbClient.from('consignment_items').insert({
        consignor_id: consignor.id,
        brand,
        model: text('model') || null,
        category: text('category') || null,
        inquiry_channel: text('channel') || null,
        inquiry_notes: text('notes') || null,
        asking_price: asking,
      }).select('id, item_code').single();
      if (error) throw error;
      newCode = data.item_code;
      this.selected.preintake = data.id;
    });
    if (ok) showToast(`Inquiry ${newCode} created. Set its lead status when you have qualified it.`);
  },

  // =========================================================== INTAKE (7-9)
  renderIntake() {
    const queue = DB.pipelineItems.filter((i) => INTAKE_STAGES.includes(i.stage));
    if (this.selected.intake && !queue.some((i) => i.id === this.selected.intake)) this.selected.intake = null;
    const sel = this.item(this.selected.intake);
    const editable = this.canEdit();

    return `
      <h1 class="page-title" style="margin-bottom:4px;">Intake & Agreements</h1>
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">Receiving Queue (${queue.length})</div>
        ${this.queueTable(queue, this.selected.intake, [
          ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
          ['Consignor & Item', (i) => `<div style="font-weight:600;">${escapeHtml(i.consignor.full_name)}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(this.itemName(i))}</div>`],
          ['Arrival', (i) => `${escapeHtml(FULFILLMENT_METHODS[i.fulfillment] || '—')}<div class="cell-muted" style="font-size:11.5px;">${escapeHtml(this.fmtDate(i.appointmentAt))}</div>`],
          ['Agreed Payout', (i) => this.peso(i.agreedPayout)],
          ['Stage', (i) => this.stageBadge(i.stage) + (this.isDetailsRevision(i) ? `<div>${badge('Details revision', 'danger')}</div>` : '')],
        ], 'No items waiting to be received.')}
      </div>
      ${sel ? this.renderIntakePanel(sel, editable) : ''}`;
  },

  /** Returned by the manager for item-details corrections (already authenticated, sitting at Receiving). */
  isDetailsRevision(i) {
    return i.stage === 'arrivals_receiving' && !!(i.auth && i.auth.final_result);
  },

  receivingChecks(i) {
    return [
      [!!i.consignor.id_verified, 'Consignor government ID verified'],
      [!!i.agreementId, 'Consignment agreement signed'],
      [i.accessories.length > 0, 'Accessories recorded'],
      [!!i.serial, 'Serial number recorded'],
      [this.photoCount(i) === 10, `Required photos (${this.photoCount(i)}/10)`],
    ];
  },

  renderIntakePanel(i, editable) {
    const dis = editable ? '' : 'disabled';
    const c = i.consignor;
    const atDoor = i.stage === 'dropoff_pickup_courier';
    const checks = this.receivingChecks(i);
    const ready = checks.every(([ok]) => ok);
    const revision = this.isDetailsRevision(i);
    const lockDetails = !atDoor && !revision; // after receiving, details only reopen for a manager's revision request
    const review = revision ? (i.managerReviews || [])[0] : null;

    return `
      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:6px;">${escapeHtml(i.code)} · ${escapeHtml(this.itemName(i))}</div>
          <div style="margin-bottom:14px;">${this.stageBadge(i.stage)}</div>
          ${revision ? `<div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:8px; padding:10px; font-size:12.5px; margin-bottom:14px;">
            <strong style="color:var(--danger-red);">The manager asked for item details to be corrected</strong>${review && review.notes ? `: ${escapeHtml(review.notes)}` : '.'}
            Fix the details below, save, then send it back to the manager.</div>` : ''}

          <h3 style="font-size:14px; margin:0 0 8px;">1. Consignor Identity</h3>
          <div style="font-size:12.5px; margin-bottom:8px;">${escapeHtml(c.full_name)}${c.phone ? ` · ${escapeHtml(c.phone)}` : ''}${c.email ? ` · ${escapeHtml(c.email)}` : ''}</div>
          ${c.id_verified ? `<div style="font-size:12.5px; color:var(--green); margin-bottom:14px;">✓ Verified with ${escapeHtml(ID_TYPES[c.id_type] || 'government ID')} on ${escapeHtml(this.fmtDate(c.verified_at))}</div>` : `
          <div class="section-grid">
            <div class="field-group col-wide">
              <label class="field-label">Government ID Type</label>
              <select class="field-input" id="int-id-type" ${dis}>
                ${Object.entries(ID_TYPES).map(([v, l]) => `<option value="${v}" ${c.id_type === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="field-group col-wide">
              <label class="field-label">ID Photo (JPG, PNG or PDF)</label>
              <input class="field-input" type="file" id="int-id-file" accept="image/jpeg,image/png,image/webp,application/pdf" ${dis}>
            </div>
          </div>
          ${editable ? '<button class="btn-secondary" id="int-verify-id" style="margin-bottom:14px;">Upload</button>' : ''}`}

          <h3 style="font-size:14px; margin:6px 0 8px;">2. Item Details</h3>
          ${lockDetails ? '<p class="cell-muted" style="font-size:12px;">Details are locked after receiving.</p>' : ''}
          <form id="int-details-form">
            <div class="section-grid">
              ${this.inputField('brand', 'Brand', i.brand, dis || (lockDetails ? 'disabled' : ''), true)}
              ${this.inputField('model', 'Model', i.model, dis || (lockDetails ? 'disabled' : ''))}
              ${this.inputField('color', 'Color', i.color, dis || (lockDetails ? 'disabled' : ''))}
            </div>
            <div class="section-grid">
              <div class="field-group col-wide"><label class="field-label">Category</label>
                <select class="field-input" name="category" ${dis || (lockDetails ? 'disabled' : '')}>
                  ${ITEM_CATEGORIES.map((cat) => `<option ${i.category === cat ? 'selected' : ''}>${cat}</option>`).join('')}
                  ${i.category && !ITEM_CATEGORIES.includes(i.category) ? `<option selected>${escapeHtml(i.category)}</option>` : ''}
                </select>
              </div>
              ${this.inputField('hardware', 'Hardware', i.hardware, dis || (lockDetails ? 'disabled' : ''))}
            </div>
            <div class="section-grid">
              ${this.inputField('serial', 'Serial Number', i.serial, dis || (lockDetails ? 'disabled' : ''), false, 'e.g. SN-01234567')}
              ${this.inputField('microchip', 'Microchip Number', i.microchip, dis || (lockDetails ? 'disabled' : ''))}
              ${this.inputField('dateCode', 'Date Code', i.dateCode, dis || (lockDetails ? 'disabled' : ''))}
            </div>
            <div class="field-group">
              <label class="field-label">Condition Notes (exterior, interior, hardware)</label>
              <textarea class="field-input" name="conditionNotes" rows="2" ${dis || (lockDetails ? 'disabled' : '')}>${escapeHtml(i.conditionNotes)}</textarea>
            </div>
            <div class="field-group">
              <label class="field-label">Accessories Included</label>
              <div id="int-accessories" style="display:flex; gap:14px; flex-wrap:wrap; margin-top:4px;">
                ${ACCESSORY_OPTIONS.map((a) => `<label style="font-size:13px; display:flex; gap:6px; align-items:center;"><input type="checkbox" name="acc" value="${a}" ${i.accessories.includes(a) ? 'checked' : ''} ${dis || (lockDetails ? 'disabled' : '')}> ${a}</label>`).join('')}
                <label style="font-size:13px; display:flex; gap:6px; align-items:center;"><input type="checkbox" name="acc" value="None" ${i.accessories.includes('None') ? 'checked' : ''} ${dis || (lockDetails ? 'disabled' : '')}> None</label>
              </div>
            </div>
            ${editable && !lockDetails ? '<button type="submit" class="btn-secondary">Save Item Details</button>' : ''}
          </form>

          <h3 style="font-size:14px; margin:18px 0 8px;">3. Required Photos</h3>
          ${this.renderPhotoGrid(i, editable && atDoor)}

          <h3 style="font-size:14px; margin:18px 0 8px;">4. Consignment Agreement & E-Signature</h3>
          ${i.agreementId ? this.renderSignedAgreement(i, editable && atDoor) : `
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; font-size:12px; color:#475569; margin-bottom:8px;">
            <strong>Key terms</strong> (official policy text to follow from the client): 60-day consignment from the publish date, extendable by mutual agreement ·
            ₱2,500 pull-out fee if withdrawn within 60 days of posting · payout 1–14 banking days after the sale, less applicable fees ·
            layaway at 1% per month up to 3 months for items ₱200,000 and above.
          </div>
          ${editable ? this.renderSignatureUpload() : '<p class="cell-muted" style="font-size:12px;">Waiting for the consignor\'s signature.</p>'}`}
        </div>

        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">5. Receive Item</div>
          ${this.checklistHtml(checks)}
          ${atDoor && editable ? `<button class="btn-confirm" id="int-receive" style="width:100%; margin-top:12px;${ready ? '' : ' opacity:.5; cursor:not-allowed;'}" ${ready ? '' : 'disabled'}>Receive Item</button>` : ''}
          ${!atDoor ? '<div style="font-size:12.5px; color:var(--green); margin-top:8px;">✓ Received</div>' : ''}

          ${revision ? `
          <div class="card-title" style="margin:20px 0 10px;">Details Revision</div>
          <div style="font-size:12.5px; margin-bottom:8px;">Authentication: ${this.authCell(i)} · photos already approved.</div>
          ${editable ? '<button class="btn-confirm" id="int-revision-done" style="width:100%;">Send Back to Manager</button><small class="cell-muted">Save the corrected details first.</small>' : ''}` : `
          <div class="card-title" style="margin:20px 0 10px;">6. Authentication Payment</div>
          ${this.renderPaymentSection(i, editable)}`}
          <button class="btn-secondary" id="int-history" style="width:100%; margin-top:16px;">View Activity Log</button>
        </div>
      </div>`;
  },

  inputField(name, label, value, dis, required, placeholder) {
    return `<div class="field-group col-wide"><label class="field-label">${label}</label>
      <input class="field-input" name="${name}" value="${escapeHtml(value || '')}" ${required ? 'required' : ''} ${dis || ''} ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}></div>`;
  },

  suggestedFee(i) {
    const b = (i.brand || '').toLowerCase();
    if (b.includes('hermes') || b.includes('hermès')) return 'entrupy/hermes_premium';
    return 'entrupy/standard';
  },

  renderPaymentSection(i, editable) {
    if (i.stage === 'dropoff_pickup_courier') return '<p class="cell-muted" style="font-size:12px;">Available after the item is received.</p>';
    if (i.stage === 'arrivals_receiving') {
      const suggested = this.suggestedFee(i);
      return `
        <div class="field-group">
          <label class="field-label">Authentication Service & Fee</label>
          <select class="field-input" id="int-fee" ${editable ? '' : 'disabled'}>
            ${DB.authFeeSchedule.map((f) => {
              const key = `${f.provider}/${f.category}`;
              return `<option value="${key}" ${key === suggested ? 'selected' : ''}>${escapeHtml(FEE_LABELS[key] || key)} — ${this.peso(f.fee)}</option>`;
            }).join('')}
          </select>
          <small class="cell-muted">Non-refundable and paid upfront. The fee is based on the selected provider and service.</small>
        </div>
        ${editable ? '<button class="btn-confirm" id="int-request-payment" style="width:100%;">Request Authentication Payment</button>' : ''}`;
    }
    // authentication_payment
    const a = i.auth || {};
    return `
      <div style="font-size:12.5px; margin-bottom:8px;">${escapeHtml(FEE_LABELS[`${a.provider}/${a.category}`] || a.provider || '—')}: <strong>${this.peso(a.fee)}</strong></div>
      <div style="text-align:center; border:1px dashed #CBD5E1; border-radius:8px; padding:10px; margin-bottom:8px; font-size:12px;">
        Customer pays through QR PH (GCash, Maya or bank app).<br>Enter the reference number from their receipt.
      </div>
      <div class="field-group">
        <label class="field-label">QR PH Reference Number</label>
        <input class="field-input" id="int-pay-ref" placeholder="e.g. QPH-992019203" ${editable ? '' : 'disabled'}>
      </div>
      ${editable ? '<button class="btn-confirm" id="int-confirm-payment" style="width:100%;">Confirm Payment</button>' : ''}
      <small class="cell-muted">Confirming moves the item to the authentication queue and starts the 24-hour timer.</small>`;
  },

  bindIntake() {
    this.bindQueueSelect('intake');
    const i = this.item(this.selected.intake);
    if (!i) return;
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => fn(el)); };

    if (i.stage === 'dropoff_pickup_courier') this.bindPhotoUploads(i);
    else this.fillPhotos('intake-photos');
        this.bindSignatureUpload(i);

    on('int-history', () => this.showHistory(i));

    on('int-verify-id', (btn) => {
      const file = document.getElementById('int-id-file').files[0];
      const idType = document.getElementById('int-id-type').value;
      if (Validate.show(null, [[document.getElementById('int-id-file'), this.checkFile(file, true)]])) return;
      this.save(btn, 'Consignor ID verified.', async () => {
        const path = `${i.consignor.id}/id-${Date.now()}.${this.extOf(file)}`;
        const up = await sbClient.storage.from('consignor-ids').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        const { data, error } = await sbClient.from('consignors').update({
          id_type: idType, id_photo_path: path, id_verified: true,
          verified_by: Session.currentUser.uid, verified_at: new Date().toISOString(),
        }).eq('id', i.consignor.id).select('id');
        if (error) throw error;
        if (!data || !data.length) throw new Error('Your role is not allowed to verify consignors.');
      });
    });

    const form = document.getElementById('int-details-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const t = (k) => String(fd.get(k) || '').trim() || null;
        let acc = fd.getAll('acc');
        const serial = t('serial');
        const microchip = t('microchip');
        const field = (name) => form.querySelector(`[name="${name}"]`);
        if (Validate.show(form, [
          [field('brand'), Validate.itemText(t('brand'), 'Brand', true)],
          [field('model'), Validate.itemText(t('model'), 'Model')],
          [field('color'), Validate.itemText(t('color'), 'Color')],
          [field('hardware'), Validate.itemText(t('hardware'), 'Hardware')],
          [field('serial'), Validate.code(serial, 'Serial number')],
          [field('microchip'), Validate.code(microchip, 'Microchip number')],
          [field('dateCode'), Validate.itemText(t('dateCode'), 'Date code')],
          [field('conditionNotes'), Validate.notes(t('conditionNotes'), 'Condition notes')],
          [document.getElementById('int-accessories'), acc.includes('None') && acc.length > 1 ? 'Untick "None" when accessories are included.' : null],
        ])) return;
        const norm = (s) => String(s || '').trim().toLowerCase();
        const dupOf = (code) => code && DB.pipelineItems.find((o) => o.id !== i.id && (norm(o.serial) === norm(code) || norm(o.microchip) === norm(code)));
        const dupSerial = dupOf(serial);
        const dupChip = dupOf(microchip);
        const dupMsg = (d) => d && `Possible duplicate: ${d.code} (${this.itemName(d)}) already has this serial or microchip number.`;
        if (Validate.show(form, [[field('serial'), dupMsg(dupSerial)], [field('microchip'), dupMsg(dupChip)]])) return;
        this.save(form.querySelector('button[type="submit"]'), 'Item details saved.', () => this.updateItem(i.id, {
          brand: t('brand'), model: t('model'), color: t('color'), category: t('category'), hardware: t('hardware'),
          serial_number: serial, microchip_number: microchip, date_code: t('dateCode'),
          condition_notes: t('conditionNotes'), accessories_included: acc.length ? acc.join(', ') : null,
        }));
      });
    }

    on('int-revision-done', (btn) => {
      this.save(btn, `${i.code} sent back to the manager for approval.`, () => this.updateItem(i.id, { current_stage: 'manager_approval' }));
    });

    on('int-receive', (btn) => {
      this.save(btn, `${i.code} received. Next: request the authentication payment.`, () =>
        this.updateItem(i.id, { current_stage: 'arrivals_receiving' }));
    });

    on('int-request-payment', (btn) => {
      const [provider, category] = document.getElementById('int-fee').value.split('/');
      this.save(btn, 'Payment requested. Enter the QR PH reference once the customer has paid.', async () => {
        if (!i.auth) {
          const { error } = await sbClient.from('authentication_records').insert({ item_id: i.id, provider, category });
          if (error) throw error;
        }
        await this.updateItem(i.id, { current_stage: 'authentication_payment' });
      });
    });

    on('int-confirm-payment', (btn) => {
      const refEl = document.getElementById('int-pay-ref');
      const ref = refEl.value.trim();
      if (Validate.show(null, [[refEl, Validate.code(ref, 'QR PH reference number', true)]])) return;
      this.save(btn, `Payment confirmed. ${i.code} is now in the authentication queue.`, async () => {
        const { data, error } = await sbClient.from('authentication_records')
          .update({ payment_status: 'confirmed', payment_reference: ref }).eq('item_id', i.id).select('id');
        if (error) throw error;
        if (!data || !data.length) throw new Error('Your role is not allowed to confirm payments.');
      });
    });
  },
};
