// India market-sentiment feed for the Wrap's India view. Sibling to /api/us-sentiment
// but a DIFFERENT instrument set — India has no VIX term structure and no liquid retail
// HY OAS, so LEADING is the genuinely forward/flow signals that DO exist here:
//   LEADING:    India VIX (log-z vs its own trailing year) · FII net flow (the canary,
//               scored ALONE — DII is context) · [PCR deferred to v2]
//   COINCIDENT: Nifty vs 125D MA (self-computed). Breadth is added client-side from
//               /api/premarket; 52-wk hi/lo dropped (no clean India source, low value).
// Headline = LEADING-only composite (forward risk appetite), self-computed → tagged
// "India · blend". All math in app/lib/indiaSentiment.js (unit-tested).
//
// Keyless: Yahoo for ^INDIAVIX / ^NSEI; FII/DII history read from the KV trail the
// premarket cron already maintains. Server-only (no keys, nothing bundled). Each signal
// degrades to { stale } independently — never a fabricated reading.
import { vixLogZ, fiiFlowScore, absorptionGap, indiaHeadline, percentileRank } from '../../lib/indiaSentiment';
import { maMomentum, momentumScore, sma, scoreLabel, isNum } from '../../lib/usSentiment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const YH_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
// Daily close series + latest price for a symbol (range=1y → ~250 sessions).
async function yhDaily(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  for (const host of YH_HOSTS) {
    try {
      const res = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      const closes = r?.indicators?.quote?.[0]?.close;
      const last = r?.meta?.regularMarketPrice;
      if (Array.isArray(closes)) {
        const clean = closes.filter((x) => typeof x === 'number' && isFinite(x));
        return { closes: clean, last: isNum(last) ? last : clean[clean.length - 1], asOf: r?.meta?.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString() : null };
      }
    } catch { /* try next host */ }
  }
  return null;
}

// Tiny live-level fetch (range=1d) — used once the band is cached so we refresh the
// intraday VIX without re-pulling the year.
async function yhLast(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  for (const host of YH_HOSTS) {
    try {
      const res = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(7000) });
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      if (meta && typeof meta.regularMarketPrice === 'number') return { last: meta.regularMarketPrice, asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null };
    } catch { /* try next host */ }
  }
  return null;
}

// India VIX scored against a log-band (median + σ of ln VIX) cached ONCE PER UTC DAY in
// module scope. The band only moves daily, so warm instances don't re-fetch + re-sort the
// 246-close year on every request — only the live level refreshes intraday. (FII uses a
// SHORT rolling window by contrast — see lib/indiaSentiment.js for why the windows differ.)
let VIX_BAND = { day: null, median: null, sigma: null, closes: null };
async function vixSignal() {
  const day = new Date().toISOString().slice(0, 10);
  let last, asOf;
  if (VIX_BAND.day !== day || !isNum(VIX_BAND.median)) {
    const d = await yhDaily('^INDIAVIX'); // day rollover (or cold start): pull the year + recompute the band
    const closes = (d?.closes || []).filter((x) => x > 0);
    if (closes.length < 30) return { stale: true, error: 'India VIX history thin', source: 'Yahoo ^INDIAVIX' };
    const logs = closes.map(Math.log).sort((a, b) => a - b);
    const m = logs.reduce((a, b) => a + b, 0) / logs.length;
    VIX_BAND = { day, median: logs[Math.floor(logs.length / 2)], sigma: Math.sqrt(logs.reduce((a, b) => a + (b - m) ** 2, 0) / (logs.length - 1)), closes };
    last = d?.last; asOf = d?.asOf;
  } else {
    const q = await yhLast('^INDIAVIX'); // band cached → only the live level
    last = q?.last; asOf = q?.asOf;
  }
  const score = vixLogZ(last, VIX_BAND.median, VIX_BAND.sigma);
  return isNum(score)
    ? { value: last, score, pct: percentileRank(last, VIX_BAND.closes), asOf, source: 'NSE India VIX (Yahoo)' }
    : { stale: true, error: 'India VIX unavailable', source: 'Yahoo ^INDIAVIX' };
}

// FII/DII history from the KV trail (one {d, fii, dii} point per session, maintained by
// the premarket cron). Server-side only; no store wired (local dev) → empty → FII cold-
// starts and the headline re-normalizes onto VIX.
function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
async function readTrail() {
  const creds = kvCreds();
  if (!creds) return [];
  try {
    const { createClient } = await import('@vercel/kv');
    const arr = await createClient(creds).get('premarket:fiidiiTrail');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export async function GET() {
  const [vix, nseiD, trail] = await Promise.all([vixSignal(), yhDaily('^NSEI'), readTrail()]);

  // LEADING #1 — India VIX, log-z vs its own trailing year (band cached daily).
  const vixScore = vix.stale ? null : vix.score;

  // LEADING #2 — FII net flow (the canary), scored ALONE; DII is context.
  const pts = (trail || []).filter((p) => p && isNum(p.fii));
  const fiiHist = pts.map((p) => p.fii);
  const diiHist = pts.map((p) => p.dii);
  const last = pts[pts.length - 1];
  const fiiNet = last?.fii ?? null, diiNet = last?.dii ?? null;
  const fiiScore = fiiFlowScore(fiiNet, fiiHist);
  const fii = isNum(fiiNet)
    ? { net: fiiNet, dii: isNum(diiNet) ? diiNet : null, score: isNum(fiiScore) ? fiiScore : null, building: !isNum(fiiScore), asOf: last?.d, source: 'NSE FII/DII (KV trail)' }
    : { stale: true, error: 'FII trail unavailable', source: 'NSE FII/DII (KV trail)' };

  // COINCIDENT — Nifty vs 125D MA (price-derived; context, not in the headline).
  const sma125 = sma(nseiD?.closes, 125);
  const nPct = maMomentum(nseiD?.last, sma125);
  const momentum = isNum(nPct)
    ? { pct: nPct, score: momentumScore(nPct), asOf: nseiD?.asOf, source: 'Nifty 50 vs 125D MA (Yahoo)' }
    : { stale: true, error: 'need 125 daily closes', source: 'Yahoo ^NSEI' };

  // Headline — LEADING-only, re-normalized over present factors (cold-start → VIX 1.0).
  const score = indiaHeadline({ vixScore, fiiScore });
  const composite = isNum(score)
    ? { score, rating: scoreLabel(score), source: 'India · blend' }
    : { stale: true, source: 'India · blend' };

  // Divergence — the absorption the combined sum hides (silent unless FII flees + DII soaks).
  const gap = absorptionGap(fiiNet, diiNet, fiiHist, diiHist);

  return Response.json(
    { fetchedAt: new Date().toISOString(), composite, leading: { vix, fii }, coincident: { momentum }, absorption: gap },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=1800' } },
  );
}
