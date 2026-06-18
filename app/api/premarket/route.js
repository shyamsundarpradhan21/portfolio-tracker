// Pre-Market Insights feed — the morning companion that lands BEFORE NSE opens.
// Modelled on Dhan's pre-market window (a cohesive overnight read in one place),
// adapted to this book. Two keyless sources, same discipline as /api/macro:
//   - Yahoo Finance v8 chart for overnight global cues (indices/commodities/FX)
//   - NSE public JSON (fiidiiTradeReact) for the FII/DII cash-flow trail
//
//   GET /api/premarket
//   → { fetchedAt, window:{ open, label, opensInMin }, cues:{ <key>:{…}|{stale} },
//       fiidii:{ trail:[…], latest:{…} } | { stale } }
//
// Every datum carries its source + as-of stamp; a failed source returns an
// explicit { stale:true, error } so the UI renders an honest "unavailable"
// cell instead of a stale or fabricated number.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Pre-open window (IST) ────────────────────────────────────────────────────
// Dhan surfaces Pre-Market Insights 6:30–9:00 AM IST on trading days. We compute
// the same wall-clock window deterministically (Mon–Fri); outside it the tab
// runs in "market context" mode rather than the live morning companion.
const PRE_START = 6 * 60 + 30; // 06:30 IST
const PRE_END = 9 * 60;        // 09:00 IST
const NSE_OPEN = 9 * 60 + 15;  // 09:15 IST

function preOpenWindow() {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t) => p.find((x) => x.type === t)?.value;
    const wd = get('weekday');
    const weekend = wd === 'Sat' || wd === 'Sun';
    let hh = parseInt(get('hour'), 10); if (hh === 24) hh = 0;
    const mins = hh * 60 + parseInt(get('minute'), 10);
    const open = !weekend && mins >= PRE_START && mins < PRE_END;
    const label = weekend ? 'weekend' : open ? 'pre-open' : mins < PRE_START ? 'before-window' : mins < NSE_OPEN ? 'pre-open auction' : mins < 15 * 60 + 30 ? 'market open' : 'after-close';
    const opensInMin = !weekend && mins < NSE_OPEN ? NSE_OPEN - mins : null;
    return { open, label, opensInMin, istMinutes: mins, weekend };
  } catch {
    return { open: false, label: 'unknown', opensInMin: null, istMinutes: null, weekend: false };
  }
}

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
        state: meta.marketState || null,
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
  { key: 'gold',   sym: 'GC=F',   group: 'commodity',  label: 'Gold',       kind: 'commodity', unit: '$' },
  { key: 'brent',  sym: 'BZ=F',   group: 'commodity',  label: 'Brent crude',kind: 'commodity', unit: '$' },
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

// ── Support / resistance pivot levels ────────────────────────────────────────
// Classic floor-trader pivots from the prior COMPLETED session's high/low/close
// — a standard, deterministic read of where the pre-open auction sits relative
// to support and resistance. We pull a few daily candles and use the last one
// whose OHLC is fully formed (the current day's partial candle is skipped).
async function yhPivots(symbol, label) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=7d`;
  for (const host of YH_HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      const ts = r?.timestamp, q = r?.indicators?.quote?.[0];
      if (!Array.isArray(ts) || !q) continue;
      // Walk back to the most recent bar with a complete H/L/C.
      let idx = -1;
      for (let i = ts.length - 1; i >= 0; i--) {
        if (q.high?.[i] != null && q.low?.[i] != null && q.close?.[i] != null) { idx = i; break; }
      }
      if (idx === -1) continue;
      const H = q.high[idx], L = q.low[idx], C = q.close[idx];
      const pp = (H + L + C) / 3;
      return {
        prevClose: C, prevHigh: H, prevLow: L,
        pp,
        r1: 2 * pp - L, s1: 2 * pp - H,
        r2: pp + (H - L), s2: pp - (H - L),
        r3: H + 2 * (pp - L), s3: L - 2 * (H - pp),
        asOf: new Date(ts[idx] * 1000).toISOString().slice(0, 10),
        source: `Yahoo ${symbol} (pivots)`,
      };
    } catch { /* try next host */ }
  }
  return { stale: true, error: 'fetch failed', source: `Yahoo ${symbol} (pivots)` };
}

async function fetchLevels() {
  const [nifty, sensex] = await Promise.all([
    yhPivots('^NSEI', 'Nifty 50'),
    yhPivots('^BSESN', 'Sensex'),
  ]);
  return { nifty, sensex };
}

// ── FII/DII cash-flow trail (NSE public JSON) ────────────────────────────────
// NSE gates its JSON behind a session cookie set on the home page, so we bootstrap
// a cookie with a browser UA, then hit the data endpoint. Often blocked from
// data-centre IPs — on any failure we return { stale } and the UI shows the trail
// as unavailable rather than inventing flows.
async function fetchFiiDii() {
  const src = 'NSE fiidiiTradeReact';
  try {
    const boot = await fetch('https://www.nseindia.com/', {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const cookie = (boot.headers.get('set-cookie') || '')
      .split(/,(?=[^ ;]+=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');

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

export async function GET() {
  const [cues, levels, fiidii] = await Promise.all([fetchCues(), fetchLevels(), fetchFiiDii()]);
  return Response.json(
    {
      fetchedAt: new Date().toISOString(),
      window: preOpenWindow(),
      cues,
      levels,
      fiidii,
    },
    // Cues move pre-open; a short edge cache keeps the morning refreshes cheap
    // without serving a number that's more than a minute or two old.
    { headers: { 'Cache-Control': 's-maxage=90, stale-while-revalidate=300' } },
  );
}
