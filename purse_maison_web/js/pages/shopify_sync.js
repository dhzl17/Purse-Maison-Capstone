/**
 * Shopify Sync card (Settings page) — owner and manager.
 * The store is updated automatically every minute by the shopify-sync Edge Function (Module 29). This card shows
 * whether Shopify matches the system and has buttons to push changes right away (useful during a demo).
 *
 *   Sync now               sends every item waiting to go to Shopify
 *   Compare with Shopify   asks Shopify for its product counts and shows them next to the system's
 *   Resync all             marks every listed item to be sent again (e.g. after re-importing the mock data)
 *   Connect order webhooks (owner) tells Shopify to report paid orders to the shopify-webhook function
 *   Remove extra products  (owner) deletes Shopify products made by this system whose item no longer exists here
 */

const SHOPIFY_SYNC_LABELS = {
  synced: ['Synced', 'success'],
  pending: ['Waiting', 'warning'],
  syncing: ['Sending', 'info'],
  failed: ['Failed', 'danger'],
};

const ShopifySync = {
  overview: null,      // rows of shopify_sync_overview
  failed: null,        // items whose last sync failed
  audit: null,         // last result of "Compare with Shopify"
  loadError: null,
  busy: '',            // which button is running
  progress: '',
  loading: false,
  loadedFor: null,

  canSee() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'superAdmin' || role === 'manager';
  },

  isOwner() { return !!Session.currentUser && Session.currentUser.role === 'superAdmin'; },

  totals() {
    const t = { published: 0, reserved: 0, sold: 0, archived: 0, synced: 0, pending: 0, syncing: 0, failed: 0 };
    for (const r of this.overview || []) {
      t[r.inventory_status] = (t[r.inventory_status] || 0) + r.items;
      t[r.shopify_sync_status] = (t[r.shopify_sync_status] || 0) + r.items;
    }
    t.active = t.published + t.reserved;
    t.archivedTotal = t.sold + t.archived;
    t.total = t.active + t.archivedTotal;
    return t;
  },

  render() {
    const t = this.totals();
    const a = this.audit && this.audit.shopify;
    const cell = (n) => (a ? `<strong>${n}</strong>` : '<span class="cell-muted">—</span>');
    const match = (sys, shop) => (!a ? '' : sys === shop ? badge('Same', 'success') : badge(`Off by ${Math.abs(sys - shop)}`, 'danger'));
    const btn = (id, label, primary) => `<button class="${primary ? 'btn-add' : 'btn-secondary'}" id="${id}" ${this.busy ? 'disabled' : ''}>${this.busy === id ? 'Working…' : label}</button>`;

    let body;
    if (this.loadError) body = `<p class="cell-muted">Could not load the sync status: ${escapeHtml(this.loadError)}</p>`;
    else if (!this.overview) body = '<p class="cell-muted">Loading…</p>';
    else {
      body = `
        <div class="table-scroll" style="margin-bottom:14px;">
          <table class="data-table" style="min-width:560px;">
            <thead><tr><th>Products</th><th>In the system</th><th>In Shopify</th><th></th></tr></thead>
            <tbody>
              <tr><td>On sale (Active)<div class="cell-muted" style="font-size:11.5px;">published ${t.published} + reserved (layaway) ${t.reserved}</div></td>
                <td><strong>${t.active}</strong></td><td>${cell(a && a.active)}</td><td>${match(t.active, a && a.active)}</td></tr>
              <tr><td>Sold or withdrawn (Archived)<div class="cell-muted" style="font-size:11.5px;">sold ${t.sold} + withdrawn ${t.archived}</div></td>
                <td><strong>${t.archivedTotal}</strong></td><td>${cell(a && a.archived)}</td><td>${match(t.archivedTotal, a && a.archived)}</td></tr>
              <tr><td><strong>Total</strong></td><td><strong>${t.total}</strong></td><td>${cell(a && a.total)}</td><td>${match(t.total, a && a.total)}</td></tr>
            </tbody>
          </table>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:14px; font-size:13px;">
          <span class="cell-muted">Sync status:</span>
          ${Object.entries(SHOPIFY_SYNC_LABELS).map(([key, [label, tone]]) => badge(`${label} ${t[key] || 0}`, t[key] ? tone : 'info')).join(' ')}
          ${this.audit ? `<span class="cell-muted">· compared ${escapeHtml(this.audit.at)}</span>` : ''}
        </div>
        ${this.progress ? `<p style="font-size:13px; margin-bottom:12px;">${escapeHtml(this.progress)}</p>` : ''}
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:${this.failed && this.failed.length ? 18 : 0}px;">
          ${btn('shopify-sync-now', 'Sync now', true)}
          ${btn('shopify-compare', 'Compare with Shopify')}
          ${btn('shopify-resync-all', 'Resync all')}
          ${this.isOwner() ? btn('shopify-webhooks', 'Connect order webhooks') : ''}
          ${this.isOwner() ? btn('shopify-orphans', 'Remove extra Shopify products') : ''}
        </div>
        ${this.failed && this.failed.length ? `
          <div class="card-title" style="font-size:14px; margin-bottom:8px;">Failed (${this.failed.length})</div>
          ${this.failed.map((f) => `
            <div class="staff-row" style="flex-wrap:wrap; gap:8px;">
              <div style="min-width:220px; flex:1;"><strong>${escapeHtml(f.item_code)}</strong> ${escapeHtml([f.brand, f.model].filter(Boolean).join(' '))}
                <div style="font-size:12px; color:var(--danger-red);">${escapeHtml(f.shopify_sync_error || 'Unknown error')}</div></div>
              <button class="btn-secondary" data-shopify-retry="${f.id}" style="padding:5px 10px; font-size:12px;" ${this.busy ? 'disabled' : ''}>Retry</button>
            </div>`).join('')}` : ''}`;
    }

    return `
      <div class="card" style="margin-bottom:24px;">
        <div class="card-title" style="margin-bottom:6px;">Shopify Sync</div>
        <p class="cell-muted" style="font-size:13px; margin-bottom:16px;">Every item with a published, reserved, sold or withdrawn listing is one product in Shopify. Changes are sent automatically every minute; paid Shopify orders are recorded in Sales &amp; Payouts.</p>
        ${body}
      </div>`;
  },

  // ----------------------------------------------------------------- data
  async load() {
    this.loading = true;
    const [ov, failed] = await Promise.all([
      sbClient.from('shopify_sync_overview').select('inventory_status, shopify_sync_status, items'),
      sbClient.from('consignment_items').select('id, item_code, brand, model, shopify_sync_error')
        .eq('shopify_sync_status', 'failed').order('updated_at', { ascending: false }).limit(20),
    ]);
    this.loading = false;
    this.loadError = ov.error ? ov.error.message : (failed.error ? failed.error.message : null);
    this.overview = ov.error ? [] : ov.data;
    this.failed = failed.error ? [] : failed.data;
    Router.rerender();
  },

  /** Calls the shopify-sync Edge Function and returns its JSON, or throws with a readable message. */
  async call(body) {
    const { data, error } = await sbClient.functions.invoke('shopify-sync', { body });
    if (error) {
      let msg = error.message || 'Request failed';
      try {
        const detail = error.context && typeof error.context.json === 'function' ? await error.context.json() : null;
        if (detail && detail.error) msg = detail.error;
      } catch (_) { /* keep the generic message */ }
      if (/Failed to send a request|not found|404/i.test(msg)) msg = 'The shopify-sync Edge Function is not deployed yet.';
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  },

  async run(id, task) {
    if (this.busy) return;
    this.busy = id;
    Router.rerender();
    try {
      await task();
    } catch (err) {
      showToast(err.message || 'Something went wrong.');
    } finally {
      this.busy = '';
      this.progress = '';
      await this.load();
    }
  },

  async syncNow() {
    let sent = 0, failed = 0;
    for (let round = 0; round < 30; round++) {
      const r = await this.call({ action: 'run' });
      sent += r.synced; failed += r.failed;
      this.progress = `Sent ${sent} item(s) to Shopify${failed ? `, ${failed} failed` : ''}. ${r.stillPending ? `${r.stillPending} still waiting…` : ''}`;
      Router.rerender();
      if (!r.stillPending) break;
      if (r.stoppedForRateLimit) await new Promise((res) => setTimeout(res, 5000));
    }
    showToast(sent || failed ? `Shopify sync: ${sent} sent${failed ? `, ${failed} failed` : ''}.` : 'Shopify is already up to date.');
  },

  async compare() {
    const r = await this.call({ action: 'audit' });
    this.audit = { ...r, at: new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) };
  },

  // ----------------------------------------------------------------- bind
  afterRender() {
    if (!this.canSee()) return;
    if (this.loadedFor !== Session.currentUser.uid) {
      this.loadedFor = Session.currentUser.uid;
      this.overview = null; this.failed = null; this.audit = null; this.loadError = null;
    }
    if (this.overview === null && !this.loading) { this.load(); return; }

    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    on('shopify-sync-now', () => this.run('shopify-sync-now', () => this.syncNow()));
    on('shopify-compare', () => this.run('shopify-compare', () => this.compare()));
    on('shopify-resync-all', () => {
      const overlay = openModal({
        title: 'Resync all items?',
        bodyHtml: `<p>Every item with a published, reserved, sold or withdrawn listing will be sent to Shopify again. Existing products are updated, not duplicated. This can take several minutes for many items.</p>
          <div class="modal-actions"><button class="btn-secondary" data-close-modal>Cancel</button><button class="btn-confirm" id="resync-ok">Resync all</button></div>`,
      });
      overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
      overlay.querySelector('#resync-ok').addEventListener('click', () => {
        closeModal();
        this.run('shopify-resync-all', async () => {
          const { data, error } = await sbClient.rpc('request_shopify_sync', { p_item_id: null });
          if (error) throw error;
          showToast(`${data} item(s) marked to be sent. Starting now…`);
          await this.syncNow();
        });
      });
    });
    on('shopify-webhooks', () => this.run('shopify-webhooks', async () => {
      const r = await this.call({ action: 'register_webhooks' });
      showToast(`Order webhooks connected: ${r.webhooks.join(', ')}.`);
    }));
    on('shopify-orphans', () => {
      const overlay = openModal({
        title: 'Remove extra Shopify products?',
        bodyHtml: `<p>Products that this system created in Shopify, but whose item no longer has a listing here (for example after test data was deleted), will be <strong>deleted from Shopify</strong>. Products you added in Shopify yourself are not touched. This cannot be undone.</p>
          <div class="modal-actions"><button class="btn-secondary" data-close-modal>Cancel</button><button class="btn-confirm btn-danger" id="orphans-ok">Remove</button></div>`,
      });
      overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
      overlay.querySelector('#orphans-ok').addEventListener('click', () => {
        closeModal();
        this.run('shopify-orphans', async () => {
          const r = await this.call({ action: 'remove_orphans' });
          showToast(r.deleted ? `${r.deleted} extra product(s) removed from Shopify.` : 'No extra products found.');
          await this.compare();
        });
      });
    });
    document.querySelectorAll('[data-shopify-retry]').forEach((b) => b.addEventListener('click', () =>
      this.run('shopify-retry', async () => {
        const { error } = await sbClient.rpc('request_shopify_sync', { p_item_id: b.dataset.shopifyRetry });
        if (error) throw error;
        await this.syncNow();
      })));
  },
};
