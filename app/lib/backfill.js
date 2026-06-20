'use client';

// Synthetic historical snapshots, reconstructed from the dated ledgers so the
// Overview growth curve starts at the first rupee deployed instead of the day
// snapshots began. Weekly resolution (the history API serves weekly closes).
//
// Per-sleeve method:
//   IND — each TRANSACTIONS buy replayed at its own stock's closes:
//         value(t) = invested × close(t)/close(buy). Falls back to cost if the
//         series is missing.
//   US  — exact per-symbol replay from the Vested tradebook
//         (data/us_trades.json, generated from the DriveWealth statement):
//         each ticker's dated net flows become units at that week's close;
//         value(t) = units(t) × close(t) + actual cash balance + exited
//         positions at net cost. Converted at fx(t).
//   MF  — units × NAV(t) per fund from its `bought` date, using the weekly
//         NAV history served by /api/mf-nav (api.mfapi.in). At cost until the
//         NAV payload arrives or for any fund whose history is missing.
//   FD  — deterministic quarterly compounding from each open date, clamped at
//         maturity (matches deriveFds).
//   nw  — assets − loanOutstanding(t): zero before disbursement (Sep 2025),
//         actual SBI statement balances thereafter.
//
// Output: [{ d, nw, assets, invested, synth: true }] — callers must only use
// dates BEFORE the first real snapshot; real dailies always win.

import { TRANSACTIONS, US_CASHFLOWS, MF_CASHFLOWS, MF_FUNDS, FDS, LOAN, loanOutstanding } from '../portfolio';
import { cmpfCorpus } from './cmpf';
import { APP } from './appData';

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
// mfNav: /api/mf-nav payload (funds[id].hist = [[iso, nav], …] ascending)
export function buildBackfill(series, fxRates, fxLive, mfNav) {
  if (!series) return [];
  const fx = (d) => fxAt(fxRates, d) ?? fxLive ?? 84;

  // MF: last NAV on-or-before d per fund, null when no history is available.
  const mfHist = Object.fromEntries(
    MF_FUNDS.map((f) => [f.id, mfNav?.funds?.[f.id]?.hist || null]),
  );
  const mfNavAt = (id, d) => {
    const h = mfHist[id];
    if (!h?.length || h[0][0] > d) return null;
    let v = null;
    for (const [hd, nav] of h) { if (hd > d) break; v = nav; }
    return v;
  };

  const flows = [
    ...TRANSACTIONS.map((t) => ({ date: t.date, inr: t.invested })),
    ...MF_CASHFLOWS.map((c) => ({ date: c.date, inr: -c.amount })), // outflows positive
    ...US_CASHFLOWS.map((c) => ({ date: c.date, inr: c.invested * fx(c.date) })),
    ...FDS.filter((f) => f.status !== 'pipeline').map((f) => ({ date: f.open, inr: f.newMoney ?? f.principal })),
    // Exited Indian delivery trades (Zerodha tax P&L): buy in at entry,
    // proceeds out at exit — keeps "invested" a true net-deployed line.
    ...APP.indianExits.trades.flatMap(([e, x, buy, sell]) => [
      { date: e, inr: buy },
      { date: x, inr: -sell },
    ]),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!flows.length) return [];
  const first = flows[0].date;

  // Weekly grid from the broadest series we have (Nifty), clipped to history.
  const grid = (series['^NSEI']?.closes || series[Object.keys(series)[0]]?.closes || [])
    .map((c) => c.date)
    .filter((d) => d >= first);
  if (!grid.length) return [];

  // US: actual cash balance at t (last statement balance ≤ t)
  const cashDays = Object.keys(APP.usTrades.cash).sort();
  const cashAt = (d) => {
    let v = 0;
    for (const k of cashDays) { if (k > d) break; v = APP.usTrades.cash[k]; }
    return v;
  };

  return grid.map((d) => {
    // IND: replay each live buy at its own closes; exited trades are carried
    // at buy value while held (no price history for exited names — their
    // realized P&L lands on the invested line at exit instead).
    let ind = 0;
    for (const tx of TRANSACTIONS.filter((t) => t.date <= d && t.invested > 0)) {
      const s = series[`${tx.sym}.NS`];
      const c0 = closeAt(s, tx.date), c1 = closeAt(s, d);
      ind += c0 && c1 ? tx.invested * (c1 / c0) : tx.invested;
    }
    for (const [e, x, buy] of APP.indianExits.trades) {
      if (e <= d && d < x) ind += buy;
    }
    // US: per-ticker unit replay from the tradebook + cash + exited-at-cost
    let usd = cashAt(d);
    for (const [sym, fls] of Object.entries(APP.usTrades.flows)) {
      const s = series[sym];
      let units = 0, costFallback = 0;
      for (const [fd, amt] of fls) {
        if (fd > d) break;
        const c = closeAt(s, fd);
        if (c) units += amt / c; else costFallback += amt;
      }
      const c1 = closeAt(s, d);
      usd += Math.max(0, c1 ? units * c1 : 0) + Math.max(0, costFallback);
    }
    // exited positions (no price history fetched): carry at net cost ≥ 0
    let otherCost = 0;
    for (const [fd, amt] of APP.usTrades.other) { if (fd <= d) otherCost += amt; }
    usd += Math.max(0, otherCost);
    const us = usd * fx(d);
    // MF: units × NAV(t) per fund from its bought date; cost when NAV missing
    let mf = 0;
    for (const f of MF_FUNDS) {
      if (!f.bought || f.bought > d) continue;
      const nav = mfNavAt(f.id, d);
      mf += nav != null ? f.units * nav : f.cost;
    }
    // FD: compound each open deposit, clamp at maturity
    let fd = 0;
    for (const f of FDS.filter((f) => f.status !== 'pipeline' && f.open <= d)) {
      const end = f.closedOn && f.closedOn <= d ? null : f; // closed before d → cash left the sleeve
      if (!end) continue;
      const yrs = Math.min((new Date(d) - new Date(f.open)) / YEAR, (new Date(f.matures) - new Date(f.open)) / YEAR);
      fd += f.rate != null ? compound(f.principal, f.rate, yrs) : f.principal;
    }
    const pf = cmpfCorpus(d);
    const invested = flows.filter((f) => f.date <= d).reduce((s, f) => s + f.inr, 0);
    // Undeployed loan cash: borrowing is NW-neutral (cash asset = liability),
    // but the ledgers only see the liability until the cash is deployed —
    // without this the curve craters by the principal on disbursement day.
    // Post-disbursement deployments are assumed to consume loan cash first.
    let loanCash = 0;
    if (d >= LOAN.open && loanOutstanding(d) > 0) {
      const deployedSince = flows.filter((f) => f.date > LOAN.open && f.date <= d && f.inr > 0)
        .reduce((s, f) => s + f.inr, 0);
      loanCash = Math.max(0, LOAN.sanctioned - deployedSince);
    }
    const assets = Math.round(ind + us + mf + fd + pf + loanCash);
    // invAssets = the deployed INVESTMENT sleeves only (no PF corpus, no loan cash) —
    // a clean value basis paired with `invested` for the time-weighted performance
    // curve, which must not treat PF accrual or loan mechanics as investment return.
    return { d, nw: assets - loanOutstanding(d), assets, invested: Math.round(invested), invAssets: Math.round(ind + us + mf + fd), synth: true };
  });
}
