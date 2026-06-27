// Phase 2b - seed-layer merge: override the F&O ledger's ESTIMATED charges with the REAL NCLFO
// charges parsed from contract notes, by (broker, date), self-only. Pure merge logic + a dry-run
// CLI. The seed (scripts/seed-portfolio-kv.mjs) will call mergeFnoCharges() later; THIS step only
// builds + verifies and writes the merged object LOCALLY (never portfolio:v1, never KV).
//
//   node scripts/contract-parser/merge-fno-charges.mjs <real_charges.json> <out.json>
//
// Rules (from the recon + reconciliation):
//  - SELF only (the real_charges feed is already self-filtered), NCLFO (F&O) only.
//  - Broker-case normalised to the fno-ledger naming (zerodha_self->Zerodha, dhan->Dhan, ...).
//  - real where present -> override estCharges (chargeSource:'real'); no real note -> KEEP est
//    (chargeSource:'est'). Acceptable-tail/gap days (Dhan-old / Upstox-futures / Fyers-16) keep est.
//  - opening-only days (a real charge whose (broker,date) has NO realised-P&L row) are NOT dropped:
//    a charge-only entry is added (grossRealised 0) so the FY charge total still includes them.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const BROKER = { zerodha_self: 'Zerodha', zerodha: 'Zerodha', dhan: 'Dhan', fyers: 'Fyers', upstox: 'Upstox' };
const norm = (b) => BROKER[String(b).toLowerCase()] || (b ? b[0].toUpperCase() + b.slice(1) : b);
const SLEEVE = { Dhan: 'S01', Zerodha: 'S01', Upstox: 'S02', Fyers: 'S02' };   // S01=Dhan+Zerodha, S02=Upstox+Fyers
const fy = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 4 ? y : y - 1; return `FY${String(s).slice(2)}-${String(s + 1).slice(2)}`; };
const r2 = (n) => Math.round(n * 100) / 100;

export function mergeFnoCharges(ledger, realCharges) {
  // index real charges by Broker|date (sum if >1 note that day)
  const real = new Map();
  for (const e of realCharges) {
    if (!(e.realCharge > 0)) continue;   // a 0 means the F&O charge couldn't be itemized (old-format
    const k = `${norm(e.broker)}|${e.date}`;   // garbage segments) - DON'T override est with 0; keep est.
    real.set(k, r2((real.get(k) || 0) + e.realCharge));
  }
  const rows = [];
  const usedKeys = new Set();
  for (const row of ledger.rows) {
    const k = `${norm(row.broker)}|${row.date}`;
    const rc = real.get(k);
    if (rc !== undefined) {                          // REAL override
      usedKeys.add(k);
      rows.push({ ...row, broker: norm(row.broker), estCharges: row.estCharges, realCharge: rc,
                  chargeSource: 'real', net: r2((row.grossRealised || 0) - rc) });
    } else {                                         // est fallback (gap / refused / acceptable tail)
      rows.push({ ...row, broker: norm(row.broker), chargeSource: 'est' });
    }
  }
  // opening-only days: a real charge with no realised-P&L row -> charge-only entry (NOT dropped)
  let openingOnly = 0;
  for (const [k, rc] of real) {
    if (usedKeys.has(k)) continue;
    const [broker, date] = k.split('|');
    rows.push({ date, broker, sleeve: SLEEVE[broker] || null, grossRealised: 0, estCharges: 0,
                realCharge: rc, chargeSource: 'real', net: r2(-rc), openingOnly: true, source: 'contract-note' });
    openingOnly++;
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows, stats: { realRows: usedKeys.size, openingOnly, estRows: rows.length - usedKeys.size - openingOnly } };
}

// per-FY x broker REAL-charge total from the merged object (the verification quantity)
export function realChargeByFy(merged) {
  const out = {};
  for (const row of merged.rows) {
    if (row.chargeSource !== 'real') continue;
    const key = `${fy(row.date)} ${row.broker}`;
    out[key] = r2((out[key] || 0) + row.realCharge);
  }
  return out;
}

// ---- dry-run CLI ----
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const realPath = process.argv[2], outPath = process.argv[3];
  const ledgerPath = fileURLToPath(new URL('../../data/fno-ledger.json', import.meta.url));
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const realCharges = JSON.parse(readFileSync(realPath, 'utf8'));
  const merged = mergeFnoCharges(ledger, realCharges);
  writeFileSync(outPath, JSON.stringify({ note: 'DRY-RUN merged F&O ledger (NOT pushed to KV/portfolio:v1)', ...merged }, null, 1));
  console.log(`merged rows: ${merged.rows.length} | real-override: ${merged.stats.realRows} | opening-only added: ${merged.stats.openingOnly} | est-fallback: ${merged.stats.estRows}`);
  console.log('=== per-FY real-charge total from merge vs reconciliation ===');
  const got = realChargeByFy(merged);
  const EXPECT = { 'FY25-26 Zerodha': 716, 'FY25-26 Upstox': 18337, 'FY25-26 Dhan': 26404, 'FY25-26 Fyers': 32314, 'FY26-27 Dhan': 9856, 'FY26-27 Fyers': 6468 };
  for (const [k, exp] of Object.entries(EXPECT)) {
    const g = Math.round(got[k] || 0);
    console.log(`  ${k.padEnd(16)} merge=${String(g).padStart(7)}  recon=${String(exp).padStart(7)}  ${Math.abs(g - exp) <= 2 ? 'MATCH' : 'MISMATCH (' + (g - exp) + ')'}`);
  }
  console.log(`\nwrote ${outPath}`);
}
