// Registry parser: vested — Vested / DriveWealth tradebook export
// ("Vested_Transactions*.xlsx"). Wraps the PROVEN scripts/parse-vested.py, which
// regenerates BOTH US-sleeve stores from one export:
//   * data/us_trades.json          — per-symbol USD-flow + cash replay for the US
//                                     historical growth curve (app/lib/backfill.js);
//                                     git-tracked, consumed by a direct import
//   * US_DIVIDENDS in portfolio.private.json — the US-tab "Dividend Income" card
//                                     (app/components/tabs/USTab.js); KV-seeded
// naturalKey = the export's latest activity date (a re-download with newer trades
// advances it → a genuinely new document; the same export re-dropped is a DUP).
// PASS flow mirrors broker-tax's same-name convention + payslip's seed-chain:
//   1. APPEND the export into data/reports/vested/ as <asOf>-<sha8>.xlsx — every
//      month's export is KEPT (append-corpus like the payslips). The export is
//      uploaded month-by-month, NOT as one cumulative file, so parse-vested rebuilds
//      from the UNION of all exports (deduped) — a month-only upload can no longer
//      wipe prior history;
//   2. run parse-vested.py --write → rebuilds us_trades.json from the corpus union AND
//      full-replaces US_DIVIDENDS in the private seed;
//   3. AUTO-CHAIN the guarded seed: node scripts/seed-portfolio-kv.mjs (US_DIVIDENDS
//      only reaches the app via KV — its near-empty sanity guard stands, a refusal
//      FAILs the intake). us_trades.json needs no seed (git-tracked, direct import).
// The inbox clone is then deleted by the router.

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPy, lastJsonLine, ROOT } from './py.mjs';

const SCRIPT = join(ROOT, 'scripts', 'parse-vested.py');
const SEED = join(ROOT, 'scripts', 'seed-portfolio-kv.mjs');
const REPORTS = join(ROOT, 'data', 'reports');
const VESTED_DIR = join(REPORTS, 'vested');   // append-corpus of every export; parse-vested --write unions them

export const VESTED_NAME = /^(?:[0-9a-f]{8}-)?Vested_Transactions.*\.xlsx$/i;

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

export const vestedParser = {
  id: 'vested',
  expects: { cadence: 'monthly', label: 'Vested/DriveWealth tradebook' },
  // filename-only sniff (xlsx, no cheap magic helper) — mirrors broker-tax. The
  // name is distinct from broker-tax's "Profit-Loss Statement*.xlsx" (the Vested
  // TAX report), so the two never both claim a file.
  canHandle: ({ name }) => VESTED_NAME.test(name),
  async run(file, { dry }) {
    // probe the export for its latest activity date (PII-free porcelain)
    const probe = await runPy('python', SCRIPT, ['--one', file.path, '--porcelain']);
    const st = lastJsonLine(probe.stdout);
    if (!st?.asOf) {
      return { status: 'FAIL', reason: st?.error || `probe failed (exit ${probe.code}) — not a recognizable Vested export` };
    }
    const naturalKey = st.key || st.asOf;                            // latest activity date
    if (dry) return { status: 'PASS', naturalKey, target: 'data/us_trades.json + US_DIVIDENDS (dry)', parserVersion: 'parse-vested' };

    mkdirSync(VESTED_DIR, { recursive: true });
    const savedAs = `${st.asOf}-${file.sha256.slice(0, 8)}.xlsx`;    // KEEP every export (append-corpus)
    copyFileSync(file.path, join(VESTED_DIR, savedAs));             // router deletes the inbox clone; the corpus persists
    const meta = { asOf: st.asOf, savedAs };

    const wrote = await runPy('python', SCRIPT, ['--write']);       // us_trades.json + US_DIVIDENDS from the corpus UNION
    if (wrote.code !== 0) {
      return { status: 'FAIL', naturalKey, meta, reason: `parse-vested --write exit ${wrote.code} (export saved to corpus as ${savedAs}): ${(wrote.stderr || wrote.stdout).slice(0, 200)}` };
    }
    const seed = await runSeed();                                    // guarded — refusal = FAIL (US_DIVIDENDS reaches the app only via KV)
    if (seed.code !== 0) {
      return { status: 'FAIL', naturalKey, meta, reason: `seed-portfolio-kv refused/failed (exit ${seed.code}) — us_trades.json + US_DIVIDENDS written, KV NOT updated` };
    }
    return { status: 'PASS', naturalKey, meta, target: `data/reports/vested/${savedAs} (corpus) · data/us_trades.json (rebuilt from union) · US_DIVIDENDS → KV portfolio:v1 (seeded)`, parserVersion: 'parse-vested' };
  },
};
