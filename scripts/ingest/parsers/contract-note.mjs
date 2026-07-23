// Registry parser: contract-note — broker contract notes (Zerodha/Fyers/
// Upstox/Dhan today; Groww/Rupeezy pending real samples, plan step d2).
// Thin wrapper over the PROVEN scripts/contract-parser/run.py --porcelain:
// decrypt via CN_PW_*, per-segment checksum reconciliation, PII-redacted
// ledger:cn:<note-no> push all live THERE. naturalKey = the contract-note
// number read from the note CONTENT (re-sent note = same number = DUP).

import { join } from 'node:path';
import { venvPythonStrict, runPy, lastJsonLine, isPdf, ROOT } from './py.mjs';

const SCRIPT = join(ROOT, 'scripts', 'contract-parser', 'run.py');
const VESTED = join(ROOT, 'scripts', 'parse-vested.py');   // rebuilds the combined us_trades.json
const SEED = join(ROOT, 'scripts', 'seed-portfolio-kv.mjs');

// After a Dhan-GIFT US note books trades (USTRADES): rebuild the combined US book — us_trades.json
// (Vested ∪ Dhan flows) AND US[] composition (Vested ∪ Dhan holdings) — then re-seed KV. Mirrors the
// vested parser's own --write+seed chain. Non-fatal: a failed rebuild just leaves the trade store
// ahead of the combined book until the next Vested/US upload retries it.
async function rebuildUsBook() {
  const { spawn } = await import('node:child_process');
  const py = (args) => new Promise((res) => {
    const c = spawn('python', [VESTED, ...args], { cwd: ROOT, windowsHide: true });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('error', () => res({ code: -1, out })); c.on('close', (code) => res({ code, out }));
  });
  const seed = () => new Promise((res) => {
    const c = spawn(process.execPath, [SEED], { cwd: ROOT, windowsHide: true });
    c.on('error', () => res({ code: -1 })); c.on('close', (code) => res({ code }));
  });
  // holdings FIRST: it adds the Dhan symbols to US[], so the subsequent us_trades --write sees them
  // as HELD and books their flows under `flows` (per-symbol) rather than the `other` aggregate.
  const h = await py(['--holdings', '--write']);                                    // US[] composition
  const w = h.code === 0 ? await py(['--write']) : { code: -1 };                    // us_trades.json flows
  const s = (h.code === 0 && w.code === 0) ? await seed() : { code: -1 };           // reseed KV
  return { holdings: h.code, write: w.code, seed: s.code };
}

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
    case 'USTRADES':  // Dhan-GIFT US (ViewTrade) note — trades booked into data/dhan-us-trades.json
      return { status: 'PASS', claimed, naturalKey: cn, target: 'data/dhan-us-trades.json · us_trades.json (rebuilt)', reason: st.reason || null, meta: { ...meta, broker: 'dhan-us', usTrades: st.us_trades ?? null } };
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
    const mapped = mapCnStatus(st);
    if (st.status === 'USTRADES' && !dry && mapped.status === 'PASS') {
      const rb = await rebuildUsBook();   // us_trades.json + US[] (Vested ∪ Dhan) + KV reseed
      if (rb.write !== 0) mapped.reason = `${mapped.reason} — WARN us_trades rebuild failed (code ${rb.write}); store written`;
      else if (rb.holdings !== 0) mapped.reason = `${mapped.reason} — WARN US[] holdings rebuild failed (code ${rb.holdings}); flows written`;
      else if (rb.seed !== 0) mapped.reason = `${mapped.reason} — book rebuilt; WARN KV reseed failed (code ${rb.seed})`;
    }
    return { ...mapped, parserVersion: 'contract-parser' };
  },
};
