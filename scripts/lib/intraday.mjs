// Durable intraday P&L tape. Broker positions reset at the next pre-open, so an
// intraday curve only exists if we snapshot it through the session and pile the
// points up. data/fno-intraday.json keeps one array of points per trading day;
// the Trading tab's Day view plots them (cumulative net = realised + open MTM at
// each tick, green above 0 / red below). Written by scripts/capture-intraday.mjs
// on a few-minute cadence during market hours; the daily ledger stays the durable
// end-of-day record, this is just the within-day shape.
//
// Shape:
//   { note, updatedAt, days: { 'YYYY-MM-DD': [ { t:'HH:MM', net, dhan, upstox, fyers, pending } ] } }
// One point per minute — a re-capture in the same minute REPLACES that point
// (positions only move forward intraday, so the latest read in a minute wins).

import { readFileSync, writeFileSync } from 'node:fs';

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// Chronological rank for an 'HH:MM' within one portfolio session. A plain string
// sort scrambles a midnight-crossing tape ('01:14' < '19:39'), so the US overnight
// tail (00:00–05:59 IST) is ranked AFTER the evening it belongs to. F&O/equity sit
// wholly in the day window (≥06:00 IST), so this leaves them untouched. Mirrors the
// tRank used by app/lib/pnlDaily mergeLiveTapes so file, KV and UI agree on order.
const tRank = (t) => { const [h, m] = String(t).split(':').map(Number); const x = h * 60 + m; return x < 360 ? x + 1440 : x; };

// Insert/replace a point on `date`'s tape. `point` = { t:'HH:MM', net, byBroker:{…}, pending }.
// Pure given (json, …) → returns the next json object (no I/O), so it unit-tests
// without touching disk. Keeps each day's array sorted by time.
export function upsertPoint(json, date, point) {
  const out = json && typeof json === 'object' ? { ...json } : {};
  const days = { ...(out.days || {}) };
  const arr = Array.isArray(days[date]) ? days[date].slice() : [];
  const i = arr.findIndex((x) => x.t === point.t);
  const prev = i >= 0 ? arr[i] : null;
  const p = {
    t: point.t,
    net: round2(point.net),
    // realised (closed legs) + open MTM split — present only on points captured by the
    // post-2026-06-25 daemon; older points carry net only (the UI falls back gracefully).
    realised: round2(point.realised ?? null),
    mtm: round2(point.mtm ?? null),
    dhan: round2(point.byBroker?.dhan ?? null),
    upstox: round2(point.byBroker?.upstox ?? null),
    fyers: round2(point.byBroker?.fyers ?? null),
    dhanRealised: round2(point.byBrokerRealised?.dhan ?? null),
    upstoxRealised: round2(point.byBrokerRealised?.upstox ?? null),
    fyersRealised: round2(point.byBrokerRealised?.fyers ?? null),
    dhanMtm: round2(point.byBrokerMtm?.dhan ?? null),
    upstoxMtm: round2(point.byBrokerMtm?.upstox ?? null),
    fyersMtm: round2(point.byBrokerMtm?.fyers ?? null),
    // `pending` is STICKY within a minute: the daemon only runs the order-book
    // check ~1/min, so a later same-minute tick (which skips it → pending:false)
    // must not clear a pending flag an earlier tick set. OR with the prior point.
    pending: (point.pending || prev?.pending) ? 1 : undefined,
    // Per-leg P&L snapshot — captured ~1/min (withOrders); STICKY within the minute so a
    // later legs-less tick on the same minute doesn't wipe it. Absent on legs-less points.
    ...((Array.isArray(point.legs) && point.legs.length) ? { legs: point.legs }
      : (prev?.legs ? { legs: prev.legs } : {})),
  };
  if (i >= 0) arr[i] = p; else arr.push(p);
  arr.sort((a, b) => tRank(a.t) - tRank(b.t));
  days[date] = arr;
  out.days = days;
  return out;
}

// Merge today's executed fills into json.fills[date], deduped by broker+id (the orders
// check re-reports the same fill each ~minute). Time-sorted; drives the buy/sell markers
// on the curve. Non-personal aggregate (no account ids) — safe to commit.
export function upsertFills(json, date, fills) {
  const out = json && typeof json === 'object' ? { ...json } : {};
  const all = { ...(out.fills || {}) };
  const arr = Array.isArray(all[date]) ? all[date].slice() : [];
  const seen = new Set(arr.map((f) => `${f.broker}:${f.id}`));
  for (const f of (fills || [])) {
    const k = `${f.broker}:${f.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    arr.push(f);
  }
  arr.sort((a, b) => tRank(a.t) - tRank(b.t));
  all[date] = arr;
  out.fills = all;
  return out;
}

// Disk wrapper around upsertPoint (+ fills). Returns the point count for `date` after write.
export function appendIntraday(file, date, point) {
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { json = { days: {} }; }
  let next = upsertPoint(json, date, point);
  if (Array.isArray(point.fills) && point.fills.length) next = upsertFills(next, date, point.fills);
  next.updatedAt = point.istNow || next.updatedAt || null;
  next.note = next.note || 'Intraday F&O P&L tape (realised + open MTM). Non-personal aggregate; safe to commit.';
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next.days[date].length;
}

// ── Daily growth snapshot ── ONE record per day holding each sleeve's day-change
// (the resilient end-of-day fallback, distinct from the per-minute intraday tape).
// `partial` carries only the sleeves a run captured: { eq?, us?, fno?, mf?, istNow }.
// Merge-upsert so several runs build one record AND a sleeve that's absent/null is
// LEFT AS-IS (skip-not-zero — a failed fetch never wipes a good prior value).
// Pure given (json, …) → returns the next json (no I/O), so it unit-tests on its own.
// Net-worth ASSET sleeves, by growth cadence (same record, different feed):
//   eq/us — market day-change (intraday tick)
//   fd    — daily accrued interest (deterministic from principal×rate, no fetch)
//   mf    — daily NAV (once-daily, AMFI)
//   cmpf  — daily PF interest accrual (deterministic; monthly contributions are new money)
// EXCLUDED: F&O (business income, off-NW — lives in the fno-ledger pipeline) and CMPS
// (a defined-benefit pension — a future income right, not an accruing asset).
const GROWTH_SLEEVES = ['eq', 'us', 'fd', 'mf', 'cmpf'];
export function upsertGrowth(json, date, partial) {
  const out = json && typeof json === 'object' ? { ...json } : {};
  const days = { ...(out.days || {}) };
  const prev = days[date] && typeof days[date] === 'object' ? days[date] : {};
  const next = { ...prev, d: date };
  const asOf = { ...(prev.asOf || {}) };
  for (const k of GROWTH_SLEEVES) {
    const v = partial?.[k];
    if (v == null) continue;                 // not captured this run → carry forward
    next[k] = v;
    if (partial?.istNow) asOf[k] = partial.istNow;
  }
  next.asOf = asOf;
  days[date] = next;
  out.days = days;
  return out;
}

// Disk wrapper around upsertGrowth. Returns the merged day record after write.
export function writeGrowth(file, date, partial) {
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { json = { days: {} }; }
  const next = upsertGrowth(json, date, partial);
  next.updatedAt = partial?.istNow || next.updatedAt || null;
  next.note = next.note || 'Daily per-sleeve day-change snapshot (eq/us/fno/mf) — the resilient end-of-day fallback. Non-personal aggregate; safe to commit.';
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next.days[date];
}
