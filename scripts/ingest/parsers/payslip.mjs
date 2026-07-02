// Registry parser: payslip — MCL/COALNET salary slips ("Form (NN).pdf").
// Wraps the PROVEN scripts/parse-payslip.py (fitz layout parse). naturalKey =
// salary month (YYYY-MM from the slip content). PASS flow (plan v2 §3):
//   1. copy the slip into data/reports/ as the next free "Form (N).pdf" —
//      that folder IS the engine's corpus (regular + arrear slips combine per
//      month across ALL files, so the corpus must keep growing);
//   2. run parse-payslip.py --write (patches BASIC_PAY in the private seed —
//      net/CMPF/CMPS stay hand-arrear-reconciled by design);
//   3. AUTO-CHAIN the guarded seed: node scripts/seed-portfolio-kv.mjs
//      (its near-empty sanity guard stands — a refusal FAILs the intake).
// The inbox clone is then deleted by the router; the copy in data/reports/ is
// the engine's own gitignored PII store, same as the pre-pipeline workflow.

import { copyFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPy, lastJsonLine, isPdf, ROOT } from './py.mjs';

const SCRIPT = join(ROOT, 'scripts', 'parse-payslip.py');
const SEED = join(ROOT, 'scripts', 'seed-portfolio-kv.mjs');
const REPORTS = join(ROOT, 'data', 'reports');

// next free "Form (N).pdf" slot in data/reports/
export function nextFormName(existing) {
  let max = 0;
  for (const n of existing) {
    const m = /^Form \((\d+)\)\.pdf$/i.exec(n);
    if (m) max = Math.max(max, +m[1]);
  }
  return `Form (${max + 1}).pdf`;
}

async function runSeed() {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED], { cwd: ROOT, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', () => resolve({ code: -1, out }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

export const payslipParser = {
  id: 'payslip',
  expects: { cadence: 'monthly', label: 'salary payslip' },
  canHandle: ({ name, head }) => isPdf(head) && (/^(?:[0-9a-f]{8}-)?Form \(\d+\)\.pdf$/i.test(name) || /payslip|salary.?slip|coalnet/i.test(name)),
  async run(file, { dry }) {
    // probe the single slip for its salary month (PII-free porcelain: month + booleans)
    const probe = await runPy('python', SCRIPT, ['--one', file.path, '--porcelain']);
    const st = lastJsonLine(probe.stdout);
    if (!st?.month) {
      return { status: 'FAIL', reason: st?.error || 'no salary month found — not a recognizable payslip' };
    }
    const naturalKey = st.month;                                  // YYYY-MM
    if (dry) return { status: 'PASS', naturalKey, target: 'data/portfolio.private.json BASIC_PAY (dry)', parserVersion: 'parse-payslip' };

    mkdirSync(REPORTS, { recursive: true });
    const dest = join(REPORTS, nextFormName(readdirSync(REPORTS)));
    copyFileSync(file.path, dest);                                 // corpus copy; router deletes the inbox clone

    const wrote = await runPy('python', SCRIPT, ['--write']);
    if (wrote.code !== 0) {
      return { status: 'FAIL', naturalKey, reason: `parse-payslip --write exit ${wrote.code} (slip already copied to data/reports/)` };
    }
    const seed = await runSeed();                                  // guarded — refusal = FAIL
    if (seed.code !== 0) {
      return { status: 'FAIL', naturalKey, reason: `seed-portfolio-kv refused/failed (exit ${seed.code}) — BASIC_PAY written, KV NOT updated` };
    }
    return { status: 'PASS', naturalKey, target: 'BASIC_PAY → KV portfolio:v1 (seeded)', parserVersion: 'parse-payslip' };
  },
};
