import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_ROLES = ['super_admin', 'manager', 'consignment_team', 'pricing_team', 'sales_associate'];
const MAX_FACTS = 30;
const MAX_FACT_LENGTH = 300;

const INSTRUCTION = [
  'You write a short summary of business figures for the owner or manager of a luxury consignment business. Use plain, simple English.',
  'Rules for facts and numbers:',
  '- Use ONLY the facts you are given. If something is not in the facts, do not mention it.',
  '- Copy every number exactly as written, including symbols and units (for example ₱24.97M, 82%, 6.8 months).',
  '- Never calculate, round, convert or combine numbers.',
  '- Never compare two numbers that use different units (for example months and days). Never say one figure is above or below another unless the facts say so.',
  '- Never give a reason or cause that is not stated in the facts. Do not guess about promotions, seasons, holidays or events.',
  '- A month that is marked as not over yet is a partial figure. Do not describe it as a final result.',
  '- If the facts say the view is limited to certain brands or a period, keep your wording within that scope.',
  '- Do not suggest raising or lowering stock unless the facts say whether stock is high or low. If the facts support only two good suggestions, give two.',
  '- Every suggestion must be a concrete action on a named brand, price, intake or stock level. Do not write vague suggestions such as "address" or "look into" a figure.',
  'Return JSON only, with three fields:',
  '- "overview": 1 or 2 sentences on what happened in the period. Start with sales, then the most notable month or change.',
    '- "watch": 1 or 2 short sentences about the single most important risk or thing to keep an eye on. Choose it from the facts, such as a declining brand, slow-moving items, or stock that is large compared with sales. Do not call something a risk unless the facts show it.',
  '- "consider": 2 or 3 suggestions, each under 20 words, each starting with a verb. Each suggestion must name the specific figure or brand it is based on and say what to prioritise, review or change. Focus on consignment and inventory decisions, such as which brand to prioritise for new consignments, which brand\'s pricing or intake to review, or whether to adjust stock. Do not suggest anything the facts do not support.',
].join('\n');

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    overview: { type: 'STRING' },
    watch: { type: 'STRING' },
    consider: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['overview', 'watch', 'consider'],
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function secretKey(): string | undefined {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const key = keys.default ?? Object.values(keys)[0];
    if (typeof key === 'string' && key) return key;
  } catch (_) { /* fall through */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? undefined;
}

/** Every number of 13 or more in the AI text must appear in the facts (commas ignored). Small numbers are allowed. */
function numbersAreFromFacts(text: string, facts: string[]): boolean {
  const source = facts.join(' ').replace(/,/g, '');
  const found = text.replace(/,/g, '').match(/\d+(\.\d+)?/g) ?? [];
  return found.every((n) => Number(n) <= 12 || source.includes(n));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });

  try {
    const key = secretKey();
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const model = Deno.env.get('GEMINI_MODEL');
    if (!key || !geminiKey || !model) return json(500, { error: 'The AI summary is not set up yet.' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller?.user) return json(401, { error: 'Your session has expired. Log in again.' });

    const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', caller.user.id).maybeSingle();
    if (!me || !me.is_active || !ALLOWED_ROLES.includes(me.role)) {
      return json(403, { error: 'Your role can\'t use the AI summary.' });
    }

    const body = await req.json().catch(() => ({}));
    const facts: string[] = Array.isArray(body.facts)
      ? body.facts.map((f: unknown) => String(f).trim().slice(0, MAX_FACT_LENGTH)).filter(Boolean).slice(0, MAX_FACTS)
      : [];
    if (facts.length < 3) return json(400, { error: 'There are not enough figures to summarise yet.' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let reply: Response;
    try {
      reply = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: 'Facts:\n' + facts.map((f) => '- ' + f).join('\n') }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
            responseSchema: SCHEMA,
          },
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (reply.status === 429 || reply.status === 503) return json(503, { error: 'busy' });
    if (!reply.ok) {
      console.error('Gemini error', reply.status, (await reply.text()).slice(0, 300));
      return json(502, { error: 'unavailable' });
    }

    const data = await reply.json();
    const raw = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    let summary: { overview?: unknown; watch?: unknown; consider?: unknown };
    try { summary = JSON.parse(raw); } catch (_) { return json(502, { error: 'unavailable' }); }

    const overview = String(summary.overview ?? '').trim();
    const watch = String(summary.watch ?? '').trim();
    const consider = Array.isArray(summary.consider) ? summary.consider.map((c) => String(c).trim()).filter(Boolean).slice(0, 3) : [];
    if (!overview || !watch || consider.length === 0) return json(502, { error: 'unavailable' });

    if (!numbersAreFromFacts([overview, watch, ...consider].join(' '), facts)) {
      console.error('AI summary refused: it contained a number that is not in the facts');
      return json(502, { error: 'unavailable' });
    }

    return json(200, { summary: { overview, watch, consider } });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'unavailable' });
  }
});