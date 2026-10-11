/**
 * Pricing & Markup page (stage 16) — connected to Supabase.
 * Load after consignment_intake.js; it adds the 'consignment-pricing' page to ConsignmentFlow.
 *
 * The pricing team sets the final selling price. The database works out the markup from the tier
 * schedule and the consignor payout (price − markup), as in Modules 7 and 22. The page previews the
 * same numbers and can suggest the lowest price that still gives the consignor their agreed payout.
 * Ticking "final price approved" and "consignor payout confirmed" moves the item to Listing Creation.
 */

Object.assign(ConsignmentFlow, {
  selectedPricingItem: null,

  isPricing() {
    const role = Session.currentUser && Session.currentUser.role;
    return role === 'pricingTeam' || role === 'superAdmin';
  },

  /** Mirrors public.calculate_markup (Module 22). Returns { markup, label } or null when no tier applies. */
  previewMarkup(price, category) {
    if (!(price > 0)) return null;
    let cat = String(category || '').trim().toLowerCase();
    if (['shoes', 'shoe', 'footwear', 'wallet', 'wallets', 'shoes & wallets', 'shoes_wallets'].includes(cat)) cat = 'shoes_wallets';
    const fits = (t) => !t.category_restriction || t.category_restriction === cat;
    const tiers = DB.markupTiers || [];
    let tier = tiers.filter((t) => t.comparison === 'gte' && price >= t.threshold_price && fits(t))
      .sort((a, b) => b.threshold_price - a.threshold_price)[0];
    if (!tier) {
      tier = tiers.filter((t) => t.comparison === 'lte' && price <= t.threshold_price && fits(t))
        .sort((a, b) => a.threshold_price - b.threshold_price)[0];
    }
    if (!tier) return null;
    const pct = tier.markup_type === 'percentage';
    return {
      markup: pct ? Math.round(price * tier.markup_value) / 100 : tier.markup_value,
      label: pct ? `${tier.markup_value}% (₱${formatAmount(tier.threshold_price)} and above)`
        : `₱${formatAmount(tier.markup_value)} flat (${tier.comparison === 'lte' ? 'up to' : 'from'} ₱${formatAmount(tier.threshold_price)}${tier.category_restriction ? ', shoes & wallets' : ''})`,
    };
  },

  /** Lowest price (rounded up to ₱100) whose payout covers the agreed payout. */
  suggestPrice(agreedPayout, category) {
    if (!(agreedPayout > 0)) return null;
    const candidates = new Set();
    for (const t of DB.markupTiers || []) {
      if (t.markup_type === 'flat') candidates.add(agreedPayout + t.markup_value);
      else candidates.add(agreedPayout / (1 - t.markup_value / 100));
      candidates.add(t.threshold_price);
    }
    let best = null;
    for (const raw of candidates) {
      const p = Math.ceil(raw / 100) * 100;
      const m = this.previewMarkup(p, category);
      if (m && p - m.markup >= agreedPayout && (best === null || p < best)) best = p;
    }
    return best;
  },

  // ------------------------------------------------------------------ render
  renderPricing() {
    const queue = DB.pipelineItems.filter((i) => i.stage === 'pricing_markup')
      .sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    if (this.selectedPricingItem && !queue.some((i) => i.id === this.selectedPricingItem)) this.selectedPricingItem = null;
    const sel = this.item(this.selectedPricingItem);

    return `
      <h1 class="page-title" style="margin-bottom:4px;">Pricing & Markup</h1>
      <p class="cell-muted" style="margin:0 0 16px;">Set the final selling price. Markup and consignor payout are calculated automatically from the tier schedule.</p>
      <div class="card" style="margin-bottom:18px;">
        <div class="card-title" style="margin-bottom:12px;">Pricing Queue (${queue.length})</div>
        ${this.queueTable(queue, this.selectedPricingItem, [
          ['Item ID', (i) => `<strong>${escapeHtml(i.code)}</strong>`],
          ['Item', (i) => `<div style="font-weight:600;">${escapeHtml(this.itemName(i))}</div><div class="cell-muted" style="font-size:11.5px;">${escapeHtml(i.category || '—')}</div>`],
          ['Agreed Payout', (i) => this.peso(i.agreedPayout)],
          ['Selling Price', (i) => (i.price != null ? `<strong>${this.peso(i.price)}</strong>` : '<span class="cell-muted">Not set</span>')],
          ['Markup', (i) => this.peso(i.markup)],
          ['Payout', (i) => this.peso(i.consignorPayout)],
        ], 'No items waiting for pricing.')}
      </div>
      ${sel ? this.renderPricingPanel(sel) : ''}`;
  },

  renderPricingPanel(i) {
    const act = this.isPricing();
    const cover = this.coverPhoto(i);
    const suggested = this.suggestPrice(i.agreedPayout, i.category);
    const short = i.price != null && i.agreedPayout != null && i.consignorPayout != null && i.consignorPayout < i.agreedPayout;

    return `
      <div class="section-grid" style="align-items:flex-start;">
        <div class="card col-wide">
          <div style="display:flex; gap:16px; flex-wrap:wrap;">
            <div style="width:160px; height:160px; display:flex; align-items:center; justify-content:center; background:#F1F5F9; border-radius:8px; overflow:hidden;">
              ${cover ? `<img data-photo-bucket="listing-photos" data-photo-path="${escapeHtml(cover.storage_path)}" alt="Cover" style="max-width:100%; max-height:160px; object-fit:contain;">` : '<span class="cell-muted">No cover</span>'}
            </div>
            <div style="flex:1; min-width:220px; font-size:12.5px; line-height:1.8;">
              <div class="card-title">${escapeHtml(i.code)} · ${escapeHtml(this.itemName(i))}</div>
              <div><span class="cell-muted">Category:</span> ${escapeHtml(i.category || '—')}</div>
              <div><span class="cell-muted">Condition:</span> ${escapeHtml(i.conditionNotes || '—')}</div>
              <div><span class="cell-muted">Consignor asked:</span> ${this.peso(i.askingPrice)}</div>
              <div><span class="cell-muted">Agreed payout:</span> <strong>${this.peso(i.agreedPayout)}</strong></div>
            </div>
          </div>

          <h3 style="font-size:14px; margin:18px 0 8px;">Final Selling Price</h3>
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <input class="field-input" id="price-input" type="number" min="1" step="100" value="${i.price ?? ''}" placeholder="e.g. 265000" style="max-width:220px;" ${act ? '' : 'disabled'}>
            ${act ? '<button class="btn-confirm" id="price-save">Save Price</button>' : ''}
            ${act && suggested ? `<button class="btn-secondary" id="price-suggest" data-price="${suggested}">Suggest: ${this.peso(suggested)}</button>` : ''}
          </div>
          ${suggested ? `<small class="cell-muted">Suggested = the lowest price whose payout covers the agreed ${this.peso(i.agreedPayout)}. Adjust for market value.</small>` : ''}
          <div id="price-preview" style="margin-top:12px;"></div>
        </div>

        <div class="card col-narrow">
          <div class="card-title" style="margin-bottom:10px;">Saved Figures</div>
          <div style="font-size:13px; line-height:1.9;">
            <div><span class="cell-muted">Selling price:</span> <strong>${this.peso(i.price)}</strong></div>
            <div><span class="cell-muted">Markup (company commission):</span> <strong>${this.peso(i.markup)}</strong></div>
            <div><span class="cell-muted">Consignor payout:</span> <strong>${this.peso(i.consignorPayout)}</strong></div>
          </div>
          ${short ? `<div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:8px; padding:8px; font-size:12px; margin-top:8px;">
            The payout is ${this.peso(i.agreedPayout - i.consignorPayout)} below the agreed payout. Confirm only if the consignor accepted it.</div>` : ''}
          <div style="margin-top:14px; padding-top:12px; border-top:1px solid #E2E8F0;">
            <label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:4px 0;">
              <input type="checkbox" id="price-approved" ${i.priceApproved ? 'checked' : ''} ${act && i.price != null ? '' : 'disabled'}> Final price approved</label>
            <label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:4px 0;">
              <input type="checkbox" id="payout-confirmed" ${i.payoutConfirmed ? 'checked' : ''} ${act && i.price != null ? '' : 'disabled'}> Consignor payout confirmed</label>
            ${act ? `<button class="btn-confirm" id="price-confirm" style="width:100%; margin-top:10px;${i.price != null ? '' : ' opacity:.5; cursor:not-allowed;'}" ${i.price != null ? '' : 'disabled'}>Confirm → Listing Creation</button>` : ''}
            <small class="cell-muted">Both boxes must be ticked. Changing the price later clears them.</small>
          </div>
          <button class="btn-secondary" id="price-history" style="width:100%; margin-top:14px;">View Activity Log</button>
        </div>
      </div>`;
  },

  updatePricePreview(i) {
    const box = document.getElementById('price-preview');
    const input = document.getElementById('price-input');
    if (!box || !input) return;
    const price = Number(input.value);
    if (!(price > 0)) { box.innerHTML = ''; return; }
    const m = this.previewMarkup(price, i.category);
    if (!m) {
      box.innerHTML = `<div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:8px; padding:10px; font-size:12.5px;">
        No markup tier covers ${this.peso(price)} for "${escapeHtml(i.category || 'this category')}". This range is still an open question for the client.</div>`;
      return;
    }
    const payout = price - m.markup;
    const below = i.agreedPayout != null && payout < i.agreedPayout;
    box.innerHTML = `
      <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; font-size:12.5px; line-height:1.8;">
        <div><span class="cell-muted">Markup tier:</span> ${escapeHtml(m.label)}</div>
        <div><span class="cell-muted">Markup (company commission):</span> <strong>${this.peso(m.markup)}</strong></div>
        <div><span class="cell-muted">Consignor payout:</span> <strong style="color:${below ? 'var(--danger-red)' : 'var(--green)'};">${this.peso(payout)}</strong>
          ${i.agreedPayout != null ? `<span class="cell-muted">(agreed ${this.peso(i.agreedPayout)})</span>` : ''}</div>
        ${price >= LAYAWAY_MIN_PRICE ? '<div class="cell-muted">Layaway clause will be added to the listing (₱200,000 and above).</div>' : ''}
      </div>`;
  },

  // -------------------------------------------------------------------- bind
  bindPricing() {
    document.querySelectorAll('[data-select-item]').forEach((btn) => {
      btn.addEventListener('click', () => { this.selectedPricingItem = btn.dataset.selectItem; Router.rerender(); });
    });
    const i = this.item(this.selectedPricingItem);
    if (!i) return;
    this.fillPhotos('listing-photos');
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => fn(el)); };
    const input = document.getElementById('price-input');
    if (input) input.addEventListener('input', () => this.updatePricePreview(i));
    this.updatePricePreview(i);

    on('price-history', () => this.showHistory(i));
    on('price-suggest', (btn) => { input.value = btn.dataset.price; this.updatePricePreview(i); });
    on('price-save', (btn) => {
      const price = Number(input.value);
      if (!(price > 0)) return showToast('Enter the selling price.');
      if (!this.previewMarkup(price, i.category)) return showToast('No markup tier covers this price. Choose a price in a covered range.');
      this.save(btn, `Price saved: ${this.peso(price)}.`, () => this.updateItem(i.id, { price }));
    });
    on('price-confirm', (btn) => {
      const approved = document.getElementById('price-approved').checked;
      const confirmed = document.getElementById('payout-confirmed').checked;
      if (!approved || !confirmed) return showToast('Tick both "Final price approved" and "Consignor payout confirmed".');
      this.save(btn, `${i.code} priced at ${this.peso(i.price)} and sent to Listing Creation.`,
        () => this.updateItem(i.id, { price_approved: true, payout_confirmed: true }));
    });
  },
});

ConsignmentFlow.pages['consignment-pricing'] = ['renderPricing', 'bindPricing'];
