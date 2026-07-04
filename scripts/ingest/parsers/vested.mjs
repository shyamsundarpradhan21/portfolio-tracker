// Registry parser: vested — Vested / DriveWealth tradebook export
// ("Vested_Transactions*.xlsx"). Wraps the PROVEN scripts/parse-vested.py, which
// reduces the export to data/us_trades.json (the per-symbol USD-flow + cash source
// the US historical growth curve replays — app/lib/backfill.js). naturalKey = the
// export's latest activity date (a re-download with newer trades advances it → a
// genuinely new document; the same export re-dropped is a DUP). PASS flow mirrors
// broker-tax's same-name convention:
//   1. copy the export into data/reports/ as the canonical Vested_Transactions.xlsx
//      (a newer download REPLACES it — the file is a full cumulative history, not
//      an append-corpus like the payslips, so we keep exactly one);
//   2. run parse-vested.py --write → regenerates data/us_trades.json in place.
// us_trades.json is a git-tracked file imported directly by the portfolio route
// (no KV seed), so regenerating it IS the publish step — same as the other
// sync-pipeline JSONs. The inbox clone is then deleted by the router.

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPy, lastJsonLine, ROOT } from './py.mjs';

const SCRIPT = join(ROOT, 'scripts', 'parse-vested.py');
const REPORTS = join(ROOT, 'data', 'reports');
const CANON = 'Vested_Transactions.xlsx';   // parse-vested.py --write reads this path

export const VESTED_NAME = /^(?:[0-9a-f]{8}-)?Vested_Transactions.*\.xlsx$/i;

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
    if (dry) return { status: 'PASS', naturalKey, target: 'data/us_trades.json (dry)', parserVersion: 'parse-vested' };

    mkdirSync(REPORTS, { recursive: true });
    const dest = join(REPORTS, CANON);
    copyFileSync(file.path, dest);                                   // canonical corpus copy; router deletes the inbox clone
    const meta = { asOf: st.asOf, savedAs: CANON };

    const wrote = await runPy('python', SCRIPT, ['--write']);        // regenerates data/us_trades.json from the canonical copy
    if (wrote.code !== 0) {
      return { status: 'FAIL', naturalKey, meta, reason: `parse-vested --write exit ${wrote.code} (export already copied as ${CANON}): ${(wrote.stderr || wrote.stdout).slice(0, 200)}` };
    }
    return { status: 'PASS', naturalKey, meta, target: `data/reports/${CANON} · data/us_trades.json (regenerated)`, parserVersion: 'parse-vested' };
  },
};
