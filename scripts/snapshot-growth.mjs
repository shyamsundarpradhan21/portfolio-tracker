// One-shot daily GROWTH snapshot — captures each sleeve's day-change into a single
// record (data/growth.json + KV growth:<date>). The resilient end-of-day fallback
// that stands alone even on days the intraday daemon never ran, and the catch-up
// source when the capture host was off.
//
// HOST-AGNOSTIC by design (the two-tier plan, option D/A): it's a plain Node script,
// so any scheduler runs it — Windows Task Scheduler now, a systemd timer / cron on
// the always-on self-host box later. KV creds come from env OR mcp/.kv.env; with no
// KV it degrades to the committed data/growth.json. READ-ONLY broker access.
//
//   node scripts/snapshot-growth.mjs
//
// Net-worth ASSET sleeves only (eq + us + fd today; mf/cmpf/cmps as their feeds land).
// F&O is EXCLUDED — it's business income, captured by the F&O pipeline (fno-ledger).

import { captureGrowth } from './lib/intradayTick.mjs';
import { istParts } from './lib/marketHours.mjs';

const r = await captureGrowth({ nowMs: Date.now() });
const f = (s) => (s ? `₹${s.net}` : '—');
console.log(
  `${istParts(Date.now()).iso} growth ${r.date} · eq ${f(r.eq)} · us ${f(r.us)} · fd ${f(r.fd)}` +
  `${r.kv ? ' · kv' : ''} (captured: ${r.captured.join('+') || 'none'})`,
);
process.exit(0);
