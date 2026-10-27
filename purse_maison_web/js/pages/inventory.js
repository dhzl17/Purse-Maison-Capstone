/**
 * Inventory Management page — mirrors screens/inventory_management_page.dart
 * + widgets/inventory_table.dart + widgets/inventory_charts.dart +
 * widgets/inventory_item_dialog.dart.
 */

const InventoryPage = {
  pageSize: 6,
  currentPage: 1,
  searchKeyword: '',
  sortBy: 'recently',
  filterMonths: null,  
  filterBrands: null,

  statusBadge(status) {
    const map = {
      available: ['Available', 'info'],
      reserved: ['Reserved', 'warning'],
      rejected: ['Rejected', 'danger'],
      sold: ['Sold', 'success'],
    };
    const [label, tone] = map[status] || ['Unknown', 'info'];
    return badge(label, tone);
  },

  transactionCell(status) {
    if (status === 'none') return '<span class="cell-muted">-</span>';
    const map = { pending: ['Pending', 'warning'], cancelled: ['Cancelled', 'danger'], completed: ['Completed', 'success'] };
    const [label, tone] = map[status] || ['Unknown', 'info'];
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

  monthKeyOf(item) {
    const d = parseDateAdded(item.dateAdded);
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : null;
  },

  dateFilterGroups(items) {
    const years = new Map();
    for (const item of items) {
      const key = this.monthKeyOf(item);
      if (!key) continue;
      const [y, m] = key.split('-');
      if (!years.has(y)) years.set(y, new Set());
      years.get(y).add(m);
    }
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return [...years.keys()].sort((a, b) => b - a).map((y) => ({
      key: y,
      label: y,
      items: [...years.get(y)].sort().map((m) => ({ value: `${y}-${m}`, label: monthNames[Number(m) - 1] })),
    }));
  },

  filterAndSortItems(items) {
    let list = [...items];

    if (this.filterMonths !== null) {
      const months = new Set(this.filterMonths);
      list = list.filter((i) => months.has(this.monthKeyOf(i)));
    }

    if (this.filterBrands !== null) {
      const brands = new Set(this.filterBrands);
      list = list.filter(i => brands.has(i.brand));
    }

    if (this.searchKeyword) {
      const kw = this.searchKeyword.toLowerCase();
      list = list.filter(i =>
        String(i.id).toLowerCase().includes(kw) ||
        String(i.brand || '').toLowerCase().includes(kw) ||
        String(i.category || '').toLowerCase().includes(kw) ||
        String(i.location || '').toLowerCase().includes(kw)
      );
    }

    return sortRecords(list, this.sortBy);
  },

  render() {
    // Inventory is now a live view of the consignment pipeline (loaded by js/store.js).
    // Items are added and edited through Consignment Management, not here.
    const viewOnly = true;
    const allItems = DB.inventory;
    const processed = this.filterAndSortItems(allItems);
    const totalPages = Math.max(1, Math.ceil(processed.length / this.pageSize));
    this.currentPage = Math.min(Math.max(1, this.currentPage), totalPages);
    const start = (this.currentPage - 1) * this.pageSize;
    const pageItems = processed.slice(start, start + this.pageSize);

    const total = allItems.length;
    const available = allItems.filter((i) => i.status === 'available').length;
    const reserved = allItems.filter((i) => i.status === 'reserved').length;

    const uniqueBrands = [...new Set(allItems.map(i => i.brand).filter(Boolean))].sort();

    return `
      <h1 class="page-title">Inventory Management</h1>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-title">Total Items</div><div class="stat-value-row"><span class="stat-value">${total}</span></div></div>
        <div class="stat-card"><div class="stat-title">Available Items</div><div class="stat-value-row"><span class="stat-value">${available}</span></div></div>
        <div class="stat-card"><div class="stat-title">Reserved Items</div><div class="stat-value-row"><span class="stat-value">${reserved}</span></div></div>
        <div class="stat-card"><div class="stat-title">Low Stock Items</div><div class="stat-value-row"><span class="stat-value">0</span></div></div>
      </div>

      <div class="filter-toolbar-row">
        <div class="filter-controls-group">
          ${renderUniversalSearchBar('inventory-search-input', 'Search by ID, Brand...')}
          ${renderTreeFilter('inventory-date-filter', {
            label: 'Date Added',
            groups: this.dateFilterGroups(allItems),
            selected: this.filterMonths,
            searchPlaceholder: 'Search month or year',
            emptyText: 'No dates to filter yet.',
          })}
          ${renderTreeFilter('inventory-brand-filter', {
            label: 'Brand',
            items: uniqueBrands.map((b) => ({ value: b, label: b })),
            selected: this.filterBrands,
            searchPlaceholder: 'Search brand',
            emptyText: 'No brands yet.',
          })}
          <select class="sort-select" id="inventory-sort-select">
            <option value="recently" ${this.sortBy === 'recently' ? 'selected' : ''}>Sort: Recently Added</option>
            <option value="oldest" ${this.sortBy === 'oldest' ? 'selected' : ''}>Sort: Oldest First</option>
            <option value="price-high" ${this.sortBy === 'price-high' ? 'selected' : ''}>Sort: Price High to Low</option>
            <option value="price-low" ${this.sortBy === 'price-low' ? 'selected' : ''}>Sort: Price Low to High</option>
            <option value="alphabetical" ${this.sortBy === 'alphabetical' ? 'selected' : ''}>Sort: Brand A-Z</option>
          </select>
        </div>
        ${viewOnly ? '' : `<button class="btn-add" id="btn-add-inventory">+ Add Item</button>`}
      </div>

<div class="table-scroll">
        <table class="data-table inventory-table">
          <thead>
            <tr>
              <th class="col-id">Item ID</th>
              <th class="col-brand">Brand</th>
              <th class="col-category">Category</th>
              <th class="col-condition">Condition</th>
              <th class="col-status">Status</th>
              <th class="col-location">Location</th>
              <th class="col-date">Date Added</th>
              <th class="col-txn">Transaction Status</th>
              <th class="col-price">Price</th>
              ${viewOnly ? '' : '<th class="col-actions" style="text-align: center;">Actions</th>'}
            </tr>
          </thead>
          <tbody>
            ${pageItems.length === 0 ? `<tr><td colspan="${viewOnly ? 9 : 10}" class="cell-center cell-muted" style="padding:24px; text-align: center;">No inventory items match your search or filters.</td></tr>` :
              pageItems.map((item) => `
              <tr style="vertical-align: middle;">
                <td class="col-id">${escapeHtml(item.id)}</td>
                <td class="col-brand cell-bold">${escapeHtml(item.brand)}</td>
                <td class="col-category">${escapeHtml(item.category)}</td>
                <td class="col-condition">${escapeHtml(item.condition)}</td>
                <td class="col-status">${this.statusBadge(item.status)}</td>
                <td class="col-location">${escapeHtml(item.location)}</td>
                <td class="col-date">${escapeHtml(item.dateAdded)}</td>
                <td class="col-txn">${this.transactionCell(item.transactionStatus)}</td>
                <td class="col-price cell-bold">${escapeHtml(item.price)}</td>
                ${viewOnly ? '' : `<td class="col-actions" style="text-align: center; vertical-align: middle;"><div class="row-actions" style="justify-content: center;">
                  <button class="icon-btn" data-edit-inv="${item.id}" title="Edit">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button class="icon-btn danger" data-delete-inv="${item.id}" title="Delete">
                    <i class="fa-solid fa-trash-can"></i>
                  </button>
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
    return renderPaginationButtons(current, total);
  },

  afterRender() {
    const items = DB.inventory;
    DataStore.refreshIfStale();

    //Search bar
    const searchInput = document.getElementById('inventory-search-input');
    if (searchInput) {
      searchInput.value = this.searchKeyword;
      searchInput.addEventListener('input', debounce((e) => {
        this.searchKeyword = e.target.value;
        this.currentPage = 1;
        Router.rerender();
        const newInput = document.getElementById('inventory-search-input');
        if (newInput) { newInput.focus(); newInput.setSelectionRange(newInput.value.length, newInput.value.length); }
      }, 300));
    }

    bindTreeFilter('inventory-date-filter', (months) => {
      this.filterMonths = months;
      this.currentPage = 1;
      Router.rerender();
    });

    bindTreeFilter('inventory-brand-filter', (brands) => {
      this.filterBrands = brands;
      this.currentPage = 1;
      Router.rerender();
    });

    const sortSelect = document.getElementById('inventory-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.sortBy = e.target.value;
        this.currentPage = 1;
        Router.rerender();
      });
    }

    document.getElementById('inventory-pagination').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn) return;
      this.currentPage = parseInt(btn.dataset.page, 10);
      Router.rerender();
    });

    document.querySelectorAll('[data-edit-inv]').forEach((btn) => {
      btn.addEventListener('click', () => this.openForm(items.find((i) => i.id === btn.dataset.editInv)));
    });
    document.querySelectorAll('[data-delete-inv]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = items.find((i) => i.id === btn.dataset.deleteInv);
        confirmDelete(`${item.brand} (${item.id})`, () => {
          DB.inventory = DB.inventory.filter((i) => i.id !== item.id);
          localStorage.setItem('inventory_data', JSON.stringify(DB.inventory));
          showToast('Item deleted.');
          Router.rerender();
        });
      });
    });
    const addBtn = document.getElementById('btn-add-inventory');
    if (addBtn) addBtn.addEventListener('click', () => this.openForm(null));

    //location bar chart
    const filteredItems = this.filterAndSortItems(items);
    const byLocation = {};
    filteredItems.forEach((i) => { byLocation[i.location] = (byLocation[i.location] || 0) + 1; });
    const locEntries = Object.entries(byLocation).sort((a, b) => b[1] - a[1]);
    const maxLoc = locEntries.length ? Math.max(...locEntries.map(([, v]) => v)) : 0;
    document.getElementById('location-bars').innerHTML = locEntries.length ? locEntries.map(([label, value]) => `
      <div class="hbar-row">
        <div class="hbar-label">${escapeHtml(label)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${maxLoc ? (value / maxLoc) * 100 : 0}%"></div></div>
        <div style="width:24px;text-align:right;font-size:12px;color:var(--text-muted)">${value}</div>
      </div>`).join('') : '<p class="cell-muted">No inventory yet</p>';

    const thisYear = new Date().getFullYear();
    const months = this.filterMonths === null || !this.filterMonths.length
      ? lastNMonths(6)
      : [...this.filterMonths].sort().map((key) => {
        const [y, m] = key.split('-').map(Number);
        return { label: MONTH_ABBREV[m - 1] + (y !== thisYear ? ` '${String(y).slice(2)}` : ''), year: y, month: m };
      });
    const soldCounts = monthlySoldCounts(DB.salesTransactions, months);
    const turnoverByMonth = soldCounts.map((c) => (filteredItems.length ? (c / filteredItems.length) * 100 : 0));
    makeLineChart('chart-turnover', months.map((m) => m.label), [{
      data: turnoverByMonth, borderColor: '#10184F', backgroundColor: 'rgba(16,24,79,0.08)',
      fill: false, tension: 0.35, pointRadius: 4, pointBackgroundColor: '#10184F',
    }], { yPrefix: '' });

    const inventoryById = Object.fromEntries(filteredItems.map((i) => [i.id, i]));
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
     
      if (newStatus === 'sold' && !wasSold) {
        DB.salesTransactions.push({
          id: nextId('txn'), itemLabel: `${record.brand} ${record.category} (${record.id})`,
          amount: parseAmountString(record.price), date: new Date(), itemId: record.id,
        });
      }
      localStorage.setItem('inventory_data', JSON.stringify(DB.inventory));
      closeModal();
      showToast(isEdit ? 'Item updated.' : 'Item added.');
      Router.rerender();
    });
  },
};
