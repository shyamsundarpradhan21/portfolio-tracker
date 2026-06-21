// US market-sentiment feed for the Wrap's Global view. Opinionated split: LEADING
// signals that carry forward information (VIX term structure, HY credit spread,
// put/call positioning) vs COINCIDENT, price-derived ones (momentum, breadth,
// 52w strength) — most sentiment gauges are just price re-sliced, so we separate
// the differentiated signals from the echoes.
//
//   GET /api/us-sentiment
//   → { fetchedAt, leading:{ vixTs, hyOas, putCall }, coincident:{ momentum,
//       breadth, strength52w }, composite }
//
// All keyless or server-keyed; nothing is fetched client-side. Three sources:
//   - Yahoo v8 chart (keyless): ^VIX9D / ^VIX / ^VIX3M term structure + ^GSPC daily
//   - FRED official API (FRED_API_KEY): ICE BofA US HY OAS, BAMLH0A0HYM2
//   - CNN Fear & Greed graphdata (unofficial): put/call, breadth, 52w strength,
//     composite anchor. Needs browser-like headers or it 418s. Best-effort: every
//     source degrades to { stale } independently so a dead feed never fakes a 0.

import { vixTermStructure, hyOasScore, putCallScore, maMomentum, momentumScore, sma, isNum } from '../../lib/usSentiment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Yahoo v8 chart (keyless) ─────────────────────────────────────────────────
const YH_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
async function yhMeta(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  for (const host of YH_HOSTS) {
    try {
      const res = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(7000) });
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      if (meta && typeof meta.regularMarketPrice === 'number') return meta;
    } catch { /* try next host */ }
  }
  return null;
}

// Daily close series (for the 125-day MA). range=1y → ~250 trading days.
async function yhCloses(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  for (const host of YH_HOSTS) {
    try {
      const res = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      const closes = r?.indicators?.quote?.[0]?.close;
      const last = r?.meta?.regularMarketPrice;
      if (Array.isArray(closes)) return { closes: closes.filter((x) => typeof x === 'number'), last: isNum(last) ? last : null };
    } catch { /* try next host */ }
  }
  return null;
}

// LEADING #1 — VIX term structure (front 9D vs back 3M).
async function fetchVixTs() {
  const [m9, m, m3] = await Promise.all([yhMeta('^VIX9D'), yhMeta('^VIX'), yhMeta('^VIX3M')]);
  const ts = vixTermStructure(m9?.regularMarketPrice, m?.regularMarketPrice, m3?.regularMarketPrice);
  if (!ts) return { stale: true, error: 'VIX term feed unavailable', source: 'Yahoo ^VIX9D/^VIX3M' };
  const asOf = m3?.regularMarketTime ? new Date(m3.regularMarketTime * 1000).toISOString() : new Date().toISOString();
  return { ...ts, asOf, source: 'Yahoo ^VIX9D/^VIX/^VIX3M' };
}

// COINCIDENT — S&P 500 vs its 125-day moving average.
async function fetchMomentum() {
  const d = await yhCloses('^GSPC');
  const price = d?.last ?? (d?.closes || []).slice(-1)[0];
  const sma125 = sma(d?.closes, 125);
  const pct = maMomentum(price, sma125);
  if (pct == null) return { stale: true, error: 'need 125 daily closes', source: 'Yahoo ^GSPC' };
  return { sp: price, sma125, pct, score: momentumScore(pct), asOf: new Date().toISOString(), source: 'Yahoo ^GSPC (125D MA)' };
}

// ── FRED (official API, free key) — IP-blocked keyless host, so use the keyed API.
// LEADING #2 — ICE BofA US High Yield OAS, BAMLH0A0HYM2 (percent).
async function fetchHyOas() {
  const key = process.env.FRED_API_KEY;
  const src = 'FRED BAMLH0A0HYM2';
  if (!key) return { stale: true, error: 'no FRED_API_KEY', source: src };
  const start = new Date(); start.setDate(start.getDate() - 30);
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=BAMLH0A0HYM2&api_key=${key}` +
    `&file_type=json&sort_order=desc&limit=8&observation_start=${start.toISOString().slice(0, 10)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { stale: true, error: `FRED HTTP ${res.status}`, source: src };
    const obs = (await res.json())?.observations;
    if (!Array.isArray(obs)) return { stale: true, error: 'no observations', source: src };
    const vals = obs.map((o) => ({ v: parseFloat(o.value), d: o.date })).filter((o) => isFinite(o.v)); // desc, latest first
    if (!vals.length) return { stale: true, error: 'unparseable', source: src };
    const value = vals[0].v, prev = vals[1]?.v ?? null;
    return { value, prev, chg: isNum(prev) ? value - prev : null, score: hyOasScore(value), asOf: vals[0].d, source: src };
  } catch (e) {
    return { stale: true, error: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed'), source: src };
  }
}

// ── CNN Fear & Greed graphdata (unofficial; needs browser headers) ───────────
// One call yields the composite + put/call (raw + normalized), breadth and 52w
// strength, each with a 0-100 score. Best-effort: returns null on any failure so
// the dependent cells render "no data" rather than a fabricated reading.
async function fetchCnn() {
  try {
    const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://edition.cnn.com',
        Referer: 'https://edition.cnn.com/markets/fear-and-greed',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null; // 418 from a datacenter IP, etc.
    return await res.json();
  } catch { return null; }
}

const cnnAt = (c) => (isNum(c?.timestamp) ? new Date(c.timestamp).toISOString() : new Date().toISOString());
const cnnScore = (c) => (c && isNum(c.score) ? { score: c.score, rating: c.rating || null, asOf: cnnAt(c) } : { stale: true });

export async function GET() {
  const [vixTs, momentum, hyOas, cnn] = await Promise.all([fetchVixTs(), fetchMomentum(), fetchHyOas(), fetchCnn()]);

  // LEADING #3 — CBOE total put/call (raw + our own normalized score). CNN's
  // component carries the latest raw ratio in its last data point.
  let putCall = { stale: true, error: 'CNN unreachable', source: 'CNN put_call_options' };
  if (cnn?.put_call_options) {
    const pc = cnn.put_call_options;
    const raw = (pc.data || []).slice(-1)[0]?.y;
    putCall = isNum(raw)
      ? { value: raw, score: putCallScore(raw), rating: pc.rating || null, cnnScore: isNum(pc.score) ? pc.score : null, asOf: cnnAt(pc), source: 'CNN put_call_options' }
      : { ...cnnScore(pc), value: null, source: 'CNN put_call_options' };
  }

  const breadth = cnn?.stock_price_breadth ? { ...cnnScore(cnn.stock_price_breadth), source: 'CNN stock_price_breadth' } : { stale: true, source: 'CNN stock_price_breadth' };
  const strength52w = cnn?.stock_price_strength ? { ...cnnScore(cnn.stock_price_strength), source: 'CNN stock_price_strength' } : { stale: true, source: 'CNN stock_price_strength' };
  const composite = cnn?.fear_and_greed ? { ...cnnScore(cnn.fear_and_greed), source: 'CNN fear_and_greed' } : { stale: true, source: 'CNN fear_and_greed' };

  return Response.json(
    { fetchedAt: new Date().toISOString(), leading: { vixTs, hyOas, putCall }, coincident: { momentum, breadth, strength52w }, composite },
    // Slow-moving (HY OAS daily, CNN ~daily, VIX intraday): a short edge cache keeps
    // refreshes cheap without serving a stale-by-hours reading.
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=1800' } },
  );
}
