// Live broker read-state — holdings / positions / funds pulled from the broker
// MCPs (Upstox, Dhan, Fyers, Kite) by the daily Claude reconcile routine (see
// SCHEDULE.md) and committed, so the deployed app reads it the same way it reads
// data/snapshot-sleeves.json. The broker is the source of truth for live qty,
// avg-cost and MTM — the numbers you'd otherwise hand-edit after every trade —
// while app/portfolio.js stays the curated metadata + history layer.
import { APP } from './appData';

// broker-state is hydrated at runtime (server-imported in /api/portfolio, out of
// the client bundle); read it at call time, never at module-eval.
export function brokerFunds() { return APP.brokerState?.funds || {}; }
export function brokerPositions(key) { return APP.brokerState?.positions?.[key] || null; }

// Merge live broker holdings over a curated sleeve array WITHOUT mutating it.
// Broker drives qty + avg; the curated row keeps sector/cap/ns/name/history, so
// the analytics (sunburst, XIRR, regressions) keep working. Returns reconciled
// rows in the SAME shape as the input (existing derivations are untouched) plus
// the drift list and freshness meta the SyncBadge renders.
//
//   reconcileSleeve(SWING, 'SWING')
//     → { rows, drift, source, syncedAt, stale }
//
// When a sleeve has no live data (broker not wired, stale, or login-gated like
// Kite), the curated rows are handed back untouched and `stale` is set so the
// badge can explain why the numbers are the hand-maintained ones.
export function reconcileSleeve(curated, key) {
  const h = APP.brokerState?.holdings?.[key];
  const source = (h && h.source) || null;
  const when = (h && h.syncedAt) || APP.brokerState?.syncedAt || null;

  if (!h || h.stale || !Array.isArray(h.rows) || !h.rows.length) {
    return { rows: curated, drift: [], source, syncedAt: when, stale: true };
  }

  const bySym = new Map(h.rows.map((r) => [r.sym, r]));
  const drift = [];
  const rows = curated.map((c) => {
    const b = bySym.get(c.sym);
    if (!b) { drift.push({ sym: c.sym, kind: 'gone-at-broker' }); return c; }
    bySym.delete(c.sym);
    const qty = b.qty != null ? b.qty : c.qty;
    const cost = b.avg != null ? b.avg : c.cost;
    if (c.qty !== qty) drift.push({ sym: c.sym, kind: 'qty', app: c.qty, broker: qty });
    else if (Math.abs((c.cost || 0) - cost) > Math.max(0.01, 0.001 * cost)) {
      drift.push({ sym: c.sym, kind: 'avg', app: c.cost, broker: cost });
    }
    return { ...c, qty, cost, inv: +(qty * cost).toFixed(2),
             live: { ltp: b.ltp ?? null, pnl: b.pnl ?? null, dayPct: b.dayPct ?? null } };
  });
  // Anything the broker holds that the curated sleeve doesn't know about — a buy
  // never added. Surface it as drift (it has no metadata, so we don't inject it).
  for (const b of bySym.values()) drift.push({ sym: b.sym, kind: 'new-at-broker', broker: b.qty });

  return { rows, drift, source, syncedAt: when, stale: false };
}
