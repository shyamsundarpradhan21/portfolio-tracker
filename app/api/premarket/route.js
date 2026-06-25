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
// FII/DII trail capture is shared with /api/snapshot (the daily cron) — one copy.
import { nseCookie, fetchFiiDii, persistTrail } from '../../lib/fiidiiTrail';

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

// ── FII derivative positioning (NSE participant-wise OI CSV) ─────────────────
// Underneath the cash net (fiidiiTradeReact, above) sits the F&O book. NSE's
// participant-wise open-interest CSV breaks every participant (FII / DII / Pro /
// retail "Client") across index & stock futures and index & stock options, in
// number of contracts. We read it to derive the FII *stance* the cash row hides
// (e.g. cash flat, but net-short futures + long puts = bearish) and the classic
// FII-vs-retail divergence. Plain CSV, no parser dependency. Keyed to the
// authoritative cash session date so it never asks NSE for a non-existent file.
const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
// 'DD-Mon-YYYY' (cash feed) → 'DDMMYYYY' (CSV filename); null if unrecognised.
function toDDMMYYYY(d) {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(String(d || ''));
  const mm = m && MON[m[2].toLowerCase()];
  return mm ? `${m[1]}${mm}${m[3]}` : null;
}
// IST 'today' as DDMMYYYY — fallback when the cash feed gave no session date.
function istDDMMYYYY() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${ist.getUTCFullYear()}`;
}

async function fetchParticipantStats(cookie, sessionDate) {
  const src = 'NSE fao_participant_oi';
  const ddmmyyyy = toDDMMYYYY(sessionDate) || istDDMMYYYY();
  try {
    const res = await fetch(`https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${ddmmyyyy}.csv`, {
      headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/', Cookie: cookie || '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { stale: true, error: `NSE HTTP ${res.status}`, source: src };
    const rows = (await res.text()).trim().split('\n').map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
    if (rows.length < 3) return { stale: true, error: 'no rows', source: src };
    const num = (v) => { const n = parseInt(String(v).replace(/[", ]/g, ''), 10); return isFinite(n) ? n : 0; };
    // Cols by position (header has trailing-space labels, so index not name):
    // 1 FutIdxLong 2 FutIdxShort 3 FutStkLong 4 FutStkShort
    // 5 OptIdxCallLong 6 OptIdxPutLong 7 OptIdxCallShort 8 OptIdxPutShort
    const pick = (re) => rows.find((r) => re.test(String(r[0] || '')));
    const net = (r) => r && ({
      idxFut: num(r[1]) - num(r[2]),       // long − short  (net position, in contracts)
      stkFut: num(r[3]) - num(r[4]),
      idxCall: num(r[5]) - num(r[7]),      // call long − call short
      idxPut: num(r[6]) - num(r[8]),       // put  long − put  short
    });
    // Exact match: the header row is "Client Type", which a /^Client/ prefix would
    // wrongly grab before the "Client" data row (parsing its labels to 0).
    const fii = net(pick(/^FII$/i));
    const retail = net(pick(/^Client$/i));
    if (!fii) return { stale: true, error: 'no FII row', source: src };

    // Stance: net-short futures, long puts and short calls each read bearish.
    const bear = (fii.idxFut < 0 ? 1 : 0) + (fii.idxPut > 0 ? 1 : 0) + (fii.idxCall < 0 ? 1 : 0);
    const bull = (fii.idxFut > 0 ? 1 : 0) + (fii.idxPut < 0 ? 1 : 0) + (fii.idxCall > 0 ? 1 : 0);
    const stance = bear > bull ? 'bearish' : bull > bear ? 'bullish' : 'mixed';
    // Divergence: retail leaning the opposite way on index futures (the classic split).
    const divergence = !!retail && fii.idxFut !== 0 && retail.idxFut !== 0 && Math.sign(fii.idxFut) !== Math.sign(retail.idxFut);

    return { asOf: sessionDate || null, source: src, fii, retail: retail || null, stance, divergence };
  } catch (e) {
    return { stale: true, error: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed'), source: src };
  }
}

// Server-side FII/DII trail persistence (KV premarket:fiidiiTrail) now lives in
// lib/fiidiiTrail.js — shared with /api/snapshot's daily cron. The Wrap still persists
// on-demand here when the page loads; the cron keeps it building with no browser open.

export async function GET() {
  // One NSE cookie bootstrap, reused by both NSE endpoints (indices + FII/DII).
  const cookie = await nseCookie();
  const [cues, sessions, usSectors, usMovers, usVix, fiidii, indices] = await Promise.all([
    fetchCues(), fetchSessions(), fetchUsSectors(), fetchUsMovers(), yhQuote('^VIX', 'Yahoo ^VIX'), fetchFiiDii(cookie), fetchIndices(cookie),
  ]);
  // Persist + attach the server trail when KV is configured; null otherwise.
  const trail = await persistTrail(fiidii && !fiidii.stale ? fiidii.latest : null);
  if (trail) fiidii.trail = trail;
  // FII derivative positioning — keyed to the cash feed's authoritative session date.
  const fiiDerivs = await fetchParticipantStats(cookie, fiidii && !fiidii.stale ? fiidii.latest?.date : null);
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
    },
    // Closes/levels move intraday; a short edge cache keeps refreshes cheap
    // without serving a number that's more than a minute or two old.
    { headers: { 'Cache-Control': 's-maxage=90, stale-while-revalidate=300' } },
  );
}
