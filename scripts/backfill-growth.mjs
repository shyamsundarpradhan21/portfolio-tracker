// Backfill the daily GROWTH snapshots from HISTORICAL sources, so the Overview
// wealth-growth curve has real history instead of accruing one point per night.
//   eq/us : Yahoo daily closes (current qty × close-to-close) — reuses computeDayChange /
//           computeUsDayChange, the SAME math as the live snapshot, so it's consistent.
//   mf    : api.mfapi.in full NAV history (units × NAV-to-NAV) via sumMfDayChange.
//   fd/cmpf: deterministic daily accrual (every calendar day).
// Writes growth:<date> to data/growth.json + KV (carry-forward merge via upsertGrowth;
// skip-not-zero). Uses CURRENT holdings/qty across the window — corp actions ignored, a
// fair approximation for a ~quarter window. READ-ONLY external fetches.
//   node scripts/backfill-growth.mjs [days=90]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { equityHoldings, usHoldings, yahooSym, computeDayChange, computeUsDayChange } from './lib/equity.mjs';
import { resolveCode, navHistory, sumMfDayChange } from './lib/mf.mjs';
import { pullFdDayChange } from './lib/fd.mjs';
import { pullCmpfDayChange } from './lib/cmpf.mjs';
import { upsertGrowth } from './lib/intraday.mjs';
import { kvSetJSON, kvConfigured } from './lib/kv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GROWTH_FILE = join(ROOT, 'data', 'growth.json');
const DAYS = Math.min(370, Math.max(1, +process.argv[2] || 90));
const TTL = 35 * 24 * 3600;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const istIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('Z', '+05:30');
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const priv = JSON.parse(readFileSync(join(ROOT, 'data', 'portfolio.private.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(ROOT, 'data', 'broker-state.json'), 'utf8'));
const eqH = equityHoldings(state);
const usH = usHoldings(priv);
const funds = priv.MF_FUNDS || [];

// Yahoo daily closes → sorted [{ date, close }]
async function yhDaily(sym) {
  for (const host of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    try {
      const r = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${DAYS + 20}d`,
        { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const res = (await r.json())?.chart?.result?.[0];
      const ts = res?.timestamp, cl = res?.indicators?.quote?.[0]?.close;
      if (!Array.isArray(ts) || !Array.isArray(cl)) continue;
      const out = [];
      ts.forEach((t, i) => { if (cl[i] != null) out.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: cl[i] }); });
      return out;
    } catch { /* next host */ }
  }
  return [];
}

// daily series → { <date>: { price: close[D], prevClose: close[D-1] } } (the quote shape
// computeDayChange / computeUsDayChange expect).
function quoteSeries(series) {
  const q = {};
  for (let i = 1; i < series.length; i++) q[series[i].date] = { price: series[i].close, prevClose: series[i - 1].close };
  return q;
}

async function main() {
  // ── eq: per-holding historical quotes → per-date day-change ──────────────
  const eqMaps = {};
  for (const h of eqH) eqMaps[yahooSym(h.sym)] = quoteSeries(await yhDaily(yahooSym(h.sym)));
  const eqBy = {};
  for (const D of [...new Set(Object.values(eqMaps).flatMap((m) => Object.keys(m)))]) {
    const quotes = {};
    for (const sym in eqMaps) if (eqMaps[sym][D]) quotes[sym] = eqMaps[sym][D];
    const dc = computeDayChange(eqH, quotes);
    if (dc?.covered) eqBy[D] = { net: dc.net, bySleeve: dc.bySleeve, covered: dc.covered };
  }

  // ── us: per-holding (USD) + INR=X (FX) → per-date INR day-change ──────────
  const usMaps = {};
  for (const h of usH) usMaps[h.sym] = quoteSeries(await yhDaily(h.sym));
  const fxBy = quoteSeries(await yhDaily('INR=X'));
  const usBy = {};
  for (const D in fxBy) {
    const fx = fxBy[D]?.price;
    if (!fx) continue;
    const quotes = {};
    for (const sym in usMaps) if (usMaps[sym][D]) quotes[sym] = usMaps[sym][D];
    if (!Object.keys(quotes).length) continue;
    const dc = computeUsDayChange(usH, quotes, fx);
    if (dc?.covered) usBy[D] = { net: dc.net, usd: dc.usd, fx: dc.fx, covered: dc.covered };
  }

  // ── mf: full NAV history per fund → per-date sumMfDayChange ───────────────
  const navHist = {};
  await Promise.all(funds.map(async (f) => {
    if (!f?.units || !f?.q) return;
    try { const code = await resolveCode(f); if (code) navHist[f.id] = await navHistory(code); } catch { /* skip fund */ }
  }));
  const mfDates = [...new Set(Object.values(navHist).flatMap((m) => Object.keys(m)))].sort();
  const prevIso = {};
  const mfBy = {};
  for (const D of mfDates) {
    const navByFund = {};
    for (const f of funds) {
      const h = navHist[f.id];
      if (!h || h[D] == null) continue;
      const p = prevIso[f.id];
      if (p != null && h[p] != null) navByFund[f.id] = { latest: h[D], prev: h[p] };
      prevIso[f.id] = D;
    }
    const dc = sumMfDayChange(funds, navByFund);
    if (dc) mfBy[D] = { net: dc.net, covered: dc.covered, byFund: dc.byFund };
  }

  // ── assemble per calendar date (fd/cmpf accrue every day; eq/us/mf where traded) ──
  const today = istToday();
  const cal = [];
  for (let i = 0; i < DAYS; i++) { const d = new Date(Date.now() + 5.5 * 3600 * 1000); d.setUTCDate(d.getUTCDate() - i); cal.push(d.toISOString().slice(0, 10)); }
  // Cap to the last DAYS calendar days — the mf NAV history spans YEARS, but we only want
  // the recent window where eq/us/fd/cmpf are all present (else the old tail is mf-only).
  const dates = cal.filter((d) => d <= today).sort();

  let json; try { json = JSON.parse(readFileSync(GROWTH_FILE, 'utf8')); } catch { json = { days: {} }; }
  let wrote = 0, kvOk = 0;
  for (const D of dates) {
    const partial = { istNow: istIso() };
    if (eqBy[D]) partial.eq = eqBy[D];
    if (usBy[D]) partial.us = usBy[D];
    if (mfBy[D]) partial.mf = mfBy[D];
    try { const fd = pullFdDayChange(D, priv); if (fd) partial.fd = fd; } catch { /* pre-FD */ }
    try { const cmpf = pullCmpfDayChange(D, priv); if (cmpf) partial.cmpf = cmpf; } catch { /* pre-CMPF */ }
    if (!['eq', 'us', 'mf', 'fd', 'cmpf'].some((k) => partial[k])) continue; // nothing captured → skip
    json = upsertGrowth(json, D, partial);
    wrote++;
    if (kvConfigured() && (await kvSetJSON(`growth:${D}`, json.days[D], TTL))) kvOk++;
  }
  json.updatedAt = istIso();
  json.note = json.note || 'Daily per-sleeve day-change snapshot (eq/us/fno/mf) — the resilient end-of-day fallback. Non-personal aggregate; safe to commit.';
  writeFileSync(GROWTH_FILE, JSON.stringify(json, null, 2) + '\n');
  console.log(`backfill ${DAYS}d → ${wrote} day-records (eq ${Object.keys(eqBy).length} · us ${Object.keys(usBy).length} · mf ${Object.keys(mfBy).length} days) · KV ${kvOk}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('backfill failed:', e); process.exit(1); });
