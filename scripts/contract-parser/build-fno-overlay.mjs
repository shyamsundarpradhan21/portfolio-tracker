// Phase 2c Part 1 (option b): build the DORMANT F&O charge overlay from the KV ledgers and write it
// to a NEW key (ledger:fno:overlay). Nothing reads it yet -> invisible. Part 2 overlays it onto the
// committed data/fno-ledger.json + flips deriveFY (certify-gated). Reads ledger:cn:* (self, NCLFO).
//
//   node scripts/contract-parser/build-fno-overlay.mjs            # verify-only (no KV write)
//   node scripts/contract-parser/build-fno-overlay.mjs --write    # write ledger:fno:overlay
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emitOverlay, overlayRealChargeByFy } from './merge-fno-charges.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
function loadEnv(p) { try { const o = {}; for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } return o; } catch { return {}; } }
const env = loadEnv(ROOT + 'mcp/.kv.env');
const url = process.env.KV_REST_API_URL || env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const tok = process.env.KV_REST_API_TOKEN || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
async function kv(cmd) { const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); return (await r.json()).result; }

const LEVY = ['brokerage', 'stt', 'ctt', 'exchange_txn', 'igst', 'cgst', 'sgst', 'sebi_turnover', 'ipft', 'stamp_duty', 'clearing'];
const segToFill = (s) => { s = (s || '').toLowerCase(); if (/fo|deriv|f&o|futur/.test(s)) return 'fno'; if (/cm|cash|equity|capital/.test(s)) return 'cash'; return null; };
function fnoCharge(led) {                                    // NCLFO levies only; null if no F&O segment
  const ch = led.charges || {}, bcs = ch.by_clearing_segment || {};
  const fno = Object.entries(bcs).filter(([s]) => segToFill(s) === 'fno').map(([, d]) => d);
  if (fno.length) return fno.reduce((t, d) => t + LEVY.reduce((a, k) => a + Math.abs(d[k] || 0), 0), 0);
  const segs = new Set((led.fills || []).map((f) => f.segment));
  if (segs.size === 1 && segs.has('fno')) { const nt = ch.net_total || {}; return LEVY.reduce((a, k) => a + Math.abs(nt[k] || 0), 0); }
  return null;
}

const idx = await kv(['SMEMBERS', 'ledger:cn:index']);
const agg = new Map();                                       // (broker|date) -> real NCLFO charge (deduped: 1 GET per cn)
let self = 0;
for (const n of idx) {
  const led = JSON.parse(await kv(['GET', `ledger:cn:${n}`]));
  if (!led || led.tax_entity !== 'self') continue;
  self++;
  const fc = fnoCharge(led);
  if (fc === null || !led.trade_date) continue;
  const k = `${led.broker}|${led.trade_date}`;
  agg.set(k, Math.round(((agg.get(k) || 0) + fc) * 100) / 100);
}
const realCharges = [...agg].map(([k, c]) => { const [broker, date] = k.split('|'); return { broker, date, realCharge: c }; });
const committed = JSON.parse(readFileSync(ROOT + 'data/fno-ledger.json', 'utf8'));
const overlay = emitOverlay(committed, realCharges);
const got = overlayRealChargeByFy(overlay);

console.log(`ledger:cn:index ${idx.length} notes (${self} self) | overlay matched ${overlay.stats.matched} committed-days + ${overlay.stats.openingOnly} opening-only`);
// Per-FY·broker overlay charge totals — INFORMATIONAL only. The former hardcoded EXPECT
// reconciliation table was retired: FY totals move every time a new note lands, so a static
// table produced misleading MISMATCH rows and (worse) a stale allMatch that read like a gate.
// The write is NEVER blocked by these numbers. Cross-check drift against
// `node scripts/ingest-reconcile.mjs` (charges coverage) rather than a baked-in expectation.
console.log('=== overlay real-charge per FY·broker (from KV, DEDUPED) ===');
const fyKeys = Object.keys(got).sort();
for (const k of fyKeys) console.log(`  ${k.padEnd(18)} ${String(Math.round(got[k] || 0)).padStart(8)}`);

const write = process.argv.includes('--write');
if (write) {
  const payload = { note: 'DORMANT F&O charge overlay (Phase 2c Part 1). Nothing reads this yet; Part 2 overlays it onto data/fno-ledger.json + flips deriveFY (certify-gated). self-only, NCLFO.', byKey: overlay.byKey, openingOnly: overlay.openingOnly, fyTotals: got, generatedFrom: 'ledger:cn:* (self F&O)' };
  const res = await kv(['SET', 'ledger:fno:overlay', JSON.stringify(payload)]);
  console.log(`\nWROTE ledger:fno:overlay -> ${res}`);
} else {
  console.log('\nverify-only (no write). add --write to push ledger:fno:overlay.');
}
// Machine-readable porcelain line (the ingest daemon greps this after a rebuild).
console.log(`OVERLAY ${write ? 'written' : 'verify'} matched=${overlay.stats.matched}+${overlay.stats.openingOnly} self=${self} fys=${fyKeys.length}`);
