// One-shot intraday capture — a single point, for manual/debug use or a one-off
// cloud tick. The LIVE path is the daemon (scripts/capture-daemon.mjs), which
// loops every 10s and publishes to KV; this just captures once and exits. It
// writes the local archive + KV but does NOT git-commit (the daemon owns the
// once-at-close archive commit), so it can't flood history.
//
//   node scripts/capture-intraday.mjs                 # one point (market-hours gated)
//   CAPTURE_FORCE=1 node scripts/capture-intraday.mjs # ignore the market gate
//
// READ-ONLY broker access — only GETs positions/orders.

import { captureTick } from './lib/intradayTick.mjs';
import { marketState, istParts } from './lib/marketHours.mjs';

const now = Date.now();
const { hhmm, dow } = istParts(now);
const state = marketState(now);
if (!process.env.CAPTURE_FORCE && state !== 'open') {
  console.log(`capture-intraday: market ${state} (${hhmm} IST, dow ${dow}) — skipped`);
  process.exit(0);
}

const r = await captureTick({ withOrders: true, nowMs: now });
if (r.ok) {
  console.log(`capture-intraday @ ${r.t}: net ₹${r.net} (${r.brokers.join('+') || 'none'})${r.pending ? ' · pending order' : ''} — ${r.count} pts today${r.kv ? ' · published to KV' : ''}`);
} else {
  console.log(`capture-intraday @ ${r.t}: ${r.reason}${r.error ? ' — ' + r.error : ''}`);
}
