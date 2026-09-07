/**
 * Inventory Management page — mirrors screens/inventory_management_page.dart
 * + widgets/inventory_table.dart + widgets/inventory_charts.dart +
 * widgets/inventory_item_dialog.dart.
 */

const InventoryPage = {
  pageSize: 6,
  currentPage: 1,

  statusBadge(status) {
    const map = {
      available: ['Available', 'info'],
      reserved: ['Reserved', 'warning'],
      rejected: ['Rejected', 'danger'],
      sold: ['Sold', 'success'],
    };
    const [label, tone] = map[status];
    return badge(label, tone);
  },

  transactionCell(status) {
    if (status === 'none') return '<span class="cell-muted">-</span>';
    const map = { pending: ['Pending', 'warning'], cancelled: ['Cancelled', 'danger'], completed: ['Completed', 'success'] };
    const [label, tone] = map[status];
    return badge(label, tone);
  },

  nextItemId() {
    let maxNum = 0;
    for (const item of DB.inventory) {
      const m = /INV-(\d+)/.exec(item.id);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    return `INV-${String(maxNum + 1).padStart(3, '0')}`;
  },

  render() {
    const viewOnly = Session.inventoryViewOnly();
    const items = DB.inventory;
    const totalPages = Math.max(1, Math.ceil(items.length / this.pageSize));
    this.currentPage = Math.min(Math.max(1, this.currentPage), totalPages);
    const start = (this.currentPage - 1) * this.pageSize;
    const pageItems = items.slice(start, start + this.pageSize);

    const total = items.length;
    const available = items.filter((i) => i.status === 'available').length;
    const reserved = items.filter((i) => i.status === 'reserved').length;

    return `
      <h1 class="page-title">Inventory Management</h1>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-title">Total Items</div><div class="stat-value-row"><span class="stat-value">${total}</span></div></div>
        <div class="stat-card"><div class="stat-title">Available Items</div><div class="stat-value-row"><span class="stat-value">${available}</span></div></div>
        <div class="stat-card"><div class="stat-title">Reserved Items</div><div class="stat-value-row"><span class="stat-value">${reserved}</span></div></div>
        <div class="stat-card"><div class="stat-title">Low Stock Items</div><div class="stat-value-row"><span class="stat-value">0</span></div></div>
      </div>

      <div class="toolbar-row">
        <div class="sort-row">Sort by: <strong style="color:var(--text-dark)">Recently</strong> ▾</div>
        ${viewOnly ? '' : `<button class="btn-add" id="btn-add-inventory">+ Add Item</button>`}
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Item ID</th><th>Brand</th><th>Category</th><th>Condition</th><th>Status</th>
            <th>Location</th><th>Date Added</th><th>Transaction Status</th><th>Price</th>
            ${viewOnly ? '' : '<th>Actions</th>'}
          </tr></thead>
          <tbody>
            ${pageItems.map((item) => `
              <tr>
                <td>${escapeHtml(item.id)}</td>
                <td class="cell-bold">${escapeHtml(item.brand)}</td>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.condition)}</td>
                <td class="cell-center">${this.statusBadge(item.status)}</td>
                <td class="cell-center">${escapeHtml(item.location)}</td>
                <td class="cell-center">${escapeHtml(item.dateAdded)}</td>
                <td class="cell-center">${this.transactionCell(item.transactionStatus)}</td>
                <td class="cell-bold">${escapeHtml(item.price)}</td>
                ${viewOnly ? '' : `<td><div class="row-actions">
                  <button class="icon-btn" data-edit-inv="${item.id}" title="Edit">✎</button>
                  <button class="icon-btn danger" data-delete-inv="${item.id}" title="Delete">🗑</button>
                </div></td>`}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="pagination" id="inventory-pagination">
        ${this.renderPagination(this.currentPage, totalPages)}
      </div>

      <div class="section-grid">
        <div class="chart-card" style="flex:1.3;min-width:300px;">
          <div class="chart-card-title">Inventory by Location</div>
          <div id="location-bars"></div>
        </div>
        <div class="chart-card" style="flex:1.3;min-width:300px;">
          <div class="chart-card-title">Inventory Turnover Rate</div>
          <div class="chart-canvas-wrap short"><canvas id="chart-turnover"></canvas></div>
        </div>
        <div class="chart-card col-narrow">
          <div class="chart-card-title">Slowest-Moving Items</div>
          <div id="turnover-leaderboard"></div>
        </div>
      </div>
    `;
  },

  renderPagination(current, total) {
    let html = `<button ${current === 1 ? 'disabled' : ''} data-page="${current - 1}">‹</button>`;
    for (let p = 1; p <= total; p++) {
      html += `<button class="${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }
    html += `<button ${current === total ? 'disabled' : ''} data-page="${current + 1}">›</button>`;
    return html;
  },

  afterRender() {
    const items = DB.inventory;

    // -- pagination --
    document.getElementById('inventory-pagination').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn) return;
      this.currentPage = parseInt(btn.dataset.page, 10);
      Router.rerender();
    });

    // -- row actions --
    document.querySelectorAll('[data-edit-inv]').forEach((btn) => {
      btn.addEventListener('click', () => this.openForm(items.find((i) => i.id === btn.dataset.editInv)));
    });
    document.querySelectorAll('[data-delete-inv]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = items.find((i) => i.id === btn.dataset.deleteInv);
        confirmDelete(`${item.brand} (${item.id})`, () => {
          DB.inventory = DB.inventory.filter((i) => i.id !== item.id);
          showToast('Item deleted.');
          Router.rerender();
        });
      });
    });
    const addBtn = document.getElementById('btn-add-inventory');
    if (addBtn) addBtn.addEventListener('click', () => this.openForm(null));

    // -- location bar chart (hand-built, matches the Flutter version) --
    const byLocation = {};
    items.forEach((i) => { byLocation[i.location] = (byLocation[i.location] || 0) + 1; });
    const locEntries = Object.entries(byLocation).sort((a, b) => b[1] - a[1]);
    const maxLoc = locEntries.length ? Math.max(...locEntries.map(([, v]) => v)) : 0;
    document.getElementById('location-bars').innerHTML = locEntries.length ? locEntries.map(([label, value]) => `
      <div class="hbar-row">
        <div class="hbar-label">${escapeHtml(label)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${maxLoc ? (value / maxLoc) * 100 : 0}%"></div></div>
        <div style="width:24px;text-align:right;font-size:12px;color:var(--text-muted)">${value}</div>
      </div>`).join('') : '<p class="cell-muted">No inventory yet</p>';

    // -- turnover line chart --
    const months = lastNMonths(6);
    const soldCounts = monthlySoldCounts(DB.salesTransactions, months);
    const turnoverByMonth = soldCounts.map((c) => (items.length ? (c / items.length) * 100 : 0));
    makeLineChart('chart-turnover', months.map((m) => m.label), [{
      data: turnoverByMonth, borderColor: '#10184F', backgroundColor: 'rgba(16,24,79,0.08)',
      fill: false, tension: 0.35, pointRadius: 4, pointBackgroundColor: '#10184F',
    }], { yPrefix: '' });

    // -- slowest-moving leaderboard --
    const inventoryById = Object.fromEntries(items.map((i) => [i.id, i]));
    const entries = [];
    for (const t of DB.salesTransactions) {
      if (!t.itemId) continue;
      const item = inventoryById[t.itemId];
      if (!item) continue;
      const added = parseDateAdded(item.dateAdded);
      if (!added) continue;
      const days = Math.round((t.date - added) / 86400000);
      if (days < 0) continue;
      entries.push({ name: `${item.brand} ${item.category}`, days, price: item.price });
    }
    entries.sort((a, b) => b.days - a.days);
    const top = entries.slice(0, 5);
    document.getElementById('turnover-leaderboard').innerHTML = top.length ? top.map((e) => `
      <div class="leaderboard-row">
        <div class="leaderboard-name">${escapeHtml(e.name)}</div>
        <div class="leaderboard-meta">${e.days} Days &nbsp; ${escapeHtml(e.price)}</div>
      </div>`).join('') : '<p class="cell-muted">No sales history yet — this fills in once items start selling.</p>';
  },

  openForm(existing) {
    const isEdit = !!existing;
    const id = isEdit ? existing.id : this.nextItemId();
    const today = new Date();
    const html = `
      <form id="inventory-form">
        <div class="field-group"><label class="field-label">Brand</label><input class="field-input" name="brand" required value="${escapeHtml(existing?.brand || '')}"></div>
        <div class="field-group"><label class="field-label">Category</label><input class="field-input" name="category" required value="${escapeHtml(existing?.category || '')}"></div>
        <div class="field-group"><label class="field-label">Condition</label><input class="field-input" name="condition" required value="${escapeHtml(existing?.condition || '')}"></div>
        <div class="field-group"><label class="field-label">Status</label>
          <select class="field-input" name="status">
            ${['available', 'reserved', 'rejected', 'sold'].map((s) => `<option value="${s}" ${existing?.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="field-group"><label class="field-label">Location</label><input class="field-input" name="location" required value="${escapeHtml(existing?.location || '')}"></div>
        <div class="field-group"><label class="field-label">Date Added</label><input class="field-input" name="dateAdded" required value="${escapeHtml(existing?.dateAdded || `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`)}"></div>
        <div class="field-group"><label class="field-label">Transaction Status</label>
          <select class="field-input" name="transactionStatus">
            ${['none', 'pending', 'cancelled', 'completed'].map((s) => `<option value="${s}" ${existing?.transactionStatus === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="field-group"><label class="field-label">Price</label><input class="field-input" name="price" required value="${escapeHtml(existing?.price || '')}"></div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-close-modal>Cancel</button>
          <button type="submit" class="btn-confirm">${isEdit ? 'Save Changes' : 'Add Item'}</button>
        </div>
      </form>`;
    const overlay = openModal({ title: isEdit ? 'Edit Inventory Item' : 'Add Inventory Item', bodyHtml: html });
    overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    overlay.querySelector('#inventory-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newStatus = fd.get('status');
      const record = {
        id, brand: fd.get('brand').trim(), category: fd.get('category').trim(),
        condition: fd.get('condition').trim(), status: newStatus,
        location: fd.get('location').trim(), dateAdded: fd.get('dateAdded').trim(),
        transactionStatus: fd.get('transactionStatus'), price: fd.get('price').trim(),
      };
      const wasSold = existing?.status === 'sold';
      if (isEdit) {
        const idx = DB.inventory.findIndex((i) => i.id === id);
        DB.inventory[idx] = record;
      } else {
        DB.inventory.push(record);
      }
      // Auto-log a sale the moment an item flips to Sold — feeds the
      // Dashboard's Total Sales / turnover / leaderboard stats.
      if (newStatus === 'sold' && !wasSold) {
        DB.salesTransactions.push({
          id: nextId('txn'), itemLabel: `${record.brand} ${record.category} (${record.id})`,
          amount: parseAmountString(record.price), date: new Date(), itemId: record.id,
        });
      }
      closeModal();
      showToast(isEdit ? 'Item updated.' : 'Item added.');
      Router.rerender();
    });
  },
};
