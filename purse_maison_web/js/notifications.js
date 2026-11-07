/**
 * Notification bell (top bar), shown to every signed-in user.
 *   Alerts:  the inventory and sales notices chosen in Settings → Notification Settings (set by LoginAlerts).
 *   Tickets: Super Admin only. Counts support tickets that are not resolved yet (New + In Progress)
 *            and lists the latest ones, using the same support_tickets table and Row Level Security
 *            as Help Center → Submit a Ticket.
 * The ticket count refreshes every 30 seconds, when the browser tab becomes active again,
 * and right after a ticket is submitted or updated in this browser.
 */

const TicketBell = {
  REFRESH_MS: 30000,
  LIST_LIMIT: 10,
  tickets: [],
  alerts: [],
  count: 0,
  lastId: null,
  timer: null,
  loading: false,
  bound: false,

  enabled() {
    return !!Session.currentUser;
  },

  isOwner() {
    return !!Session.currentUser && Session.currentUser.role === 'superAdmin';
  },

  total() {
    return this.alerts.length + (this.isOwner() ? this.count : 0);
  },

  start() {
    const root = document.getElementById('ticket-bell');
    if (!root) return;
    root.hidden = !this.enabled();
    if (!this.enabled()) return;
    this.bind();
    this.alerts = [];
    this.tickets = [];
    this.count = 0;
    this.lastId = null;
    this.draw();
    clearInterval(this.timer);
    if (this.isOwner()) {
      this.refresh();
      this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, this.REFRESH_MS);
    }
  },

  /** Called by LoginAlerts with the notices for this user: [{ label, text, route }]. */
  setAlerts(list) {
    this.alerts = list || [];
    this.draw();
  },

  async refresh() {
    if (!this.isOwner() || this.loading) return;
    this.loading = true;
    try {
      const { data, error, count } = await sbClient.from('support_tickets')
        .select('id, subject, status, created_by, created_at', { count: 'exact' })
        .neq('status', 'resolved')
        .order('created_at', { ascending: false })
        .limit(this.LIST_LIMIT);
      if (error) throw error;
      const list = data || [];

      if (this.lastId !== null) {
        const uid = Session.currentUser.uid;
        const fresh = list.filter((t) => t.id > this.lastId && t.created_by !== uid);
        if (fresh.length === 1) showToast(`New ticket ${HelpPage.ticketCode(fresh[0])}: ${fresh[0].subject}`);
        else if (fresh.length > 1) showToast(`${fresh.length} new tickets were submitted.`);
      }
      this.lastId = list.reduce((max, t) => Math.max(max, t.id), this.lastId || 0);
      this.tickets = list;
      this.count = typeof count === 'number' ? count : list.length;
    } catch (err) {
      console.error('Loading ticket notifications failed:', err);
    } finally {
      this.loading = false;
    }
    this.draw();
  },

  draw() {
    const badgeEl = document.getElementById('ticket-bell-count');
    const button = document.getElementById('ticket-bell-btn');
    if (!badgeEl || !button) return;
    const total = this.total();
    badgeEl.textContent = total > 99 ? '99+' : String(total);
    badgeEl.hidden = total === 0;
    button.setAttribute('aria-label', `Notifications: ${total} to review`);
    const panel = document.getElementById('ticket-bell-panel');
    if (panel && !panel.hidden) panel.innerHTML = this.panelHtml();
  },

  alertsHtml() {
    if (!this.alerts.length) return '';
    const items = this.alerts.map((a, idx) => `
      <li>
        <button type="button" class="notif-item" data-bell-alert="${escapeHtml(a.route)}" data-bell-index="${idx}">
          <span class="notif-item-top"><span class="help-ticket-code">${escapeHtml(a.label)}</span></span>
          <span class="notif-item-subject" style="white-space:normal;">${escapeHtml(a.text)}</span>
        </button>
      </li>`).join('');
    return `
      <div class="notif-sub" style="padding:8px 14px 0;">Alerts</div>
      <ul class="notif-list">${items}</ul>`;
  },

  ticketsHtml() {
    if (!this.isOwner()) return '';
    const items = this.tickets.map((t) => `
      <li>
        <button type="button" class="notif-item" data-bell-ticket="${t.id}" data-bell-status="${escapeHtml(t.status)}">
          <span class="notif-item-top">
            <span class="help-ticket-code">${HelpPage.ticketCode(t)}</span>
            ${HelpPage.ticketStatusBadge(t.status)}
          </span>
          <span class="notif-item-subject">${escapeHtml(t.subject)}</span>
          <span class="notif-item-date">${escapeHtml(DataStore.formatDateTime(t.created_at))}</span>
        </button>
      </li>`).join('');
    return `
      <div class="notif-sub" style="padding:8px 14px 0;">Tickets · ${this.count} unresolved</div>
      ${items ? `<ul class="notif-list">${items}</ul>` : '<p class="notif-empty">No unresolved tickets.</p>'}
      <div class="notif-foot">
        <button type="button" class="help-link" data-bell-all>View all tickets</button>
      </div>`;
  },

  panelHtml() {
    const total = this.total();
    const body = this.alertsHtml() + this.ticketsHtml();
    return `
      <div class="notif-head">
        <span class="notif-title">Notifications</span>
        <span class="notif-sub">${total} to review</span>
      </div>
      ${body || '<p class="notif-empty">You are all caught up.</p>'}`;
  },

  open() {
    const panel = document.getElementById('ticket-bell-panel');
    panel.innerHTML = this.panelHtml();
    panel.hidden = false;
    document.getElementById('ticket-bell-btn').setAttribute('aria-expanded', 'true');
    this.refresh();
  },

  close() {
    const panel = document.getElementById('ticket-bell-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.getElementById('ticket-bell-btn').setAttribute('aria-expanded', 'false');
  },

  bind() {
    if (this.bound) return;
    this.bound = true;
    const root = document.getElementById('ticket-bell');
    const panel = document.getElementById('ticket-bell-panel');

    document.getElementById('ticket-bell-btn').addEventListener('click', () => {
      if (panel.hidden) this.open(); else this.close();
    });
    panel.addEventListener('click', (e) => {
      const alertItem = e.target.closest('[data-bell-alert]');
      if (alertItem) {
        const idx = Number(alertItem.dataset.bellIndex);
        const picked = this.alerts[idx];
        if (picked && typeof picked.onOpen === 'function') picked.onOpen();
        if (picked && !picked.sticky) this.alerts.splice(idx, 1);
        this.close();
        this.draw();
        Router.navigate(alertItem.dataset.bellAlert);
        return;
      }
      const item = e.target.closest('[data-bell-ticket]');
      if (item) {
        this.close();
        HelpPage.openTicket(Number(item.dataset.bellTicket), item.dataset.bellStatus);
        return;
      }
      if (e.target.closest('[data-bell-all]')) {
        this.close();
        HelpPage.openTicket(null, 'open');
      }
    });
    document.addEventListener('click', (e) => { if (!root.contains(e.target)) this.close(); });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.close(); document.getElementById('ticket-bell-btn').focus(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
  },
};