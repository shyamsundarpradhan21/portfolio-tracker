// derive-fno-realised.mjs — reconstruct F&O realised P&L from the durable CONTRACT NOTES
// (`ledger:cn:*`) via per-contract FIFO, INDEPENDENTLY of the broker's daily `realizedProfit`
// (which the broker wipes at next pre-open, so it's lost on a laptop-off day). Every trade's note
// sits permanently in Gmail → parsed into KV; this walks the note fills through the shared FIFO
// engine (scripts/lib/fnoFifo.mjs — the same algo backfill-fno-realised.mjs runs over the broker
// trade-history) and books realised on each close at the ORIGINAL entry price.
//
// DORMANT: writes a NEW artifact (`data/fno-realised-notes.json` mirror + KV `ledger:fno:realised`).
// NOTHING in the live app reads it yet — wiring displayed realised is a separate value-recheck-gated
// step (see tasks/todo.md). This step BUILDS + VERIFIES the reconstruction against the committed
// broker-sourced fno-ledger.
//
//   node scripts/derive-fno-realised.mjs            # dry-run: reconcile vs fno-ledger, no write
//   node scripts/derive-fno-realised.mjs --write    # + persist the dormant artifact/KV key
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fifoRealisedByDay, normContractKey, isCompleteContract } from './lib/fnoFifo.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const r2 = (n) => Math.round(n * 100) / 100;
const BROKER = { zerodha_self: 'Zerodha', zerodha: 'Zerodha', dhan: 'Dhan', fyers: 'Fyers', upstox: 'Upstox', astha: 'Astha' };
const norm = (b) => BROKER[String(b).toLowerCase()] || (b ? b[0].toUpperCase() + b.slice(1) : b);
const fy = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 4 ? y : y - 1; return `FY${String(s).slice(2)}-${String(s + 1).slice(2)}`; };

function loadEnv(p) { try { const o = {}; for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) o[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } return o; } catch { return {}; } }
const env = loadEnv(ROOT + 'mcp/.kv.env');
const url = process.env.KV_REST_API_URL || env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const tok = process.env.KV_REST_API_TOKEN || env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
async function kv(cmd) { const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); return (await r.json()).result; }

if (!url || !tok) { console.error('no KV creds (mcp/.kv.env) — cannot read ledger:cn:*'); process.exit(1); }

// ── pull the self F&O fills from the contract-note ledger ──────────────────────────────────────
const idx = await kv(['SMEMBERS', 'ledger:cn:index']);
const fillsByBroker = {};             // Broker -> [{ key, date, side, qty, price }] (insertion order ≈ chronological)
let selfNotes = 0, fnoNotes = 0, fnoFills = 0, excludedFills = 0;
const fragmentedNotes = [];           // notes with a split/truncated F&O fill → excluded from FIFO
for (const n of idx) {
  let led; try { led = JSON.parse(await kv(['GET', `ledger:cn:${n}`])); } catch { continue; }
  if (!led || led.tax_entity !== 'self' || !led.trade_date) continue;
  selfNotes++;
  const fno = (led.fills || []).filter((f) => f.segment === 'fno');
  if (!fno.length) continue;
  fnoNotes++;
  const keyed = fno.map((f) => ({ key: normContractKey(f.instrument), side: f.side, qty: f.qty, price: f.price }));
  if (keyed.some((k) => !isCompleteContract(k.key))) {   // a fragmented/truncated note — can't FIFO safely
    fragmentedNotes.push({ note: n, broker: norm(led.broker), date: led.trade_date, fills: keyed.length });
    excludedFills += keyed.length;
    continue;
  }
  const broker = norm(led.broker);
  const arr = (fillsByBroker[broker] ||= []);
  for (const k of keyed) { arr.push({ ...k, date: led.trade_date }); fnoFills++; }
}

// ── per-broker FIFO (fills sorted by date; stable within a day) → realised per (date, broker) ────
const rows = [];
const residualByBroker = {};
for (const broker of Object.keys(fillsByBroker).sort()) {
  const fills = fillsByBroker[broker].slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const { dayRealised, residualLots } = fifoRealisedByDay(fills);
  residualByBroker[broker] = residualLots;
  for (const [date, g] of Object.entries(dayRealised)) rows.push({ date, broker, grossRealised: r2(g), source: 'note-fifo' });
}
rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.broker < b.broker ? -1 : 1)));

// per-FY × broker note-FIFO gross
const fyTotals = {};
for (const r of rows) { const k = `${fy(r.date)} ${r.broker}`; fyTotals[k] = r2((fyTotals[k] || 0) + r.grossRealised); }

// ── reconcile vs the committed broker-sourced fno-ledger (INFORMATIONAL — independent sources) ───
const ledger = JSON.parse(readFileSync(ROOT + 'data/fno-ledger.json', 'utf8'));
const ledgerFy = {};
for (const r of (ledger.rows || [])) { const k = `${fy(r.date)} ${norm(r.broker)}`; ledgerFy[k] = r2((ledgerFy[k] || 0) + (r.grossRealised || 0)); }

console.log(`ledger:cn:index ${idx.length} notes | ${selfNotes} self | ${fnoNotes} F&O notes | ${fnoFills} FIFO fills | ${fragmentedNotes.length} fragmented notes (${excludedFills} fills excluded)`);
console.log('\n=== note-FIFO gross realised  vs  broker-sourced fno-ledger, per FY × broker ===');
console.log('  FY · broker           note-FIFO      ledger            Δ');
for (const k of [...new Set([...Object.keys(fyTotals), ...Object.keys(ledgerFy)])].sort()) {
  const nf = r2(fyTotals[k] || 0), lg = r2(ledgerFy[k] || 0);
  console.log(`  ${k.padEnd(20)} ${String(nf).padStart(12)} ${String(lg).padStart(12)} ${String(r2(nf - lg)).padStart(12)}`);
}
console.log('\n=== residual open lots per broker (large ⇒ note history INCOMPLETE for that broker) ===');
for (const b of Object.keys(residualByBroker).sort()) console.log(`  ${b.padEnd(10)} ${residualByBroker[b]}`);
if (fragmentedNotes.length) {
  console.log(`\n=== fragmented notes excluded from FIFO (split/truncated fills — fall back to broker/ITR) ===`);
  for (const fnote of fragmentedNotes.slice(0, 15)) console.log(`  ${fnote.broker.padEnd(10)} ${fnote.date}  ${fnote.note}  (${fnote.fills} fills)`);
  if (fragmentedNotes.length > 15) console.log(`  … +${fragmentedNotes.length - 15} more`);
}

// ── persist the DORMANT artifact ────────────────────────────────────────────────────────────────
const payload = {
  note: 'DORMANT note-derived F&O realised (per-contract FIFO over ledger:cn:* self fills). NOT read by the live app yet — wiring is value-recheck-gated. KV ledger:fno:realised = prod copy; data/fno-realised-notes.json = gitignored local mirror.',
  generatedFrom: 'ledger:cn:* (self F&O) via scripts/lib/fnoFifo.mjs',
  rows, fyTotals,
  stats: { fnoNotes, fnoFills, fragmentedNotes: fragmentedNotes.length, excludedFills, residualByBroker },
};
if (process.argv.includes('--write')) {
  if (fnoNotes === 0) { console.error('\nrefusing --write: 0 F&O notes read (KV empty/misconfigured)'); process.exit(1); }
  const body = JSON.stringify(payload);
  const res = await kv(['SET', 'ledger:fno:realised', body]);
  const dest = ROOT + 'data/fno-realised-notes.json', tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 1)); renameSync(tmp, dest);
  console.log(`\nWROTE ledger:fno:realised -> ${res}  + data/fno-realised-notes.json`);
} else {
  console.log('\n(dry-run — add --write to persist the dormant ledger:fno:realised + data/fno-realised-notes.json)');
}
console.log(`REALISED ${process.argv.includes('--write') ? 'written' : 'verify'} rows=${rows.length} fills=${fnoFills} fragmented=${fragmentedNotes.length}`);
