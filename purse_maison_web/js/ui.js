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
