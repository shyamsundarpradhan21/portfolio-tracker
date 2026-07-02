// Registry parser: contract-note — broker contract notes (Zerodha/Fyers/
// Upstox/Dhan today; Groww/Rupeezy pending real samples, plan step d2).
// Thin wrapper over the PROVEN scripts/contract-parser/run.py --porcelain:
// decrypt via CN_PW_*, per-segment checksum reconciliation, PII-redacted
// ledger:cn:<note-no> push all live THERE. naturalKey = the contract-note
// number read from the note CONTENT (re-sent note = same number = DUP).

import { join } from 'node:path';
import { venvPythonStrict, runPy, lastJsonLine, isPdf, ROOT } from './py.mjs';

const SCRIPT = join(ROOT, 'scripts', 'contract-parser', 'run.py');

// run.py statuses → pipeline statuses. CARRY (daily MTM note: no trades, no
// levies) is a RECOGNISED inert document — PASS with no target, not a failure.
export function mapCnStatus(st) {
  if (!st) return { status: 'FAIL', reason: 'contract-parser gave no porcelain status' };
  const cn = st.cn || null;
  // trade date + broker ride into the manifest row (PII-free) — the
  // completeness report matches them against the F&O ledger's traded days
  const meta = { date: st.date || null, broker: (st.broker || '').toLowerCase() || null };
  // decrypt-probe claim = a CN_PW decrypted this note. SKIP means "no CN_PW_*
  // decrypts" (not this parser's file) → declines. Every other status means a
  // password opened it (PUSHED/OK/CARRY parsed; REFUSED/HELD parsed-but-failed).
  const claimed = st.status !== 'SKIP';
  switch (st.status) {
    case 'PUSHED':
    case 'OK':      // dry-run or no-KV-creds parse-verified
      return { status: 'PASS', claimed, naturalKey: cn, target: cn ? `ledger:cn:${cn}` : null, reason: st.reason || null, meta };
    case 'CARRY':
      return { status: 'PASS', claimed, naturalKey: cn, target: null, reason: 'carry/MTM note — inert, no trades', meta: { ...meta, carry: true } };
    default:        // REFUSED (checksum FAIL) / HELD (unmapped charge) / SKIP (no pw) / KVFAIL / KVERR
      return { status: 'FAIL', claimed, naturalKey: cn, target: null, reason: `${st.status}: ${st.reason || ''}`.trim(), meta };
  }
}

// Filename claim: "contract note", "cnote", OR a bare "contract" token (letters-
// only boundary so "NSEFUTURES_CONTRACT_2023…" — Astha's naming — is claimed
// where \bcontract\b would miss it, underscore being a word char). PDF-gated;
// none of the other parsers' name conventions contain "contract", so no theft.
const CN_NAME = /(?:^|[^a-z])contract(?:[^a-z]|$)|contract.?note|\bcnote\b|tax.?invoice.*note/i;

export const contractNoteParser = {
  id: 'contract-note',
  expects: { cadence: 'per-trading-day', label: 'F&O contract note' },
  probeEncrypted: 2,   // decrypt-probe order: after cas-mf
  canHandle: ({ name, head }) => isPdf(head) && CN_NAME.test(name),
  async run(file, { dry }) {
    const venv = venvPythonStrict('scripts/contract-parser/.venv');
    if (venv.error) return { status: 'FAIL', claimed: false, reason: venv.error };
    const args = [file.path, '--porcelain'];
    if (dry) args.push('--dry-run');
    const { code, stdout, stderr } = await runPy(venv.python, SCRIPT, args);
    const st = lastJsonLine(stdout);
    if (!st) return { status: 'FAIL', claimed: false, reason: `contract-parser no porcelain (exit ${code}): ${(stderr || stdout).slice(0, 200)}` };
    return { ...mapCnStatus(st), parserVersion: 'contract-parser' };
  },
};
