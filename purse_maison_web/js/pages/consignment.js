function calculateMarkup(askingPrice, category = '') {
  const price = typeof askingPrice === 'number' ? askingPrice : parseAmountString(askingPrice);
  let markup = 0;
  let label = '';
  if (price <= 10000) {
    markup = 3000;
    label = '+₱3,000 (Flat)';
  } else if (price <= 20000) {
    markup = 6000;
    label = '+₱6,000 (Flat)';
  } else if (price <= 49000) {
    markup = 10000;
    label = '+₱10,000 (Flat)';
  } else if (price <= 99000) {
    markup = 13000;
    label = '+₱13,000 (Flat)';
  } else if (price <= 199000) {
    markup = 18000;
    label = '+₱18,000 (Flat)';
  } else {
    markup = Math.round(price * 0.12);
    label = '+12%';
  }
  const finalPrice = price + markup;
  return { price, markup, finalPrice, label };
}

function calculateAuthFee(provider, brand, category) {
  const b = (brand || '').toLowerCase();
  
  if (provider === 'Entrupy') {
    if (b.includes('hermès') || b.includes('hermes')) {
      return { fee: 8500, label: 'Hermès Premium Entrupy Fee' };
    }
    return { fee: 1800, label: 'Standard Entrupy Fee' };
  } 
  
  if (provider === 'LegitGrail') {
    if (b.includes('chanel') || b.includes('hermès') || b.includes('hermes')) {
      return { fee: 1800, label: 'Premium (Chanel & Hermès) Fee' };
    }
    return { fee: 1100, label: 'Footwear & Standard Fee' };
  }

  return { fee: 1800, label: 'Standard Fee' };
}

function renderSLABadge(createdAtMs, targetHours = 24) {
  if (!createdAtMs) return `<span class="badge badge-info">24h SLA</span>`;
  
  const elapsedMs = Date.now() - createdAtMs;
  const targetMs = targetHours * 60 * 60 * 1000;
  const remainingMs = targetMs - elapsedMs;

  if (remainingMs <= 0) {
    return `<span class="badge badge-danger" title="SLA Breached!"> SLA Overdue</span>`;
  }

  const hoursLeft = Math.floor(remainingMs / (1000 * 60 * 60));
  const minsLeft = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  
  const tone = hoursLeft < 4 ? 'danger' : (hoursLeft < 12 ? 'warning' : 'success');
  return `<span class="badge badge-${tone}">⏱ ${hoursLeft}h ${minsLeft}m SLA</span>`;
}

function checkDuplicateConsignment(serialNumber, microchipNumber, consignorName) {
  const sn = (serialNumber || '').trim().toLowerCase();
  const mc = (microchipNumber || '').trim().toLowerCase();
  const name = (consignorName || '').trim().toLowerCase();

  let duplicateSerial = null;
  let existingCustomer = null;

  if (sn) {
    duplicateSerial = DB.consignments.find(c => 
      (c.serialNumber && c.serialNumber.trim().toLowerCase() === sn) || 
      (c.microchipNumber && c.microchipNumber.trim().toLowerCase() === sn)
    );
    if (!duplicateSerial) {
      duplicateSerial = DB.inventory.find(i => 
        (i.serialNumber && i.serialNumber.trim().toLowerCase() === sn)
      );
    }
  }

  if (!duplicateSerial && mc) {
    duplicateSerial = DB.consignments.find(c => 
      (c.microchipNumber && c.microchipNumber.trim().toLowerCase() === mc) || 
      (c.serialNumber && c.serialNumber.trim().toLowerCase() === mc)
    );
  }

  if (name) {
    existingCustomer = DB.consignments.find(c => 
      c.consignorName && c.consignorName.trim().toLowerCase() === name
    ) || (DB.consignorClients && DB.consignorClients.find(cl => cl.name && cl.name.trim().toLowerCase() === name));
  }

  return { duplicateSerial, existingCustomer };
}

const ConsignmentPage = {
  showAll: false,
  searchKeyword: '',
  sortBy: 'recently',

  authBadge(status) {
    if (status === 'verified') return badge('Verified', 'success');
    if (status === 'rejected') return badge('Rejected', 'danger');
    return badge('Pending', 'warning');
  },

  doubleAuthBadge(primary, secondary) {
    if (primary === 'verified' && secondary === 'verified') {
      return `<span class="badge badge-success" title="Verified by Primary & Secondary authenticators">Verified</span>`;
    }
    if (primary === 'verified' || secondary === 'verified') {
      return `<span class="badge badge-info" title="1 of 2 Authentications complete">1/2 Verified</span>`;
    }
    if (primary === 'rejected' || secondary === 'rejected') {
      return `<span class="badge badge-danger" title="Rejected by Authenticator">Rejected</span>`;
    }
    return `<span class="badge badge-warning" title="Awaiting Double Authentication">Awaiting 2-Factor</span>`;
  },

  payoutBadge(status) {
    const map = { notYetSold: ['Not Yet Sold', 'warning'], sold: ['Sold', 'success'], cancelled: ['Cancelled', 'danger'] };
    const [label, tone] = map[status] || ['Pending', 'info'];
    return badge(label, tone);
  },

  filterAndSortConsignments(items) {
    let list = [...items];
    if (this.searchKeyword) {
      const kw = this.searchKeyword.toLowerCase();
      list = list.filter((i) => {
        return (
          String(i.id || '').toLowerCase().includes(kw) ||
          String(i.brand || '').toLowerCase().includes(kw) ||
          String(i.itemName || '').toLowerCase().includes(kw) ||
          String(i.serialNumber || '').toLowerCase().includes(kw) ||
          String(i.consignorName || '').toLowerCase().includes(kw)
        );
      });
    }
    return sortRecords(list, this.sortBy);
  },

  nextItemId() {
    let maxNum = 0;
    for (const item of DB.consignments) {
      const n = parseInt(item.id, 10);
      if (!isNaN(n)) maxNum = Math.max(maxNum, n);
    }
    return maxNum === 0 ? '1101' : String(maxNum + 1);
  },

  nextInquiryId() {
    let maxNum = 100;
    for (const item of DB.consignments) {
      if (item.id && String(item.id).startsWith('INQ-')) {
        const n = parseInt(String(item.id).replace('INQ-', ''), 10);
        if (!isNaN(n)) maxNum = Math.max(maxNum, n);
      }
    }
    return `INQ-${maxNum + 1}`;
  },

  render(route = 'consignment-overview') {
    switch (route) {
      case 'consignment-preintake':
        return this.renderPreIntakeView();
      case 'consignment-photo':
        return this.renderPhotographyView();
      case 'consignment-auth':
        return this.renderAuthenticationView();
      case 'consignment-design':
        return this.renderDesignView();
      case 'consignment-pricing':
        return this.renderPricingView();
      case 'consignment-intake':
        return this.renderIntakeView();
      case 'consignment-approval':
        return this.renderApprovalsView();
      case 'consignment-overview':
      case 'consignment':
      default:
        return this.renderOverviewView();
    }
  },

/* ==========================================================================
     SUBTAB 1: INQUIRIES & PRE-INTAKE 
     ========================================================================== */
  renderPreIntakeView() {
    const preItems = DB.consignments.filter(i => 
      i.status === 'Inquiry Received' || i.status === 'Pre-Intake Pending' || 
      i.status === 'In Transit to Receiving' || i.status === 'Qualified' ||
      String(i.id).startsWith('INQ-')
    );

    const selectedItem = window.activePreIntakeItemId
      ? DB.consignments.find(i => String(i.id) === String(window.activePreIntakeItemId))
      : (preItems.length > 0 ? preItems[preItems.length - 1] : null);

    return `
      <div style="margin-bottom:20px;">
        <h1 class="page-title" style="margin-bottom:4px;">Customer Inquiry</h1>
      
        <form id="preintake-capture-form">
          <div class="section-grid">
            <div class="field-group col-wide">
              <label class="field-label">Consignor Full Name</label>
              <input class="field-input" id="pre-consignor-name" placeholder="e.g. Maria Santos" required />
            </div>
            <div class="field-group col-wide">
              <label class="field-label">Inquiry Source Channel</label>
              <select class="field-input" id="pre-inquiry-channel">
                <option value="Instagram">Instagram DM</option>
                <option value="FB Messenger">FB Messenger</option>
                <option value="Website">Website Form</option>
                <option value="Walk-in">Showroom Walk-in</option>
                <option value="WhatsApp">WhatsApp</option>
                <option value="Phone">Phone Inquiry</option>
              </select>
            </div>
          </div>
          <div class="section-grid">
            <div class="field-group col-wide">
              <label class="field-label">Consignor Asking Price (₱)</label>
              <input class="field-input" id="pre-asking-price" type="number" placeholder="e.g. 150000" required />
            </div>
            <div class="field-group col-wide">
              <label class="field-label">Initial Photo Upload (Optional)</label>
              <input class="field-input" type="file" id="pre-initial-photos" accept="image/*" />
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">Internal Notes / Item Description</label>
            <textarea class="field-input" id="pre-inquiry-notes" rows="2" placeholder="e.g. Chanel Boy Bag in caviar leather, minor wear on corners..."></textarea>
          </div>
          <button type="submit" class="btn-confirm">Submit</button>
        </form>
      </div>

      <div class="section-grid">
        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:16px;">Pre-Intake Queue (${preItems.length})</div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr>
                <th>Lead ID</th><th>Consignor & Channel</th><th>Asking Price</th><th>Lead Status</th><th>Action</th>
              </tr></thead>
              <tbody>
                ${preItems.length === 0 ? '<tr><td colspan="5" class="cell-center cell-muted">No pending pre-intake inquiries.</td></tr>' :
                  preItems.map(item => `
                  <tr class="${selectedItem && String(selectedItem.id) === String(item.id) ? 'row-selected' : ''}">
                    <td><strong>${escapeHtml(item.id)}</strong></td>
                    <td>
                      <div style="font-weight:600;">${escapeHtml(item.consignorName || item.itemName)}</div>
                      <div class="cell-muted" style="font-size:11.5px;">${escapeHtml(item.contactChannel || 'Channel N/A')}</div>
                    </td>
                    <td>${escapeHtml(item.price)}</td>
                    <td><span class="badge badge-warning">${escapeHtml(item.status)}</span></td>
                    <td><button class="btn-add" data-preintake-select="${item.id}" data-item-id="${item.id}" style="padding:4px 8px; font-size:11px;">Select</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        ${selectedItem ? `
        <div class="card col-narrow">
          
          <div style="border-bottom:1px solid #E2E8F0; padding-bottom:12px; margin-bottom:12px;">
            <div style="font-weight:600; font-size:13px; color:var(--card-navy-dark);">${escapeHtml(selectedItem.consignorName || selectedItem.itemName)}</div>
            <div style="font-size:12px; color:var(--text-muted);">Asking: ${escapeHtml(selectedItem.price)} · Channel: ${escapeHtml(selectedItem.contactChannel || 'Direct')}</div>
          </div>

          <div class="field-group">
            <label class="field-label">Lead Qualification Status</label>
            <select class="field-input" id="pre-lead-status" data-item-id="${selectedItem.id}">
              <option value="Pre-Intake Pending" ${selectedItem.status === 'Pre-Intake Pending' ? 'selected' : ''}>Pre-Intake Pending</option>
              <option value="Qualified" ${selectedItem.status === 'Qualified' ? 'selected' : ''}>Qualified</option>
              <option value="Need More Photos" ${selectedItem.status === 'Need More Photos' ? 'selected' : ''}>Need More Photos</option>
              <option value="Rejected" ${selectedItem.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
            </select>
          </div>

          <!-- Price Negotiation Log (Step 4) -->
          <div class="field-group" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:10px; margin-bottom:12px;">
            <label class="field-label" style="font-weight:600; margin-bottom:6px;">Negotiation Log (Asking vs Counter)</label>
            <div style="display:flex; gap:6px; margin-bottom:6px;">
              <input class="field-input" id="pre-neg-asking" placeholder="Asking ₱" value="${escapeHtml(selectedItem.price || '')}" style="font-size:11.5px;" />
              <input class="field-input" id="pre-neg-counter" placeholder="Counter ₱" style="font-size:11.5px;" />
            </div>
            <button class="btn-secondary" id="btn-log-negotiation" data-item-id="${selectedItem.id}" style="width:100%; font-size:11px; padding:4px;">Submit</button>
            ${selectedItem.negotiationLog && selectedItem.negotiationLog.length > 0 ? `
              <div style="margin-top:8px; max-height:80px; overflow-y:auto; font-size:11px;">
                ${selectedItem.negotiationLog.map(n => `
                  <div style="border-bottom:1px dashed #E2E8F0; padding:2px 0; color:#475569;">
                    Asking: ₱${n.asking} | Counter: ₱${n.counter} <span style="color:#94A3B8">(${n.date})</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>

          
          <div class="field-group">
            <label class="field-label">Fulfillment / Receiving Method</label>
            <select class="field-input" id="pre-fulfillment-type">
              <option value="Showroom Walk-in">Showroom Walk-in</option>
              <option value="Drop-off">Drop-off at Hub</option>
              <option value="Courier Delivery">Courier / Express Delivery</option>
              <option value="Home Pickup">Home Pickup Service</option>
            </select>
          </div>

          <div class="field-group">
            <label class="field-label">Scheduled Receiving Date & Time</label>
            <input type="datetime-local" class="field-input" id="pre-appointment-date" />
          </div>

          <button class="btn-confirm" id="btn-schedule-fulfillment" data-item-id="${selectedItem.id}" style="width:100%; margin-top:8px;">Submit</button>
        </div>
        ` : ''}
      </div>
    `;
  },

/* ==========================================================================
     SUBTAB 2: PHOTOGRAPHY SUBTAB 
     ========================================================================== */
  renderPhotographyView() {
    const photoItems = DB.consignments.filter(i => 
      i.status === 'For Photography' || i.status === 'In Photography'
    );

    const selectedItem = window.activePhotoItemId 
      ? DB.consignments.find(i => String(i.id) === String(window.activePhotoItemId)) 
      : (photoItems.length > 0 ? photoItems[photoItems.length - 1] : null);

    return `
      <div style="margin-bottom:20px;">
        <h1 class="page-title" style="margin-bottom:4px;">Photography Tasks</h1>
        <div class="card-title" style="margin-bottom:16px;">
          <span>Items Pending Photography (${photoItems.length})</span>
        </div>

        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>Item ID</th><th>Brand & Item</th><th>Category</th><th>Condition</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody>
              ${photoItems.length === 0 ? '<tr><td colspan="6" class="cell-center cell-muted">No items pending photography.</td></tr>' : 
                photoItems.map((item) => `
                <tr class="${selectedItem && String(selectedItem.id) === String(item.id) ? 'row-selected' : ''}">
                  <td><strong>${escapeHtml(item.id)}</strong></td>
                  <td>
                    <div style="font-weight:600;">${escapeHtml(item.itemName)}</div>
                    <div class="cell-muted" style="font-size:11.5px;">SN: ${escapeHtml(item.serialNumber || 'N/A')}</div>
                  </td>
                  <td>${escapeHtml(item.category)}</td>
                  <td>${escapeHtml(item.condition)}</td>
                  <td>
                    <select 
                      class="field-input photo-status-select" 
                      data-item-id="${item.id}" 
                      style="
                        padding: 8px 12px;
                        font-size: 13px;
                        border-radius: 8px;
                        border: 1px solid #CBD5E1;
                        background-color: #FFFFFF;
                        color: #1E293B;
                        width: 100%;
                        max-width: 180px;
                        cursor: pointer;
                        outline: none;
                        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                      "
                    >
                      <option value="For Photography" ${item.status === 'For Photography' ? 'selected' : ''}>For Photography</option>
                      <option value="In Photography" ${item.status === 'In Photography' ? 'selected' : ''}>In Photography</option>
                    </select>
                  </td>
                  <td><button class="btn-add" data-photo-upload="${item.id}" data-item-id="${item.id}" style="padding:6px 12px; font-size:12px;">Select Item</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${selectedItem ? `
      <div class="card" id="photo-workspace-card">
        <div class="card-title" style="margin-bottom:14px;">Photo Upload Workspace (Selected Item: <span id="photo-active-item">${escapeHtml(selectedItem.id)} - ${escapeHtml(selectedItem.itemName)}</span>)</div>
        
        <input type="file" id="photo-file-input" accept="image/*" style="display:none;" />

        <div class="photo-upload-zone" id="drag-drop-photo-zone" style="cursor:pointer; border:2px dashed #CBD5E1; padding:20px; text-align:center; border-radius:8px; background:#FAFAFA;">
          <div style="font-weight:600; font-size:14px;">Click Here to Upload Next Angle</div>
        </div>

        <div class="photo-grid-5" style="display:grid; grid-template-columns:repeat(5, 1fr); gap:10px; margin-top:20px;">
          <div class="photo-slot-card" id="slot-0" style="border:1px solid #E2E8F0; padding:10px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; font-weight:600;">1. Front View</div>
            <div class="photo-preview-box" style="margin:10px 0; min-height:40px;"></div>
            <div class="slot-status" style="font-size:11px; color:var(--danger-red); font-weight:600;">Missing</div>
          </div>
          <div class="photo-slot-card" id="slot-1" style="border:1px solid #E2E8F0; padding:10px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; font-weight:600;">2. Back View</div>
            <div class="photo-preview-box" style="margin:10px 0; min-height:40px;"></div>
            <div class="slot-status" style="font-size:11px; color:var(--danger-red); font-weight:600;">Missing</div>
          </div>
          <div class="photo-slot-card" id="slot-2" style="border:1px solid #E2E8F0; padding:10px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; font-weight:600;">3. Serial Tag</div>
            <div class="photo-preview-box" style="margin:10px 0; min-height:40px;"></div>
            <div class="slot-status" style="font-size:11px; color:var(--danger-red); font-weight:600;">Missing</div>
          </div>
          <div class="photo-slot-card" id="slot-3" style="border:1px solid #E2E8F0; padding:10px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; font-weight:600;">4. Interior View</div>
            <div class="photo-preview-box" style="margin:10px 0; min-height:40px;"></div>
            <div class="slot-status" style="font-size:11px; color:var(--danger-red); font-weight:600;">Missing</div>
          </div>
          <div class="photo-slot-card" id="slot-4" style="border:1px solid #E2E8F0; padding:10px; border-radius:6px; text-align:center;">
            <div style="font-size:12px; font-weight:600;">5. Accessories</div>
            <div class="photo-preview-box" style="margin:10px 0; min-height:40px;"></div>
            <div class="slot-status" style="font-size:11px; color:var(--danger-red); font-weight:600;">Missing</div>
          </div>
        </div>

        <div style="margin-top:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-top:1px solid var(--border-light); padding-top:16px;">
          <div id="photo-validation-msg" style="font-size:13px; color:var(--danger-red); font-weight:600;">
            <span id="photo-count-label">0</span> / 5 photos uploaded
          </div>
          <button class="btn-confirm" id="btn-submit-photo-set" data-item-id="${selectedItem.id}" disabled style="opacity:0.5; cursor:not-allowed;">Submit</button>
        </div>
      </div>
      ` : ''}
    `;
  },

/* ==========================================================================
     SUBTAB 3: AUTHENTICATION SUBTAB
     ========================================================================== */
  renderAuthenticationView() {
    const authQueue = DB.consignments.filter(i => 
      i.authentication === 'pending' || i.status === 'Pending Authentication Payment' || i.status === 'Pending Authentication'
    );

    const selectedItem = window.activeAuthItemId
      ? DB.consignments.find(i => String(i.id) === String(window.activeAuthItemId))
      : (authQueue.length > 0 ? authQueue[authQueue.length - 1] : null);

    return `
      <div style="margin-bottom:20px;">
        <h1 class="page-title" style="margin-bottom:4px;">Authentication Service</h1>
        <p class="cell-muted" style="font-size:13.5px;">Manage double-authentication decisions, certificates, 2-factor verification, and 12–24h SLA timers.</p>
      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start;">
        
        <div class="card" style="margin: 0;">
          <div class="card-title" style="margin-bottom:16px;">
            <span>Authentication Queue (${authQueue.length})</span>
          </div>

          <div class="table-scroll">
            <table class="data-table">
              <thead><tr>
                <th>Item ID</th><th>Item Details</th><th>24h SLA Countdown</th><th>Double Auth Verification</th><th>Status</th><th>Action</th>
              </tr></thead>
              <tbody>
                ${authQueue.length === 0 ? '<tr><td colspan="6" class="cell-center cell-muted" style="padding: 24px;">No items pending authentication.</td></tr>' :
                  authQueue.map(item => `
                  <tr class="${selectedItem && String(selectedItem.id) === String(item.id) ? 'row-selected' : ''}">
                    <td><strong>${escapeHtml(item.id)}</strong></td>
                    <td>
                      <div style="font-weight:600;">${escapeHtml(item.itemName)}</div>
                      <div class="cell-muted" style="font-size:11.5px;">SN: ${escapeHtml(item.serialNumber || 'N/A')}</div>
                    </td>
                    <td>${renderSLABadge(item.createdAtMs, 24)}</td>
                    <td>${this.doubleAuthBadge(item.primaryAuthStatus, item.secondaryAuthStatus)}</td>
                    <td>${this.authBadge(item.authentication)}</td>
                    <td>
                      ${item.authPaymentStatus === 'Paid' ? `
                        <button class="badge badge-success" data-auth-select="${item.id}" data-item-id="${item.id}" style="cursor: pointer; border: 1px solid #48BB78; text-decoration: none;">
                          Paid
                        </button>
                      ` : `
                        <button class="btn-confirm" data-auth-pay="${item.id}" data-item-id="${item.id}" style="padding:4px 8px; font-size:11px; background:var(--green);">
                          Pay Fee
                        </button>
                      `}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="margin: 0;">
          <div class="card-title" style="margin-bottom:14px;">Double-Authentication Panel ${selectedItem ? `(#${escapeHtml(selectedItem.id)})` : ''}</div>
          
          ${selectedItem ? `
            <div class="double-auth-box">
              <div style="font-weight:600; font-size:12.5px; margin-bottom:4px; color:var(--card-navy-dark);">Item SLA Status:</div>
              <div style="margin-bottom:8px;">${renderSLABadge(selectedItem.createdAtMs, 24)}</div>
              <div style="font-size:11.5px; color:var(--text-muted);">Current Verification: ${this.doubleAuthBadge(selectedItem.primaryAuthStatus, selectedItem.secondaryAuthStatus)}</div>
            </div>
          ` : ''}

          <div class="field-group" style="margin-bottom: 12px;">
            <label class="field-label">1st Primary Authenticator</label>
            <input class="field-input" id="auth-authenticator-input" value="${escapeHtml(selectedItem?.authenticatorName || 'Dr. Arthur Pendelton')}" placeholder="e.g. Dr. Arthur Pendelton" />
          </div>
          <div class="field-group" style="margin-bottom: 12px;">
            <label class="field-label">1st Verification Outcome</label>
            <select class="field-input" id="auth-primary-status">
              <option value="verified" ${selectedItem?.primaryAuthStatus === 'verified' ? 'selected' : ''}>Verified Authentic (Pass)</option>
              <option value="pending" ${(!selectedItem?.primaryAuthStatus || selectedItem?.primaryAuthStatus === 'pending') ? 'selected' : ''}>Pending Review</option>
              <option value="rejected" ${selectedItem?.primaryAuthStatus === 'rejected' ? 'selected' : ''}>Counterfeit / Flagged (Fail)</option>
            </select>
          </div>

          <div class="field-group" style="margin-bottom: 12px;">
            <label class="field-label">2nd Secondary Verifier</label>
            <input class="field-input" id="auth-secondary-verifier-input" value="${escapeHtml(selectedItem?.secondaryVerifierName || 'Victoria Sterling')}" placeholder="e.g. Victoria Sterling" />
          </div>
          <div class="field-group" style="margin-bottom: 12px;">
            <label class="field-label">2nd Verification Outcome</label>
            <select class="field-input" id="auth-secondary-status">
              <option value="verified" ${selectedItem?.secondaryAuthStatus === 'verified' ? 'selected' : ''}>Verified Authentic (Pass)</option>
              <option value="pending" ${(!selectedItem?.secondaryAuthStatus || selectedItem?.secondaryAuthStatus === 'pending') ? 'selected' : ''}>Pending Review</option>
              <option value="rejected" ${selectedItem?.secondaryAuthStatus === 'rejected' ? 'selected' : ''}>Counterfeit / Flagged (Fail)</option>
            </select>
          </div>

          <div class="field-group" style="margin-bottom: 12px;">
            <label class="field-label">Upload Certificate of Authenticity</label>
            <input class="field-input" type="file" id="auth-certificate-input" accept=".pdf,image/*" />
            ${selectedItem?.certificateName ? `<div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">Attached: ${escapeHtml(selectedItem.certificateName)}</div>` : ''}
          </div>
          <div class="field-group" style="margin-bottom: 12px;">
            <label class="field-label">Authenticator Notes & Stitching Log</label>
            <textarea class="field-input" id="auth-notes-input" rows="2" placeholder="e.g. Microchip scanned, hardware stamping and serial tag verified.">${escapeHtml(selectedItem?.authNotes || '')}</textarea>
          </div>
          <div class="field-group" style="margin-bottom: 16px;">
            <label class="field-label">Final Authentication Decision</label>
            <select class="field-input" id="auth-outcome-select">
              <option value="authentic">Verified Authentic (Advance to Photography)</option>
              <option value="fake">Fake / Counterfeit Item (Close & Flag in Database)</option>
            </select>
          </div>
          <button class="btn-confirm" style="width:100%;" id="btn-save-auth-decision" data-item-id="${selectedItem ? selectedItem.id : ''}">Submit Double Auth & Advance Stage</button>
        </div>

      </div>
    `;
  },

/* ==========================================================================
     SUBTAB 4: DESIGN & LISTING SUBTAB (Step 17)
     ========================================================================== */
  renderDesignView() {
    const designQueue = DB.consignments.filter(i => 
      i.status === 'Pending Listing Design' || i.status === 'In Design'
    );

    const activeItem = window.activeDesignItemId
      ? DB.consignments.find(i => String(i.id) === String(window.activeDesignItemId))
      : (designQueue.length > 0 ? designQueue[designQueue.length - 1] : null);

    return `
      <div style="margin-bottom:20px;">
        <h1 class="page-title" style="margin-bottom:4px;">Design & Listing</h1>

        <div class="card col-wide">
          <div class="card-title" style="margin-bottom:16px;">Design Queue (${designQueue.length})</div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Item ID</th><th>Current Name</th><th>Category</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                ${designQueue.length === 0 ? '<tr><td colspan="5" class="cell-center cell-muted">No items pending listing design.</td></tr>' :
                  designQueue.map(item => `
                  <tr class="${activeItem && String(activeItem.id) === String(item.id) ? 'row-selected' : ''}">
                    <td><strong>${escapeHtml(item.id)}</strong></td>
                    <td>${escapeHtml(item.itemName)}</td>
                    <td>${escapeHtml(item.category)}</td>
                    <td><span class="badge badge-warning">${escapeHtml(item.status)}</span></td>
                    <td><button class="btn-add" data-design-select="${item.id}" data-item-id="${item.id}" style="padding:4px 8px; font-size:11px;">Select Item</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        ${activeItem ? `
        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:14px;">Create Listing (Item #${escapeHtml(activeItem.id)})</div>
          <div class="field-group">
            <label class="field-label">SEO Product Title</label>
            <input class="field-input" id="design-title-input" value="${escapeHtml(activeItem.itemName)}" />
          </div>
          
          <div class="field-group">
            <label class="field-label">Product Category</label>
            <select class="field-input" id="design-category-select">
              <option value="Crossbody" ${activeItem.category === 'Crossbody' ? 'selected' : ''}>Crossbody</option>
              <option value="Shoulder Bag" ${activeItem.category === 'Shoulder Bag' ? 'selected' : ''}>Shoulder Bag</option>
              <option value="Tote" ${activeItem.category === 'Tote' ? 'selected' : ''}>Tote</option>
              <option value="Handbags" ${activeItem.category === 'Handbags' || activeItem.category === 'Handbag' ? 'selected' : ''}>Handbags</option>
              <option value="Backpack" ${activeItem.category === 'Backpack' ? 'selected' : ''}>Backpack</option>
              <option value="Small Leather Goods" ${activeItem.category === 'Small Leather Goods' ? 'selected' : ''}>Small Leather Goods</option>
              <option value="Shoes & Wallets" ${activeItem.category === 'Shoes & Wallets' ? 'selected' : ''}>Shoes & Wallets</option>
            </select>
          </div>

          <div class="field-group">
            <label class="field-label">Item Condition</label>
            <select class="field-input" id="design-condition-select">
              <option value="Pristine / New" ${activeItem.condition === 'Pristine / New' ? 'selected' : ''}>Pristine / New</option>
              <option value="Excellent" ${activeItem.condition === 'Excellent' ? 'selected' : ''}>Excellent</option>
              <option value="Very Good" ${activeItem.condition === 'Very Good' ? 'selected' : ''}>Very Good</option>
              <option value="Good" ${activeItem.condition === 'Good' ? 'selected' : ''}>Good</option>
            </select>
          </div>

          <div class="field-group">
            <label class="field-label">Condition Notes</label>
            <textarea class="field-input" id="design-notes-input" rows="3">${escapeHtml(activeItem.conditionNotes || 'Pre-loved in great shape. Clean lining and functional hardware.')}</textarea>
          </div>
          <button class="btn-confirm" id="btn-submit-design" data-item-id="${activeItem.id}" style="width:100%; margin-top:8px;">Submit</button>
        </div>
        ` : ''}
      </div>
    `;
  },

/* ==========================================================================
     SUBTAB 5: PRICING & MARKUP SUBTAB (Step 16)
     ========================================================================== */
  renderPricingView() {
    const pricingQueue = DB.consignments.filter(i => 
      i.status === 'Pending Pricing Review' || i.status === 'In Pricing'
    );

    return `
      <div style="margin-bottom:20px;">
        <h1 class="page-title" style="margin-bottom:4px;">Pricing & Markup Calculation</h1>

        <div class="card-title" style="margin-bottom:16px;">Pricing Review & Approval Matrix (${pricingQueue.length})</div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>Item ID</th><th>Item Name</th><th>Consignor Asking Price</th><th>Auto Markup</th><th>Final Selling Price</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody>
              ${pricingQueue.length === 0 ? '<tr><td colspan="7" class="cell-center cell-muted">No items currently pending pricing review.</td></tr>' :
                pricingQueue.map(item => {
                  const calc = calculateMarkup(item.price, item.category);

                  return `
                  <tr>
                    <td><strong>${escapeHtml(item.id)}</strong></td>
                    <td>
                      <div style="font-weight:600;">${escapeHtml(item.itemName)}</div>
                      <div class="cell-muted" style="font-size:11.5px;">${escapeHtml(item.category)} · ${escapeHtml(item.condition)}</div>
                    </td>
                    <td>${escapeHtml(item.price)}</td>
                    <td><span class="badge badge-info">${calc.label}</span></td>
                    <td><strong style="color:var(--card-navy-dark); font-size:15px;">₱${calc.finalPrice.toLocaleString()}</strong></td>
                    <td><span class="badge badge-warning">${escapeHtml(item.status)}</span></td>
                    <td>
                      <button class="btn-confirm" data-approve-price="${item.id}" data-item-id="${item.id}" style="padding:6px 12px; font-size:12px; cursor:pointer;">
                        Approve
                      </button>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

/* ==========================================================================
     SUBTAB 6: INTAKE & AGREEMENTS SUBTAB (Step 8)
     ========================================================================== */
  renderIntakeView() {
    return `
      <div style="margin-bottom:20px;">
        <h1 class="page-title" style="margin-bottom:4px;">Intake & Agreements</h1>

        <div class="card-title" style="margin-bottom:16px;">Consignment Intake Form</div>
        <form id="intake-form">
          <div class="section-grid">
            <div class="field-group col-wide">
              <label class="field-label">Consignor Full Name</label>
              <input class="field-input" id="intake-consignor-name" placeholder="e.g. Maria Santos" required />
            </div>
            <div class="field-group col-wide">
              <label class="field-label">Contact Channel</label>
              <select class="field-input" id="intake-contact-channel">
                <option value="Instagram Inquiry">Instagram Inquiry</option>
                <option value="TikTok Inquiry">TikTok Inquiry</option>
                <option value="Showroom Walk-in">Showroom Walk-in</option>
              </select>
            </div>
          </div>
          <div class="section-grid">
            <div class="field-group col-wide">
              <label class="field-label">Government ID Type</label>
              <select class="field-input" id="intake-govt-id-type" required>
                <option value="Passport">Passport</option>
                <option value="Driver's License">Driver's License</option>
                <option value="UMID">UMID</option>
                <option value="PhilSys National ID">PhilSys National ID</option>
                <option value="SSS ID">SSS ID</option>
                <option value="Voters ID">Voters ID</option>
                <option value="PRC ID">PRC ID</option>
              </select>
            </div>
            <div class="field-group col-wide">
              <label class="field-label">Government ID Number</label>
              <input class="field-input" id="intake-govt-id-number" placeholder="e.g. P1234567B / 006-123-456" required />
            </div>
          </div>
          <div class="field-group" style="margin-bottom:16px;">
            <label class="field-label">Upload Government ID Photo</label>
            <input class="field-input" type="file" id="intake-govt-id-image" accept="image/*" />
            <div id="govt-id-preview-container" style="display:none; margin-top:8px; align-items:center; gap:10px;">
              <img id="govt-id-preview-img" style="height:65px; border-radius:6px; border:1px solid #CBD5E1; object-fit:cover;" />
              <span style="font-size:12px; color:var(--green); font-weight:600;">Government ID Photo Attached</span>
            </div>
          </div>
          <div class="section-grid">
            <div class="field-group col-wide">
              <label class="field-label">Serial Number / Microchip ID</label>
              <input class="field-input" id="intake-serial-number" placeholder="e.g. SN-88492019" required />
            </div>
            <div class="field-group col-wide">
              <label class="field-label">Initial Asking Price (₱)</label>
              <input class="field-input" id="intake-asking-price" placeholder="e.g. 150000" type="number" required />
            </div>
          </div>

          <div class="section-grid">
            <div class="field-group col-wide">
              <label class="field-label">Consignment Term & Agreement Action</label>
              <select class="field-input" id="intake-term-action-select">
                <option value="" disabled selected>-- Select Action (Optional) --</option>
                <option value="extend">Extend Term</option>
                <option value="pullout">Request Pull-Out</option>
              </select>
            </div>
            <div class="field-group col-wide">
            </div>
          </div>
          
          <div class="field-group" style="margin-bottom:16px;">
            <label class="field-label">Accessories Included Checklist</label>
            <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:6px;">
              <label style="font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="intake-accessory-cb" value="Dust Bag" checked /> Dust Bag
              </label>
              <label style="font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="intake-accessory-cb" value="Original Box" /> Original Box
              </label>
              <label style="font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="intake-accessory-cb" value="Authenticity Card / Receipt" /> Authenticity Card / Receipt
              </label>
              <label style="font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="intake-accessory-cb" value="Strap / Keys / Clochette" /> Strap / Keys / Clochette
              </label>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">E-Signature</label>
            <div class="signature-container" style="position: relative; border: 1px dashed #ccc; background: #fafafa; border-radius: 8px;">
              <canvas id="signature-pad" width="600" height="160" style="touch-action: none; cursor: crosshair; width: 100%; height: 160px;"></canvas>
              <button type="button" id="clear-signature-btn" style="position: absolute; top: 10px; right: 10px; padding: 4px 10px; font-size: 12px;">Clear Signature</button>
            </div>
          </div>
          <button type="submit" class="btn-confirm">Submit</button>
        </form>
      </div>
    `;
  },

/* ==========================================================================
     SUBTAB 7: MANAGER APPROVALS SUBTAB 
     ========================================================================== */
  renderApprovalsView() {
    const approvalQueue = DB.consignments.filter(i => 
      i.status === 'Pending Pricing Review' || i.status === 'Pending Manager Approval'
    );

    return `
      <div style="margin-bottom:20px;">
        <h1 class="page-title" style="margin-bottom:4px;">Manager Stage Approvals</h1>

        <div class="card-title" style="margin-bottom:16px;">Manager Approval Queue (${approvalQueue.length})</div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>Item ID</th><th>Brand & Name</th><th>Authentication</th><th>Photos</th><th>Listing Specs</th><th>Final Price</th><th>Action</th>
            </tr></thead>
            <tbody>
              ${approvalQueue.length === 0 ? '<tr><td colspan="7" class="cell-center cell-muted">No items currently pending executive approval.</td></tr>' :
                approvalQueue.map(item => {
                  const calc = calculateMarkup(item.price, item.category);

                  return `
                  <tr>
                    <td><strong>${escapeHtml(item.id)}</strong></td>
                    <td><div style="font-weight:600;">${escapeHtml(item.itemName)}</div></td>
                    <td>${this.authBadge(item.authentication)}</td>
                    <td><span class="badge badge-success">${item.photoSet?.length || 5}/5 Photos</span></td>
                    <td><span class="badge badge-success">SEO Draft Ready</span></td>
                    <td><strong>₱${calc.finalPrice.toLocaleString()}</strong></td>
                    <td>
                      <div class="row-actions">
                        <button class="btn-confirm" data-manager-approve="${item.id}" data-item-id="${item.id}" style="padding:6px 12px; font-size:11.5px;">Approve</button>
                        <button class="btn-secondary" data-manager-reject="${item.id}" data-item-id="${item.id}" style="padding:6px 12px; font-size:11.5px;">Revision</button>
                      </div>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

/* ==========================================================================
     SUBTAB 8: OVERVIEW & STATUS SUBTAB
     ========================================================================== */
  renderOverviewView() {
    const processed = this.filterAndSortConsignments(DB.consignments);
    const visible = this.showAll ? processed : processed.slice(0, 6);

    return `
      <h1 class="page-title">Consignment Management</h1>
      
      <div class="filter-toolbar-row">
        <div class="filter-controls-group">
          ${renderUniversalSearchBar('consignment-search-input', 'Search by ID, Brand, Name, Serial #, Consignor...')}
          <select class="sort-select" id="consignment-sort-select">
            <option value="recently" ${this.sortBy === 'recently' ? 'selected' : ''}>Sort by: Recently Added (Default)</option>
            <option value="oldest" ${this.sortBy === 'oldest' ? 'selected' : ''}>Sort by: Oldest First</option>
            <option value="price-high" ${this.sortBy === 'price-high' ? 'selected' : ''}>Sort by: Price High to Low</option>
            <option value="price-low" ${this.sortBy === 'price-low' ? 'selected' : ''}>Sort by: Price Low to High</option>
            <option value="alphabetical" ${this.sortBy === 'alphabetical' ? 'selected' : ''}>Sort by: Alphabetical A-Z</option>
          </select>
        </div>
        <button class="btn-add" id="btn-add-consignment">+ Add Item</button>
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Item ID</th><th>Brand</th><th>Details</th><th>Authentication</th>
            <th>Status</th><th>Price</th><th>Payout Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${visible.length === 0 ? '<tr><td colspan="8" class="cell-center cell-muted" style="padding:24px;">No consignment items found matching query.</td></tr>' :
              visible.map((item) => {
              const displayImage = (item.photoSet && item.photoSet.length > 0) 
                ? item.photoSet[0] 
                : (item.image && item.image.startsWith('data:') ? item.image : `assets/images/${item.image || 'placeholder.png'}`);

              return `
              <tr>
                <td>${escapeHtml(item.id)}</td>
                <td class="cell-bold">${escapeHtml(item.brand)}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:10px;">
                    <img src="${displayImage}" alt="${escapeHtml(item.itemName)}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #E2E8F0;background:var(--chip-bg)" onerror="this.src='assets/images/placeholder.png'">
                    <div>
                      <div style="font-weight:600;">${escapeHtml(item.itemName)}</div>
                      <div class="cell-muted" style="font-size:11.5px;">${escapeHtml(item.category)} · ${escapeHtml(item.condition)}</div>
                    </div>
                  </div>
                </td>
                <td class="cell-center">${this.doubleAuthBadge(item.primaryAuthStatus || item.authentication, item.secondaryAuthStatus || item.authentication)}</td>
                <td class="cell-center">${escapeHtml(item.status)}</td>
                <td class="cell-bold">${escapeHtml(item.price)}</td>
                <td class="cell-center">${this.payoutBadge(item.payoutStatus)}</td>
                <td><div class="row-actions">
                  <button class="icon-btn" data-edit-cons="${item.id}" title="Edit">✎</button>
                  <button class="icon-btn danger" data-delete-cons="${item.id}" title="Delete">🗑</button>
                </div></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      ${processed.length > 6 ? `<button class="view-all-link" id="toggle-show-all">${this.showAll ? 'Show less ▴' : 'Show all ▾'}</button>` : ''}
    `;
  },

  /* ==========================================================================
     EVENT HANDLERS (afterRender)
     ========================================================================== */
  afterRender(route = 'consignment-overview') {
    if (route === 'consignment-preintake') {
      document.querySelectorAll('[data-preintake-select]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          window.activePreIntakeItemId = e.currentTarget.getAttribute('data-item-id') || e.currentTarget.getAttribute('data-preintake-select');
          Router.rerender();
        });
      });

      const captureForm = document.getElementById('preintake-capture-form');
      if (captureForm) {
        captureForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const consignorName = document.getElementById('pre-consignor-name')?.value.trim() || 'Anonymous';
          const channel = document.getElementById('pre-inquiry-channel')?.value || 'Instagram DM';
          const askingPrice = document.getElementById('pre-asking-price')?.value.trim() || '0';
          const notes = document.getElementById('pre-inquiry-notes')?.value.trim() || '';

          const newId = ConsignmentPage.nextInquiryId();
          const newRecord = {
            id: newId,
            consignorName: consignorName,
            contactChannel: channel,
            itemName: `Inquiry (${channel}) - ${consignorName}`,
            brand: 'Pending Verification',
            category: 'Handbags',
            condition: 'Pending Review',
            image: 'placeholder.png',
            authentication: 'pending',
            status: 'Inquiry Received',
            price: `₱${parseAmountString(askingPrice).toLocaleString()}`,
            payoutStatus: 'notYetSold',
            inquiryNotes: notes,
            negotiationLog: [],
            dateAdded: new Date().toLocaleDateString()
          };

          DB.consignments.push(newRecord);
          localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
          showToast(`Inquiry Lead #${newId} captured!`);
          window.activePreIntakeItemId = newId;
          captureForm.reset();
          Router.rerender();
        });
      }

      const logNegBtn = document.getElementById('btn-log-negotiation');
      if (logNegBtn) {
        logNegBtn.addEventListener('click', (e) => {
          const itemId = e.target.getAttribute('data-item-id');
          const targetItem = DB.consignments.find(i => String(i.id) === String(itemId));
          const asking = document.getElementById('pre-neg-asking')?.value.trim() || '0';
          const counter = document.getElementById('pre-neg-counter')?.value.trim() || '0';

          if (targetItem && asking) {
            targetItem.negotiationLog = targetItem.negotiationLog || [];
            targetItem.negotiationLog.push({
              asking: asking,
              counter: counter,
              date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            if (counter) targetItem.price = `₱${parseAmountString(counter).toLocaleString()}`;
            localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
            showToast(`Negotiation logged for Lead #${itemId}.`);
            Router.rerender();
          }
        });
      }

      const scheduleBtn = document.getElementById('btn-schedule-fulfillment');
      if (scheduleBtn) {
        scheduleBtn.addEventListener('click', (e) => {
          const itemId = e.target.getAttribute('data-item-id');
          const targetItem = DB.consignments.find(i => String(i.id) === String(itemId));
          const fulfillmentType = document.getElementById('pre-fulfillment-type')?.value || 'Showroom Walk-in';
          const dateVal = document.getElementById('pre-appointment-date')?.value || new Date().toLocaleDateString();

          if (targetItem) {
            if (String(targetItem.id).startsWith('INQ-')) {
              targetItem.id = ConsignmentPage.nextItemId();
            }

            targetItem.fulfillmentType = fulfillmentType;
            targetItem.scheduledReceivingDate = dateVal;
            targetItem.status = 'In Transit to Receiving';

            localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
            showToast(`Lead converted to official Item #${targetItem.id}! Advanced to Step 8 (Intake).`);
            Router.navigate('consignment-intake');
          }
        });
      }
      return;
    }

    if (route === 'consignment-photo') {
      document.querySelectorAll('.photo-status-select').forEach(select => {
        select.addEventListener('change', (e) => {
          const itemId = e.target.getAttribute('data-item-id');
          const newStatus = e.target.value;
          const targetItem = DB.consignments.find(i => String(i.id) === String(itemId));

          if (targetItem) {
            targetItem.status = newStatus;
            localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
            showToast(`Item #${itemId} status updated to '${newStatus}'!`);
            Router.rerender();
          }
        });
      });

      document.querySelectorAll('[data-photo-upload]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          window.activePhotoItemId = e.currentTarget.getAttribute('data-item-id') || e.currentTarget.getAttribute('data-photo-upload');
          Router.rerender();
        });
      });

      const dropZone = document.getElementById('drag-drop-photo-zone');
      const fileInput = document.getElementById('photo-file-input');
      const submitBtn = document.getElementById('btn-submit-photo-set');
      const countLabel = document.getElementById('photo-count-label');
      const validationMsg = document.getElementById('photo-validation-msg');

      let uploadedPhotos = [];

      if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0] && uploadedPhotos.length < 5) {
            const reader = new FileReader();
            reader.onload = function(event) {
              const slotIdx = uploadedPhotos.length;
              uploadedPhotos.push(event.target.result);

              const slot = document.getElementById(`slot-${slotIdx}`);
              if (slot) {
                slot.querySelector('.photo-preview-box').innerHTML = `<img src="${event.target.result}" style="width:100%; height:40px; object-fit:cover; border-radius:4px;" />`;
                const statusDiv = slot.querySelector('.slot-status');
                statusDiv.textContent = 'Uploaded';
                statusDiv.style.color = 'var(--green)';
              }

              if (countLabel) countLabel.textContent = uploadedPhotos.length;

              if (uploadedPhotos.length === 5 && submitBtn) {
                if (validationMsg) {
                  validationMsg.textContent = 'Complete!';
                  validationMsg.style.color = 'var(--green)';
                }
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
              }
            };
            reader.readAsDataURL(e.target.files[0]);
          }
        });
      }

      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          if (uploadedPhotos.length < 5) return showToast('Upload all 5 photo angles.');

          const itemId = submitBtn.getAttribute('data-item-id') || window.activePhotoItemId;
          const item = DB.consignments.find(i => String(i.id) === String(itemId));

          if (!item) return showToast('Please select an item for photo set upload.');

          item.status = 'Pending Listing Design';
          item.photoSet = uploadedPhotos;
          localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
          showToast(`Item #${item.id} photos approved! Advanced to Listing Design.`);
          window.activePhotoItemId = null;
          Router.rerender();
        });
      }
      return;
    }

    if (route === 'consignment-auth') {
      document.querySelectorAll('[data-auth-select]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          window.activeAuthItemId = e.currentTarget.getAttribute('data-item-id') || e.currentTarget.getAttribute('data-auth-select');
          Router.rerender();
        });
      });

      document.querySelectorAll('[data-auth-pay]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-item-id');
          const item = DB.consignments.find(i => String(i.id) === String(id));
          if (item) ConsignmentPage.openAuthPaymentModal(item);
        });
      });

      const saveBtn = document.getElementById('btn-save-auth-decision');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const outcomeSelect = document.getElementById('auth-outcome-select');
          const outcome = outcomeSelect ? outcomeSelect.value : 'authentic';
          const primaryStatus = document.getElementById('auth-primary-status')?.value || 'verified';
          const secondaryStatus = document.getElementById('auth-secondary-status')?.value || 'verified';
          const authenticatorInput = document.getElementById('auth-authenticator-input');
          const secondaryInput = document.getElementById('auth-secondary-verifier-input');
          const certInput = document.getElementById('auth-certificate-input');
          const notesInput = document.getElementById('auth-notes-input');

          const itemId = saveBtn.getAttribute('data-item-id') || window.activeAuthItemId;
          const targetItem = DB.consignments.find(i => String(i.id) === String(itemId));

          if (!targetItem) return showToast('Please select an item pending authentication.');

          if (authenticatorInput && authenticatorInput.value.trim()) {
            targetItem.authenticatorName = authenticatorInput.value.trim();
          }
          if (secondaryInput && secondaryInput.value.trim()) {
            targetItem.secondaryVerifierName = secondaryInput.value.trim();
          }
          if (notesInput && notesInput.value.trim()) {
            targetItem.authNotes = notesInput.value.trim();
          }
          if (certInput && certInput.files && certInput.files[0]) {
            targetItem.certificateName = certInput.files[0].name;
          }

          targetItem.primaryAuthStatus = primaryStatus;
          targetItem.secondaryAuthStatus = secondaryStatus;

          if (outcome === 'authentic' && primaryStatus === 'verified' && secondaryStatus === 'verified') {
            targetItem.authentication = 'verified';
            targetItem.status = 'For Photography';
            showToast(`Item #${targetItem.id} Double-Verified as Authentic! Advanced to Photography.`);
          } else if (outcome === 'fake' || primaryStatus === 'rejected' || secondaryStatus === 'rejected') {
            targetItem.authentication = 'rejected';
            targetItem.primaryAuthStatus = 'rejected';
            targetItem.secondaryAuthStatus = 'rejected';
            targetItem.status = 'Fake Item – Closed';
            showToast(`Item #${targetItem.id} flagged as Counterfeit – Closed and archived in database.`);
          } else {
            targetItem.authentication = 'pending';
            showToast(`Item #${targetItem.id} 1st verification saved. Awaiting 2nd secondary verifier sign-off.`);
          }

          localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
          window.activeAuthItemId = null;
          Router.rerender();
        });
      }
      return;
    }

    if (route === 'consignment-intake') {
      initSignaturePad();

      let currentGovtIdPhoto = null;
      const govtIdFileInput = document.getElementById('intake-govt-id-image');
      if (govtIdFileInput) {
        govtIdFileInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (event) => {
              currentGovtIdPhoto = event.target.result;
              const prevContainer = document.getElementById('govt-id-preview-container');
              const prevImg = document.getElementById('govt-id-preview-img');
              if (prevContainer && prevImg) {
                prevImg.src = event.target.result;
                prevContainer.style.display = 'flex';
              }
            };
            reader.readAsDataURL(e.target.files[0]);
          }
        });
      }

      const form = document.getElementById('intake-form');
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();

          const consignorName = document.getElementById('intake-consignor-name')?.value.trim() || '';
          const govtIdNumber = document.getElementById('intake-govt-id-number')?.value.trim() || '';
          const serialNumber = document.getElementById('intake-serial-number')?.value.trim() || '';
          const initialPrice = document.getElementById('intake-asking-price')?.value.trim() || '';
          const contactChannel = document.getElementById('intake-contact-channel')?.value || 'Instagram Inquiry';
          const govtIdType = document.getElementById('intake-govt-id-type')?.value || 'Passport';

          const blockErrors = [];
          if (!consignorName) blockErrors.push('Consignor Full Name is required.');
          if (!govtIdNumber) blockErrors.push('Government ID Number is required.');
          if (!currentGovtIdPhoto) blockErrors.push('Government ID Photo must be uploaded.');
          if (!serialNumber) blockErrors.push('Serial Number / Microchip ID is required.');
          if (!initialPrice || parseAmountString(initialPrice) <= 0) blockErrors.push('Initial Asking Price must be greater than ₱0.');

          const signatureData = window.getSignatureData ? window.getSignatureData() : null;
          if (!signatureData) blockErrors.push('E-Signature is required (please sign in the signature pad).');

          if (blockErrors.length > 0) {
            showToast(`Hard-Block: ${blockErrors[0]} (${blockErrors.length} issue(s) to resolve.)`);
            return;
          }

          const dupCheck = checkDuplicateConsignment(serialNumber, '', consignorName);
          if (dupCheck.duplicateSerial) {
            showToast(`Duplicate serial number "${serialNumber}" already registered in Item #${dupCheck.duplicateSerial.id}!`);
            return;
          }
          if (dupCheck.existingCustomer) {
            showToast(`ℹRepeat Consignor Identified: ${consignorName} profile linked.`);
          }

          const checkedAccessories = Array.from(document.querySelectorAll('.intake-accessory-cb:checked')).map(cb => cb.value);

          if (window.activePreIntakeItemId) {
            DB.consignments = DB.consignments.filter(i => String(i.id) !== String(window.activePreIntakeItemId));
            window.activePreIntakeItemId = null;
          }

          const newId = ConsignmentPage.nextItemId();
          const newRecord = {
            id: newId,
            brand: 'Pending Verification',
            itemName: `Pending Item — SN: ${serialNumber}`,
            category: 'Handbags',
            condition: 'Pending Review',
            image: 'placeholder.png',
            authentication: 'pending',
            primaryAuthStatus: 'pending',
            secondaryAuthStatus: 'pending',
            authPaymentStatus: 'Pending',
            status: 'Pending Authentication Payment',
            price: `₱${parseAmountString(initialPrice).toLocaleString()}`,
            payoutStatus: 'notYetSold',
            consignorName,
            contactChannel,
            govtIdType,
            govtIdNumber,
            govtIdImage: currentGovtIdPhoto,
            serialNumber,
            accessories: checkedAccessories,
            signatureImage: signatureData,
            dateAdded: new Date().toLocaleDateString(),
            postingDate: new Date().toISOString().split('T')[0],
            createdAtMs: Date.now(),
            contractDays: 60,
          };

          DB.consignments.push(newRecord);
          localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
          showToast(`Record #${newRecord.id} saved! Proceeding to payment...`);
          
          form.reset();
          currentGovtIdPhoto = null;
          if (window.clearSignaturePad) window.clearSignaturePad();

          ConsignmentPage.openAuthPaymentModal(newRecord);
        });
      }

      const termSelect = document.getElementById('intake-term-action-select');
      if (termSelect) {
        termSelect.addEventListener('change', (e) => {
          const action = e.target.value;
          const targetItem = DB.consignments.find(i => !String(i.id).startsWith('INQ-')) || DB.consignments[0];
          if (targetItem) {
            if (action === 'extend') ConsignmentPage.openExtensionModal(targetItem);
            else if (action === 'pullout') ConsignmentPage.openPulloutModal(targetItem);
          }
          termSelect.value = '';
        });
      }
      return;
    }

    if (route === 'consignment-design') {
      document.querySelectorAll('[data-design-select]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          window.activeDesignItemId = e.currentTarget.getAttribute('data-item-id') || e.currentTarget.getAttribute('data-design-select');
          Router.rerender();
        });
      });

      const submitDesignBtn = document.getElementById('btn-submit-design');
      if (submitDesignBtn) {
        submitDesignBtn.addEventListener('click', () => {
          const itemId = submitDesignBtn.getAttribute('data-item-id') || window.activeDesignItemId;
          const targetItem = DB.consignments.find(i => String(i.id) === String(itemId));

          if (!targetItem) return showToast('Please select an item pending design.');

          const titleInput = document.getElementById('design-title-input');
          const categorySelect = document.getElementById('design-category-select');
          const conditionSelect = document.getElementById('design-condition-select');
          const notesInput = document.getElementById('design-notes-input');

          if (categorySelect) targetItem.category = categorySelect.value;
          if (conditionSelect) targetItem.condition = conditionSelect.value;

          if (titleInput && titleInput.value.trim()) {
            const newTitle = titleInput.value.trim();
            targetItem.itemName = newTitle;
            const firstWord = newTitle.split(' ')[0];
            if (firstWord) targetItem.brand = firstWord;
          }

          const notesVal = notesInput ? notesInput.value.trim() : '';
          targetItem.conditionNotes = notesVal;

          const accessoriesText = (targetItem.accessories && targetItem.accessories.length > 0)
            ? targetItem.accessories.join(', ')
            : 'Dust Bag, Authenticity Card';

          const calc = calculateMarkup(targetItem.price, targetItem.category);
          let desc = `${targetItem.itemName}\nCategory: ${targetItem.category}\nCondition: ${targetItem.condition}\nInclusions: ${accessoriesText}\nNotes: ${notesVal}`;
          if (calc.finalPrice >= 200000) {
            desc += `\n\nLayaway Option: 1%/month interest (up to 3 months max).`;
          }
          desc += `\n\n100% Guaranteed Authentic`;
          targetItem.description = desc;

          targetItem.status = 'Pending Pricing Review';

          localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
          showToast(`Item #${targetItem.id} category, condition, inclusions & title saved! Sent to Pricing.`);
          window.activeDesignItemId = null;
          Router.rerender();
        });
      }
      return;
    }

    if (route === 'consignment-pricing') {
      const tableScroll = document.querySelector('.table-scroll');
      if (tableScroll) {
        const cleanTable = tableScroll.cloneNode(true);
        tableScroll.parentNode.replaceChild(cleanTable, tableScroll);

        cleanTable.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-approve-price]') || e.target.closest('[data-item-id]');
          if (!btn) return;

          const itemId = btn.getAttribute('data-item-id') || btn.getAttribute('data-approve-price');
          const targetItem = DB.consignments.find(i => String(i.id) === String(itemId));

          if (targetItem) {
            const calc = calculateMarkup(targetItem.price, targetItem.category);
            targetItem.price = `₱${calc.finalPrice.toLocaleString()}`;
            targetItem.status = 'Pending Manager Approval';

            localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
            showToast(`Item #${targetItem.id} calculated (₱${calc.finalPrice.toLocaleString()})! Sent to Manager for Final Approval.`);
            Router.rerender();
          }
        });
      }
      return;
    }
    
    if (route === 'consignment-approval') {
      const tableScroll = document.querySelector('.table-scroll');
      if (tableScroll) {
        const cleanTable = tableScroll.cloneNode(true);
        tableScroll.parentNode.replaceChild(cleanTable, tableScroll);

        cleanTable.addEventListener('click', (e) => {
          const approveBtn = e.target.closest('[data-manager-approve]');
          const rejectBtn = e.target.closest('[data-manager-reject]');

          if (approveBtn) {
            const itemId = approveBtn.getAttribute('data-item-id') || approveBtn.getAttribute('data-manager-approve');
            const targetItem = DB.consignments.find(i => String(i.id) === String(itemId));

            if (targetItem) {
              const publishErrors = [];
              if (targetItem.authentication !== 'verified' || targetItem.primaryAuthStatus !== 'verified' || targetItem.secondaryAuthStatus !== 'verified') {
                publishErrors.push('Double Authentication (Primary + Secondary) must both be verified.');
              }
              if (!targetItem.photoSet || targetItem.photoSet.length < 5) {
                publishErrors.push(`All 5 required photo angles must be uploaded (currently: ${targetItem.photoSet?.length || 0}/5).`);
              }
              if (!targetItem.description) {
                publishErrors.push('Listing design / SEO description must be completed.');
              }

              if (publishErrors.length > 0) {
                showToast(`Cannot publish. ${publishErrors[0]}`);
                return;
              }

              targetItem.status = 'Available';
              targetItem.payoutStatus = 'notYetSold';
              targetItem.postingDate = targetItem.postingDate || new Date().toISOString().split('T')[0];
              targetItem.shopifyProductId = targetItem.shopifyProductId || `gid://shopify/Product/${Math.floor(10000000000 + Math.random() * 90000000000)}`;
              targetItem.shopifySyncStatus = 'synced';

              const existingInv = DB.inventory.find(inv => inv.consignmentId === targetItem.id);
              if (!existingInv) {
                let maxInv = 0;
                for (const inv of DB.inventory) {
                  const num = parseInt(String(inv.id).replace(/[^0-9]/g, ''), 10);
                  if (!isNaN(num)) maxInv = Math.max(maxInv, num);
                }
                const invId = `INV-${String(maxInv + 1).padStart(3, '0')}`;
                const todayStr = `${new Date().getMonth() + 1}/${new Date().getDate()}/${new Date().getFullYear()}`;
                const newInvItem = {
                  id: invId,
                  brand: targetItem.brand || 'Luxury Brand',
                  category: targetItem.category || 'Handbag',
                  condition: targetItem.condition || 'Excellent',
                  status: 'available',
                  location: 'Showroom',
                  dateAdded: todayStr,
                  transactionStatus: 'none',
                  price: targetItem.price,
                  consignmentId: targetItem.id,
                  shopifyProductId: targetItem.shopifyProductId,
                };
                DB.inventory.push(newInvItem);
                localStorage.setItem('inventory_data', JSON.stringify(DB.inventory));
              }

              localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
              showToast(`Item #${targetItem.id} approved! Published live, synced to inventory and Shopify storefront (Purse Maison BGC).`);
              Router.rerender();
            }
          } else if (rejectBtn) {
            const itemId = rejectBtn.getAttribute('data-item-id') || rejectBtn.getAttribute('data-manager-reject');
            const targetItem = DB.consignments.find(i => String(i.id) === String(itemId));

            if (targetItem) {
              targetItem.status = 'Pending Listing Design';
              localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
              showToast(`Item #${targetItem.id} sent back to Listing Design for revision.`);
              Router.rerender();
            }
          }
        });
      }
      return;
    }

    const items = DB.consignments;

    const searchInput = document.getElementById('consignment-search-input');
    if (searchInput) {
      searchInput.value = this.searchKeyword;
      searchInput.addEventListener('input', debounce((e) => {
        this.searchKeyword = e.target.value;
        Router.rerender();
        const newInput = document.getElementById('consignment-search-input');
        if (newInput) {
          newInput.focus();
          newInput.setSelectionRange(newInput.value.length, newInput.value.length);
        }
      }, 300));
    }

    const sortSelect = document.getElementById('consignment-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.sortBy = e.target.value;
        Router.rerender();
      });
    }

    const addBtn = document.getElementById('btn-add-consignment');
    if (addBtn) addBtn.addEventListener('click', () => this.openForm(null));

    document.querySelectorAll('[data-track-cons]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-track-cons');
        const item = items.find((i) => String(i.id) === String(id));
        if (item) this.showConsignorPortalModal(item);
      });
    });

    document.querySelectorAll('[data-passport-cons]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-passport-cons');
        const item = items.find((i) => String(i.id) === String(id));
        if (item) this.showItemPassportModal(item);
      });
    });

    document.querySelectorAll('[data-agreement-cons]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-agreement-cons');
        const item = items.find((i) => String(i.id) === String(id));
        if (item) this.showAgreementModal(item);
      });
    });

    document.querySelectorAll('[data-edit-cons]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-edit-cons');
        const item = items.find((i) => String(i.id) === String(id));
        if (item) this.openForm(item);
      });
    });

    document.querySelectorAll('[data-pullout-cons]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-pullout-cons');
        const item = items.find((i) => String(i.id) === String(id));
        if (item) this.openPulloutModal(item);
      });
    });

    document.querySelectorAll('[data-extend-cons]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-extend-cons');
        const item = items.find((i) => String(i.id) === String(id));
        if (item) this.openExtensionModal(item);
      });
    });

    document.querySelectorAll('[data-delete-cons]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-delete-cons');
        const item = items.find((i) => String(i.id) === String(id));
        if (item) {
          confirmDelete(`${item.itemName} (${item.id})`, () => {
            DB.consignments = DB.consignments.filter((i) => String(i.id) !== String(id));
            localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
            showToast('Item deleted.');
            Router.rerender();
          });
        }
      });
    });

    const toggleBtn = document.getElementById('toggle-show-all');
    if (toggleBtn) toggleBtn.addEventListener('click', () => { this.showAll = !this.showAll; Router.rerender(); });
  },

  openForm(existing) {
    const isEdit = !!existing;
    const id = isEdit ? existing.id : this.nextItemId();
    const accessoriesList = existing?.accessories && existing.accessories.length > 0 ? existing.accessories : ['Dust Bag'];

    const html = `
      <form id="consignment-modal-form">
        <div class="field-group">
          <label class="field-label">Item ID</label>
          <input class="field-input" name="id" value="${escapeHtml(id)}" readonly style="background:#F1F5F9; cursor:not-allowed;" />
        </div>
        <div class="field-group">
          <label class="field-label">Consignor Full Name</label>
          <input class="field-input" name="consignorName" required value="${escapeHtml(existing?.consignorName || '')}" placeholder="e.g. Maria Santos" />
        </div>
        <div class="field-group">
          <label class="field-label">Government ID Info (${escapeHtml(existing?.govtIdType || 'ID')})</label>
          <input class="field-input" name="govtIdNumber" value="${escapeHtml(existing?.govtIdNumber || '')}" placeholder="e.g. Passport P1234567B" />
        </div>
        <div class="field-group">
          <label class="field-label">Government ID Photo Review</label>
          ${existing?.govtIdImage ? `<div style="margin-bottom:6px;"><img src="${existing.govtIdImage}" style="max-height:90px; border-radius:6px; border:1px solid #CBD5E1;" /></div>` : '<div style="font-size:12px; color:var(--text-muted);">No ID photo uploaded yet</div>'}
          <input class="field-input" type="file" id="modal-govt-id-image" accept="image/*" />
        </div>
        <div class="field-group">
          <label class="field-label">Accessories Checklist (Inclusions)</label>
          <div style="font-size:12px; color:#475569; background:#F8FAFC; border:1px solid #E2E8F0; padding:6px 10px; border-radius:6px;">
            ${accessoriesList.map(a => `<span class="badge badge-info" style="margin-right:4px; margin-bottom:2px; display:inline-block;"> ${escapeHtml(a)}</span>`).join('')}
          </div>
        </div>
        ${existing?.signatureImage ? `
          <div class="field-group">
            <label class="field-label">Captured Consignor E-Signature</label>
            <div style="background:#FAF9F6; border:1px dashed #CBD5E1; border-radius:6px; padding:6px; text-align:center;">
              <img src="${existing.signatureImage}" style="max-height:60px; max-width:100%; object-fit:contain;" />
            </div>
          </div>
        ` : ''}
        <div class="field-group">
          <label class="field-label">Serial Number / Microchip ID</label>
          <input class="field-input" name="serialNumber" value="${escapeHtml(existing?.serialNumber || '')}" placeholder="e.g. SN-88492019" />
        </div>
        <div class="field-group">
          <label class="field-label">Brand</label>
          <input class="field-input" name="brand" required value="${escapeHtml(existing?.brand || '')}" placeholder="e.g. Hermès" />
        </div>
        <div class="field-group">
          <label class="field-label">Item Name</label>
          <input class="field-input" name="itemName" required value="${escapeHtml(existing?.itemName || '')}" placeholder="e.g. Birkin 30 Togo" />
        </div>
        <div class="field-group">
          <label class="field-label">Category</label>
          <select class="field-input" name="category">
            ${['Handbags', 'Shoulder Bag', 'Tote', 'Crossbody', 'Hobo', 'Backpack', 'Small Leather Goods', 'Shoes & Wallets'].map(c => `
              <option value="${c}" ${existing?.category === c ? 'selected' : ''}>${c}</option>
            `).join('')}
          </select>
        </div>
        <div class="field-group">
          <label class="field-label">Condition</label>
          <select class="field-input" name="condition">
            ${['Pristine / New', 'Excellent', 'Very Good', 'Good'].map(c => `
              <option value="${c}" ${existing?.condition === c ? 'selected' : ''}>${c}</option>
            `).join('')}
          </select>
        </div>
        <div class="field-group">
          <label class="field-label">Authentication</label>
          <select class="field-input" name="authentication">
            ${['pending', 'verified', 'rejected'].map(a => `
              <option value="${a}" ${existing?.authentication === a ? 'selected' : ''}>${a[0].toUpperCase() + a.slice(1)}</option>
            `).join('')}
          </select>
        </div>
        <div class="field-group">
          <label class="field-label">Status</label>
          <select class="field-input" name="status">
            ${['Inquiry Received', 'Pre-Intake Pending', 'In Transit to Receiving', 'Pending Authentication Payment', 'Received', 'For Photography', 'In Photography', 'Pending Listing Design', 'In Design', 'Pending Pricing Review', 'Pending Manager Approval', 'Available', 'Return to Consignor', 'Fake Item – Closed'].map(s => `
              <option value="${s}" ${existing?.status === s ? 'selected' : ''}>${s}</option>
            `).join('')}
          </select>
        </div>
        <div class="field-group">
          <label class="field-label">Asking Price (₱)</label>
          <input class="field-input" name="price" required value="${escapeHtml(existing?.price || '')}" placeholder="e.g. ₱150,000" />
        </div>
        <div class="field-group">
          <label class="field-label">Payout Status</label>
          <select class="field-input" name="payoutStatus">
            ${['notYetSold', 'sold', 'cancelled'].map(p => `
              <option value="${p}" ${existing?.payoutStatus === p ? 'selected' : ''}>${p === 'notYetSold' ? 'Not Yet Sold' : p[0].toUpperCase() + p.slice(1)}</option>
            `).join('')}
          </select>
        </div>

        ${isEdit ? `
        <div class="field-group" style="margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border-light);">
          <label class="field-label" style="font-weight: 700;">Consignment Term & Agreement Status</label>
          <div style="display: flex; gap: 10px; margin-top: 8px;">
            <button type="button" id="modal-btn-extend" class="btn-secondary" style="flex: 1; border: 1px solid var(--card-navy-dark); color: var(--card-navy-dark); font-weight: 600;">
              Extend Term
            </button>
            <button type="button" id="modal-btn-pullout" class="btn-secondary" style="flex: 1; border: 1px solid var(--danger-red); color: var(--danger-red); font-weight: 600;">
              Request Pull-Out
            </button>
          </div>
        </div>
        ` : ''}

        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-modal>Cancel</button>
          <button type="submit" class="btn-confirm">${isEdit ? 'Save Changes' : 'Add Item'}</button>
        </div>
      </form>`;

    const overlay = openModal({
      title: isEdit ? `Edit Consignment #${id}` : 'Add Consignment Item',
      bodyHtml: html
    });

    if (isEdit && existing) {
      overlay.querySelector('#modal-btn-extend')?.addEventListener('click', () => {
        closeModal();
        ConsignmentPage.openExtensionModal(existing);
      });

      overlay.querySelector('#modal-btn-pullout')?.addEventListener('click', () => {
        closeModal();
        ConsignmentPage.openPulloutModal(existing);
      });
    }

    let modalGovtIdPhoto = existing?.govtIdImage || null;
    const modalFileInput = overlay.querySelector('#modal-govt-id-image');
    if (modalFileInput) {
      modalFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            modalGovtIdPhoto = evt.target.result;
          };
          reader.readAsDataURL(e.target.files[0]);
        }
      });
    }

    const form = overlay.querySelector('#consignment-modal-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const record = {
          id: id,
          consignorName: fd.get('consignorName').trim(),
          govtIdNumber: fd.get('govtIdNumber').trim(),
          govtIdImage: modalGovtIdPhoto,
          serialNumber: fd.get('serialNumber').trim(),
          brand: fd.get('brand').trim(),
          itemName: fd.get('itemName').trim(),
          category: fd.get('category'),
          condition: fd.get('condition'),
          image: existing?.image || 'placeholder.png',
          authentication: fd.get('authentication'),
          status: fd.get('status'),
          price: fd.get('price').trim().startsWith('₱') ? fd.get('price').trim() : `₱${parseAmountString(fd.get('price')).toLocaleString()}`,
          payoutStatus: fd.get('payoutStatus'),
        };

        if (isEdit) {
          const idx = DB.consignments.findIndex(i => String(i.id) === String(id));
          if (idx !== -1) DB.consignments[idx] = { ...DB.consignments[idx], ...record };
        } else {
          DB.consignments.push(record);
        }

        localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
        closeModal();
        showToast(isEdit ? `Consignment #${id} updated.` : `Consignment #${id} created.`);
        Router.rerender();
      });
    }
  },

  openPulloutModal(item) {
    const postingDateMs = item.postingDate ? new Date(item.postingDate).getTime() : (item.createdAtMs || Date.now());
    const daysSincePosting = Math.floor((Date.now() - postingDateMs) / 86400000);
    const PULLOUT_FEE = 2500;
    const pulloutFee = daysSincePosting <= 60 ? PULLOUT_FEE : 0;
    const feeLabel = pulloutFee > 0 ? `₱${pulloutFee.toLocaleString()} (within 60-day window)` : '₱0 — Waived (past 60-day period)';
    const feeClass = pulloutFee > 0 ? 'danger' : 'success';

    const html = `
      <div class="pullout-notice-card" style="margin-bottom:16px;">
        <strong style="font-size:13.5px;">Consignor Pull-Out</strong><br/>
        <span style="font-size:12.5px;">Item #${escapeHtml(item.id)} — ${escapeHtml(item.itemName)}</span>
      </div>

      <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:14px; margin-bottom:16px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12.5px;">
          <div><span style="color:var(--text-muted);">Consignor:</span><br/><strong>${escapeHtml(item.consignorName || 'N/A')}</strong></div>
          <div><span style="color:var(--text-muted);">Posting Date:</span><br/><strong>${escapeHtml(item.postingDate || 'N/A')}</strong></div>
          <div><span style="color:var(--text-muted);">Days Since Posting:</span><br/><strong>${daysSincePosting} day(s)</strong></div>
          <div><span style="color:var(--text-muted);">Item Price:</span><br/><strong>${escapeHtml(item.price)}</strong></div>
        </div>
      </div>

      <div style="text-align:center; margin-bottom:20px;">
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:6px;">Pull-Out Fee Assessment:</div>
        <div style="font-size:22px; font-weight:700; color:var(--${feeClass === 'danger' ? 'danger-red' : 'green'});">${feeLabel}</div>
        ${pulloutFee > 0 ? `<div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">Policy: ₱2,500 withdrawal fee applies within the first 60 days of item posting.</div>` : `<div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">Policy: Pull-out fee has been waived — item posted more than 60 days ago.</div>`}
      </div>

      <div class="field-group">
        <label class="field-label">Reason for Withdrawal</label>
        <select class="field-input" id="pullout-reason-select">
          <option value="Consignor Request">Consignor Request</option>
          <option value="Unsatisfied with Pricing">Unsatisfied with Pricing</option>
          <option value="Item Sold Elsewhere">Item Sold Elsewhere</option>
          <option value="Personal Reasons">Personal Reasons</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Additional Notes</label>
        <textarea class="field-input" id="pullout-notes-input" rows="2" placeholder="Optional withdrawal notes..."></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" data-close-modal>Cancel</button>
        <button class="btn-confirm btn-danger" id="btn-confirm-pullout" data-item-id="${escapeHtml(item.id)}">Confirm Withdrawal</button>
      </div>
    `;

    const overlay = openModal({ title: 'Consignor Pull-Out & Withdrawal', bodyHtml: html });
    overlay.querySelector('#btn-confirm-pullout').addEventListener('click', () => {
      const reason = document.getElementById('pullout-reason-select')?.value || 'Consignor Request';
      const notes = document.getElementById('pullout-notes-input')?.value.trim() || '';
      const targetItem = DB.consignments.find(i => String(i.id) === String(item.id));
      if (targetItem) {
        targetItem.status = 'Return to Consignor';
        targetItem.payoutStatus = 'cancelled';
        targetItem.pulloutFee = pulloutFee;
        targetItem.pulloutReason = reason;
        targetItem.pulloutNotes = notes;
        targetItem.pulloutDate = new Date().toLocaleDateString();

        localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
        closeModal();
        showToast(`Item #${item.id} withdrawal confirmed. Status updated to Return to Consignor.`);
        Router.rerender();
      }
    });
  },

  openExtensionModal(item) {
    const postingDate = item.postingDate || new Date().toISOString().split('T')[0];
    const currentContractDays = item.contractDays || 90;
    const extensionHistory = item.extensionHistory || [];

    const html = `
      <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:14px; margin-bottom:16px; font-size:12.5px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div><span style="color:var(--text-muted);">Item:</span><br/><strong>${escapeHtml(item.id)} — ${escapeHtml(item.itemName)}</strong></div>
          <div><span style="color:var(--text-muted);">Consignor:</span><br/><strong>${escapeHtml(item.consignorName || 'N/A')}</strong></div>
          <div><span style="color:var(--text-muted);">Posting Date:</span><br/><strong>${escapeHtml(postingDate)}</strong></div>
          <div><span style="color:var(--text-muted);">Current Contract Duration:</span><br/><strong>${currentContractDays} days</strong></div>
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">Extension Duration</label>
        <select class="field-input" id="extension-days-select">
          <option value="30">+30 Days</option>
          <option value="60">+60 Days</option>
          <option value="90">+90 Days</option>
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Extension Reason</label>
        <select class="field-input" id="extension-reason-select">
          <option value="Consignor Request">Consignor Request</option>
          <option value="Market Timing">Market Timing</option>
          <option value="Seasonal Extension">Seasonal Extension</option>
          <option value="Low Season Holdover">Low Season Holdover</option>
        </select>
      </div>

      ${extensionHistory.length > 0 ? `
      <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:12px;">
        <div style="font-weight:600; font-size:12px; margin-bottom:6px; color:var(--card-navy-dark);">Extension History:</div>
        ${extensionHistory.map(h => `
          <div style="font-size:11px; color:var(--text-muted); border-bottom:1px dashed #E2E8F0; padding:3px 0;">
            +${h.days} days (${h.reason}) — ${h.date}
          </div>
        `).join('')}
      </div>` : ''}

      <div class="modal-actions">
        <button class="btn-secondary" data-close-modal>Cancel</button>
        <button class="btn-confirm" id="btn-confirm-extension" data-item-id="${escapeHtml(item.id)}">Apply Extension</button>
      </div>
    `;

    const overlay = openModal({ title: 'Consignment Duration Extension', bodyHtml: html });
    overlay.querySelector('#btn-confirm-extension').addEventListener('click', () => {
      const days = parseInt(document.getElementById('extension-days-select')?.value || '30', 10);
      const reason = document.getElementById('extension-reason-select')?.value || 'Consignor Request';
      const targetItem = DB.consignments.find(i => String(i.id) === String(item.id));
      if (targetItem) {
        targetItem.contractDays = (targetItem.contractDays || 90) + days;
        targetItem.extensionHistory = targetItem.extensionHistory || [];
        targetItem.extensionHistory.push({ days, reason, date: new Date().toLocaleDateString() });
        localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
        closeModal();
        showToast(`Item #${item.id} contract extended by +${days} days. New total: ${targetItem.contractDays} days.`);
        Router.rerender();
      }
    });
  },

  openAuthPaymentModal(item) {
    const defaultCalc = calculateAuthFee('Entrupy', item.brand, item.category);

    const html = `
      <div style="text-align:center; margin-bottom:16px;">
        <strong style="font-size:14px;">Authentication Payment Required</strong><br/>
        <span style="font-size:12.5px; color:var(--text-muted);">Item #${escapeHtml(item.id)} — ${escapeHtml(item.brand)} ${escapeHtml(item.itemName)}</span>
      </div>

      <div class="field-group">
        <label class="field-label">Select Authentication Provider</label>
        <select class="field-input" id="auth-provider-select">
          <option value="Entrupy" selected>Entrupy (AI Hardware Scanner)</option>
          <option value="LegitGrail">LegitGrail (Manual & Footwear Specialist)</option>
        </select>
      </div>

      <div style="background:#F8FAFC; border:1px solid #CBD5E1; border-radius:8px; padding:12px; margin-bottom:16px; text-align:center;">
        <div style="font-size:12px; color:var(--text-muted);" id="auth-fee-label">${defaultCalc.label}</div>
        <div style="font-size:24px; font-weight:700; color:var(--card-navy-dark);" id="auth-fee-amount">₱${defaultCalc.fee.toLocaleString()}</div>
        <div style="font-size:11px; color:var(--danger-red); margin-top:2px;">Non-refundable · Paid Upfront</div>
      </div>

      <div style="text-align:center; background:#FFF; border:1px dashed #CBD5E1; border-radius:8px; padding:12px; margin-bottom:16px;">
        <div style="font-weight:600; font-size:12px; margin-bottom:6px;">Scan via QR PH (GCash / Maya / Bank Apps)</div>
        <div style="width:140px; height:140px; background:#EEE; margin:0 auto; display:flex; align-items:center; justify-content:center; border-radius:6px; font-size:11px; color:#666;">
          [ QR PH CODE ]
        </div>
      </div>

      <div class="field-group">
        <label class="field-label">Reference / Transaction Number</label>
        <input class="field-input" id="auth-payment-ref" placeholder="e.g. QPH-992019203" required />
      </div>

      <div class="modal-actions">
        <button class="btn-secondary" data-close-modal>Cancel</button>
        <button class="btn-confirm" id="btn-confirm-auth-payment">Confirm Payment & Advance Queue</button>
      </div>
    `;

    const overlay = openModal({ title: 'QR PH Payment Gate', bodyHtml: html });

    overlay.querySelector('#auth-provider-select')?.addEventListener('change', (e) => {
      const calc = calculateAuthFee(e.target.value, item.brand, item.category);
      overlay.querySelector('#auth-fee-label').textContent = calc.label;
      overlay.querySelector('#auth-fee-amount').textContent = `₱${calc.fee.toLocaleString()}`;
    });

    overlay.querySelector('#btn-confirm-auth-payment')?.addEventListener('click', () => {
      const refNo = overlay.querySelector('#auth-payment-ref')?.value.trim();
      if (!refNo) {
        showToast('Please enter the QR PH Reference Number to verify payment.');
        return;
      }

      const provider = overlay.querySelector('#auth-provider-select').value;
      const calc = calculateAuthFee(provider, item.brand, item.category);

      const targetItem = DB.consignments.find(i => String(i.id) === String(item.id));
      if (targetItem) {
        targetItem.authPaymentStatus = 'Paid';
        targetItem.authPaymentRef = refNo;
        targetItem.authProvider = provider;
        targetItem.authFeeAmount = calc.fee;
        targetItem.status = 'Pending Authentication';

        localStorage.setItem('consignments_data', JSON.stringify(DB.consignments));
        closeModal();
        showToast(`Payment Confirmed (Ref #${refNo})! Item #${item.id} advanced to Authentication Queue.`);
        Router.rerender();
      }
    });
  },

  showConsignorPortalModal(item) {
    const postingDate = item.postingDate || '2026-08-01';
    const postingDateMs = item.postingDate ? new Date(item.postingDate).getTime() : (item.createdAtMs || Date.now());
    const daysSincePosting = Math.max(0, Math.floor((Date.now() - postingDateMs) / 86400000));
    const contractDays = item.contractDays || 60;
    const daysRemaining = Math.max(0, contractDays - daysSincePosting);
    const trackingUrl = `https://pursemaison.com/track/${item.id}`;

    const calc = calculateMarkup(item.price, item.category);
    const estPayout = calc.price;

    let stageIndex = 1;
    if (item.authentication === 'verified') stageIndex = 2;
    if (item.status === 'Pending Listing Design' || item.status === 'Pending Pricing Review' || (item.photoSet && item.photoSet.length >= 5)) stageIndex = 3;
    if (item.status === 'Available' || item.status === 'Sold' || item.shopifyProductId) stageIndex = 4;
    if (item.status === 'Sold' || item.payoutStatus === 'sold') stageIndex = 5;

    const stages = [
      { num: 1, title: 'Intake & Agreement', desc: `Item received & Gov ID verified (${item.consignorName || 'Consignor'})`, done: stageIndex >= 1, current: stageIndex === 1 },
      { num: 2, title: 'Authentication Service', desc: item.authentication === 'verified' ? 'Double-Authentication Verified Authentic' : 'In authentication queue (12-24h SLA)', done: stageIndex >= 2, current: stageIndex === 2 },
      { num: 3, title: 'Photography & Quality', desc: (item.photoSet && item.photoSet.length >= 5) ? 'High-resolution 5-angle photo set complete' : 'Scheduled for studio photography', done: stageIndex >= 3, current: stageIndex === 3 },
      { num: 4, title: 'Listing & Publishing', desc: stageIndex >= 4 ? 'Live on Website, Showroom & Shopify' : 'Pending final pricing and publishing', done: stageIndex >= 4, current: stageIndex === 4 },
      { num: 5, title: 'Sale & Consignor Payout', desc: item.payoutStatus === 'sold' ? 'Sold! Payout settlement initiated (1-14 banking days)' : 'Available for purchase · Payout on sale', done: stageIndex >= 5, current: stageIndex === 5 }
    ];

    const displayImage = (item.photoSet && item.photoSet.length > 0)
      ? item.photoSet[0]
      : (item.image && item.image.startsWith('data:') ? item.image : `assets/images/${item.image || 'placeholder.png'}`);

    const html = `
      <div class="mobile-phone-frame">
        <div class="mobile-phone-notch"></div>
        <div class="mobile-phone-screen">
          <div class="mobile-phone-header">
            <h3>PURSE MAISON</h3>
            <p>Customer Consignment Portal</p>
          </div>
          <div class="mobile-phone-body">
            <div class="mobile-item-card">
              <img src="${displayImage}" alt="${escapeHtml(item.itemName)}" class="mobile-item-thumb" onerror="this.src='assets/images/placeholder.png'" />
              <div>
                <div style="font-weight:700; font-size:13px; color:#0F172A;">${escapeHtml(item.itemName)}</div>
                <div style="font-size:11px; color:#64748B;">Item ID: #${escapeHtml(item.id)} · ${escapeHtml(item.condition)}</div>
                <div style="font-size:12px; font-weight:700; color:#10184F; margin-top:2px;">Selling: ${escapeHtml(item.price)}</div>
                <div style="font-size:11px; color:#059669; font-weight:600;">Est. Payout: ₱${estPayout.toLocaleString()}</div>
              </div>
            </div>

            <div style="background:#FFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px; margin-bottom:12px; font-size:11.5px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span style="color:#64748B;">Contract Duration:</span>
                <span style="font-weight:600;">${contractDays} Days (${daysRemaining} days left)</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:#64748B;">Pull-Out Fee:</span>
                <span style="font-weight:600; color:${daysSincePosting <= 60 ? '#B91C1C' : '#059669'}">${daysSincePosting <= 60 ? '₱2,500 (<60d)' : 'Waived (0d)'}</span>
              </div>
            </div>

            <div style="font-size:12px; font-weight:700; color:#0F172A; margin-bottom:10px;">Item Lifecycle Progress:</div>
            <div class="mobile-timeline">
              ${stages.map((st, idx) => `
                <div class="mobile-timeline-step">
                  <div class="timeline-indicator-wrap">
                    <div class="timeline-indicator-dot ${st.done ? 'active' : (st.current ? 'current' : 'pending')}">
                      ${st.done ? '✓' : st.num}
                    </div>
                    ${idx < stages.length - 1 ? `<div class="timeline-indicator-line ${st.done ? 'active' : ''}"></div>` : ''}
                  </div>
                  <div class="mobile-step-details">
                    <div class="mobile-step-title">${st.title}</div>
                    <div class="mobile-step-desc">${st.desc}</div>
                  </div>
                </div>
              `).join('')}
            </div>

            <div style="margin-top:16px; display:flex; flex-direction:column; gap:8px;">
              <button class="btn-confirm" id="btn-copy-customer-link" style="width:100%; padding:9px; font-size:12px;">
                🔗 Copy Tracking Link (${trackingUrl})
              </button>
              <button class="btn-secondary" id="btn-portal-view-agreement" style="width:100%; padding:8px; font-size:12px;">
                📜 View Signed Agreement & Terms
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const overlay = openModal({ title: `Consignor Portal Preview (Item #${item.id})`, bodyHtml: html });
    overlay.querySelector('#btn-copy-customer-link')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(trackingUrl).then(() => {
        showToast(`Tracking link copied to clipboard: ${trackingUrl}`);
      }).catch(() => {
        showToast(`Tracking link: ${trackingUrl}`);
      });
    });
    overlay.querySelector('#btn-portal-view-agreement')?.addEventListener('click', () => {
      closeModal();
      ConsignmentPage.showAgreementModal(item);
    });
  },

  showItemPassportModal(item) {
    const accessoriesText = (item.accessories && item.accessories.length > 0)
      ? item.accessories.join(', ')
      : 'Dust Bag, Authenticity Card';

    const html = `
      <div class="passport-sheet">
        <div class="passport-header-row">
          <div>
            <div style="font-size:18px; font-weight:800; letter-spacing:1px; color:#10184F;">PURSE MAISON</div>
            <div style="font-size:11px; color:#64748B;">OFFICIAL ITEM PASSPORT & RECEIVING SLIP</div>
          </div>
          <div style="text-align:right;">
            <span class="badge badge-success">AUTHENTICATED</span>
            <div style="font-size:11px; color:#64748B; margin-top:4px;">Passport #: PM-${escapeHtml(item.id)}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:12.5px; margin-bottom:14px;">
          <div><span style="color:#64748B;">Brand / Model:</span><br/><strong>${escapeHtml(item.brand)} — ${escapeHtml(item.itemName)}</strong></div>
          <div><span style="color:#64748B;">Category & Condition:</span><br/><strong>${escapeHtml(item.category)} · ${escapeHtml(item.condition)}</strong></div>
          <div><span style="color:#64748B;">Serial Number:</span><br/><strong style="font-family:monospace;">${escapeHtml(item.serialNumber || 'N/A')}</strong></div>
          <div><span style="color:#64748B;">Microchip / Date Code:</span><br/><strong style="font-family:monospace;">${escapeHtml(item.microchipNumber || 'MC-' + (item.serialNumber || item.id))}</strong></div>
          <div><span style="color:#64748B;">Consignor:</span><br/><strong>${escapeHtml(item.consignorName || 'N/A')}</strong></div>
          <div><span style="color:#64748B;">Selling Price:</span><br/><strong>${escapeHtml(item.price)}</strong></div>
          <div style="grid-column: span 2;"><span style="color:#64748B;">Inclusions Verified:</span><br/><strong>${escapeHtml(accessoriesText)}</strong></div>
        </div>

        <div class="barcode-box">
          <div style="font-size:11px; color:#64748B; font-weight:600;">INVENTORY BARCODE (CODE 128)</div>
          <div class="barcode-visual">|| | | ||| | || ||||</div>
          <div style="font-family:monospace; font-size:13px; font-weight:700; letter-spacing:2px;">*PM-${escapeHtml(item.id)}-${escapeHtml(item.serialNumber || '000')}*</div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; padding-top:10px; border-top:1px dashed #CBD5E1; font-size:11px; color:#64748B;">
          <span>Purse Maison BGC Showroom</span>
          <span>Security Tag Verified</span>
          <span>${item.postingDate || new Date().toLocaleDateString()}</span>
        </div>

        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn-secondary" data-close-modal>Close</button>
          <button class="btn-confirm" id="btn-print-passport">🖨️ Print Receiving Slip</button>
        </div>
      </div>
    `;

    const overlay = openModal({ title: `Item Passport (#${item.id})`, bodyHtml: html });
    overlay.querySelector('#btn-print-passport')?.addEventListener('click', () => {
      showToast(`Item Passport & Barcode Slip for #${item.id} sent to printer.`);
    });
  },

  showAgreementModal(item) {
    const consignorName = item.consignorName || 'Maria Santos';
    const dateStr = item.postingDate || new Date().toLocaleDateString();
    const idInfo = item.govtIdNumber ? `${item.govtIdType || 'Government ID'}: ${item.govtIdNumber}` : 'Government ID: Verified On-File';

    const html = `
      <div style="background:#FFF; padding:16px; border-radius:10px; max-height:550px; overflow-y:auto; font-size:12.5px; color:#1E293B; line-height:1.5;">
        <div style="text-align:center; border-bottom:2px solid #0F2B48; padding-bottom:10px; margin-bottom:14px;">
          <h2 style="font-size:16px; margin:0 0 4px; color:#10184F; letter-spacing:0.5px;">PURSE MAISON LUXURY CONSIGNMENT AGREEMENT</h2>
          <div style="font-size:11px; color:#64748B;">Binding Terms & Operational Consignment Policy</div>
        </div>

        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:14px;">
          <div><strong>Consignor:</strong> ${escapeHtml(consignorName)} (${escapeHtml(idInfo)})</div>
          <div><strong>Item:</strong> #${escapeHtml(item.id)} — ${escapeHtml(item.brand)} ${escapeHtml(item.itemName)}</div>
          <div><strong>Agreed Price:</strong> ${escapeHtml(item.price)} · <strong>Date:</strong> ${escapeHtml(dateStr)}</div>
        </div>

        <div style="margin-bottom:12px;">
          <strong>1. Consignment Duration & Listing Period</strong>
          <p style="margin:4px 0 8px; color:#475569;">The item shall be held and marketed for an initial period of sixty (60) calendar days from the date of official publication. The duration may be extended upon mutual written agreement between Purse Maison and the consignor.</p>
        </div>

        <div style="margin-bottom:12px;">
          <strong>2. Pull-Out Fee Terms</strong>
          <p style="margin:4px 0 8px; color:#475569;">A non-negotiable withdrawal fee of <strong>₱2,500</strong> shall apply if the consignor chooses to withdraw or pull out the item within the first sixty (60) days of posting. After the 60-day threshold, withdrawal is complimentary without penalty.</p>
        </div>

        <div style="margin-bottom:12px;">
          <strong>3. Consignor Payout Settlement</strong>
          <p style="margin:4px 0 8px; color:#475569;">Consignor payout proceeds shall be disbursed within one to fourteen (1-14) banking days following confirmed completion of the sale, net of applicable authentication and service fees.</p>
        </div>

        <div style="margin-bottom:12px;">
          <strong>4. Layaway Financing Provision</strong>
          <p style="margin:4px 0 8px; color:#475569;">For items priced at ₱200,000 and above, buyer layaway plans are permitted with 1% interest per month for up to three (3) months maximum. Consignor receives full agreed payout upon final settlement.</p>
        </div>

        <div style="margin-bottom:12px;">
          <strong>5. 100% Authenticity Guarantee</strong>
          <p style="margin:4px 0 8px; color:#475569;">All consigned merchandise undergoes multi-point double verification via Entrupy AI and expert evaluators. Items confirmed counterfeit will be immediately closed, confiscated, or returned in accordance with law.</p>
        </div>

        <div style="border-top:1px dashed #CBD5E1; padding-top:12px; margin-top:14px; display:flex; justify-content:space-between; align-items:flex-end;">
          <div>
            <div style="font-size:11px; color:#64748B; margin-bottom:4px;">Consignor E-Signature:</div>
            ${item.signatureImage ? `<img src="${item.signatureImage}" style="max-height:50px; border:1px solid #CBD5E1; border-radius:4px; padding:2px;" />` : `<div style="font-family:'Brush Script MT', cursive; font-size:20px; color:#10184F;">${escapeHtml(consignorName)}</div>`}
          </div>
          <div style="text-align:right; font-size:11px; color:#64748B;">
            Signed electronically on ${escapeHtml(dateStr)}<br/>
            IP & Verification Record Logged
          </div>
        </div>

        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn-secondary" data-close-modal>Close</button>
          <button class="btn-confirm" id="btn-print-agreement">🖨️ Print Agreement</button>
        </div>
      </div>
    `;

    const overlay = openModal({ title: `Consignment Agreement (#${item.id})`, bodyHtml: html });
    overlay.querySelector('#btn-print-agreement')?.addEventListener('click', () => {
      showToast(`Consignment Agreement #${item.id} sent to printer.`);
    });
  }
};

function initSignaturePad() {
  const canvas = document.getElementById('signature-pad');
  const clearBtn = document.getElementById('clear-signature-btn');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let hasSignature = false;

  ctx.strokeStyle = '#0B1252';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    hasSignature = true;
  }

  function stopDrawing() { isDrawing = false; }

  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseleave', stopDrawing);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasSignature = false;
    });
  }

  window.getSignatureData = function() {
    return hasSignature ? canvas.toDataURL('image/png') : null;
  };

  window.clearSignaturePad = function() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSignature = false;
  };
}