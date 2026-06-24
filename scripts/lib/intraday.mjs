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
    dhan: round2(point.byBroker?.dhan ?? null),
    upstox: round2(point.byBroker?.upstox ?? null),
    fyers: round2(point.byBroker?.fyers ?? null),
    // `pending` is STICKY within a minute: the daemon only runs the order-book
    // check ~1/min, so a later same-minute tick (which skips it → pending:false)
    // must not clear a pending flag an earlier tick set. OR with the prior point.
    pending: (point.pending || prev?.pending) ? 1 : undefined,
  };
  if (i >= 0) arr[i] = p; else arr.push(p);
  arr.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  days[date] = arr;
  out.days = days;
  return out;
}

// Disk wrapper around upsertPoint. Returns the point count for `date` after write.
export function appendIntraday(file, date, point) {
  let json;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { json = { days: {} }; }
  const next = upsertPoint(json, date, point);
  next.updatedAt = point.istNow || next.updatedAt || null;
  next.note = next.note || 'Intraday F&O P&L tape (realised + open MTM). Non-personal aggregate; safe to commit.';
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next.days[date].length;
}
