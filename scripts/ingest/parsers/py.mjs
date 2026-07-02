// Shared helper for registry parsers that wrap the proven python engines
// (contract-parser, cas-parser, parse-payslip, parse-broker-tax). One spawn
// convention: venv python first, PATH python as fallback; stdout captured;
// the LAST JSON line of stdout is the machine-readable status (--porcelain).

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// venvDir relative to ROOT, e.g. 'scripts/cas-parser/.venv'
export function pythonFor(venvDir) {
  const venvPy = join(ROOT, venvDir, 'Scripts', 'python.exe');
  return existsSync(venvPy) ? venvPy : 'python';
}

export function runPy(python, script, args = [], { timeoutMs = 180_000, cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    // PYTHONIOENCODING: piped stdout on Windows defaults to cp1252, and the
    // engines print →/₹/× — without this a SUCCESSFUL run can die with
    // UnicodeEncodeError on its last status line (caught live in phase i).
    const child = spawn(python, [script, ...args], {
      cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// The porcelain contract: last parseable JSON line of stdout wins.
export function lastJsonLine(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).reverse();
  for (const l of lines) {
    const t = l.trim();
    if (!t.startsWith('{')) continue;
    try { return JSON.parse(t); } catch { /* keep looking */ }
  }
  return null;
}

// PDF magic sniff — every python-wrapped parser here eats PDFs except itr-json.
export const isPdf = (head) => head?.slice(0, 5).toString('latin1').startsWith('%PDF-');
