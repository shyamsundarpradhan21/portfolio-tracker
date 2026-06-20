// Market Wrap feed — the post-session recap that lands AFTER the close.
// One cohesive read of how the day went: index closes + day change, today's
// range, sector performance, and the prior-session FII/DII flows. Two keyless
// sources, same discipline as /api/macro:
//   - Yahoo Finance v8 chart for closes / day moves / ranges (indices/commodities/FX)
//   - NSE public JSON (fiidiiTradeReact) for the FII/DII cash-flow trail
//
//   GET /api/premarket   (route name kept for plumbing; content is the Wrap)
//   → { fetchedAt, cues:{ <key>:{…}|{stale} },
//       sessions:{ <idx>:{ close, change, pct, high, low } }, usSectors, fiidii }
//
// Every datum carries its source + as-of stamp; a failed source returns an
// explicit { stale:true, error } so the UI renders an honest "unavailable"
// cell instead of a stale or fabricated number.

import { deriveMarketState } from '../../lib/market';
import { mapAllIndices, mapYahooIndices, YH_INDEX_SYMS } from '../../lib/wrapIndices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// The session's open/closed state is NOT computed here from a wall clock — it's
// derived client-side from the live index quotes (holiday-aware Yahoo marketState,
// the same source as the topbar NSE/NYSE pills), so the Wrap header is market-
// driven and never disagrees with reality on holidays or special sessions.

// ── Yahoo v8 chart quote ─────────────────────────────────────────────────────
// Returns { price, prev, change, pct, asOf, source } or { stale, error, source }.
const YH_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
async function yhQuote(symbol, source) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  for (const host of YH_HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') continue;
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose ?? null;
      const asOf = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString();
      return {
        price,
        prev,
        change: prev != null ? price - prev : null,
        pct: prev ? ((price - prev) / prev) * 100 : null,
        state: deriveMarketState(meta),
        asOf,
        source: source || `Yahoo ${symbol}`,
      };
    } catch { /* try next host */ }
  }
  return { stale: true, error: 'fetch failed', source: source || `Yahoo ${symbol}` };
}

// Overnight cue board — grouped so the UI can lay out world / commodities / FX /
// India reference without re-deriving the grouping. kind drives formatting only.
const CUE_DEFS = [
  // World — overnight close / live where the session is on
  { key: 'sp500',  sym: '^GSPC',  group: 'world',      label: 'S&P 500',    kind: 'index' },
  { key: 'dow',    sym: '^DJI',   group: 'world',      label: 'Dow Jones',  kind: 'index' },
  { key: 'nasdaq', sym: '^IXIC',  group: 'world',      label: 'Nasdaq',     kind: 'index' },
  { key: 'nikkei', sym: '^N225',  group: 'world',      label: 'Nikkei 225', kind: 'index' },
  { key: 'hangseng', sym: '^HSI', group: 'world',      label: 'Hang Seng',  kind: 'index' },
  // India reference — prior close, the base the pre-open auction moves from
  { key: 'nifty',  sym: '^NSEI',  group: 'india',      label: 'Nifty 50',   kind: 'index' },
  { key: 'sensex', sym: '^BSESN', group: 'india',      label: 'Sensex',     kind: 'index' },
  // Commodities + currency — the cross-border channels into this book
  { key: 'gold',   sym: 'GC=F',   group: 'commodity',  label: 'Gold',        kind: 'commodity', unit: '$' },
  { key: 'silver', sym: 'SI=F',   group: 'commodity',  label: 'Silver',      kind: 'commodity', unit: '$' },
  { key: 'brent',  sym: 'BZ=F',   group: 'commodity',  label: 'Brent crude', kind: 'commodity', unit: '$' },
  { key: 'usdinr', sym: 'INR=X',  group: 'fx',         label: 'USD/INR',    kind: 'fx' },
  { key: 'us10y',  sym: '^TNX',   group: 'fx',         label: 'US 10Y',     kind: 'yield' },
];

async function fetchCues() {
  const entries = await Promise.all(
    CUE_DEFS.map(async (c) => {
      const q = await yhQuote(c.sym, `Yahoo ${c.sym}`);
      return [c.key, { ...q, label: c.label, group: c.group, kind: c.kind, unit: c.unit || null }];
    }),
  );
  return Object.fromEntries(entries);
}

// ── Session summary (today's OHLC) ───────────────────────────────────────────
// How each index did this session: open / high / low / close + day change vs the
// prior close. We read daily candles and use the latest bar (today — partial
// while the session is live, complete after the close), falling back to the live
// meta price for the close and the prior bar (or meta) for the previous close.
async function yhSession(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  for (const host of YH_HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      const ts = r?.timestamp, q = r?.indicators?.quote?.[0], meta = r?.meta;
      if (!Array.isArray(ts) || !q) continue;
      // Latest bar with a high/low = the current / most-recent session.
      let idx = -1;
      for (let i = ts.length - 1; i >= 0; i--) {
        if (q.high?.[i] != null && q.low?.[i] != null) { idx = i; break; }
      }
      if (idx === -1) continue;
      const close = q.close?.[idx] ?? meta?.regularMarketPrice ?? null;
      const prevClose = idx > 0 ? (q.close?.[idx - 1] ?? null) : (meta?.chartPreviousClose ?? null);
      if (close == null) continue;
      return {
        open: q.open?.[idx] ?? null, high: q.high[idx], low: q.low[idx], close, prevClose,
        change: prevClose != null ? close - prevClose : null,
        pct: prevClose ? ((close - prevClose) / prevClose) * 100 : null,
        asOf: new Date(ts[idx] * 1000).toISOString().slice(0, 10),
        source: `Yahoo ${symbol} (session)`,
      };
    } catch { /* try next host */ }
  }
  return { stale: true, error: 'fetch failed', source: `Yahoo ${symbol} (session)` };
}

async function fetchSessions() {
  const [nifty, sensex, sp500, nasdaq] = await Promise.all([
    yhSession('^NSEI'),
    yhSession('^BSESN'),
    yhSession('^GSPC'),
    yhSession('^IXIC'),
  ]);
  return { nifty, sensex, sp500, nasdaq };
}

// ── US sector heatmap (SPDR Select Sector ETFs) ──────────────────────────────
// The US has no single free constituent feed like the Nifty 50, so we read the
// 11 SPDR Select Sector ETFs — each tracks one GICS sector of the S&P 500. Their
// live % move IS the sector heatmap, the US-side mirror of the Nifty sector tiles.
const US_SECTOR_ETFS = [
  { key: 'tech',     sym: 'XLK',  label: 'Technology' },
  { key: 'comm',     sym: 'XLC',  label: 'Communication' },
  { key: 'discr',    sym: 'XLY',  label: 'Cons. Discretionary' },
  { key: 'fin',      sym: 'XLF',  label: 'Financials' },
  { key: 'health',   sym: 'XLV',  label: 'Health Care' },
  { key: 'indu',     sym: 'XLI',  label: 'Industrials' },
  { key: 'staples',  sym: 'XLP',  label: 'Cons. Staples' },
  { key: 'energy',   sym: 'XLE',  label: 'Energy' },
  { key: 'util',     sym: 'XLU',  label: 'Utilities' },
  { key: 'mat',      sym: 'XLB',  label: 'Materials' },
  { key: 'reit',     sym: 'XLRE', label: 'Real Estate' },
];

async function fetchUsSectors() {
  const rows = await Promise.all(
    US_SECTOR_ETFS.map(async (e) => {
      const q = await yhQuote(e.sym, `Yahoo ${e.sym}`);
      return { key: e.key, label: e.label, sym: e.sym, pct: q.stale ? null : q.pct, asOf: q.asOf || null };
    }),
  );
  return rows;
}

// ── NSE session cookie (shared) ──────────────────────────────────────────────
// NSE gates its JSON behind a cookie set on the home page. We bootstrap it ONCE
// per request (browser UA) and reuse it for every NSE endpoint below (indices +
// FII/DII), so the home page is hit a single time. Returns '' on failure — the
// callers then degrade to a fallback / { stale } rather than throwing.
async function nseCookie() {
  try {
    const boot = await fetch('https://www.nseindia.com/', {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    return (boot.headers.get('set-cookie') || '')
      .split(/,(?=[^ ;]+=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  } catch {
    return '';
  }
}

// ── NSE index board (sectoral + breadth + India VIX) ─────────────────────────
// Replaces the manual Kite EOD snapshot (data/market-wrap.json): one allIndices
// call returns every NSE index, mapped to the same wrap shape. NSE often blocks
// data-centre IPs, so on any failure we fall back to Yahoo's NSE index symbols;
// the client then falls back again to the committed snapshot — never a worse
// state than today, and live whenever NSE is reachable.
async function fetchIndices(cookie) {
  const src = 'NSE allIndices';
  // Primary — NSE allIndices (authoritative; the same source Kite mirrors).
  try {
    const res = await fetch('https://www.nseindia.com/api/allIndices', {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.nseindia.com/market-data/live-market-indices',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const mapped = mapAllIndices(await res.json());
      if (mapped) return mapped;
    }
  } catch { /* fall through to Yahoo */ }

  // Fallback — Yahoo's NSE index symbols. Fetch exactly what the mapper looks up,
  // then hand it the lookup. Breadth is thin on Yahoo, so it returns what resolves.
  const quotes = {};
  await Promise.all(YH_INDEX_SYMS.map(async (s) => { quotes[s] = await yhQuote(s, `Yahoo ${s}`); }));
  const yh = mapYahooIndices((s) => quotes[s]);
  if (yh) return yh;

  return { stale: true, error: 'NSE + Yahoo index feeds unavailable', source: src };
}

// ── FII/DII cash-flow trail (NSE public JSON) ────────────────────────────────
// Uses the shared NSE session cookie (see nseCookie). Often blocked from
// data-centre IPs — on any failure we return { stale } and the UI shows the trail
// as unavailable rather than inventing flows.
async function fetchFiiDii(cookie) {
  const src = 'NSE fiidiiTradeReact';
  try {
    const res = await fetch('https://www.nseindia.com/api/fiidiiTradeReact', {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.nseindia.com/reports/fii-dii',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { stale: true, error: `NSE HTTP ${res.status}`, source: src };

    const json = await res.json();
    // Response is an array of { category:'FII/FPI *'|'DII *', date, buyValue,
    // sellValue, netValue } rows. NSE returns only the latest session here, so a
    // 10-day trail isn't available from this endpoint — we surface today's net.
    const rows = Array.isArray(json) ? json : json?.data;
    if (!Array.isArray(rows) || !rows.length) return { stale: true, error: 'no rows', source: src };

    const pick = (re) => rows.find((r) => re.test(String(r.category || '')));
    const fii = pick(/FII|FPI/i);
    const dii = pick(/DII/i);
    const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
    const norm = (r) => r && ({ buy: num(r.buyValue), sell: num(r.sellValue), net: num(r.netValue), date: r.date });

    const latest = { fii: norm(fii), dii: norm(dii), date: (fii || dii)?.date || null, source: src };
    if (latest.fii?.net == null && latest.dii?.net == null) return { stale: true, error: 'unparseable', source: src };
    return { latest, asOf: latest.date, source: src };
  } catch (e) {
    return { stale: true, error: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed'), source: src };
  }
}

// ── Server-side FII/DII trail (Vercel KV / Upstash Redis, optional) ──────────
// When a Redis store is wired we persist one point per NSE session here too, so
// the 10-day trail is cross-device and keeps building even when no browser is
// open — refreshed by the daily Vercel cron (see vercel.json). Without a store
// this is a no-op and the client's localStorage trail (lib/fiidii.js) is the
// source of truth.
//
// Vercel KV now ships via the Marketplace (Upstash for Redis), which injects
// creds under EITHER naming depending on how the store is connected:
//   - KV_REST_API_URL / KV_REST_API_TOKEN          (legacy / "KV" prefix)
//   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (Upstash default)
// We accept both and build the client explicitly so it works either way. The
// import is dynamic so the route never hard-depends on the store being present.
const KV_KEY = 'premarket:fiidiiTrail';
const TRAIL_CAP = 10;

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function kvClient() {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const { createClient } = await import('@vercel/kv');
    return createClient(creds);
  } catch {
    return null;
  }
}

async function persistTrail(latest) {
  const kv = await kvClient();
  if (!kv || !latest?.date) return null;
  const fii = latest.fii?.net, dii = latest.dii?.net;
  try {
    const arr = (await kv.get(KV_KEY)) || [];
    // Nothing live to record — return whatever trail the store already holds.
    if ((fii == null || !isFinite(fii)) && (dii == null || !isFinite(dii))) return arr.length ? arr : null;
    const point = { d: latest.date, fii: isFinite(fii) ? fii : null, dii: isFinite(dii) ? dii : null };
    const i = arr.findIndex((p) => p.d === point.d);
    if (i >= 0) arr[i] = point; else arr.push(point);
    arr.sort((a, b) => new Date(a.d) - new Date(b.d));
    const trimmed = arr.slice(-TRAIL_CAP);
    await kv.set(KV_KEY, trimmed);
    return trimmed;
  } catch {
    return null; // store unreachable — fall back to the client trail
  }
}

export async function GET() {
  // One NSE cookie bootstrap, reused by both NSE endpoints (indices + FII/DII).
  const cookie = await nseCookie();
  const [cues, sessions, usSectors, fiidii, indices] = await Promise.all([
    fetchCues(), fetchSessions(), fetchUsSectors(), fetchFiiDii(cookie), fetchIndices(cookie),
  ]);
  // Persist + attach the server trail when KV is configured; null otherwise.
  const trail = await persistTrail(fiidii && !fiidii.stale ? fiidii.latest : null);
  if (trail) fiidii.trail = trail;
  return Response.json(
    {
      fetchedAt: new Date().toISOString(),
      cues,
      sessions,
      usSectors,
      fiidii,
      indices,
    },
    // Closes/levels move intraday; a short edge cache keeps refreshes cheap
    // without serving a number that's more than a minute or two old.
    { headers: { 'Cache-Control': 's-maxage=90, stale-while-revalidate=300' } },
  );
}
