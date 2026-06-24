// One capture tick, shared by the daemon (10s loop) and the one-shot CLI: pull
// live F&O P&L across brokers, append the point to the local archive
// (data/fno-intraday.json), and publish the day's tape to KV (intraday:<date>)
// so the deployed app reads it near-live WITHOUT a git commit / redeploy in the
// loop. Git is the daemon's once-at-close job, not per-tick.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pullPositions } from './brokers.mjs';
import { pullEquityDayChange } from './equity.mjs';
import { appendIntraday } from './intraday.mjs';
import { kvSetJSON, kvConfigured } from './kv.mjs';
import { istParts } from './marketHours.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INTRADAY_FILE = join(ROOT, 'data', 'fno-intraday.json');
export const EQUITY_FILE = join(ROOT, 'data', 'eq-intraday.json');
export const kvKey = (date) => `intraday:${date}`;          // F&O (back-compat key)
export const kvKeyEq = (date) => `intraday:eq:${date}`;     // equity day-change
const KV_TTL = 3 * 24 * 3600; // recent days live in KV; older history served from the committed file

// Append a point to a tape file and publish that day's tape to KV. Shared by the
// F&O and equity capture paths; never throws (file/KV failures degrade to a skip).
function publish(file, keyFn, date, point) {
  let count = 0;
  try { count = appendIntraday(file, date, point); } catch { /* archive best-effort */ }
  let kv = false;
  if (kvConfigured()) {
    try {
      const tape = JSON.parse(readFileSync(file, 'utf8'))?.days?.[date] || [];
      // kvSetJSON is async; fire-and-return its promise via the caller.
      return { count, kvPromise: kvSetJSON(keyFn(date), tape, KV_TTL) };
    } catch { /* KV best-effort */ }
  }
  return { count, kvPromise: Promise.resolve(kv) };
}

// Captures one point. `withOrders` controls the (heavier) pending-order check —
// the daemon passes true only ~once/min. Returns a result object; never throws
// (broker/KV failures degrade to a skip), so a loop can call it blindly.
export async function captureTick({ withOrders = true, nowMs = Date.now(), file = INTRADAY_FILE } = {}) {
  const { date, hhmm, iso } = istParts(nowMs);
  let snap;
  try {
    snap = await pullPositions({ withOrders });
  } catch (e) {
    return { ok: false, reason: 'pull-failed', error: String(e?.message || e), date, t: hhmm };
  }
  if (!snap.any) return { ok: false, reason: 'no-tokens', date, t: hhmm };

  const point = { t: hhmm, net: snap.net, byBroker: snap.byBroker, pending: snap.pending, istNow: iso };
  const { count, kvPromise } = publish(file, kvKey, date, point);
  const kv = await kvPromise;
  return { ok: true, kind: 'fno', date, t: hhmm, net: snap.net, brokers: Object.keys(snap.byBroker), pending: snap.pending, count, kv };
}

// Equity day-change tick: committed holdings × live Yahoo prices → today's MTM
// vs prev close. Slower cadence than F&O (the daemon throttles it ~1/min) to stay
// polite to Yahoo. Same skip-not-zero contract.
export async function captureEquityTick({ nowMs = Date.now(), file = EQUITY_FILE } = {}) {
  const { date, hhmm, iso } = istParts(nowMs);
  let dc;
  try { dc = await pullEquityDayChange(); }
  catch (e) { return { ok: false, kind: 'eq', reason: 'pull-failed', error: String(e?.message || e), date, t: hhmm }; }
  if (!dc) return { ok: false, kind: 'eq', reason: 'no-data', date, t: hhmm };

  const point = { t: hhmm, net: dc.net, byBroker: dc.bySleeve, pending: false, istNow: iso };
  const { count, kvPromise } = publish(file, kvKeyEq, date, point);
  const kv = await kvPromise;
  return { ok: true, kind: 'eq', date, t: hhmm, net: dc.net, covered: dc.covered, missing: dc.missing, count, kv };
}
