// Old-figures reconciliation — REPORT-ONLY (plan v2 step j). Prints the
// cross-granularity invariants; NEVER writes a store. Corrections go through
// edit-private-JSON → guarded seed after user sign-off.
//
//   node scripts/ingest-reconcile.mjs [--json]
//
// Sources: data/itr-candidate-*.json (from the itr-json parser — the filed
// return is the AUTHORITY anchor), data/fno-verified.json (hand seed),
// data/fno-ledger.json, data/broker-tax.json, data/portfolio.private.json
// (PAYSLIPS + as-of dates; local read), KV ledger:fno:overlay + ledger:mf:index
// (best-effort — offline degrades to 'unreadable').

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReconcile } from './ingest/reconcile.mjs';
import { kvGetJSON, kvConfigured, kvCreds } from './lib/kv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJ = (p) => { try { return JSON.parse(readFileSync(join(ROOT, p), 'utf8')); } catch { return null; } };

const candidates = readdirSync(join(ROOT, 'data'))
  .filter((f) => /^itr-candidate-AY\d{4}-\d{2}\.json$/.test(f))
  .map((f) => readJ(`data/${f}`))
  .filter(Boolean);

const seed = readJ('data/fno-verified.json');
const ledgerRows = readJ('data/fno-ledger.json')?.rows || [];
const brokerTaxFno = readJ('data/broker-tax.json')?.fno_realized || null;
const priv = readJ('data/portfolio.private.json') || {};

let overlayCount = null;
let mfLedgerKeys = [];
if (kvConfigured()) {
  const overlay = await kvGetJSON('ledger:fno:overlay');
  overlayCount = overlay ? Object.keys(overlay).length : 0;
  try {
    const r = await fetch(kvCreds().url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvCreds().token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SMEMBERS', 'ledger:mf:index']),
      signal: AbortSignal.timeout(6000),
    });
    mfLedgerKeys = (await r.json())?.result || [];
  } catch { /* offline — stays [] with the PENDING note */ }
}

const report = buildReconcile({
  candidates, seed, ledgerRows, brokerTaxFno,
  payslips: priv.PAYSLIPS || [], overlayCount, mfLedgerKeys,
  privateAsOf: {
    US_REALIZED: priv.US_REALIZED?.asOf,
    INDIAN_REALIZED: priv.INDIAN_REALIZED?.asOf,
    US_DIVIDENDS: priv.US_DIVIDENDS?.asOf,
  },
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
}

const rup = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-IN'));
console.log(`ingest-reconcile — REPORT ONLY (no store is ever written)`);
console.log(`authority: ${report.authority}\n`);

console.log(`F&O per FY (ITR filed net vs pipeline ledger vs broker-tax gross):`);
if (!report.fno.length) console.log('  no ITR candidates yet — ingest the filed ITR JSONs first');
for (const r of report.fno) {
  console.log(`  ${r.fy} (${r.ay}):  ITR net ${rup(r.itrNet)} (non-spec ${rup(r.itrNonSpec)} + spec ${rup(r.itrSpec)}) · ledger net ${rup(r.ledgerNet)} · broker-tax gross ${rup(r.brokerTaxGross)}  → ${r.vsLedger}`);
}
if (report.fno.length) console.log(`  basis: ${report.fno[0].note}`);

console.log(`\nSchedule S vs parsed payslips (bases differ — informational):`);
for (const r of report.salary) {
  console.log(`  ${r.fy}: ITR gross ${rup(r.itrGross)} / ITR net ${rup(r.itrNet)} · payslip take-home ${rup(r.payslipTakeHome)} over ${r.payslipMonths} slips${r.flag ? `  ⚠ ${r.flag}` : ''}`);
}

console.log(`\nSchedule CFL vs hand-verified seed (latest AY ${report.latestAy} is the seed-comparable one):`);
for (const c of report.cfl) {
  const mark = c.ay === report.latestAy ? '→' : ' ';
  console.log(`  ${mark} ${c.ay}: non-spec ${rup(c.nonSpec.itr)}/${rup(c.nonSpec.seed)} ${c.nonSpec.verdict} · spec ${rup(c.speculative.itr)}/${rup(c.speculative.seed)} ${c.speculative.verdict} · stcg ${rup(c.stcg.itr)}/${rup(c.stcg.seed)} ${c.stcg.verdict}`);
}

console.log(`\nF&O charges coverage: ${report.charges.ledgerDays} ledger day-rows · overlay entries: ${report.charges.overlayEntries ?? 'KV unreadable (offline)'}\n  ${report.charges.note}`);
console.log(`\nMF vs CAS: ${report.mf.status}\n  guard: ${report.mf.guard}`);
console.log(`\nout-of-scope stores (figures untouched — as-of staleness only):`);
for (const s of report.staleness) console.log(`  ${s.store}: as of ${s.asOf || 'unknown'}`);
