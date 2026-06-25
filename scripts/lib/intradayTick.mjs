// One capture tick, shared by the daemon (10s loop) and the one-shot CLI: pull
// live F&O P&L across brokers, append the point to the local archive
// (data/fno-intraday.json), and publish the day's tape to KV (intraday:<date>)
// so the deployed app reads it near-live WITHOUT a git commit / redeploy in the
// loop. Git is the daemon's once-at-close job, not per-tick.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pullPositions } from './brokers.mjs';
import { pullEquityDayChange, pullUsDayChange, niftyCandles } from './equity.mjs';
import { pullFdDayChange } from './fd.mjs';
import { pullMfDayChange } from './mf.mjs';
import { pullCmpfDayChange } from './cmpf.mjs';
import { appendIntraday, writeGrowth } from './intraday.mjs';
import { kvSetJSON, kvConfigured } from './kv.mjs';
import { istParts, usSessionDate } from './marketHours.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INTRADAY_FILE = join(ROOT, 'data', 'fno-intraday.json');
export const EQUITY_FILE = join(ROOT, 'data', 'eq-intraday.json');
export const US_FILE = join(ROOT, 'data', 'us-intraday.json');
export const NIFTY_FILE = join(ROOT, 'data', 'nifty-ohlc.json');
export const kvKey = (date) => `intraday:${date}`;          // F&O (back-compat key)
export const kvKeyEq = (date) => `intraday:eq:${date}`;     // equity day-change (India)
export const kvKeyUs = (date) => `intraday:us:${date}`;     // US equity day-change (INR)
export const kvKeyNifty = (date) => `intraday:nifty:${date}`; // NIFTY 50 1-min OHLC watermark
const KV_TTL = 3 * 24 * 3600; // recent days live in KV; older history served from the committed file

// Overwrite a day's NIFTY OHLC array (Yahoo returns the WHOLE day each fetch, so
// the latest read wins) and publish it to KV. Best-effort; never throws.
function publishNifty(date, candles, istNow) {
  if (!Array.isArray(candles) || !candles.length) return Promise.resolve(false);
  try {
    let json;
    try { json = JSON.parse(readFileSync(NIFTY_FILE, 'utf8')); } catch { json = { days: {} }; }
    json.days = { ...(json.days || {}), [date]: candles };
    json.updatedAt = istNow || json.updatedAt || null;
    json.note = json.note || 'NIFTY 50 (^NSEI) intraday 1-minute OHLC candles per trading day. Public index data; safe to commit.';
    writeFileSync(NIFTY_FILE, JSON.stringify(json, null, 2) + '\n');
  } catch { /* archive best-effort */ }
  if (kvConfigured()) { try { return kvSetJSON(kvKeyNifty(date), candles, KV_TTL); } catch {} }
  return Promise.resolve(false);
}

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

  // NIFTY 50 1-min OHLC watermark — refreshed on the heavier ~1/min pass only
  // (withOrders), best-effort, never blocks the capture.
  let niftyKv = Promise.resolve(false);
  if (withOrders) {
    try { const candles = await niftyCandles(); niftyKv = publishNifty(date, candles, iso); } catch {}
  }
  const [kv] = await Promise.all([kvPromise, niftyKv]);
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

// US equity day-change tick (INR). Keyed by usSessionDate so the overnight IST
// session is one tape entry. net is INR (USD day-change × live USD/INR).
export async function captureUsTick({ nowMs = Date.now(), file = US_FILE } = {}) {
  const { hhmm, iso } = istParts(nowMs);
  const date = usSessionDate(nowMs);
  let dc;
  try { dc = await pullUsDayChange(); }
  catch (e) { return { ok: false, kind: 'us', reason: 'pull-failed', error: String(e?.message || e), date, t: hhmm }; }
  if (!dc) return { ok: false, kind: 'us', reason: 'no-data', date, t: hhmm };

  const point = { t: hhmm, net: dc.net, usd: dc.usd, fx: dc.fx, pending: false, istNow: iso };
  const { count, kvPromise } = publish(file, kvKeyUs, date, point);
  const kv = await kvPromise;
  return { ok: true, kind: 'us', date, t: hhmm, net: dc.net, usd: dc.usd, covered: dc.covered, missing: dc.missing, count, kv };
}

// ── Daily growth snapshot ── one end-of-day record per day with each net-worth
// ASSET sleeve's day-change (data/growth.json + KV growth:<date>). The resilient
// fallback: it RE-COMPUTES fresh (never reads the intraday tape), so it stands alone
// on days the intraday daemon never ran — the whole point of the catch-up tier.
// Each sleeve is independent + skip-not-zero (a failed sleeve is omitted → carried
// forward by upsertGrowth, never drawn as a fake ₹0). fd/mf/cmpf/cmps added separately.
// F&O is NOT here — it's business income, captured by the F&O pipeline (fno-ledger).
// Host-agnostic & READ-ONLY: same Yahoo reads the daemon uses; KV via kv.mjs.
export const GROWTH_FILE = join(ROOT, 'data', 'growth.json');
export const kvKeyGrowth = (date) => `growth:${date}`;
const GROWTH_TTL = 35 * 24 * 3600; // recent records live in KV; older served from the committed file

export async function captureGrowth({ nowMs = Date.now() } = {}) {
  const { date, iso } = istParts(nowMs);
  // Asset sleeves in parallel; a rejection/empty → null → omitted (carry-forward).
  const [eqR, usR, mfR] = await Promise.allSettled([
    pullEquityDayChange(),
    pullUsDayChange(),
    pullMfDayChange(),
  ]);
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  const eqS = val(eqR), usS = val(usR), mfS = val(mfR);
  const eq = eqS ? { net: eqS.net, bySleeve: eqS.bySleeve, covered: eqS.covered } : null;
  const us = usS ? { net: usS.net, usd: usS.usd, fx: usS.fx, covered: usS.covered } : null;
  const mf = mfS ? { net: mfS.net, covered: mfS.covered, byFund: mfS.byFund } : null;
  // FD + CMPF are deterministic (accrued interest), computed not fetched — no network.
  let fd = null, cmpf = null;
  try { fd = pullFdDayChange(date); } catch { /* private FDS unavailable → omit */ }
  try { cmpf = pullCmpfDayChange(date); } catch { /* private CMPF unavailable → omit */ }

  const partial = { eq, us, fd, mf, cmpf, istNow: iso };
  let record = null;
  try { record = writeGrowth(GROWTH_FILE, date, partial); } catch { /* archive best-effort */ }
  let kv = false;
  if (record && kvConfigured()) { try { kv = await kvSetJSON(kvKeyGrowth(date), record, GROWTH_TTL); } catch {} }
  return { ok: true, date, eq, us, fd, mf, cmpf, kv, captured: ['eq', 'us', 'fd', 'mf', 'cmpf'].filter((k) => partial[k]) };
}
