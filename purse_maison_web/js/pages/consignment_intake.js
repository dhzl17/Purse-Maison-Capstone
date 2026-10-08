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

const LEAD_STATUSES = {
  new: 'New', qualified: 'Qualified', need_more_photos: 'Need More Photos',
  negotiation: 'Negotiation', rejected: 'Rejected', cancelled: 'Cancelled',
};
const FULFILLMENT_METHODS = { walk_in: 'Walk-in', drop_off: 'Drop-off', pickup: 'Pickup', courier: 'Courier' };
const ID_TYPES = {
  passport: 'Passport', drivers_license: "Driver's License", umid: 'UMID', prc_id: 'PRC ID', philsys_id: 'PhilSys National ID',
};
const INTAKE_PHOTO_TYPES = {
  front: 'Front', back: 'Back', side_left: 'Left side', side_right: 'Right side', underside: 'Bottom / underside',
  inside: 'Inside', serial_number: 'Serial number', date_code: 'Date code', hardware: 'Hardware', accessories: 'Accessories',
};
const OPTIONAL_INTAKE_PHOTOS = { microchip: 'Microchip (if present)' };
const ACCESSORY_OPTIONS = ['Dust bag', 'Box', 'Lock', 'Keys', 'Strap', 'Receipt'];
const ITEM_CATEGORIES = ['Handbag', 'Shoulder Bag', 'Tote', 'Crossbody', 'Backpack', 'Clutch', 'Small Leather Goods', 'Wallet', 'Shoes', 'Belt', 'Accessory'];
const FEE_LABELS = {
  'entrupy/standard': 'Entrupy — Standard',
  'entrupy/hermes_premium': 'Entrupy — Hermès premium',
  'legitgrail/footwear_standard': 'LegitGrail — Footwear & standard (existing Entrupy cert)',
  'legitgrail/chanel_hermes_premium': 'LegitGrail — Chanel & Hermès premium',
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ConsignmentFlow = {
  selected: { preintake: null, intake: null },
  overviewSearch: '',
  overviewSort: 'recently',
  overviewStage: 'all',
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

  /** Turns database errors into messages staff can act on. */
  friendly(err) {
    const msg = (err && (err.message || err.error_description)) || 'Unknown error';
    if (/duplicate key/i.test(msg)) {
      if (/serial_number/i.test(msg)) return 'Another item already has this serial number.';
      if (/microchip/i.test(msg)) return 'Another item already has this microchip number.';
      if (/barcode/i.test(msg)) return 'Another item already has this barcode.';
      return 'This record already exists.';
    }
    if (/row-level security|permission denied/i.test(msg)) return 'Your role is not allowed to make this change.';
    return msg;
  },

  /** Runs a save, shows the result, reloads the pipeline and redraws. Returns true on success. */
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

  /** Fills <img data-photo-path> elements with short-lived signed links (the buckets are private). */
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

  renderPhotoGrid(item, editable) {
    const slot = (type, label, optional) => {
      const path = item.photos[type];
      return `
        <div class="photo-slot-card" style="border:1px solid #E2E8F0; padding:8px; border-radius:6px; text-align:center;">
          <div style="font-size:11.5px; font-weight:600;">${escapeHtml(label)}${optional ? ' <span class="cell-muted">(optional)</span>' : ''}</div>
          <div class="photo-preview-box" style="margin:6px 0; height:90px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:6px; overflow:hidden;">
            ${path ? `<img data-photo-bucket="intake-photos" data-photo-path="${escapeHtml(path)}" alt="${escapeHtml(label)}" style="max-width:100%; max-height:90px; object-fit:contain;">` : ''}
          </div>
          <div style="font-size:11px; font-weight:600; color:${path ? 'var(--green)' : (optional ? 'var(--text-muted)' : 'var(--danger-red)')};">${path ? 'Uploaded' : 'Missing'}</div>
          ${editable ? `
            <label class="btn-secondary" style="display:inline-block; margin-top:6px; padding:3px 8px; font-size:11px; cursor:pointer;">
              ${path ? 'Replace' : 'Upload'}
              <input type="file" accept="image/jpeg,image/png,image/webp" data-photo-upload="${type}" style="display:none;">
            </label>` : ''}
        </div>`;
    };
    return `
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:8px;">
        ${Object.entries(INTAKE_PHOTO_TYPES).map(([t, l]) => slot(t, l, false)).join('')}
        ${Object.entries(OPTIONAL_INTAKE_PHOTOS).map(([t, l]) => slot(t, l, true)).join('')}
      </div>
      <div style="font-size:12.5px; margin-top:8px; font-weight:600; color:${this.photoCount(item) === 10 ? 'var(--green)' : 'var(--danger-red)'};">
        ${this.photoCount(item)} / 10 required photos uploaded
      </div>`;
  },

  bindPhotoUploads(item) {
    document.querySelectorAll('[data-photo-upload]').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const label = INTAKE_PHOTO_TYPES[input.dataset.photoUpload] || OPTIONAL_INTAKE_PHOTOS[input.dataset.photoUpload];
        input.closest('label').firstChild.textContent = 'Uploading… ';
        await this.save(null, `${label} photo uploaded.`, () => this.uploadIntakePhoto(item, input.dataset.photoUpload, file));
      });
    });
    this.fillPhotos('intake-photos');
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
    if (this.overviewStage !== 'all') list = list.filter((i) => i.stage === this.overviewStage);
    const priceOf = (i) => i.price ?? i.askingPrice ?? 0;
    if (this.overviewSort === 'oldest') list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (this.overviewSort === 'alphabetical') list.sort((a, b) => this.itemName(a).localeCompare(this.itemName(b)));
    else if (this.overviewSort === 'price-high') list.sort((a, b) => priceOf(b) - priceOf(a));
    else if (this.overviewSort === 'price-low') list.sort((a, b) => priceOf(a) - priceOf(b));
    else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const stagesPresent = STAGE_ORDER.filter((s) => DB.pipelineItems.some((i) => i.stage === s));
    const canStart = Session.canAccess('consignment-preintake');

    return `
      <h1 class="page-title">Consignment Management</h1>
      <div class="filter-toolbar-row">
        <div class="filter-controls-group">
          ${renderUniversalSearchBar('cons-overview-search', 'Search by Item ID, Brand, Serial #, Consignor, Stage...')}
          <select class="sort-select" id="cons-overview-stage">
            <option value="all">All stages</option>
            ${stagesPresent.map((s) => `<option value="${s}" ${this.overviewStage === s ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
          </select>
          <select class="sort-select" id="cons-overview-sort">
            ${[['recently', 'Recently Added'], ['oldest', 'Oldest First'], ['price-high', 'Price High to Low'], ['price-low', 'Price Low to High'], ['alphabetical', 'Alphabetical A-Z']]
              .map(([v, l]) => `<option value="${v}" ${this.overviewSort === v ? 'selected' : ''}>Sort by: ${l}</option>`).join('')}
          </select>
        </div>
        ${canStart ? '<button class="btn-add" id="cons-new-inquiry">+ New Inquiry</button>' : ''}
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th style="text-align:center;">Item ID</th><th style="text-align:center;">Brand</th><th style="text-align:center;">Details</th>
            <th style="text-align:center;">Consignor</th><th style="text-align:center;">Stage</th><th style="text-align:center;">Authentication</th>
            <th style="text-align:center;">Price</th><th style="text-align:center;">Last Update</th><th style="text-align:center;">History</th>
          </tr></thead>
          <tbody>
            ${list.length === 0 ? `<tr><td colspan="9" class="cell-muted" style="text-align:center; padding:24px;">${DB.pipelineItems.length ? 'No items match your search.' : 'No consignment items yet.'}</td></tr>` :
              list.map((i) => `
              <tr style="text-align:center; vertical-align:middle;">
                <td><strong>${escapeHtml(i.code)}</strong></td>
                <td class="cell-bold">${escapeHtml(i.brand)}</td>
                <td style="text-align:left;">
                  <div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div>
                  <div class="cell-muted" style="font-size:11.5px;">${escapeHtml(i.category || '—')}${i.serial ? ` · SN ${escapeHtml(i.serial)}` : ''}</div>
                </td>
                <td>${escapeHtml(i.consignor.full_name)}</td>
                <td>${this.stageBadge(i.stage)}</td>
                <td>${this.authCell(i)}</td>
                <td class="cell-bold">${i.price != null ? this.peso(i.price) : (i.askingPrice != null ? `<span class="cell-muted">Asking ${this.peso(i.askingPrice)}</span>` : '—')}</td>
                <td style="font-size:12px;">${escapeHtml(this.fmtDate(i.updatedAt))}</td>
                <td><button class="icon-btn" data-history="${i.id}" title="View activity log"><i class="fa-solid fa-clock-rotate-left"></i></button></td>
              </tr>`).join('')}
          </tbody>
        </table>
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
        Router.rerender();
        const s = document.getElementById('cons-overview-search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }, 300));
    }
    const sort = document.getElementById('cons-overview-sort');
    if (sort) sort.addEventListener('change', (e) => { this.overviewSort = e.target.value; Router.rerender(); });
    const stage = document.getElementById('cons-overview-stage');
    if (stage) stage.addEventListener('change', (e) => { this.overviewStage = e.target.value; Router.rerender(); });
    const add = document.getElementById('cons-new-inquiry');
    if (add) add.addEventListener('click', () => Router.navigate('consignment-preintake'));
    document.querySelectorAll('[data-history]').forEach((btn) => {
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
      <p class="cell-muted" style="margin:0 0 16px;">Stages 1–7: inquiry, lead qualification, initial photos, negotiation, approval and scheduling.</p>

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
              <label class="field-label">Consignor (type to search existing, or enter a new name)</label>
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
            <div class="field-group col-wide"><label class="field-label">Phone (new consignor)</label><input class="field-input" name="phone" placeholder="e.g. 0917 123 4567"></div>
            <div class="field-group col-wide"><label class="field-label">Email (new consignor)</label><input class="field-input" name="email" type="email" placeholder="for the consignor portal"></div>
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
          <button type="submit" class="btn-confirm">Create Inquiry</button>
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
      initial_photo_submission: ['price_negotiation', 'Photos Complete → Negotiation'],
      price_negotiation: ['consignment_approval', 'Send for Consignment Approval'],
      consignment_approval: ['appointment_scheduling', 'Approve Consignment'],
      appointment_scheduling: ['dropoff_pickup_courier', 'Mark In Transit to Receiving'],
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
        <small class="cell-muted">Qualified moves the item to Initial Photos; Negotiation to Price Negotiation; Rejected or Cancelled closes it.</small>
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
      ${editable && i.stage === 'consignment_approval' ? '<button class="btn-secondary" id="pre-not-approved" style="width:100%; margin-top:6px; color:var(--danger-red);">Not Approved (close)</button>' : ''}
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
      if (!asking && !counter) return showToast('Enter an asking price or a counteroffer.');
      this.save(btn, 'Negotiation logged.', async () => {
        const { error } = await sbClient.from('price_negotiations').insert({ item_id: i.id, asking_price: asking, counter_offer: counter, notes });
        if (error) throw error;
      });
    });
    on('neg-save-payout', (btn) => {
      const v = Number(document.getElementById('neg-payout').value);
      if (!(v > 0)) return showToast('Enter the agreed payout amount.');
      this.save(btn, 'Agreed payout saved.', () => this.updateItem(i.id, { agreed_payout: v }));
    });
    on('pre-save-appointment', (btn) => {
      const method = document.getElementById('pre-fulfillment').value || null;
      const when = document.getElementById('pre-appointment').value;
      if (!method) return showToast('Choose a fulfillment method.');
      if (!when) return showToast('Choose the appointment date and time.');
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
    if (!consignorText || !brand) return showToast('Consignor and brand are required.');
    const phone = text('phone');
    const email = text('email').toLowerCase();

    // Existing consignor picked from the list?
    let consignor = DB.consignorList.find((c) => this.consignorOption(c) === consignorText);
    if (!consignor) {
      // Duplicate detection for new consignors: same phone, email, or exact name
      const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
      const dup = DB.consignorList.find((c) =>
        (phone && norm(c.phone) === norm(phone)) || (email && norm(c.email) === norm(email)) || norm(c.full_name) === norm(consignorText));
      if (dup) {
        return showToast(`Possible duplicate: "${this.consignorOption(dup)}" already exists. Pick them from the consignor list instead.`);
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
      <p class="cell-muted" style="margin:0 0 16px;">Stages 8–9: verify the consignor, record the item, sign the agreement, receive it, and confirm the authentication fee.</p>
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">Receiving Queue (${queue.length})</div>
        ${this.queueTable(queue, this.selected.intake, [
          ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
          ['Consignor & Item', (i) => `<div style="font-weight:600;">${escapeHtml(i.consignor.full_name)}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(this.itemName(i))}</div>`],
          ['Arrival', (i) => `${escapeHtml(FULFILLMENT_METHODS[i.fulfillment] || '—')}<div class="cell-muted" style="font-size:11.5px;">${escapeHtml(this.fmtDate(i.appointmentAt))}</div>`],
          ['Agreed Payout', (i) => this.peso(i.agreedPayout)],
          ['Stage', (i) => this.stageBadge(i.stage)],
        ], 'No items waiting to be received. Items appear here once marked In Transit on Inquiries & Pre-Intake.')}
      </div>
      ${sel ? this.renderIntakePanel(sel, editable) : ''}`;
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
    const lockDetails = !atDoor; // the database re-checks receiving rules on every change once received

    return `
      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:6px;">${escapeHtml(i.code)} · ${escapeHtml(this.itemName(i))}</div>
          <div style="margin-bottom:14px;">${this.stageBadge(i.stage)}</div>

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
          ${editable ? '<button class="btn-secondary" id="int-verify-id" style="margin-bottom:14px;">Upload ID & Mark Verified</button>' : ''}`}

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
              ${this.inputField('serial', 'Serial Number', i.serial, dis || (lockDetails ? 'disabled' : ''), false, 'Required to receive')}
              ${this.inputField('microchip', 'Microchip Number', i.microchip, dis || (lockDetails ? 'disabled' : ''))}
              ${this.inputField('dateCode', 'Date Code', i.dateCode, dis || (lockDetails ? 'disabled' : ''))}
            </div>
            <div class="field-group">
              <label class="field-label">Condition Notes (exterior, interior, hardware)</label>
              <textarea class="field-input" name="conditionNotes" rows="2" ${dis || (lockDetails ? 'disabled' : '')}>${escapeHtml(i.conditionNotes)}</textarea>
            </div>
            <div class="field-group">
              <label class="field-label">Accessories Included</label>
              <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:4px;">
                ${ACCESSORY_OPTIONS.map((a) => `<label style="font-size:13px; display:flex; gap:6px; align-items:center;"><input type="checkbox" name="acc" value="${a}" ${i.accessories.includes(a) ? 'checked' : ''} ${dis || (lockDetails ? 'disabled' : '')}> ${a}</label>`).join('')}
                <label style="font-size:13px; display:flex; gap:6px; align-items:center;"><input type="checkbox" name="acc" value="None" ${i.accessories.includes('None') ? 'checked' : ''} ${dis || (lockDetails ? 'disabled' : '')}> None</label>
              </div>
            </div>
            ${editable && !lockDetails ? '<button type="submit" class="btn-secondary">Save Item Details</button>' : ''}
          </form>

          <h3 style="font-size:14px; margin:18px 0 8px;">3. Required Photos</h3>
          ${this.renderPhotoGrid(i, editable && !lockDetails)}

          <h3 style="font-size:14px; margin:18px 0 8px;">4. Consignment Agreement & E-Signature</h3>
          ${i.agreementId ? `<div style="font-size:12.5px; color:var(--green);">✓ Signed on ${escapeHtml(this.fmtDate(i.agreementSignedAt))}</div>` : `
          <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; font-size:12px; color:#475569; margin-bottom:8px;">
            <strong>Key terms</strong> (official policy text to follow from the client): 60-day consignment from the publish date, extendable by mutual agreement ·
            ₱2,500 pull-out fee if withdrawn within 60 days of posting · payout 1–14 banking days after the sale, less applicable fees ·
            layaway at 1% per month up to 3 months for items ₱200,000 and above.
          </div>
          ${editable ? `
          <div class="signature-container" style="position:relative; border:1px dashed #ccc; background:#fafafa; border-radius:8px;">
            <canvas id="signature-pad" width="600" height="160" style="touch-action:none; cursor:crosshair; width:100%; height:160px;"></canvas>
            <button type="button" id="clear-signature-btn" style="position:absolute; top:10px; right:10px; padding:4px 10px; font-size:12px;">Clear</button>
          </div>
          <button class="btn-secondary" id="int-sign" style="margin-top:8px;">Save Signed Agreement</button>` : ''}`}
        </div>

        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">5. Receive Item</div>
          ${this.checklistHtml(checks)}
          ${atDoor && editable ? `<button class="btn-confirm" id="int-receive" style="width:100%; margin-top:12px;${ready ? '' : ' opacity:.5; cursor:not-allowed;'}" ${ready ? '' : 'disabled'}>Receive Item</button>` : ''}
          ${atDoor && !ready ? '<small class="cell-muted">Receive Item unlocks when every line above is ticked.</small>' : ''}
          ${!atDoor ? '<div style="font-size:12.5px; color:var(--green); margin-top:8px;">✓ Received</div>' : ''}

          <div class="card-title" style="margin:20px 0 10px;">6. Authentication Payment</div>
          ${this.renderPaymentSection(i, editable)}
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
          <label class="field-label">Provider & Fee</label>
          <select class="field-input" id="int-fee" ${editable ? '' : 'disabled'}>
            ${DB.authFeeSchedule.map((f) => {
              const key = `${f.provider}/${f.category}`;
              return `<option value="${key}" ${key === suggested ? 'selected' : ''}>${escapeHtml(FEE_LABELS[key] || key)} — ${this.peso(f.fee)}</option>`;
            }).join('')}
          </select>
          <small class="cell-muted">Non-refundable, paid upfront. The database sets the fee from the schedule.</small>
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
    if (document.getElementById('signature-pad') && typeof initSignaturePad === 'function') initSignaturePad();

    on('int-history', () => this.showHistory(i));

    on('int-verify-id', (btn) => {
      const file = document.getElementById('int-id-file').files[0];
      const idType = document.getElementById('int-id-type').value;
      const problem = this.checkFile(file, true);
      if (problem) return showToast(problem);
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
        if (acc.includes('None') && acc.length > 1) return showToast('Untick "None" when accessories are included.');
        const serial = t('serial');
        const microchip = t('microchip');
        const norm = (s) => String(s || '').trim().toLowerCase();
        const dup = DB.pipelineItems.find((o) => o.id !== i.id && (
          (serial && (norm(o.serial) === norm(serial) || norm(o.microchip) === norm(serial))) ||
          (microchip && (norm(o.microchip) === norm(microchip) || norm(o.serial) === norm(microchip)))));
        if (dup) return showToast(`Possible duplicate: ${dup.code} (${this.itemName(dup)}) already has this serial or microchip number.`);
        this.save(form.querySelector('button[type="submit"]'), 'Item details saved.', () => this.updateItem(i.id, {
          brand: t('brand'), model: t('model'), color: t('color'), category: t('category'), hardware: t('hardware'),
          serial_number: serial, microchip_number: microchip, date_code: t('dateCode'),
          condition_notes: t('conditionNotes'), accessories_included: acc.length ? acc.join(', ') : null,
        }));
      });
    }

    on('int-sign', (btn) => {
      const sig = window.getSignatureData ? window.getSignatureData() : null;
      if (!sig) return showToast('Ask the consignor to sign in the box first.');
      this.save(btn, 'Agreement signed and attached.', async () => {
        const { data, error } = await sbClient.from('consignment_agreements')
          .insert({ consignor_id: i.consignor.id, signature_data: sig }).select('id').single();
        if (error) throw error;
        await this.updateItem(i.id, { agreement_id: data.id });
      });
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
      const ref = document.getElementById('int-pay-ref').value.trim();
      if (!ref) return showToast('Enter the QR PH reference number.');
      this.save(btn, `Payment confirmed. ${i.code} is now in the authentication queue.`, async () => {
        const { data, error } = await sbClient.from('authentication_records')
          .update({ payment_status: 'confirmed', payment_reference: ref }).eq('item_id', i.id).select('id');
        if (error) throw error;
        if (!data || !data.length) throw new Error('Your role is not allowed to confirm payments.');
      });
    });
  },
};
