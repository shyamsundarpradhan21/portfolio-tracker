// Registry parser: cas-mf — consolidated MF account statements (CAMS/KFintech).
// Thin wrapper over scripts/cas-parser/run.py --porcelain (the engine does the
// decrypt/parse/validate/redact/KV work; refuse-on-fail lives THERE).
// naturalKey = statement period + folio-set hash (from the engine).

import { join } from 'node:path';
import { venvPythonStrict, runPy, lastJsonLine, isPdf, ROOT } from './py.mjs';

const SCRIPT = join(ROOT, 'scripts', 'cas-parser', 'run.py');

// CAMS/KFintech mails + manual exports name these recognizably; PDF magic
// required so a stray .txt named "CAS.pdf.txt" can't get claimed. Note: \b
// misses "CAS_JUN" (underscore is a word char) — letters-only boundaries.
export const CAS_NAME = /(?:^|[^a-z])(cas|cams|camsonline|kfintech|kfin)(?:[^a-z]|$)|consolidated.{0,12}account.{0,12}statement/i;

export const casMfParser = {
  id: 'cas-mf',
  expects: { cadence: 'monthly', label: 'CAS (CAMS/KFintech)' },
  probeEncrypted: 1,   // decrypt-probe order: CAS first, then contract-note
  canHandle: ({ name, head }) => isPdf(head) && CAS_NAME.test(name),
  async run(file, { dry }) {
    const venv = venvPythonStrict('scripts/cas-parser/.venv');
    if (venv.error) return { status: 'FAIL', reason: venv.error, claimed: false };
    const args = [file.path, '--porcelain'];
    if (dry) args.push('--dry-run');
    const { code, stdout, stderr } = await runPy(venv.python, SCRIPT, args);
    const st = lastJsonLine(stdout);
    if (!st) {
      return { status: 'FAIL', claimed: false, reason: `cas-parser gave no porcelain status (exit ${code}): ${(stderr || stdout).slice(0, 200)}` };
    }
    return {
      status: st.status === 'PASS' ? 'PASS' : 'FAIL',
      // decrypt-probe claim = casparser STRUCTURALLY parsed it (a CAS_PW opened a
      // real CAS). A wrong password / not-a-CAS declines → probe tries the next parser.
      claimed: st.parsed === true,
      naturalKey: st.key ?? null,
      target: st.target ?? null,
      reason: st.reason || null,
      parserVersion: 'casparser-1.2.1',
    };
  },
};
