// Upcoming corp actions for the user's holdings — the market-wide NSE corp-actions calendar
// (laptop-captured to KV `marketwrap:corpactions`, committed fallback data/corp-actions.json)
// PLUS the US dividend calendar (KV `marketwrap:corpactions:us`, committed corp-actions-us.json),
// each filtered to the matching holdings (Indian by NSE sym, US by ticker) with the ex-date
// countdown recomputed fresh against today. Reveals which names are held → PRIVATE:
// force-dynamic + no-store, never cached or bundled.

import { loadPortfolio } from '../../lib/serverPortfolio';
import { daysUntil } from '../../lib/corpActions';
import { parseNseDate } from '../../lib/niftyOptions';
import corpSeed from '../../../data/corp-actions.json';
import corpSeedUs from '../../../data/corp-actions-us.json';

// NSE "15-Jul-2026" -> ISO "2026-07-15" (US feed is already ISO, passes through unchanged).
const toISO = (d) => { const ms = parseNseDate(d); return ms == null ? d : new Date(ms).toISOString().slice(0, 10); };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY_IN = 'marketwrap:corpactions';
const KEY_US = 'marketwrap:corpactions:us';

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
// KV serving copy first, committed snapshot as the local-dev / cold fallback — same read
// pattern as loadPortfolio / loadFnoOverlay. `fallback` is the committed array.
async function kvArray(key, fallback) {
  const creds = kvCreds();
  if (creds) {
    try {
      const r = await fetch(creds.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', key]),
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      const j = await r.json();
      if (j?.result) { const v = JSON.parse(j.result); if (Array.isArray(v)) return v; }
    } catch { /* fall back to committed */ }
  }
  return Array.isArray(fallback) ? fallback : [];
}

export async function GET() {
  const todayISO = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST
  const [calIn, calUs, port] = await Promise.all([
    kvArray(KEY_IN, corpSeed?.actions ?? corpSeed?.dividends),
    kvArray(KEY_US, corpSeedUs?.actions),
    loadPortfolio(),
  ]);

  // Indian book (INDIAN + SWING) by bare NSE symbol; US book by ticker — the corp-actions keys.
  const heldIn = new Set(
    [...(port?.INDIAN || []), ...(port?.SWING || [])].map((h) => String(h?.sym || '').trim().toUpperCase()).filter(Boolean),
  );
  const heldUs = new Set((port?.US || []).map((h) => String(h?.sym || h?.ticker || '').trim().toUpperCase()).filter(Boolean));

  const mapItem = (d, market) => ({
    sym: d.sym,
    name: d.name || d.sym,
    type: d.type || 'dividend',
    amount: d.amount ?? null,
    ratio: d.ratio ?? null,
    market,
    exDate: toISO(d.exDate),
    days: daysUntil(d.exDate, todayISO),
  });

  const items = [
    ...calIn.filter((d) => d && heldIn.has(String(d.sym || '').toUpperCase())).map((d) => mapItem(d, 'IN')),
    ...calUs.filter((d) => d && heldUs.has(String(d.sym || '').toUpperCase())).map((d) => mapItem(d, 'US')),
  ]
    .filter((d) => d.days != null && d.days >= 0)
    .sort((a, b) => a.days - b.days);

  return Response.json(
    { fetchedAt: new Date().toISOString(), items },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
