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

import { UA } from '../../lib/ua';
import { deriveMarketState } from '../../lib/market';
import { mapAllIndices, mapYahooIndices, YH_INDEX_SYMS } from '../../lib/wrapIndices';
// FII/DII cash + derivative-positioning capture is shared with /api/snapshot (the daily
// cron) — one copy, in lib/fiidiiTrail. This route persists on-demand; the cron builds it
// with no browser open.
import { nseCookie, fetchFiiDii, persistTrail, fetchParticipantStats } from '../../lib/fiidiiTrail';
// Nifty 50 Overview inputs: classic pivot S/R (computed from the prior session's
// OHLC) and the option-chain read (PCR/ATM IV/max pain/expiry). The options snapshot
// is laptop-captured (residential IP reaches NSE) into KV + a committed seed; the
// route also tries NSE live, so a datacenter block degrades to the last snapshot,
// never a blank — same NSE→fallback discipline as the index board above.
import { computePivots, pivotSourceBar } from '../../lib/pivots';
import { mapOptionChain, expiryInDays } from '../../lib/niftyOptions';
import niftyOptionsSeed from '../../../data/nifty-options.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
  { key: 'ftse',   sym: '^FTSE',  group: 'world',      label: 'FTSE 100',   kind: 'index' },
  { key: 'cac',    sym: '^FCHI',  group: 'world',      label: 'CAC 40',     kind: 'index' },
  { key: 'dax',    sym: '^GDAXI', group: 'world',      label: 'DAX',        kind: 'index' },
  { key: 'nikkei', sym: '^N225',  group: 'world',      label: 'Nikkei 225', kind: 'index' },
  { key: 'hangseng', sym: '^HSI', group: 'world',      label: 'Hang Seng',  kind: 'index' },
  { key: 'kospi',  sym: '^KS11',  group: 'world',      label: 'KOSPI',      kind: 'index' },
  // India reference — prior close, the base the pre-open auction moves from
  { key: 'nifty',  sym: '^NSEI',  group: 'india',      label: 'Nifty 50',   kind: 'index' },
  { key: 'sensex', sym: '^BSESN', group: 'india',      label: 'Sensex',     kind: 'index' },
  // Commodities + currency — the cross-border channels into this book
  { key: 'gold',   sym: 'GC=F',   group: 'commodity',  label: 'Gold',        kind: 'commodity', unit: '$' },
  { key: 'silver', sym: 'SI=F',   group: 'commodity',  label: 'Silver',      kind: 'commodity', unit: '$' },
  { key: 'brent',  sym: 'BZ=F',   group: 'commodity',  label: 'Brent crude', kind: 'commodity', unit: '$' },
  { key: 'natgas', sym: 'NG=F',   group: 'commodity',  label: 'Nat Gas',     kind: 'commodity', unit: '$' },
  { key: 'btc',    sym: 'BTC-USD', group: 'crypto',    label: 'Bitcoin',     kind: 'crypto',    unit: '$' },
  { key: 'eth',    sym: 'ETH-USD', group: 'crypto',    label: 'Ethereum',    kind: 'crypto',    unit: '$' },
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

// ── US market movers (Yahoo predefined screeners) ────────────────────────────
// day_gainers / day_losers are keyless "saved" screeners. Unfiltered they're
// micro-cap-heavy (penny biotech, SPACs), so we keep only large caps (≥ $10B) —
// the names that actually move the index and that this book tracks — then surface
// the 5 biggest moves each way. The US mirror of the Nifty day-movers.
async function fetchUsMovers() {
  const CAP_FLOOR = 10e9;
  const one = async (scrId) => {
    const path = `/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=50`;
    for (const host of YH_HOSTS) {
      try {
        const res = await fetch(host + path, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) continue;
        const quotes = (await res.json())?.finance?.result?.[0]?.quotes;
        if (!Array.isArray(quotes)) continue;
        return quotes
          .filter((x) => x && x.symbol && (x.marketCap || 0) >= CAP_FLOOR && typeof x.regularMarketChangePercent === 'number')
          .map((x) => ({ sym: x.symbol, name: x.shortName || x.longName || x.symbol, pct: x.regularMarketChangePercent }))
          .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
          .slice(0, 5);
      } catch { /* try next host */ }
    }
    return [];
  };
  const [gainers, losers] = await Promise.all([one('day_gainers'), one('day_losers')]);
  return { gainers, losers };
}

// nseCookie (shared NSE session bootstrap) now lives in lib/fiidiiTrail.js.

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

// fetchFiiDii (NSE cash-flow trail) now lives in lib/fiidiiTrail.js (shared with the cron).

// fetchParticipantStats (NSE participant-OI derivative stance) now lives in
// lib/fiidiiTrail.js (shared with the cron) — same one-copy move as fetchFiiDii above.

// Server-side FII/DII trail persistence (KV premarket:fiidiiTrail) now lives in
// lib/fiidiiTrail.js — shared with /api/snapshot's daily cron. The Wrap still persists
// on-demand here when the page loads; the cron keeps it building with no browser open.

// ── Nifty pivot S/R (classic levels) ─────────────────────────────────────────
// Daily ^NSEI bars → the last COMPLETED session's H/L/C → classic pivot ladder.
// When the market is live the latest bar is the partial session, so pivotSourceBar
// drops it (levels are for the CURRENT session, off yesterday's close).
async function fetchNiftyLevels() {
  const path = `/v8/finance/chart/${encodeURIComponent('^NSEI')}?interval=1d&range=5d`;
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
      const bars = ts
        .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), high: q.high?.[i], low: q.low?.[i], close: q.close?.[i] }))
        .filter((b) => [b.high, b.low, b.close].every((x) => x != null && isFinite(x)));
      const bar = pivotSourceBar(bars, deriveMarketState(meta) === 'REGULAR');
      const lv = computePivots(bar);
      if (lv) return { nifty: { ...lv, prevClose: bar.close, asOf: bar.date } };
    } catch { /* try next host */ }
  }
  return { stale: true, error: 'fetch failed' };
}

// ── Nifty option-chain read (PCR / ATM IV / max pain / expiry) ────────────────
// Serving order mirrors the index board: (1) NSE live, best-effort with a short
// timeout — usually blocked on a datacenter IP but real when it gets through;
// (2) the laptop-captured KV snapshot; (3) the committed seed. A snapshot's
// expiry-in is recomputed against today, and a rolled/expired snapshot is hidden
// (honest blank) rather than shown with a negative countdown.
function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
async function kvGetJSON(key) {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key]),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch { return null; }
}
// Refresh the expiry countdown against today; drop a snapshot whose nearest expiry
// has already passed (it's stale until the next capture).
function freshenOptions(o, todayISO) {
  if (!o || !o.expiryDate) return null;
  const eid = expiryInDays(o.expiryDate, todayISO);
  if (eid == null || eid < 0) return null;
  return { ...o, expiryInDays: eid };
}
async function fetchOptions(cookie, todayISO) {
  // 1 — NSE live (short timeout so it can't stall the wrap; runs inside Promise.all)
  try {
    const res = await fetch('https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY', {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.nseindia.com/option-chain',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const o = mapOptionChain(await res.json(), todayISO);
      if (o) return { ...o, snapshot: false };
    }
  } catch { /* fall through to snapshot */ }
  // 2 — laptop-captured KV snapshot
  const kv = freshenOptions(await kvGetJSON('marketwrap:options'), todayISO);
  if (kv) return { ...kv, snapshot: true };
  // 3 — committed seed
  const seed = freshenOptions(niftyOptionsSeed?.options, todayISO);
  if (seed) return { ...seed, snapshot: true };
  return null;
}

export async function GET() {
  // Expiry-in / snapshot freshness are IST-calendar (the wrap is NSE-oriented).
  const todayISO = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  // One NSE cookie bootstrap, reused by both NSE endpoints (indices + FII/DII).
  const cookie = await nseCookie();
  const [cues, sessions, usSectors, usMovers, usVix, fiidii, indices, levels, options] = await Promise.all([
    fetchCues(), fetchSessions(), fetchUsSectors(), fetchUsMovers(), yhQuote('^VIX', 'Yahoo ^VIX'), fetchFiiDii(cookie), fetchIndices(cookie), fetchNiftyLevels(), fetchOptions(cookie, todayISO),
  ]);
  // FII derivative positioning — keyed to the cash feed's authoritative session date.
  const fiiDerivs = await fetchParticipantStats(cookie, fiidii && !fiidii.stale ? fiidii.latest?.date : null);
  // Persist + attach the server trail when KV is configured; null otherwise. The
  // positioning is captured onto the same session point so it builds a history too.
  const trail = await persistTrail(fiidii && !fiidii.stale ? fiidii.latest : null, fiiDerivs);
  if (trail) fiidii.trail = trail;
  return Response.json(
    {
      fetchedAt: new Date().toISOString(),
      cues,
      sessions,
      usSectors,
      usMovers,
      usVix: usVix && !usVix.stale ? usVix.price : null,
      fiidii,
      fiiDerivs,
      indices,
      levels,
      options,
    },
    // Closes/levels move intraday; a short edge cache keeps refreshes cheap
    // without serving a number that's more than a minute or two old.
    { headers: { 'Cache-Control': 's-maxage=90, stale-while-revalidate=300' } },
  );
}
