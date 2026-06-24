// One capture tick, shared by the daemon (10s loop) and the one-shot CLI: pull
// live F&O P&L across brokers, append the point to the local archive
// (data/fno-intraday.json), and publish the day's tape to KV (intraday:<date>)
// so the deployed app reads it near-live WITHOUT a git commit / redeploy in the
// loop. Git is the daemon's once-at-close job, not per-tick.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pullPositions } from './brokers.mjs';
import { appendIntraday } from './intraday.mjs';
import { kvSetJSON, kvConfigured } from './kv.mjs';
import { istParts } from './marketHours.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INTRADAY_FILE = join(ROOT, 'data', 'fno-intraday.json');
export const kvKey = (date) => `intraday:${date}`;
const KV_TTL = 3 * 24 * 3600; // recent days live in KV; older history served from the committed file

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
  let count = 0;
  try { count = appendIntraday(file, date, point); } catch (e) { /* archive write best-effort */ }

  // Publish the full day's tape to KV for the live read path.
  let kv = false;
  if (kvConfigured()) {
    try {
      const json = JSON.parse(readFileSync(file, 'utf8'));
      const tape = json?.days?.[date] || [];
      kv = await kvSetJSON(kvKey(date), tape, KV_TTL);
    } catch { /* KV best-effort */ }
  }
  return { ok: true, date, t: hhmm, net: snap.net, brokers: Object.keys(snap.byBroker), pending: snap.pending, count, kv };
}
