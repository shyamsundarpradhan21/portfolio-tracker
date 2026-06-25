// Live equity intraday day-change for the capture daemon. Unlike F&O (where the
// broker returns position P&L directly), equity P&L is holdings × price — and the
// big INDIAN delivery sleeve is hosted-OAuth Kite, which a headless daemon can't
// drive. It doesn't need to: the reconcile routine already commits the holdings
// (qty/avg) into broker-state.json, and live prices come keyless from the existing
// /api/quotes proxy (Yahoo, returns price + prevClose). So the day-change curve is
// Σ qty × (price − prevClose) — no Kite token in the loop.
//
// READ-ONLY: only reads committed holdings + GETs the public quotes proxy.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const r2 = (n) => Math.round(n * 100) / 100;

// NSE ticker → Yahoo symbol. broker-state holds bare NSE symbols (AURIONPRO);
// Yahoo wants the .NS suffix (the same convention /api/quotes already uses).
export const yahooSym = (sym) => `${String(sym).trim().toUpperCase()}.NS`;

// Equity holdings the daemon can price: INDIAN (Kite delivery, hand-reconciled)
// + SWING (Upstox). Each row carries qty + sym; we ignore the snapshot ltp/pnl
// (stale — from the morning sync) and re-price live.
export function equityHoldings(state) {
  const out = [];
  for (const [key, sleeve] of [['INDIAN', 'INDIAN'], ['SWING', 'SWING']]) {
    for (const r of state?.holdings?.[key]?.rows || []) {
      if (r?.sym && r.qty) out.push({ sym: r.sym, qty: +r.qty, sleeve });
    }
  }
  return out;
}

// Pure: holdings + a quotes map → today's day-change P&L. quotes is keyed by the
// Yahoo symbol → { price, prevClose }. A holding with no quote is reported under
// `missing` (skipped, never zeroed into the total). Exported for unit tests.
export function computeDayChange(holdings, quotes) {
  const bySleeve = {}; let net = 0; const missing = []; let covered = 0;
  for (const h of holdings) {
    const q = quotes[yahooSym(h.sym)];
    if (!q || q.price == null || q.prevClose == null) { missing.push(h.sym); continue; }
    const dc = h.qty * (q.price - q.prevClose);
    net += dc;
    bySleeve[h.sleeve] = (bySleeve[h.sleeve] || 0) + dc;
    covered++;
  }
  for (const k in bySleeve) bySleeve[k] = r2(bySleeve[k]);
  return { net: r2(net), bySleeve, covered, missing };
}

// Keyless Yahoo Finance v8 chart fetch — the same source /api/quotes uses, but
// inlined here because the daemon runs on the laptop and the deployed app is
// behind Vercel deployment protection (its URL isn't callable unauthenticated).
// One symbol per call; failures are skipped (→ reported as `missing`, not zeroed).
const YH_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
async function yahooQuote(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d&includePrePost=false`;
  for (const host of YH_HOSTS) {
    try {
      const r = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const meta = (await r.json())?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (typeof price !== 'number') continue;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose ?? price;
      return { price, prevClose };
    } catch { /* try next host */ }
  }
  return null;
}

// NIFTY 50 intraday 1-MINUTE OHLC candles (^NSEI) for the chart watermark. Yahoo's
// finest intraday granularity is 1m. Returns [{ t:'HH:MM'(IST), o, h, l, c }] for
// today, or null. The whole-day array is re-fetched each refresh (cheap, overwrite).
export async function niftyCandles() {
  const path = '/v8/finance/chart/%5ENSEI?interval=1m&range=1d&includePrePost=false';
  for (const host of YH_HOSTS) {
    try {
      const r = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const res = (await r.json())?.chart?.result?.[0];
      const ts = res?.timestamp, q = res?.indicators?.quote?.[0];
      if (!Array.isArray(ts) || !q) continue;
      const out = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if ([o, h, l, c].some((v) => typeof v !== 'number')) continue;
        const d = new Date((ts[i] + 5.5 * 3600) * 1000);   // shift epoch to IST wall-clock
        const t = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        out.push({ t, o: r2(o), h: r2(h), l: r2(l), c: r2(c) });
      }
      return out.length ? out : null;
    } catch { /* try next host */ }
  }
  return null;
}

// Resolve quotes for a symbol list (bounded concurrency to stay polite to Yahoo).
async function fetchQuotes(syms) {
  const out = {};
  const POOL = 6;
  for (let i = 0; i < syms.length; i += POOL) {
    const batch = syms.slice(i, i + POOL);
    const got = await Promise.all(batch.map((s) => yahooQuote(s)));
    batch.forEach((s, j) => { if (got[j]) out[s] = got[j]; });
  }
  return out;
}

// ── US sleeve ── US holdings live in the private portfolio (not broker-state),
// priced in USD then converted to INR at the live USD/INR rate. Symbols are plain
// US tickers (AAPL), no suffix. Shape-tolerant: accepts sym|ticker|symbol and
// qty|units|shares so it survives the private file's exact layout.
export function usHoldings(priv) {
  const arr = priv?.US || priv?.us || [];
  const out = [];
  for (const r of Array.isArray(arr) ? arr : []) {
    const sym = r?.sym || r?.ticker || r?.symbol;
    const qty = +(r?.qty ?? r?.units ?? r?.shares ?? 0);
    if (sym && qty) out.push({ sym: String(sym).trim().toUpperCase(), qty });
  }
  return out;
}

// Pure: US holdings + USD quotes + USD/INR → today's day-change in INR.
// dcInr = Σ qty×(price−prevClose) × fx. Missing quotes are reported, not zeroed.
export function computeUsDayChange(holdings, quotes, fx) {
  let usd = 0, covered = 0; const missing = [];
  for (const h of holdings) {
    const q = quotes[h.sym];
    if (!q || q.price == null || q.prevClose == null) { missing.push(h.sym); continue; }
    usd += h.qty * (q.price - q.prevClose);
    covered++;
  }
  const rate = fx || null;
  return { usd: r2(usd), net: rate ? r2(usd * rate) : null, fx: rate, covered, missing };
}

// One US snapshot: private US holdings × live Yahoo (USD) × live USD/INR → INR
// day-change. Returns null if holdings/quotes/FX unavailable (→ daemon skips).
export async function pullUsDayChange(priv) {
  // `priv` injected by the cloud route (KV portfolio:v1); the daemon/script reads the
  // gitignored file. Param path is what lets this run on Vercel (no private file there).
  if (!priv) {
    try { priv = JSON.parse(readFileSync(join(ROOT, 'data', 'portfolio.private.json'), 'utf8')); }
    catch { return null; }
  }
  const holdings = usHoldings(priv);
  if (!holdings.length) return null;
  let quotes, fxq;
  try {
    [quotes, fxq] = await Promise.all([
      fetchQuotes([...new Set(holdings.map((h) => h.sym))]),
      fetchQuotes(['INR=X']),
    ]);
  } catch { return null; }
  const fx = fxq['INR=X']?.price ?? null;
  const dc = computeUsDayChange(holdings, quotes, fx);
  if (!dc.covered || dc.net == null) return null;
  return { net: dc.net, usd: dc.usd, fx: dc.fx, covered: dc.covered, missing: dc.missing };
}

// One equity snapshot: committed holdings × live Yahoo prices → today's day-change.
// Returns null if holdings/quotes are unavailable (→ daemon skips the tick).
export async function pullEquityDayChange(state) {
  // `state` injected by the cloud route (static import of committed broker-state.json);
  // the daemon/script reads it off disk. broker-state IS committed, so Vercel could read
  // it too, but a static import is what NFT reliably bundles into the function.
  if (!state) {
    try { state = JSON.parse(readFileSync(join(ROOT, 'data', 'broker-state.json'), 'utf8')); }
    catch { return null; }
  }
  const holdings = equityHoldings(state);
  if (!holdings.length) return null;
  let quotes;
  try { quotes = await fetchQuotes([...new Set(holdings.map((h) => yahooSym(h.sym)))]); }
  catch { return null; }
  const dc = computeDayChange(holdings, quotes);
  if (!dc.covered) return null;
  return dc;
}
