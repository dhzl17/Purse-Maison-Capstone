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

// ---- Modal system ----------------------------------------------------
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

// ---- Toasts ------------------------------------------------------------
function showToast(message) {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---- Debounce Helper ---------------------------------------------------
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

// ---- SLA Countdown Badge Helper ---------------------------------------
function renderSLABadge(createdAtMs, targetHours = 24) {
  if (!createdAtMs) {
    // Default to 18h SLA
    return `<span class="sla-badge normal">⏱ 18h 30m SLA</span>`;
  }
  const now = Date.now();
  const elapsedMs = now - createdAtMs;
  const totalMs = targetHours * 3600 * 1000;
  const remainingMs = totalMs - elapsedMs;

  if (remainingMs <= 0) {
    return `<span class="sla-badge breached">🚨 SLA Breached</span>`;
  }

  const hours = Math.floor(remainingMs / (3600 * 1000));
  const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));

  if (hours < 4) {
    return `<span class="sla-badge warning">⚠️ ${hours}h ${minutes}m (Urgent)</span>`;
  }
  return `<span class="sla-badge normal">⏱ ${hours}h ${minutes}m remaining</span>`;
}

// ---- Record Sorting Helper --------------------------------------------
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

// ---- Render Universal Search Bar --------------------------------------
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

