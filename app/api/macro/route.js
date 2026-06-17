// Live macro CLOCK for the scenario engine. Two free, keyless sources:
//   - FRED CSV (fredgraph.csv?id=…) for rates/credit/conditions series
//   - Yahoo Finance v8 chart for VIX/term-structure/DXY/USDINR/Brent
//
//   GET /api/macro
//   → { fetchedAt, live: { <metric>: { value, prev, change, asOf, source } | { stale } } }
//
// Every datum is tagged with its source + as-of timestamp. If a source fails we
// return an explicit { stale: true, error } for that metric — never a silent
// guess (the UI renders these as an unavailable cell).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── FRED (keyless CSV) ───────────────────────────────────────────────────────
// fredgraph.csv returns: header row, then `date,value` rows; missing prints are
// '.'. We keep the last two real observations (latest + prior) for a change.
async function fredSeries(id) {
  const start = new Date();
  start.setDate(start.getDate() - 60); // ~60d window is plenty for last-2 obs
  const cosd = start.toISOString().slice(0, 10);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/csv' },
      cache: 'no-store',
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return { stale: true, error: `FRED HTTP ${res.status}`, source: `FRED ${id}` };
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1) // drop header
      .map((ln) => ln.split(','))
      .filter((c) => c.length >= 2 && c[1] !== '.' && c[1] !== '' && isFinite(+c[1]))
      .map((c) => ({ date: c[0], v: +c[1] }));
    if (!rows.length) return { stale: true, error: 'no observations', source: `FRED ${id}` };
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    return {
      value: last.v,
      prev: prev ? prev.v : null,
      change: prev ? last.v - prev.v : null,
      asOf: last.date,
      source: `FRED ${id}`,
    };
  } catch (e) {
    return { stale: true, error: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed'), source: `FRED ${id}` };
  }
}

// ── Yahoo v8 chart quote ─────────────────────────────────────────────────────
async function yhQuote(symbol, label) {
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  for (const host of hosts) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') continue;
      const value = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose ?? null;
      const asOf = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString();
      return { value, prev, change: prev != null ? value - prev : null, asOf, source: `Yahoo ${symbol}` };
    } catch { /* try next host */ }
  }
  return { stale: true, error: 'fetch failed', source: `Yahoo ${symbol}` };
}

export async function GET() {
  const [us10y, spread, hyOas, nfci, vix, vix3m, dxy, usdinr, brent] = await Promise.all([
    fredSeries('DGS10'),          // US 10Y yield (%)
    fredSeries('T10Y2Y'),         // 2s10s spread (pp)
    fredSeries('BAMLH0A0HYM2'),   // ICE BofA US HY OAS (%) — risk-off early warning
    fredSeries('NFCI'),           // Chicago Fed financial conditions index
    yhQuote('^VIX', 'VIX'),
    yhQuote('^VIX3M', 'VIX3M'),
    yhQuote('DX-Y.NYB', 'DXY'),
    yhQuote('INR=X', 'USDINR'),
    yhQuote('BZ=F', 'Brent'),
  ]);

  // VIX term structure: VIX3M > VIX is contango (calm); VIX > VIX3M is
  // backwardation (stress). Derived only when both reads are live.
  let vixTerm = { stale: true, error: 'needs VIX + VIX3M' };
  if (!vix.stale && !vix3m.stale && vix3m.value) {
    const ratio = vix.value / vix3m.value;
    vixTerm = {
      ratio,
      state: ratio > 1 ? 'backwardation' : 'contango',
      asOf: vix.asOf,
      source: 'Yahoo ^VIX/^VIX3M',
    };
  }

  return Response.json(
    { fetchedAt: new Date().toISOString(), live: { us10y, spread2s10s: spread, hyOas, nfci, vix, vix3m, vixTerm, dxy, usdinr, brent } },
    { headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=600' } },
  );
}
