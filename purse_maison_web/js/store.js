/**
 * Live data from Supabase, loaded into the same DB.* shapes the pages already use.
 *
 * Call `await DataStore.loadAll()` once after login (main.js does this). Pages can call
 * `DataStore.refreshIfStale()` in afterRender to quietly reload data that is over a minute old.
 *
 * Filled by this file:
 *   DB.inventory            published / reserved / sold / rejected items
 *   DB.salesTransactions    verified sales recorded in the system
 *   DB.salesSeries          monthly revenue per brand (imported history + system sales)
 *   DB.activeConsignedCount items still moving through the consignment pipeline
 *   DB.inquiryCount         number of client inquiries
 *   DB.clientInquiries      client inquiries (Client Assignment page)
 *   DB.salesAssociates      sales associates with their current workload
 *   DB.assignmentActivity   recent assignment activity feed
 *   DB.pipelineItems        every consignment item with its consignor, photos and negotiation log
 *   DB.consignorList        consignors, for lookup and duplicate checks
 *   DB.authFeeSchedule      authentication fee schedule
 *   DB.staffDirectory       staff names and roles (for authenticator assignment)
 *   DB.salesForecasts       one row per brand from the latest ARIMA forecast
 *   DB.forecastRows         the monthly forecast values behind those rows
 *   DB.forecastMeta         when it ran, model accuracy, latest run status, skipped brands
 *   DB.predictionAlerts     plain-language alerts worked out from the forecast
 *
 * Note: Supabase returns at most 1000 rows per request, which is plenty for this project.
 */

const CLOSED_STAGES = ['closed_fake', 'closed_rejected'];
const FINISHED_STAGES = ['closed_fake', 'closed_rejected', 'sold', 'archived'];
const GROWTH_STABLE_BAND = 5;   // growth within +/-5% counts as "stable"
const ALERT_GROWTH_PERCENT = 10; // growth beyond +/-10% raises an alert

const INQUIRY_CHANNELS = {
  walk_in: 'Walk-in', phone: 'Phone', email: 'Email', website: 'Website',
  facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', messenger: 'Messenger', whatsapp: 'WhatsApp',
};

const DataStore = {
  loadedAt: 0,
  loading: null,
  errors: [],

  /** Loads everything the read-only pages need. Safe to call again to refresh. */
  loadAll() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.errors = [];
      await Promise.all([
        this._run('items', () => this.loadItems()),
        this._run('sales history', () => this.loadSalesSeries()),
        this._run('clients', () => this.loadClients()),
        this._run('consignments', () => this.loadPipeline()),
      ]);
      // The forecast summary compares against sales history, so it loads after it.
      await this._run('forecast', () => this.loadForecast());
      this.loadedAt = Date.now();
      if (this.errors.length) {
        showToast(`Some data could not be loaded (${this.errors.join(', ')}). Try refreshing the page.`);
      }
    })().finally(() => { this.loading = null; });
    return this.loading;
  },

  /** Reloads in the background if the data is older than maxAgeMs, then redraws the page once. */
  refreshIfStale(maxAgeMs = 60000) {
    if (this.loading || Date.now() - this.loadedAt < maxAgeMs) return;
    this.loadAll().then(() => Router.rerender());
  },

  async _run(label, fn) {
    try {
      await fn();
    } catch (err) {
      console.error(`Failed to load ${label}:`, err);
      this.errors.push(label);
    }
  },

  // ---------------------------------------------------------------- helpers
  one(embedded) { return Array.isArray(embedded) ? embedded[0] : embedded; },

  /** "M/D/YYYY" in Manila time, the format the inventory page already parses. */
  formatMDY(iso) {
    return new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric' });
  },

  formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  },

  /** "2026-09-01" -> local Date for that day (avoids the UTC shift of new Date('2026-09-01')). */
  parseDateOnly(s) {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  },

  peso(n) { return `₱${formatAmount(Number(n) || 0)}`; },

  // ------------------------------------------------------------------ items
  inventoryStatusOf(item, listing) {
    if (CLOSED_STAGES.includes(item.current_stage)) return 'rejected';
    if (item.current_stage === 'sold' || (listing && listing.inventory_status === 'sold')) return 'sold';
    if (listing && listing.inventory_status === 'reserved') return 'reserved';
    if (listing && listing.inventory_status === 'published') return 'available';
    return null; // still in the pipeline (not inventory yet) or archived
  },

  /** The backend has no physical-location column, so this is worked out from the item's status. */
  locationOf(status) {
    if (status === 'sold') return 'Released';
    if (status === 'rejected') return 'For Return';
    return 'Showroom';
  },

  async loadItems() {
    const { data, error } = await sbClient
      .from('consignment_items')
      .select('item_code, brand, model, category, condition_notes, price, current_stage, created_at, listings(inventory_status, published_at), sales_transactions(payment_status, sale_price, sold_at)')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      DB.inventory = [];
      DB.salesTransactions = [];
      DB.activeConsignedCount = 0;
      throw error;
    }

    const inventory = [];
    const sales = [];
    let active = 0;

    for (const it of data) {
      if (!FINISHED_STAGES.includes(it.current_stage)) active++;

      const listing = this.one(it.listings);
      const sale = this.one(it.sales_transactions);
      const status = this.inventoryStatusOf(it, listing);
      if (!status) continue;

      const verifiedSale = sale && sale.payment_status === 'verified';
      const priceValue = verifiedSale && sale.sale_price != null ? sale.sale_price : it.price;
      const notes = (it.condition_notes || '').trim();
      const addedIso = (listing && listing.published_at) || it.created_at;

      let transactionStatus = 'none';
      if (sale) transactionStatus = verifiedSale ? 'completed' : 'pending';
      else if (status === 'rejected') transactionStatus = 'cancelled';

      inventory.push({
        id: it.item_code,
        brand: it.brand || '—',
        category: it.category || '—',
        condition: notes ? (notes.length > 40 ? notes.slice(0, 40) + '…' : notes) : '—',
        status,
        location: this.locationOf(status),
        dateAdded: this.formatMDY(addedIso),
        transactionStatus,
        price: priceValue == null ? '—' : this.peso(priceValue),
      });

      if (verifiedSale) {
        sales.push({
          id: it.item_code,
          itemLabel: `${it.brand} ${it.model || it.category || ''} (${it.item_code})`.replace(/\s+/g, ' '),
          amount: Number(sale.sale_price) || 0,
          date: new Date(sale.sold_at),
          itemId: it.item_code,
        });
      }
    }

    DB.inventory = inventory;
    DB.salesTransactions = sales;
    DB.activeConsignedCount = active;
  },

  // ------------------------------------------------------------ sales history
  async loadSalesSeries() {
    const { data, error } = await sbClient
      .from('monthly_brand_sales')
      .select('sale_month, brand, brand_key, units_sold, revenue')
      .order('sale_month', { ascending: true })
      .limit(1000);
    if (error) { DB.salesSeries = []; throw error; }

    DB.salesSeries = data.map((r) => ({
      date: this.parseDateOnly(r.sale_month),
      amount: Number(r.revenue) || 0,
      units: r.units_sold || 0,
      brand: r.brand,
      brandKey: r.brand_key,
    }));
  },

  // ---------------------------------------------------------------- clients
  async loadClients() {
    const [inq, work, profiles, activity] = await Promise.all([
      sbClient.from('inquiries')
        .select('id, client_name, client_phone, client_email, client_role, is_vip, inquiry_channel, inquiry_status, transaction_result, assigned_associate_id, assigned_at, created_at')
        .order('created_at', { ascending: true })
        .limit(1000),
      sbClient.from('associate_workload')
        .select('associate_id, full_name, open_inquiries, open_consignments, status')
        .limit(200),
      sbClient.from('profiles').select('id, full_name').limit(500),
      sbClient.from('assignment_activity')
        .select('description, created_at')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (inq.error) {
      DB.clientInquiries = []; DB.salesAssociates = []; DB.assignmentActivity = []; DB.inquiryCount = 0;
      throw inq.error;
    }
    DB.inquiryCount = inq.data.length;

    const names = new Map();
    if (!profiles.error) for (const p of profiles.data) names.set(p.id, p.full_name || '(unnamed)');
    if (!work.error) for (const w of work.data) names.set(w.associate_id, w.full_name || names.get(w.associate_id) || '(unnamed)');

    // Oldest inquiry is No. 1; the page sorts them as needed.
    DB.clientInquiries = inq.data.map((r, idx) => ({
      id: r.id,
      no: idx + 1,
      clientName: r.client_name,
      phone: r.client_phone || '',
      email: r.client_email || '',
      isVip: !!r.is_vip,
      clientType: r.inquiry_channel === 'walk_in' ? 'Walk-in' : 'Online',
      clientRole: r.client_role === 'consignor' ? 'Consignor' : 'Buyer',
      clientRoleValue: r.client_role,
      inquiryStatus: r.inquiry_status,
      inquirySource: INQUIRY_CHANNELS[r.inquiry_channel] || r.inquiry_channel,
      channel: r.inquiry_channel,
      transactionResult: r.transaction_result,
      assignedId: r.assigned_associate_id,
      assignedName: r.assigned_associate_id ? (names.get(r.assigned_associate_id) || '(unknown)') : '',
      assignedAt: r.assigned_at,
      createdAt: r.created_at,
    }));

    // Each associate, with the clients they are currently handling
    DB.salesAssociates = work.error ? [] : work.data.map((w) => {
      const open = DB.clientInquiries.filter((i) => i.assignedId === w.associate_id && i.inquiryStatus === 'assigned');
      let currentClient = '-';
      if (open.length === 1) currentClient = open[0].clientName;
      else if (open.length > 1) currentClient = `${open[0].clientName} +${open.length - 1} more`;
      return {
        id: w.associate_id,
        associateName: w.full_name || names.get(w.associate_id) || '(unnamed)',
        status: w.status,
        openInquiries: w.open_inquiries || 0,
        openConsignments: w.open_consignments || 0,
        currentClient,
      };
    }).sort((a, b) => a.associateName.localeCompare(b.associateName));

    // Activity feed: written by database triggers (inquiry assignments, resolutions, consignment assignments)
    DB.assignmentActivity = activity.error ? [] : activity.data.slice(0, 12).map((a, i) => ({
      id: `aa-${i}`,
      description: a.description,
      timestamp: this.formatDateTime(a.created_at),
    }));
  },

  // ------------------------------------------------------------- pipeline
  async loadPipeline() {
    const [items, consignors, fees, staff] = await Promise.all([
      sbClient.from('consignment_items')
        .select(`id, item_code, brand, model, color, category, hardware, serial_number, microchip_number, date_code,
                 condition_notes, accessories_included, price, consignor_payout, current_stage, lead_status,
                 inquiry_channel, inquiry_notes, asking_price, agreed_payout, fulfillment_method, appointment_at,
                 agreement_id, assigned_photographer_id, photos_approved, created_at, updated_at,
                 consignor:consignors(id, full_name, phone, email, id_verified, id_type, id_photo_path, verified_at),
                 agreement:consignment_agreements(signed_at),
                 item_photos(photo_type, storage_path, uploaded_at),
                 listing_photos(id, photo_type, storage_path, is_primary, edited, uploaded_at),
                 price_negotiations(asking_price, counter_offer, notes, logged_at),
                 authentication_records(id, provider, category, fee, payment_status, payment_reference, payment_confirmed_at,
                   service_started_at, sla_deadline, primary_authenticator_id, secondary_authenticator_id,
                   primary_result, secondary_result, final_result, certificate_url, certificate_uploaded_at),
                 listings(inventory_status)`)
        .order('created_at', { ascending: false })
        .limit(1000),
      sbClient.from('consignors').select('id, full_name, phone, email').order('full_name').limit(1000),
      sbClient.from('authentication_fee_schedule').select('provider, category, fee').order('provider'),
      sbClient.from('profiles').select('id, full_name, role, is_active').limit(500),
    ]);
    if (items.error) { DB.pipelineItems = []; throw items.error; }

    DB.consignorList = consignors.error ? [] : consignors.data;
    DB.authFeeSchedule = fees.error ? [] : fees.data;
    DB.staffDirectory = staff.error ? [] : staff.data;

    DB.pipelineItems = items.data.map((r) => {
      const photos = (r.item_photos || []).slice().sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at));
      const latestPhoto = {};
      for (const p of photos) latestPhoto[p.photo_type] = p.storage_path; // newest wins
      const lphotos = (r.listing_photos || []).slice().sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at));
      const latestListing = {};
      for (const p of lphotos) latestListing[p.photo_type] = p; // newest wins
      const listing = this.one(r.listings);
      return {
        id: r.id,
        code: r.item_code,
        brand: r.brand,
        model: r.model || '',
        color: r.color || '',
        category: r.category || '',
        hardware: r.hardware || '',
        serial: r.serial_number || '',
        microchip: r.microchip_number || '',
        dateCode: r.date_code || '',
        conditionNotes: r.condition_notes || '',
        accessories: r.accessories_included ? r.accessories_included.split(',').map((a) => a.trim()).filter(Boolean) : [],
        price: r.price == null ? null : Number(r.price),
        consignorPayout: r.consignor_payout == null ? null : Number(r.consignor_payout),
        stage: r.current_stage,
        leadStatus: r.lead_status,
        channel: r.inquiry_channel || '',
        notes: r.inquiry_notes || '',
        askingPrice: r.asking_price == null ? null : Number(r.asking_price),
        agreedPayout: r.agreed_payout == null ? null : Number(r.agreed_payout),
        fulfillment: r.fulfillment_method || '',
        appointmentAt: r.appointment_at,
        agreementId: r.agreement_id,
        agreementSignedAt: (this.one(r.agreement) || {}).signed_at || null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        consignor: this.one(r.consignor) || { full_name: '(unknown)' },
        photos: latestPhoto,
        listingPhotos: latestListing,
        listingPhotoList: lphotos,
        photographerId: r.assigned_photographer_id,
        photosApproved: !!r.photos_approved,
        negotiations: (r.price_negotiations || []).slice().sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at)),
        auth: this.one(r.authentication_records) || null,
        listingStatus: listing ? listing.inventory_status : null,
      };
    });
  },

  // ---------------------------------------------------------------- forecast
  async loadForecast() {
    DB.salesForecasts = [];
    DB.forecastRows = [];
    DB.predictionAlerts = [];
    DB.forecastMeta = { generatedAt: null, horizon: 0, avgMae: null, latestRun: null, skipped: [] };

    const [fc, runs] = await Promise.all([
      sbClient.from('latest_forecast')
        .select('run_id, brand, brand_key, forecast_month, predicted_revenue, revenue_lower, revenue_upper, generated_at, arima_order, mae')
        .order('forecast_month', { ascending: true })
        .limit(1000),
      sbClient.from('forecast_runs')
        .select('id, status, requested_at, started_at, finished_at, error_message')
        .order('requested_at', { ascending: false })
        .limit(10),
    ]);
    if (fc.error) throw fc.error;
    if (runs.error) throw runs.error;

    const latestRun = runs.data[0] || null;
    const latestCompleted = runs.data.find((r) => r.status === 'completed') || null;

    let skipped = [];
    if (latestCompleted) {
      const models = await sbClient
        .from('forecast_brand_models')
        .select('brand, outcome, months_of_history')
        .eq('run_id', latestCompleted.id);
      if (!models.error) {
        skipped = models.data
          .filter((m) => m.outcome !== 'forecasted')
          .map((m) => ({ brand: m.brand, outcome: m.outcome, months: m.months_of_history }));
      }
    }

    // Group the monthly values by brand
    const byBrand = new Map();
    DB.forecastRows = fc.data.map((r) => ({
      brandKey: r.brand_key,
      brand: r.brand,
      month: this.parseDateOnly(r.forecast_month),
      revenue: Number(r.predicted_revenue) || 0,
      lower: r.revenue_lower == null ? null : Number(r.revenue_lower),
      upper: r.revenue_upper == null ? null : Number(r.revenue_upper),
      arimaOrder: r.arima_order,
      mae: r.mae == null ? null : Number(r.mae),
    }));
    for (const r of DB.forecastRows) {
      if (!byBrand.has(r.brandKey)) byBrand.set(r.brandKey, []);
      byBrand.get(r.brandKey).push(r);
    }

    const summary = [];
    for (const [brandKey, rows] of byBrand) {
      rows.sort((a, b) => a.month - b.month);
      const n = rows.length;
      const first = rows[0].month;
      const histStart = new Date(first.getFullYear(), first.getMonth() - n, 1);
      const historical = DB.salesSeries
        .filter((s) => s.brandKey === brandKey && s.date >= histStart && s.date < first)
        .reduce((sum, s) => sum + s.amount, 0);
      const projected = rows.reduce((sum, r) => sum + r.revenue, 0);
      const growth = historical > 0 ? Math.round(((projected - historical) / historical) * 1000) / 10 : null;

      let trend = 'stable';
      if (growth !== null && growth > GROWTH_STABLE_BAND) trend = 'increasing';
      else if (growth !== null && growth < -GROWTH_STABLE_BAND) trend = 'decreasing';

      summary.push({
        brand: rows[0].brand,
        brandKey,
        months: n,
        historicalValue: historical,
        projectedValue: projected,
        historicalSales: formatAmount(historical),
        projectedSales: formatAmount(projected),
        projectedGrowthPercent: growth,
        trend,
        mae: rows[0].mae,
        arimaOrder: rows[0].arimaOrder,
      });
    }
    summary.sort((a, b) => b.projectedValue - a.projectedValue);
    DB.salesForecasts = summary;

    const maes = summary.map((s) => s.mae).filter((v) => v !== null);
    const generatedAt = (fc.data[0] && fc.data[0].generated_at) || (latestCompleted && latestCompleted.finished_at) || null;
    DB.forecastMeta = {
      generatedAt,
      horizon: summary.reduce((m, s) => Math.max(m, s.months), 0),
      avgMae: maes.length ? maes.reduce((a, b) => a + b, 0) / maes.length : null,
      latestRun,
      skipped,
    };

    // Plain-language alerts worked out from the numbers
    const when = generatedAt ? this.formatDateTime(generatedAt) : '';
    const alerts = [];
    for (const s of summary) {
      if (s.projectedGrowthPercent === null) continue;
      if (s.projectedGrowthPercent >= ALERT_GROWTH_PERCENT) {
        alerts.push(`Demand for ${s.brand} is projected to rise ${s.projectedGrowthPercent}% over the next ${s.months} months.`);
      } else if (s.projectedGrowthPercent <= -ALERT_GROWTH_PERCENT) {
        alerts.push(`Demand for ${s.brand} is projected to fall ${Math.abs(s.projectedGrowthPercent)}% over the next ${s.months} months. Consider reducing inventory.`);
      }
    }
    for (const k of skipped) {
      alerts.push(`${k.brand} was skipped: ${k.months ?? 0} month(s) of sales history is not enough for a forecast.`);
    }
    if (latestRun && latestRun.status === 'failed') {
      alerts.push(`The last forecast run failed: ${latestRun.error_message || 'no details recorded'}.`);
    }
    DB.predictionAlerts = alerts.map((description, i) => ({ id: `pa-${i}`, description, timestamp: when }));
  },
};
