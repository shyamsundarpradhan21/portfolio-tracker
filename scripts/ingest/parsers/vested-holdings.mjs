// Registry parser: vested-holdings — Vested / DriveWealth POSITIONS export
// ("Vested_Holdings*.xlsx"). Wraps scripts/parse-vested.py --holdings, the
// authoritative source for the US[] composition (qty/cost/inv). This is a
// SEPARATE document from the tradebook (Vested_Transactions*.xlsx, → vested.mjs):
// the transactions Trades sheet CANNOT reconstruct current holdings (splits mint
// shares with no buy row; DRIP shares aren't booked as trades), so composition
// comes from this positions snapshot instead.
//   * US[] in portfolio.private.json — qty/cost/inv per holding (KV-seeded).
//     Curated name/cat are PRESERVED from the current US[]; a genuinely new
//     ticker must be curated (NEW_META in parse-vested.py) or the write FAILs.
// naturalKey = the snapshot's as-of date (ISO). A newer snapshot advances it → a
// genuinely new document; the same file re-dropped is a DUP.
// PASS flow mirrors vested.mjs:
//   1. copy the export into data/reports/ as the canonical Vested_Holdings.xlsx
//      (a newer download REPLACES it — a positions snapshot, keep exactly one);
//   2. run parse-vested.py --holdings --write → full-replaces US[] in the seed;
//   3. AUTO-CHAIN the guarded seed (US[] reaches the app only via KV).
// The inbox clone is then deleted by the router.

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPy, lastJsonLine, ROOT } from './py.mjs';

const SCRIPT = join(ROOT, 'scripts', 'parse-vested.py');
const SEED = join(ROOT, 'scripts', 'seed-portfolio-kv.mjs');
const REPORTS = join(ROOT, 'data', 'reports');
const CANON = 'Vested_Holdings.xlsx';   // parse-vested.py --holdings reads this path

export const VESTED_HOLDINGS_NAME = /^(?:[0-9a-f]{8}-)?Vested_Holdings.*\.xlsx$/i;

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

export const vestedHoldingsParser = {
  id: 'vested-holdings',
  expects: { cadence: 'monthly', label: 'Vested/DriveWealth holdings snapshot' },
  // filename-only sniff (xlsx). Distinct from vested.mjs's "Vested_Transactions*"
  // and broker-tax's "Profit-Loss Statement*", so no two parsers claim a file.
  canHandle: ({ name }) => VESTED_HOLDINGS_NAME.test(name),
  async run(file, { dry }) {
    // probe the positions snapshot for its as-of date (PII-free porcelain)
    const probe = await runPy('python', SCRIPT, ['--holdings', '--one', file.path, '--porcelain']);
    const st = lastJsonLine(probe.stdout);
    if (!st?.asOf) {
      return { status: 'FAIL', reason: st?.error || `probe failed (exit ${probe.code}) — not a recognizable Vested holdings export` };
    }
    const naturalKey = st.key || st.asOf;                            // snapshot as-of date (ISO)
    if (dry) return { status: 'PASS', naturalKey, target: 'US[] composition (dry)', parserVersion: 'parse-vested --holdings' };

    mkdirSync(REPORTS, { recursive: true });
    const dest = join(REPORTS, CANON);
    copyFileSync(file.path, dest);                                   // canonical snapshot copy; router deletes the inbox clone
    const meta = { asOf: st.asOf, savedAs: CANON };

    const wrote = await runPy('python', SCRIPT, ['--holdings', '--write']);   // US[] from the canonical copy
    if (wrote.code !== 0) {
      // an uncategorised new ticker (or a parse error) is a clean FAIL — the file
      // is copied but US[] is left untouched until the ticker is curated.
      return { status: 'FAIL', naturalKey, meta, reason: `parse-vested --holdings --write exit ${wrote.code} (export copied as ${CANON}): ${(wrote.stderr || wrote.stdout).slice(0, 200)}` };
    }
    const seed = await runSeed();                                    // guarded — refusal = FAIL (US[] reaches the app only via KV)
    if (seed.code !== 0) {
      return { status: 'FAIL', naturalKey, meta, reason: `seed-portfolio-kv refused/failed (exit ${seed.code}) — US[] written, KV NOT updated` };
    }
    return { status: 'PASS', naturalKey, meta, target: `data/reports/${CANON} · US[] composition → KV portfolio:v1 (seeded)`, parserVersion: 'parse-vested --holdings' };
  },
};
