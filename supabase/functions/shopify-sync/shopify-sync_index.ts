// Edge Function: shopify-sync
// Makes the Shopify store match the system. Every item with a published, reserved, sold or archived listing is one
// Shopify product (handle = item code, e.g. pm-2046). Items waiting to be sent are marked "pending" by the database
// (migration 0029); this function sends them.
//
// Who can call it:
//   - the every-minute schedule (Supabase Cron), which sends the project's secret key in the apikey header
//   - the owner or the manager from Settings -> Shopify Sync (their login token)
//
// Actions (POST JSON):
//   { action: 'run' }               send pending items for up to ~40 seconds (default)
//   { action: 'audit' }             product counts in Shopify next to the counts in the system
//   { action: 'remove_orphans' }    owner: delete Shopify products made by this system whose item is no longer listed
//   { action: 'register_webhooks' } owner: tell Shopify to send paid orders to the shopify-webhook function
//
// Secrets (Edge Functions -> Secrets): SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET,
//   SHOPIFY_API_VERSION (2026-10), SHOPIFY_LOCATION_NAME (Purse Maison BGC)
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor, name it exactly
// "shopify-sync", paste this file, Deploy. Then open the function's settings and turn OFF "Verify JWT":
// the function checks the caller itself.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SHOP = Deno.env.get('SHOPIFY_STORE_DOMAIN') ?? '';
const API_VERSION = Deno.env.get('SHOPIFY_API_VERSION') ?? '2026-10';
const LOCATION_NAME = Deno.env.get('SHOPIFY_LOCATION_NAME') ?? 'Purse Maison BGC';
const SYNC_TAG = 'purse-maison-sync';         // every product this system creates carries this tag
const BATCH_SIZE = 10;                        // items taken from the queue at a time
const TIME_BUDGET_MS = 40000;                 // stop taking new batches after this
const LIVE_STATUSES = ['published', 'reserved', 'sold', 'archived'];
const HIDDEN_PHOTO_TYPES = ['serial_number'];  // not shown publicly (open question for the client)
const CHANNEL_TAGS: Record<string, string> = { live_selling: 'Live Selling', social_media: 'Social Media' };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** The project's secret key: the new SUPABASE_SECRET_KEYS dictionary first, the legacy service role key second. */
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const key = keys.default ?? Object.values(keys)[0];
    if (typeof key === 'string' && key) return key;
  } catch (_) { /* fall through */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}
const KEY = secretKey();

/** Any of the project's secret keys (new or legacy) identifies the schedule as the caller. */
const SYSTEM_KEYS = new Set<string>();
try { Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')).forEach((k) => typeof k === 'string' && k && SYSTEM_KEYS.add(k)); } catch (_) { /* none */ }
if (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) SYSTEM_KEYS.add(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string);

// ------------------------------------------------------------------ database (REST, with the secret key)
async function db(method: string, path: string, body?: unknown, prefer?: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Database: ${data?.message ?? res.statusText}`);
  return data;
}

/** Reads every row of a query, 1000 at a time (the API returns at most 1000 rows per request). */
async function dbAll(path: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db('GET', `${path}&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function signedPhotoUrl(path: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/listing-photos/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : null;
}

// ------------------------------------------------------------------ who is calling?
async function callerRole(req: Request): Promise<'system' | 'super_admin' | 'manager' | null> {
  const apikey = req.headers.get('apikey') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (SYSTEM_KEYS.has(apikey) || SYSTEM_KEYS.has(bearer)) return 'system';
  if (!bearer) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${bearer}` } });
  if (!res.ok) return null;
  const user = await res.json();
  const rows = await db('GET', `profiles?select=role,is_active&id=eq.${encodeURIComponent(user.id)}`);
  const me = rows[0];
  if (!me || !me.is_active) return null;
  return me.role === 'super_admin' || me.role === 'manager' ? me.role : null;
}

// ------------------------------------------------------------------ Shopify
class Throttled extends Error {}

let token = '';
let tokenExpiresAt = 0;

/** Client credentials grant: a fresh Admin API token, kept for its 24 hours. */
async function shopifyToken(): Promise<string> {
  if (token && Date.now() < tokenExpiresAt - 60000) return token;
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: Deno.env.get('SHOPIFY_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('SHOPIFY_CLIENT_SECRET') ?? '',
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify login failed (${res.status}): ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  token = data.access_token;
  tokenExpiresAt = Date.now() + Number(data.expires_in ?? 86399) * 1000;
  return token;
}

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await shopifyToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429) throw new Throttled('Shopify is busy (rate limit). Will retry.');
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify error ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  if (body.errors?.length) {
    if (body.errors.some((e: any) => e.extensions?.code === 'THROTTLED')) throw new Throttled('Shopify is busy (rate limit). Will retry.');
    throw new Error(`Shopify: ${body.errors.map((e: any) => e.message).join('; ')}`);
  }
  return body.data;
}

function userErrors(list: any[] | undefined) {
  if (list && list.length) throw new Error(`Shopify: ${list.map((e) => e.message).join('; ')}`);
}

let locationId = '';
let onlineStoreId = '';

async function shopIds() {
  if (!locationId) {
    const data = await gql('query { locations(first: 50) { nodes { id name } } }');
    const loc = data.locations.nodes.find((l: any) => l.name.trim().toLowerCase() === LOCATION_NAME.toLowerCase());
    if (!loc) throw new Error(`Shopify has no location named "${LOCATION_NAME}". Rename it in Shopify: Settings > Locations.`);
    locationId = loc.id;
  }
  if (!onlineStoreId) onlineStoreId = await findOnlineStore();
  return { locationId, onlineStoreId };
}

/**
 * The Online Store's publication ID. Shopify leaves "catalog" empty for sales channels like the Online Store,
 * so this also tries the older "name" field, and finally the SHOPIFY_ONLINE_STORE_PUBLICATION_ID secret.
 */
async function findOnlineStore(): Promise<string> {
  const fixed = (Deno.env.get('SHOPIFY_ONLINE_STORE_PUBLICATION_ID') ?? '').trim();
  if (fixed) return fixed;
  const isOnlineStore = (s: unknown) => String(s ?? '').trim().toLowerCase() === 'online store';
  const seen: string[] = [];
  for (const fields of ['catalog { title }', 'name', 'app { title }']) {
    try {
      const data = await gql(`query { publications(first: 50) { nodes { id ${fields} } } }`);
      for (const p of data.publications.nodes) {
        const label = p.catalog?.title ?? p.name ?? p.app?.title;
        if (label) seen.push(label);
        if (isOnlineStore(label)) return p.id;
      }
    } catch (err) {
      if (err instanceof Throttled) throw err;  // try the next way only if this field isn't available
    }
  }
  throw new Error(`The Online Store sales channel was not found in Shopify${seen.length ? ` (found: ${[...new Set(seen)].join(', ')})` : ''}. Check that the app has the read_publications scope, or set the SHOPIFY_ONLINE_STORE_PUBLICATION_ID secret.`);
}

const PRODUCT_SET = `
  mutation SyncProduct($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
    productSet(identifier: $identifier, input: $input, synchronous: true) {
      product { id variants(first: 1) { nodes { id inventoryItem { id } } } }
      userErrors { field message }
    }
  }`;

const PUBLISH = `
  mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { userErrors { field message } }
  }`;

const UNPUBLISH = `
  mutation Unpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) { userErrors { field message } }
  }`;

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Description, specifications, authenticity footer and layaway clause, one paragraph each. */
function descriptionHtml(l: any) {
  return [l.description, l.specifications, l.authenticity_footer, l.layaway_clause]
    .filter((s) => s && String(s).trim())
    .map((s) => `<p>${escapeHtml(String(s).trim()).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

// ------------------------------------------------------------------ one item
async function syncItem(itemId: string) {
  const [item] = await db('GET', `consignment_items?select=id,item_code,brand,category,price,barcode,shopify_product_id,shopify_variant_id&id=eq.${itemId}`);
  const [listing] = await db('GET', `listings?select=title,description,specifications,seo_title,seo_description,authenticity_footer,layaway_clause,sales_channels,inventory_status&item_id=eq.${itemId}`);

  if (!item || !listing || !LIVE_STATUSES.includes(listing.inventory_status)) {
    await db('PATCH', `consignment_items?id=eq.${itemId}&shopify_sync_status=eq.syncing`,
      { shopify_sync_status: 'not_applicable', shopify_sync_error: null });
    return 'skipped';
  }

  const { locationId, onlineStoreId } = await shopIds();
  const state = listing.inventory_status;
  const channels: string[] = listing.sales_channels ?? [];
  const status = state === 'published' || state === 'reserved' ? 'ACTIVE' : 'ARCHIVED';
  const quantity = state === 'published' ? 1 : 0;
  const onStore = state === 'published' && channels.includes('website');

  const input: Record<string, unknown> = {
    handle: item.item_code.toLowerCase(),
    title: listing.title || item.item_code,
    descriptionHtml: descriptionHtml(listing),
    vendor: item.brand,
    productType: item.category ?? '',
    tags: [SYNC_TAG, ...channels.filter((c) => CHANNEL_TAGS[c]).map((c) => CHANNEL_TAGS[c])],
    status,
    productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
    variants: [{
      ...(item.shopify_variant_id ? { id: item.shopify_variant_id } : {}),
      optionValues: [{ optionName: 'Title', name: 'Default Title' }],
      price: String(item.price ?? 0),
      sku: item.item_code,
      ...(item.barcode ? { barcode: item.barcode } : {}),
      inventoryPolicy: 'DENY',
      inventoryItem: { tracked: true },
      inventoryQuantities: [{ locationId, name: 'available', quantity }],
    }],
  };
  if (listing.seo_title || listing.seo_description) {
    input.seo = { title: listing.seo_title ?? '', description: listing.seo_description ?? '' };
  }

  // Photos go with the first send only (cover photo first). The bucket is private, so each is a 1-hour signed link.
  if (!item.shopify_product_id) {
    const photos = await db('GET', `listing_photos?select=storage_path,photo_type,is_primary&item_id=eq.${itemId}&order=is_primary.desc,uploaded_at.asc`);
    const files = [];
    for (const p of photos) {
      if (HIDDEN_PHOTO_TYPES.includes(p.photo_type)) continue;
      const url = await signedPhotoUrl(p.storage_path);
      if (url) files.push({ originalSource: url, contentType: 'IMAGE', alt: `${input.title} - ${String(p.photo_type).replace(/_/g, ' ')}` });
    }
    if (files.length) input.files = files;
  }

  let data = await gql(PRODUCT_SET, {
    identifier: item.shopify_product_id ? { id: item.shopify_product_id } : { handle: input.handle },
    input,
  });
  let errors = data.productSet.userErrors;
  // The product was deleted in Shopify: create it again from the item code.
  if (errors.length && item.shopify_product_id && errors.some((e: any) => /not (exist|found)/i.test(e.message))) {
    delete (input.variants as any[])[0].id;
    data = await gql(PRODUCT_SET, { identifier: { handle: input.handle }, input });
    errors = data.productSet.userErrors;
  }
  userErrors(errors);

  const product = data.productSet.product;
  const variant = product.variants.nodes[0];
  await db('PATCH', `consignment_items?id=eq.${itemId}`, {
    shopify_product_id: product.id,
    shopify_variant_id: variant?.id ?? null,
    shopify_inventory_item_id: variant?.inventoryItem?.id ?? null,
  });

  // A new product is on no sales channel yet, and an archived one is hidden everywhere, so that case needs no call.
  const isNew = !item.shopify_product_id || item.shopify_product_id !== product.id;
  if (onStore || !(isNew && status === 'ARCHIVED')) {
    const pub = await gql(onStore ? PUBLISH : UNPUBLISH, { id: product.id, input: [{ publicationId: onlineStoreId }] });
    userErrors(onStore ? pub.publishablePublish.userErrors : pub.publishableUnpublish.userErrors);
  }

  // Only mark it synced if nothing changed while we were sending (a change sets it back to pending).
  await db('PATCH', `consignment_items?id=eq.${itemId}&shopify_sync_status=eq.syncing`, {
    shopify_sync_status: 'synced', shopify_synced_at: new Date().toISOString(), shopify_sync_error: null,
  });
  return 'synced';
}

async function run() {
  const started = Date.now();
  const result = { synced: 0, failed: 0, skipped: 0, stoppedForRateLimit: false };
  while (Date.now() - started < TIME_BUDGET_MS) {
    const ids: string[] = await db('POST', 'rpc/claim_shopify_sync_batch', { batch_size: BATCH_SIZE });
    if (!ids.length) break;
    for (let n = 0; n < ids.length; n++) {
      const id = ids[n];
      try {
        const outcome = await syncItem(id);
        if (outcome === 'synced') result.synced++; else result.skipped++;
      } catch (err) {
        if (err instanceof Throttled) {
          // Put this item and the rest of the batch back in the queue and stop for now.
          const rest = ids.slice(n).join(',');
          await db('PATCH', `consignment_items?id=in.(${rest})&shopify_sync_status=eq.syncing`, { shopify_sync_status: 'pending' });
          result.stoppedForRateLimit = true;
          return result;
        }
        result.failed++;
        const message = err instanceof Error ? err.message : String(err);
        await db('PATCH', `consignment_items?id=eq.${id}&shopify_sync_status=eq.syncing`,
          { shopify_sync_status: 'failed', shopify_sync_error: message.slice(0, 500) });
      }
    }
  }
  const left = await db('GET', 'consignment_items?select=id&shopify_sync_status=eq.pending&limit=1000');
  return { ...result, stillPending: left.length };
}

// ------------------------------------------------------------------ compare, clean up, webhooks
async function audit() {
  const q = (extra: string) => JSON.stringify(`tag:"${SYNC_TAG}"${extra}`);
  const data = await gql(`query {
    total: productsCount(query: ${q('')}, limit: null) { count }
    active: productsCount(query: ${q(' status:active')}, limit: null) { count }
    archived: productsCount(query: ${q(' status:archived')}, limit: null) { count }
    draft: productsCount(query: ${q(' status:draft')}, limit: null) { count }
  }`);
  const rows = await db('GET', 'shopify_sync_overview?select=inventory_status,shopify_sync_status,items');
  const system: Record<string, number> = { published: 0, reserved: 0, sold: 0, archived: 0 };
  const sync: Record<string, number> = {};
  for (const r of rows) {
    system[r.inventory_status] = (system[r.inventory_status] ?? 0) + r.items;
    sync[r.shopify_sync_status] = (sync[r.shopify_sync_status] ?? 0) + r.items;
  }
  return {
    shopify: { total: data.total.count, active: data.active.count, archived: data.archived.count, draft: data.draft.count },
    system: {
      total: system.published + system.reserved + system.sold + system.archived,
      active: system.published + system.reserved,     // published + reserved (layaway) = Active in Shopify
      archived: system.sold + system.archived,         // sold + withdrawn = Archived in Shopify
      listings: system,
    },
    sync,
  };
}

async function removeOrphans() {
  const live = await dbAll(`listings?select=item_id&inventory_status=in.(${LIVE_STATUSES.join(',')})&order=item_id`);
  const liveIds = new Set(live.map((r: any) => r.item_id));
  const items = await dbAll('consignment_items?select=id,item_code&order=id');
  const keep = new Set(items.filter((i: any) => liveIds.has(i.id)).map((i: any) => i.item_code.toLowerCase()));

  let deleted = 0;
  let after: string | null = null;
  const toDelete: string[] = [];
  do {
    const data: any = await gql(`query Products($after: String) {
      products(first: 250, after: $after, query: ${JSON.stringify(`tag:"${SYNC_TAG}"`)}) {
        nodes { id handle } pageInfo { hasNextPage endCursor } } }`, { after });
    for (const p of data.products.nodes) if (!keep.has(p.handle)) toDelete.push(p.id);
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);

  for (const id of toDelete) {
    const data = await gql('mutation Delete($id: ID!) { productDelete(input: { id: $id }) { deletedProductId userErrors { field message } } }', { id });
    userErrors(data.productDelete.userErrors);
    deleted++;
  }
  return { deleted };
}

async function registerWebhooks() {
  const uri = `${SUPABASE_URL}/functions/v1/shopify-webhook`;
  const existing = await gql('query { webhookSubscriptions(first: 50) { nodes { id topic uri } } }');
  const done: string[] = [];
  for (const topic of ['ORDERS_CREATE', 'ORDERS_PAID']) {
    if (existing.webhookSubscriptions.nodes.some((w: any) => w.topic === topic && w.uri === uri)) { done.push(`${topic} (already set)`); continue; }
    const data = await gql(`mutation Create($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { field message } } }`,
      { topic, sub: { uri } });
    userErrors(data.webhookSubscriptionCreate.userErrors);
    done.push(topic);
  }
  return { webhooks: done, uri };
}

// ------------------------------------------------------------------ entry point
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });
  try {
    if (!SHOP || !KEY) return json(500, { error: 'Shopify secrets are not set (SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET).' });
    const role = await callerRole(req);
    if (!role) return json(403, { error: 'Only the owner or the manager can run the Shopify sync.' });

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? 'run';
    if (action === 'run') return json(200, await run());
    if (action === 'audit') return json(200, await audit());
    if (action === 'remove_orphans' || action === 'register_webhooks') {
      if (role !== 'super_admin' && role !== 'system') return json(403, { error: 'Only the owner can do this.' });
      return json(200, action === 'remove_orphans' ? await removeOrphans() : await registerWebhooks());
    }
    return json(400, { error: 'Unknown action' });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});