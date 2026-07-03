// Ingestion completeness report (plan v2 §6) — on-demand + weekly scheduled.
//
//   node scripts/ingest-report.mjs [--json] [--since-notes 2026-04-01]
//                                  [--since-payslip 2026-01] [--since-cas 2026-01]
//                                  [--since-ay 2024]
//
// Expectation model per parser `expects` cadence:
//   contract-note  one per (broker, traded day) — traded days come from the
//                  F&O ledger itself (data/fno-ledger.json), so holidays and
//                  idle days never false-positive;
//   payslip / cas  one per month from the baseline (first PASS or --since-*);
//   itr-json       one per AY whose belated-filing window has closed.
// Plus per-parser staleness (days since last PASS vs cadence). Gaps are
// REPORTED here, not discovered at ITR time.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from './ingest/manifest.mjs';
import { loadParsers } from './ingest/registry.mjs';
import { buildReport } from './ingest/report.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const manifest = readManifest(join(ROOT, 'data', 'ingest-manifest.json'));
let ledgerRows = [];
try { ledgerRows = JSON.parse(readFileSync(join(ROOT, 'data', 'fno-ledger.json'), 'utf8')).rows || []; }
catch { /* no ledger yet — note expectations stay empty */ }

const parsers = await loadParsers();
const report = buildReport({
  manifest, ledgerRows, parsers,
  since: {
    notesIso: arg('--since-notes'),
    payslipMonth: arg('--since-payslip'),
    casMonth: arg('--since-cas'),
    itrAy: arg('--since-ay') ? +arg('--since-ay') : undefined,
  },
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
}

const n = report.contractNotes;
console.log(`ingest completeness — ${report.asOf.slice(0, 10)}`);
console.log(`\ncontract notes: ${n.covered}/${n.expected} traded (broker, day) pairs covered`);
if (n.gaps.length) {
  const byBroker = {};
  for (const g of n.gaps) (byBroker[g.broker] ||= []).push(g.date);
  for (const [b, days] of Object.entries(byBroker)) {
    console.log(`  MISSING ${b}: ${days.length} day(s) — ${days.slice(0, 6).join(', ')}${days.length > 6 ? ` … +${days.length - 6}` : ''}`);
  }
} else if (n.expected) console.log('  complete over the ledger window');

for (const [label, r] of [['payslips', report.payslips], ['CAS', report.cas]]) {
  if (!r.baseline) { console.log(`\n${label}: no baseline yet (nothing ingested; set --since-* to enforce a window)`); continue; }
  console.log(`\n${label}: ${r.covered}/${r.expected} months from ${r.baseline}`);
  if (r.gaps.length) console.log(`  MISSING: ${r.gaps.join(', ')}`);
}

console.log(`\nITR: ${report.itr.covered} ingested${report.itr.gaps.length ? ` — MISSING ${report.itr.gaps.join(', ')}` : ' — all closed AYs covered'}`);

console.log('\nstaleness:');
for (const s of report.staleness) {
  const state = s.stale ? 'STALE' : 'ok   ';
  console.log(`  ${state} ${s.parser.padEnd(14)} ${s.cadence.padEnd(16)} last PASS ${s.lastPass ? `${s.lastPass.slice(0, 10)} (${s.ageDays}d ago)` : 'never'}`);
}

const u = report.unresolved;
console.log(`\nunresolved intake (didn't reach the clean ledger — quarantined/parked as files):`);
console.log(`  FAILED: ${u.failed.total} row(s)`);
for (const g of u.failed.groups) {
  const eg = g.examples.slice(0, 2).join(', ') + (g.examples.length > 2 || g.count > g.examples.length ? ' …' : '');
  console.log(`    ${g.parser.padEnd(14)} ${g.reasonClass.padEnd(16)} ×${g.count}  e.g. ${eg}`);
}
if (!u.failed.total) console.log('    none');
console.log(`  UNRECOGNIZED: ${u.unrecognized.total} row(s) across ${u.unrecognized.distinct} file(s)`);
for (const f of u.unrecognized.files.slice(0, 10)) {
  console.log(`    ${f.file}${f.attempts > 1 ? ` (×${f.attempts})` : ''}`);
}
if (u.unrecognized.files.length > 10) console.log(`    … +${u.unrecognized.files.length - 10} more`);
if (!u.unrecognized.total) console.log('    none');
