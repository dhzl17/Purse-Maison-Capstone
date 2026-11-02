// Edge Function: shopify-webhook
// Receives Shopify's order notifications (orders/create and orders/paid). When an order is paid, every item in it that
// came from this system is recorded as a sale, exactly like Record Sale in Sales & Payouts, with the payment verified.
// The usual database rules then mark the listing Sold, notify the consignor, and the shopify-sync function archives the
// product in Shopify.
//
// Every delivery is logged in shopify_webhook_events. A delivery Shopify sends twice is only processed once.
//
// Secrets (Edge Functions -> Secrets): SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_SECRET (used to check Shopify's signature)
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor, name it exactly
// "shopify-webhook", paste this file, Deploy. Then turn OFF "Verify JWT": Shopify can't send a Supabase login,
// so the function checks Shopify's signature instead.

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SHOP = Deno.env.get('SHOPIFY_STORE_DOMAIN') ?? '';
const CLIENT_SECRET = Deno.env.get('SHOPIFY_CLIENT_SECRET') ?? '';
const FALLBACK_BUYER = 'Shopify Online Buyer';

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

function reply(status: number, message: string) {
  return new Response(JSON.stringify({ message }), { status, headers: { 'Content-Type': 'application/json' } });
}

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
  if (!res.ok) throw new Error(data?.message ?? res.statusText);
  return data;
}

/** Shopify signs the raw body with the app's client secret (HMAC-SHA256, base64). */
async function validSignature(raw: string, header: string | null) {
  if (!header || !CLIENT_SECRET) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(raw)));
  const expected = btoa(String.fromCharCode(...sig));
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

/** The buyer's name, if it passes the same name rule as the forms (Module 26). */
async function buyerName(order: any): Promise<string> {
  const c = order.customer ?? {};
  const candidates = [
    [c.first_name, c.last_name].filter(Boolean).join(' '),
    order.shipping_address?.name,
    order.billing_address?.name,
  ];
  for (const raw of candidates) {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (await db('POST', 'rpc/is_valid_person_name', { v: name }) === true) return name;
  }
  return FALLBACK_BUYER;
}

/** A PH mobile number saved as 09XXXXXXXXX, or null. */
function buyerPhone(order: any): string | null {
  const candidates = [order.shipping_address?.phone, order.billing_address?.phone, order.customer?.phone, order.phone];
  for (const raw of candidates) {
    let v = String(raw ?? '').replace(/[\s()-]/g, '');
    if (v.startsWith('+63')) v = `0${v.slice(3)}`;
    if (/^09\d{9}$/.test(v)) return v;
  }
  return null;
}

async function recordSale(order: any, orderId: string): Promise<string[]> {
  const notes: string[] = [];
  const name = await buyerName(order);
  const phone = buyerPhone(order);
  const soldAt = order.processed_at ?? order.created_at ?? new Date().toISOString();

  for (const line of order.line_items ?? []) {
    let item = null;
    if (line.sku) {
      [item] = await db('GET', `consignment_items?select=id,item_code&item_code=eq.${encodeURIComponent(String(line.sku).trim().toUpperCase())}`);
    }
    if (!item && line.product_id) {
      [item] = await db('GET', `consignment_items?select=id,item_code&shopify_product_id=eq.${encodeURIComponent(`gid://shopify/Product/${line.product_id}`)}`);
    }
    if (!item) { notes.push(`"${line.title ?? line.sku}" is not from the system (ignored)`); continue; }

    const [sale] = await db('GET', `sales_transactions?select=id,shopify_order_id&item_id=eq.${item.id}`);
    if (sale && sale.shopify_order_id === orderId) { notes.push(`${item.item_code} already recorded`); continue; }
    if (sale) throw new Error(`${item.item_code} was already sold in the system. Refund this order in Shopify.`);

    const [created] = await db('POST', 'sales_transactions', {
      item_id: item.id,
      buyer_name: name,
      buyer_phone: phone,
      sale_type: 'full_payment',
      sale_channel: 'shopify',
      shopify_order_id: orderId,
      shopify_order_name: order.name ?? null,
      sold_at: soldAt,
    }, 'return=representation');
    // Shopify has already taken the payment, so it is verified straight away (payout due in 14 banking days).
    await db('PATCH', `sales_transactions?id=eq.${created.id}`, { payment_status: 'verified' });
    notes.push(`${item.item_code} sold (${order.name ?? orderId})`);
  }
  return notes;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, 'Use POST');
  const raw = await req.text();

  if (!(await validSignature(raw, req.headers.get('X-Shopify-Hmac-SHA256')))) return reply(401, 'Invalid signature');
  const shop = req.headers.get('X-Shopify-Shop-Domain');
  if (SHOP && shop && shop !== SHOP) return reply(401, 'Unknown store');

  const topic = req.headers.get('X-Shopify-Topic') ?? '';
  const webhookId = req.headers.get('X-Shopify-Webhook-Id') ?? crypto.randomUUID();
  let order: any;
  try { order = JSON.parse(raw); } catch (_) { return reply(400, 'Body is not JSON'); }
  const orderId = order.admin_graphql_api_id ?? (order.id ? `gid://shopify/Order/${order.id}` : null);

  // Log it. An ID we've already seen means Shopify sent it again: nothing to do.
  const logged = await db('POST', 'shopify_webhook_events',
    { webhook_id: webhookId, topic, shopify_order_id: orderId, payload: order },
    'resolution=ignore-duplicates,return=representation');
  if (!logged.length) return reply(200, 'Already received');

  const finish = (status: string, error: string | null) =>
    db('PATCH', `shopify_webhook_events?webhook_id=eq.${encodeURIComponent(webhookId)}`,
      { status, error, processed_at: new Date().toISOString() });

  try {
    if (topic !== 'orders/create' && topic !== 'orders/paid') {
      await finish('ignored', `Topic ${topic} is not handled`);
      return reply(200, 'Ignored');
    }
    if (order.financial_status !== 'paid') {
      await finish('ignored', `Not paid yet (${order.financial_status ?? 'unknown'})`);
      return reply(200, 'Not paid yet');
    }
    const notes = await recordSale(order, orderId);
    await finish('processed', notes.join('; ') || null);
    return reply(200, 'Processed');
  } catch (err) {
    // Still answer 200: the error is logged for staff, and Shopify would otherwise keep retrying the same order.
    await finish('failed', err instanceof Error ? err.message : String(err)).catch(() => {});
    return reply(200, 'Logged as failed');
  }
});
