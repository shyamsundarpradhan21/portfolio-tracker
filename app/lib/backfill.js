'use client';

// Synthetic historical snapshots, reconstructed from the dated ledgers so the
// Overview growth curve starts at the first rupee deployed instead of the day
// snapshots began. Weekly resolution (the history API serves weekly closes).
//
// Per-sleeve method:
//   IND — each TRANSACTIONS buy replayed at its own stock's closes:
//         value(t) = invested × close(t)/close(buy). Falls back to cost if the
//         series is missing.
//   US  — deposits replayed into TODAY'S basket as an index:
//         value(t) = Σ_τ≤t usd_τ × basket(t)/basket(τ), converted at fx(t).
//         (Per-symbol buy dates aren't ledgered; the current basket is the
//         best available proxy for the sleeve's path.)
//   MF  — carried at cost (small sleeve; no per-fund NAV history ledgered).
//   FD  — deterministic quarterly compounding from each open date, clamped at
//         maturity (matches deriveFds).
//   nw  — assets − loanOutstanding(t): zero before disbursement (Sep 2025),
//         actual SBI statement balances thereafter.
//
// Output: [{ d, nw, assets, invested, synth: true }] — callers must only use
// dates BEFORE the first real snapshot; real dailies always win.

import { TRANSACTIONS, INDIAN, US, US_CASHFLOWS, MF_CASHFLOWS, FDS, loanOutstanding } from '../portfolio';

const DAY = 24 * 3600 * 1000;
const YEAR = 365.25 * DAY;
const compound = (p, rate, years) => p * Math.pow(1 + rate / 400, 4 * Math.max(0, years));

// Last close on or before `date` (series closes are ascending weekly points).
function closeAt(series, date) {
  if (!series?.closes?.length) return null;
  let v = null;
  for (const c of series.closes) {
    if (c.date > date) break;
    v = c.close;
  }
  return v;
}

function fxAt(rates, date) {
  if (!rates) return null;
  if (rates[date] != null) return rates[date];
  const keys = Object.keys(rates).filter((k) => k <= date).sort();
  return keys.length ? rates[keys[keys.length - 1]] : null;
}

// series: hist.series from /api/history · fxRates: /api/fx-history rates map
export function buildBackfill(series, fxRates, fxLive) {
  if (!series) return [];
  const fx = (d) => fxAt(fxRates, d) ?? fxLive ?? 84;

  const flows = [
    ...TRANSACTIONS.map((t) => ({ date: t.date, inr: t.invested })),
    ...MF_CASHFLOWS.map((c) => ({ date: c.date, inr: -c.amount })), // outflows positive
    ...US_CASHFLOWS.map((c) => ({ date: c.date, inr: c.invested * fx(c.date) })),
    ...FDS.filter((f) => f.status !== 'pipeline').map((f) => ({ date: f.open, inr: f.newMoney ?? f.principal })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!flows.length) return [];
  const first = flows[0].date;

  // Weekly grid from the broadest series we have (Nifty), clipped to history.
  const grid = (series['^NSEI']?.closes || series[Object.keys(series)[0]]?.closes || [])
    .map((c) => c.date)
    .filter((d) => d >= first);
  if (!grid.length) return [];

  // US basket index at date t: today's holdings priced at t.
  const basket = (d) => {
    let v = 0, ok = false;
    for (const h of US) {
      const c = closeAt(series[h.sym], d);
      if (c != null) { v += h.qty * c; ok = true; }
    }
    return ok ? v : null;
  };
  const today = grid[grid.length - 1];
  const basketCache = {};
  const basketAt = (d) => (basketCache[d] ??= basket(d));

  return grid.map((d) => {
    // IND: replay each buy at its own closes
    let ind = 0;
    for (const tx of TRANSACTIONS.filter((t) => t.date <= d && t.invested > 0)) {
      const s = series[`${tx.sym}.NS`];
      const c0 = closeAt(s, tx.date), c1 = closeAt(s, d);
      ind += c0 && c1 ? tx.invested * (c1 / c0) : tx.invested;
    }
    // US: deposits replayed into the current basket, valued at fx(d)
    let usd = 0;
    for (const c of US_CASHFLOWS.filter((c) => c.date <= d)) {
      const b0 = basketAt(c.date), b1 = basketAt(d);
      usd += b0 && b1 ? c.invested * (b1 / b0) : c.invested;
    }
    const us = Math.max(0, usd) * fx(d);
    // MF at cost
    const mf = MF_CASHFLOWS.filter((c) => c.date <= d && c.amount < 0).reduce((s, c) => s - c.amount, 0);
    // FD: compound each open deposit, clamp at maturity
    let fd = 0;
    for (const f of FDS.filter((f) => f.status !== 'pipeline' && f.open <= d)) {
      const end = f.closedOn && f.closedOn <= d ? null : f; // closed before d → cash left the sleeve
      if (!end) continue;
      const yrs = Math.min((new Date(d) - new Date(f.open)) / YEAR, (new Date(f.matures) - new Date(f.open)) / YEAR);
      fd += f.rate != null ? compound(f.principal, f.rate, yrs) : f.principal;
    }
    const invested = flows.filter((f) => f.date <= d).reduce((s, f) => s + f.inr, 0);
    const assets = Math.round(ind + us + mf + fd);
    return { d, nw: assets - loanOutstanding(d), assets, invested: Math.round(invested), synth: true };
  });
}
