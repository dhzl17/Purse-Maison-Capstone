/**
 * Shared UI helpers used across every page module: HTML escaping, status
 * badges, the modal system, toasts, and small formatting utilities.
 * Mirrors widgets/dialog_widgets.dart + widgets/common_widgets.dart from
 * the Flutter app.
 */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** tone: 'success' | 'danger' | 'warning' | 'info' */
function badge(label, tone) {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function formatAmount(amount) {
  const whole = Math.round(amount).toString();
  let out = '';
  for (let i = 0; i < whole.length; i++) {
    const posFromEnd = whole.length - i;
    out += whole[i];
    if (posFromEnd > 1 && posFromEnd % 3 === 1) out += ',';
  }
  return out;
}

function parseAmountString(s) {
  const digits = String(s ?? '').replace(/[^0-9.]/g, '');
  const n = parseFloat(digits);
  return isNaN(n) ? 0 : n;
}

/** Parses "M/D/YYYY" strings used for inventory dateAdded. */
function parseDateAdded(s) {
  const parts = String(s ?? '').split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map((p) => parseInt(p, 10));
  if (!m || !d || !y) return null;
  return new Date(y, m - 1, d);
}

//Modal system
function openModal({ title, bodyHtml, wide = false }) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${wide ? '' : ''}">
      <div class="modal-header">
        <div class="modal-title">${escapeHtml(title)}</div>
        <button class="modal-close" data-close-modal>&times;</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeModal);
  });
  root.innerHTML = '';
  root.appendChild(overlay);
  return overlay;
}

function closeModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
}

function confirmDelete(itemLabel, onConfirm) {
  const overlay = openModal({
    title: 'Delete this item?',
    bodyHtml: `
      <p>This will permanently remove "${escapeHtml(itemLabel)}". This can't be undone.</p>
      <div class="modal-actions">
        <button class="btn-secondary" data-close-modal>Cancel</button>
        <button class="btn-confirm btn-danger" id="confirm-delete-btn">Delete</button>
      </div>`,
  });
  overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
  overlay.querySelector('#confirm-delete-btn').addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
}

function showToast(message) {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function renderSLABadge(createdAtMs, targetHours = 24) {
  if (!createdAtMs) {
    return `<span class="sla-badge normal">⏱ 18h 30m SLA</span>`;
  }
  const now = Date.now();
  const elapsedMs = now - createdAtMs;
  const totalMs = targetHours * 3600 * 1000;
  const remainingMs = totalMs - elapsedMs;

  if (remainingMs <= 0) {
    return `<span class="sla-badge breached">SLA Breached</span>`;
  }

  const hours = Math.floor(remainingMs / (3600 * 1000));
  const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));

  if (hours < 4) {
    return `<span class="sla-badge warning">⚠️${hours}h ${minutes}m (Urgent)</span>`;
  }
  return `<span class="sla-badge normal">⏱ ${hours}h ${minutes}m remaining</span>`;
}

function sortRecords(records, sortBy = 'recently') {
  const list = [...records];
  switch (sortBy) {
    case 'oldest':
      return list.sort((a, b) => {
        const da = parseDateAdded(a.dateAdded) || new Date(a.createdAt || 0);
        const db = parseDateAdded(b.dateAdded) || new Date(b.createdAt || 0);
        return da - db;
      });
    case 'price-high':
    case 'price-desc':
      return list.sort((a, b) => parseAmountString(b.price || b.askingPrice) - parseAmountString(a.price || a.askingPrice));
    case 'price-low':
    case 'price-asc':
      return list.sort((a, b) => parseAmountString(a.price || a.askingPrice) - parseAmountString(b.price || b.askingPrice));
    case 'alphabetical':
    case 'a-z':
      return list.sort((a, b) => {
        const nameA = String(a.brand || a.itemName || a.clientName || '').toLowerCase();
        const nameB = String(b.brand || b.itemName || b.clientName || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    case 'recently':
    default:
      return list.sort((a, b) => {
        const da = parseDateAdded(a.dateAdded) || new Date(a.createdAt || 0);
        const db = parseDateAdded(b.dateAdded) || new Date(b.createdAt || 0);
        return db - da;
      });
  }
}

function renderUniversalSearchBar(inputId, placeholder = 'Search by ID, Brand, Name, Serial #, Consignor...') {
  return `
<div class="universal-search-wrap">
      <svg class="universal-search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="#0F2B48">
        <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
      <input type="text" id="${inputId}" class="universal-search-input" placeholder="${escapeHtml(placeholder)}" />
    </div>
  `;
}

function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 3) return [1, 2, 3, 4, '…', total];
  if (current >= total - 2) return [1, '…', total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

function renderPaginationButtons(current, total) {
  const numbers = buildPageList(current, total).map((p) => (
    p === '…'
      ? '<span class="page-ellipsis">…</span>'
      : `<button class="${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`
  )).join('');

  return `
    <button class="page-nav page-nav-prev" ${current === 1 ? 'disabled' : ''} data-page="${current - 1}">
      <span class="page-nav-arrow">⟵</span><span class="page-nav-label">Previous</span>
    </button>
    <div class="page-numbers">${numbers}</div>
    <button class="page-nav page-nav-next" ${current === total ? 'disabled' : ''} data-page="${current + 1}">
      <span class="page-nav-label">Next</span><span class="page-nav-arrow">⟶</span>
    </button>`;
}

function fillerRows(rendered, pageSize, colCount, totalPages) {
  const n = pageSize - rendered;
  if (totalPages <= 1 || rendered === 0 || n <= 0) return '';
  return Array(n).fill(`<tr class="filler-row" aria-hidden="true"><td colspan="${colCount}"></td></tr>`).join('');
}


// ---------------------------------------------------------------- tree filter
/**
 * A dropdown filter with tick boxes, used by every filter in the system.
 *   groups:   [{ key, label, items: [{ value, label }] }]  tick boxes under headings (e.g. Year → Month)
 *   items:    [{ value, label }]                          a plain list instead of groups (e.g. brands)
 *   selected: array of values, or null when everything is selected ("Select All")
 *   single:   true for one-choice filters (e.g. a period); selected is then one value
 *   defaultValue: for single filters, the value that counts as "not filtered"
 *   search:   show the search box (default: when there are more than 6 options)
 * Tick-box filters apply when the user clicks Apply; one-choice filters apply on click.
 * bindTreeFilter's onApply receives the chosen values (null = everything) or the single value.
 */
function renderTreeFilter(id, { label, groups, items, selected = null, single = false, defaultValue = null,
  search, searchPlaceholder = 'Search', emptyText = 'Nothing to filter yet.' }) {
  const list = items ? [{ key: 'all', label: '', items, flat: true }] : (groups || []);
  const options = list.flatMap((g) => g.items.map((i) => ({ ...i, value: String(i.value), group: g.flat ? '' : g.label })));
  const all = options.map((o) => o.value);
  const showSearch = search === undefined ? all.length > 6 : search;

  let chosen;
  let summary;
  let active;
  if (single) {
    const value = selected === null || selected === undefined ? String(defaultValue) : String(selected);
    chosen = new Set([value]);
    const found = options.find((o) => o.value === value);
    summary = found ? found.label : 'All';
    active = defaultValue !== null && value !== String(defaultValue);
  } else {
    chosen = selected === null || selected === undefined
      ? new Set(all)
      : new Set(selected.map(String).filter((v) => all.includes(v)));
    const isAll = chosen.size === all.length;
    summary = 'All';
    if (all.length && chosen.size === 0) summary = 'None';
    else if (!isAll && chosen.size === 1) {
      const only = options.find((o) => chosen.has(o.value));
      summary = only ? `${only.label}${only.group ? ` ${only.group}` : ''}` : '1 selected';
    } else if (!isAll) summary = `${chosen.size} selected`;
    active = !isAll;
  }

  const input = (o) => (single
    ? `<input type="radio" name="${escapeHtml(id)}-choice" value="${escapeHtml(o.value)}" data-tree-item ${chosen.has(o.value) ? 'checked' : ''}>`
    : `<input type="checkbox" value="${escapeHtml(o.value)}" data-tree-item ${chosen.has(o.value) ? 'checked' : ''}>`);

  const itemRows = (g) => g.items.map((i) => {
    const o = { ...i, value: String(i.value) };
    return `
          <li class="tree-filter-row tree-filter-item" data-tree-search="${escapeHtml(`${o.label} ${g.flat ? '' : g.label}`.trim().toLowerCase())}">
            <label class="tree-filter-check">
              ${input(o)}
              <span>${escapeHtml(o.label)}</span>
            </label>
          </li>`;
  }).join('');

  const groupHtml = list.map((g, gi) => (g.flat ? `
    <li class="tree-filter-group tree-filter-flat" data-tree-group="${escapeHtml(g.key)}">
      <ul class="tree-filter-items">${itemRows(g)}</ul>
    </li>` : `
    <li class="tree-filter-group" data-tree-group="${escapeHtml(g.key)}">
      <div class="tree-filter-row tree-filter-group-row">
        <button type="button" class="tree-filter-toggle" data-tree-toggle aria-expanded="${gi === 0 ? 'true' : 'false'}" aria-label="Show or hide ${escapeHtml(g.label)}">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        ${single ? `<span class="tree-filter-check"><span class="tree-filter-group-label">${escapeHtml(g.label)}</span><span class="tree-filter-count">${g.items.length}</span></span>` : `
        <label class="tree-filter-check">
          <input type="checkbox" data-tree-group-check>
          <span class="tree-filter-group-label">${escapeHtml(g.label)}</span>
          <span class="tree-filter-count">${g.items.length}</span>
        </label>`}
      </div>
      <ul class="tree-filter-items" ${gi === 0 ? '' : 'hidden'}>${itemRows(g)}</ul>
    </li>`)).join('');

  return `
    <div class="tree-filter${single ? ' tree-filter-single' : ''}" id="${escapeHtml(id)}">
      <button type="button" class="tree-filter-button${active ? ' is-active' : ''}" aria-haspopup="true" aria-expanded="false">
        <span class="tree-filter-button-label">${escapeHtml(label)}:</span>
        <span class="tree-filter-button-value">${escapeHtml(summary)}</span>
        <svg class="tree-filter-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="tree-filter-panel" role="dialog" aria-label="${escapeHtml(label)} filter" hidden>
        ${all.length ? `
          ${showSearch ? `
          <div class="tree-filter-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-5.2-5.2m0 0A7.5 7.5 0 1 0 5.2 5.2a7.5 7.5 0 0 0 10.6 10.6Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
            <input type="search" placeholder="${escapeHtml(searchPlaceholder)}" aria-label="${escapeHtml(searchPlaceholder)}" data-tree-search-input autocomplete="off">
          </div>` : ''}
          ${single ? '' : `
          <div class="tree-filter-row tree-filter-all">
            <label class="tree-filter-check">
              <input type="checkbox" data-tree-all>
              <span>(Select All)</span>
            </label>
          </div>`}
          <ul class="tree-filter-tree">${groupHtml}</ul>
          <p class="tree-filter-empty" hidden>No matches.</p>
          ${single ? '' : `
          <div class="tree-filter-footer">
            <button type="button" class="tree-filter-clear" data-tree-clear>Clear</button>
            <button type="button" class="tree-filter-apply" data-tree-apply>Apply</button>
          </div>`}` : `<p class="tree-filter-empty">${escapeHtml(emptyText)}</p>`}
      </div>
    </div>`;
}

let _treeFilterDocBound = false; // one page-wide listener closes any open tree filter

function closeTreeFilter(root) {
  root.querySelector('.tree-filter-panel').hidden = true;
  root.querySelector('.tree-filter-button').setAttribute('aria-expanded', 'false');
  root.classList.remove('is-open');
}

function bindTreeFilter(id, onApply) {
  const root = document.getElementById(id);
  if (!root) return;
  const single = root.classList.contains('tree-filter-single');
  const button = root.querySelector('.tree-filter-button');
  const panel = root.querySelector('.tree-filter-panel');
  const itemBoxes = () => [...root.querySelectorAll('[data-tree-item]')];

  const syncChecks = () => {
    if (single) return;
    root.querySelectorAll('.tree-filter-group').forEach((g) => {
      const groupBox = g.querySelector('[data-tree-group-check]');
      if (!groupBox) return;
      const boxes = [...g.querySelectorAll('[data-tree-item]')];
      const on = boxes.filter((b) => b.checked).length;
      groupBox.checked = on === boxes.length;
      groupBox.indeterminate = on > 0 && on < boxes.length;
    });
    const allBox = root.querySelector('[data-tree-all]');
    if (allBox) {
      const boxes = itemBoxes();
      const on = boxes.filter((b) => b.checked).length;
      allBox.checked = boxes.length > 0 && on === boxes.length;
      allBox.indeterminate = on > 0 && on < boxes.length;
    }
    const apply = root.querySelector('[data-tree-apply]');
    if (apply) apply.disabled = !itemBoxes().some((b) => b.checked);
  };

  const open = () => {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
    (root.querySelector('[data-tree-search-input]') || root.querySelector('[data-tree-item]:checked') || root.querySelector('[data-tree-item]'))?.focus();
  };
  const close = () => closeTreeFilter(root);

  button.addEventListener('click', () => {
    if (panel.hidden) open(); else close();
  });
  if (!_treeFilterDocBound) {
    _treeFilterDocBound = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.tree-filter.is-open').forEach((r) => { if (!r.contains(e.target)) closeTreeFilter(r); });
    });
  }
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); button.focus(); }
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (single && t.matches('[data-tree-item]')) {
      close();
      onApply(t.value);
      return;
    }
    if (t.matches('[data-tree-all]')) {
      // Only the options shown by the current search (collapsed groups still count)
      itemBoxes().filter((b) => !b.closest('.tree-filter-item[hidden], .tree-filter-group[hidden]')).forEach((b) => { b.checked = t.checked; });
    } else if (t.matches('[data-tree-group-check]')) {
      t.closest('.tree-filter-group').querySelectorAll('[data-tree-item]').forEach((b) => { b.checked = t.checked; });
    }
    syncChecks();
  });

  root.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-tree-toggle]');
    if (toggle) {
      const list = toggle.closest('.tree-filter-group').querySelector('.tree-filter-items');
      const expand = list.hidden;
      list.hidden = !expand;
      toggle.setAttribute('aria-expanded', String(expand));
      return;
    }
    if (e.target.closest('[data-tree-clear]')) {
      itemBoxes().forEach((b) => { b.checked = false; });
      syncChecks();
      return;
    }
    if (e.target.closest('[data-tree-apply]')) {
      const boxes = itemBoxes();
      const values = boxes.filter((b) => b.checked).map((b) => b.value);
      close();
      onApply(values.length === boxes.length ? null : values);
    }
  });

  root.querySelector('[data-tree-search-input]')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll('.tree-filter-group').forEach((g) => {
      let groupShown = 0;
      g.querySelectorAll('.tree-filter-item').forEach((row) => {
        const hit = !q || row.dataset.treeSearch.includes(q);
        row.hidden = !hit;
        if (hit) groupShown++;
      });
      g.hidden = groupShown === 0;
      if (q && groupShown) {
        g.querySelector('.tree-filter-items').hidden = false;
        g.querySelector('[data-tree-toggle]')?.setAttribute('aria-expanded', 'true');
      }
      shown += groupShown;
    });
    const empty = root.querySelector('.tree-filter-empty');
    if (empty) empty.hidden = shown > 0;
  });

  syncChecks();
}