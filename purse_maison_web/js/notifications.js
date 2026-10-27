/**
 * Ticket notifications (bell in the top bar), shown to the Super Admin only.
 * Counts support tickets that are not resolved yet (New + In Progress) and lists the latest ones.
 * Uses the same support_tickets table and Row Level Security as Help Center → Submit a Ticket.
 * The count refreshes every 30 seconds, when the browser tab becomes active again,
 * and right after a ticket is submitted or updated in this browser.
 */

const TicketBell = {
  REFRESH_MS: 30000,
  LIST_LIMIT: 10,
  tickets: [],   
  count: 0,       
  lastId: null,
  timer: null, 
  loading: false,
  bound: false,

  enabled() {
    return !!Session.currentUser && Session.currentUser.role === 'superAdmin';
  },

  start() {
    const root = document.getElementById('ticket-bell');
    if (!root) return;
    root.hidden = !this.enabled();
    if (!this.enabled()) return;
    this.bind();
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, this.REFRESH_MS);
  },

  async refresh() {
    if (!this.enabled() || this.loading) return;
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
    badgeEl.textContent = this.count > 99 ? '99+' : String(this.count);
    badgeEl.hidden = this.count === 0;
    button.setAttribute('aria-label', `Ticket notifications: ${this.count} unresolved`);
    const panel = document.getElementById('ticket-bell-panel');
    if (panel && !panel.hidden) panel.innerHTML = this.panelHtml();
  },

  panelHtml() {
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
      <div class="notif-head">
        <span class="notif-title">Ticket Notifications</span>
        <span class="notif-sub">${this.count} unresolved</span>
      </div>
      ${items ? `<ul class="notif-list">${items}</ul>` : '<p class="notif-empty">No unresolved tickets.</p>'}
      <div class="notif-foot">
        <button type="button" class="help-link" data-bell-all>View all tickets</button>
      </div>`;
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