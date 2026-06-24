// Daily per-sleeve GROWTH snapshot — the resilient end-of-day fallback the app
// reads when no intraday tape exists for a day (the capture host was off, or a
// slow sleeve like MF/CMPF that never had an intraday tape). Reads KV growth:<date>
// (republished by scripts/snapshot-growth.mjs), falling back to the committed
// archive (data/growth.json) for older days or when KV is unconfigured. Private
// aggregate (net ₹ per sleeve) but kept force-dynamic + no-store like the other
// private-data routes so nothing private ships in the client bundle.

import growthArchive from '../../../data/growth.json';

export const dynamic = 'force-dynamic';

const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function fromKV(date) {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', `growth:${date}`]),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch { return null; }
}

export async function GET(req) {
  const date = new URL(req.url).searchParams.get('date');
  if (!isoDate(date)) {
    return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  const live = await fromKV(date);
  const record = live || growthArchive?.days?.[date] || null;
  return new Response(JSON.stringify({ date, record, source: live ? 'kv' : 'archive' }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
