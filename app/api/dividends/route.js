// Upcoming dividends for the user's holdings — the market-wide NSE corp-actions
// calendar (laptop-captured to KV `marketwrap:corpactions`, committed fallback
// data/corp-actions.json) filtered to the Indian holdings from loadPortfolio, with
// the ex-date countdown recomputed fresh against today. Reveals which names are
// held → PRIVATE: force-dynamic + no-store, never cached or bundled.

import { loadPortfolio } from '../../lib/serverPortfolio';
import { daysUntil } from '../../lib/corpActions';
import { parseNseDate } from '../../lib/niftyOptions';
import corpSeed from '../../../data/corp-actions.json';

// NSE "15-Jul-2026" -> ISO "2026-07-15" so the client formats it reliably.
const toISO = (nse) => { const ms = parseNseDate(nse); return ms == null ? nse : new Date(ms).toISOString().slice(0, 10); };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY = 'marketwrap:corpactions';

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
// KV serving copy first, committed snapshot as the local-dev / cold fallback — the
// same read pattern as loadPortfolio / loadFnoOverlay.
async function loadCalendar() {
  const creds = kvCreds();
  if (creds) {
    try {
      const r = await fetch(creds.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', KEY]),
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      const j = await r.json();
      if (j?.result) { const v = JSON.parse(j.result); if (Array.isArray(v)) return v; }
    } catch { /* fall back to committed */ }
  }
  return Array.isArray(corpSeed?.dividends) ? corpSeed.dividends : [];
}

export async function GET() {
  const todayISO = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST
  const [calendar, port] = await Promise.all([loadCalendar(), loadPortfolio()]);

  // Indian book (INDIAN + SWING) keyed by bare NSE symbol — the corp-actions key.
  const held = new Set(
    [...(port?.INDIAN || []), ...(port?.SWING || [])]
      .map((h) => String(h?.sym || '').trim().toUpperCase())
      .filter(Boolean),
  );

  const items = calendar
    .filter((d) => d && held.has(String(d.sym || '').toUpperCase()))
    .map((d) => ({ sym: d.sym, name: d.name || d.sym, amount: d.amount ?? null, exDate: toISO(d.exDate), days: daysUntil(d.exDate, todayISO) }))
    .filter((d) => d.days != null && d.days >= 0)
    .sort((a, b) => a.days - b.days);

  return Response.json(
    { fetchedAt: new Date().toISOString(), items },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
