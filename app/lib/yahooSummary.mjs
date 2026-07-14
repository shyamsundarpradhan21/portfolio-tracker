// Yahoo Finance quoteSummary fetcher — the crumb+cookie-gated endpoint that carries the
// slow-moving fundamentals the stock-detail panel needs (P/E, EPS, beta, float, market cap,
// next-earnings, dividends, income statement) — the fields the KEYLESS v8 chart endpoint does
// NOT expose. Shared by scripts/spike-yahoo-summary.mjs and app/api/stock/route.js so the spike
// proves the exact code the route runs.
//
// Flow (standard Yahoo consent dance):
//   1. GET a Yahoo page → capture the A1/A3 Set-Cookie.
//   2. GET /v1/test/getcrumb with that cookie → a short-lived crumb token.
//   3. GET /v10/finance/quoteSummary/<sym>?modules=…&crumb=… with cookie + crumb.
// Cookie+crumb are cached in-module (~30 min) so a burst of clicks doesn't re-handshake.
//
// Everything optional-chained + shape-validated: a missing module blanks ONE field, never
// throws. The caller (route) layers a committed-fundamentals fallback on top of that.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const COOKIE_HOSTS = ['https://fc.yahoo.com/', 'https://finance.yahoo.com/'];
const TTL = 30 * 60 * 1000; // 30 min

// The modules the panel consumes. quoteSummary drops unknown modules silently, so an
// over-broad list is safe; a per-symbol coverage gap simply blanks the affected field.
export const MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'calendarEvents',
  'summaryProfile',
  'incomeStatementHistory',
  'incomeStatementHistoryQuarterly',
];

let _cred = { cookie: null, crumb: null, ts: 0 };

async function fetchCookie() {
  for (const url of COOKIE_HOSTS) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      // node fetch exposes Set-Cookie via getSetCookie() (undici) or a folded header.
      const setc =
        (typeof res.headers.getSetCookie === 'function' && res.headers.getSetCookie()) ||
        (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      const jar = setc
        .map((c) => c.split(';')[0])
        .filter((c) => /^(A1|A3|A1S|GUC|B)=/.test(c))
        .join('; ');
      if (jar) return jar;
    } catch { /* try next */ }
  }
  return null;
}

async function fetchCrumb(cookie) {
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + '/v1/test/getcrumb', {
        headers: { 'User-Agent': UA, Accept: 'text/plain,*/*', Cookie: cookie },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const crumb = (await res.text()).trim();
      // A valid crumb is a short token; an HTML/empty body means the handshake failed.
      if (crumb && crumb.length < 32 && !crumb.startsWith('<')) return crumb;
    } catch { /* try next */ }
  }
  return null;
}

// Returns { cookie, crumb } or throws if the handshake can't be completed.
async function credentials(force = false) {
  const now = Date.now();
  if (!force && _cred.crumb && _cred.cookie && now - _cred.ts < TTL) return _cred;
  const cookie = await fetchCookie();
  if (!cookie) throw new Error('yahoo: no cookie (consent handshake failed)');
  const crumb = await fetchCrumb(cookie);
  if (!crumb) throw new Error('yahoo: no crumb');
  _cred = { cookie, crumb, ts: now };
  return _cred;
}

// Raw quoteSummary result[0] for a symbol, or throws. Retries the handshake once on a
// 401/Unauthorized (a stale crumb), then gives up so the caller can fall back.
export async function fetchStockSummary(symbol, modules = MODULES) {
  const sym = encodeURIComponent(symbol);
  const mod = modules.join(',');
  for (let attempt = 0; attempt < 2; attempt++) {
    const { cookie, crumb } = await credentials(attempt === 1);
    for (const host of HOSTS) {
      try {
        const url = `${host}/v10/finance/quoteSummary/${sym}?modules=${mod}&crumb=${encodeURIComponent(crumb)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookie },
          cache: 'no-store',
          signal: AbortSignal.timeout(9000),
        });
        if (res.status === 401 || res.status === 403) break; // stale crumb → re-handshake
        if (!res.ok) continue;
        const json = await res.json();
        const r = json?.quoteSummary?.result?.[0];
        if (r) return r;
      } catch { /* try next host */ }
    }
  }
  throw new Error(`yahoo: quoteSummary failed for ${symbol}`);
}

// ── normalization ── raw numeric under `.raw`, human string under `.fmt`.
const raw = (v) => (v && typeof v === 'object' && 'raw' in v ? v.raw : typeof v === 'number' ? v : null);
const fmt = (v) => (v && typeof v === 'object' && 'fmt' in v ? v.fmt : null);
const secs = (v) => { const s = raw(v); return s ? new Date(s * 1000).toISOString().slice(0, 10) : null; };

// Map raw quoteSummary → the flat shape the StockDetail panel consumes. Every field
// optional; a module the symbol lacks yields null, not an error.
export function normalizeStock(r, symbol) {
  const P = r?.price || {};
  const S = r?.summaryDetail || {};
  const K = r?.defaultKeyStatistics || {};
  const F = r?.financialData || {};
  const C = r?.calendarEvents || {};
  const PR = r?.summaryProfile || {};
  const ISa = r?.incomeStatementHistory?.incomeStatementHistory || [];
  const ISq = r?.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];

  const incomeSeries = (rows) =>
    rows
      .slice(0, 5)
      .reverse()
      .map((row) => {
        const rev = raw(row.totalRevenue);
        const ni = raw(row.netIncome);
        return {
          date: (row.endDate?.fmt || '').slice(0, 7) || secs(row.endDate),
          revenue: rev,
          netIncome: ni,
          netMargin: rev && ni != null ? Math.round((ni / rev) * 1000) / 10 : null,
        };
      });

  const earnDates = C?.earnings?.earningsDate || [];

  return {
    symbol,
    // header
    name: P.longName || P.shortName || symbol,
    exchange: P.exchangeName || P.fullExchangeName || null,
    sector: PR.sector || null,
    industry: PR.industry || null,
    currency: P.currency || S.currency || null,
    price: raw(P.regularMarketPrice),
    prevClose: raw(P.regularMarketPreviousClose) ?? raw(S.previousClose),
    change: raw(P.regularMarketChange),
    changePct: raw(P.regularMarketChangePercent),
    marketState: P.marketState || null,
    // ranges
    dayLow: raw(S.dayLow) ?? raw(P.regularMarketDayLow),
    dayHigh: raw(S.dayHigh) ?? raw(P.regularMarketDayHigh),
    week52Low: raw(S.fiftyTwoWeekLow),
    week52High: raw(S.fiftyTwoWeekHigh),
    // key stats
    nextEarnings: secs(earnDates[0]),
    volume: raw(S.volume) ?? raw(P.regularMarketVolume),
    avgVolume30: raw(S.averageVolume) ?? raw(S.averageDailyVolume3Month),
    marketCap: raw(P.marketCap) ?? raw(S.marketCap),
    marketCapFmt: fmt(P.marketCap) || fmt(S.marketCap),
    dividendYieldIndicated: raw(S.dividendYield),
    peTTM: raw(S.trailingPE),
    basicEpsTTM: raw(K.trailingEps),
    sharesFloat: raw(K.floatShares),
    sharesFloatFmt: fmt(K.floatShares),
    beta: raw(S.beta) ?? raw(K.beta),
    // dividends
    dividendYieldTTM: raw(S.trailingAnnualDividendYield),
    lastDividend: raw(S.dividendRate) ?? raw(S.trailingAnnualDividendRate),
    exDividendDate: secs(C.exDividendDate) ?? secs(S.exDividendDate),
    dividendPayDate: secs(C.dividendDate) ?? secs(S.dividendDate),
    payoutRatio: raw(S.payoutRatio) ?? raw(K.payoutRatio),
    // income statement
    incomeAnnual: incomeSeries(ISa),
    incomeQuarterly: incomeSeries(ISq),
  };
}
