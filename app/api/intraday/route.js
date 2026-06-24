// Live intraday P&L tape for the Trading tab's Day view. Reads the day's tape from
// KV (intraday:<date>), which the capture daemon republishes every ~10s — so the
// client polls this and sees near-live P&L with no redeploy. Falls back to the
// committed archive (data/fno-intraday.json) when KV is empty (older days, or KV
// unconfigured in local dev). Non-personal aggregate (net ₹ per minute), but kept
// force-dynamic + no-store like the other private-data routes.

import fnoIntraday from '../../../data/fno-intraday.json';
import eqIntraday from '../../../data/eq-intraday.json';
import usIntraday from '../../../data/us-intraday.json';

export const dynamic = 'force-dynamic';

const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
// kind selects the tape: F&O position P&L (default), India equity, or US equity.
const ARCHIVE = { fno: fnoIntraday, eq: eqIntraday, us: usIntraday };
const kvKeyOf = (kind, date) => (kind === 'fno' ? `intraday:${date}` : `intraday:${kind}:${date}`);
const KINDS = new Set(['fno', 'eq', 'us']);

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function fromKV(kind, date) {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', kvKeyOf(kind, date)]),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch { return null; }
}

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const date = params.get('date');
  const kind = KINDS.has(params.get('kind')) ? params.get('kind') : 'fno';
  if (!isoDate(date)) {
    return Response.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  const live = await fromKV(kind, date);
  const tape = Array.isArray(live) ? live : (ARCHIVE[kind]?.days?.[date] || []);
  return new Response(JSON.stringify({ date, kind, tape, source: live ? 'kv' : 'archive' }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
