#!/usr/bin/env node
// scripts/ensure-tokens.mjs — catch-up broker-token minter (self-heal).
//
// WHY: the morning mint lives ONLY in the fixed 08:55 DailyMorning task
// (sync.cmd → sync-brokers.mjs). If the laptop is asleep/off at 08:55 — or the SEBI
// pre-open cycle killed the evening token before the daemon relaunched at 09:13 —
// the F&O capture reads dead tokens and logs `no-tokens` all day, with no recovery.
// This makes token freshness a SELF-HEAL keyed on the OPEN WINDOW, not a fixed clock:
// the Supervisor calls it every ~5 min in-window (and it self-runs on AtLogOn), so
// opening the laptop at 11:30 mints within one tick.
//
// FRESHNESS RULE — matches the SEBI daily-invalidation cycle, NOT Dhan's mint+24h
// `expiryTs` (that field LIES: it reports a dead morning token as valid). A token is
// fresh iff its .token.json was written today at/after 08:45 IST (a hair before the
// 08:55 normal mint). Anything older predates today's pre-open cycle → dead → re-mint.
//
// SCOPE: dhan (pure-API TOTP; mint.py force-mints past the lying cache) + upstox
// (headless Playwright login.py). Fyers is PARKED (headed/Cloudflare, no unattended
// auth) — never touched here.
//
// PER-BROKER DEGRADATION: one broker failing never blocks the other, so Dhan (the
// primary F&O source) always heals even if Upstox has an issue. Idempotent + cheap to
// call every tick: a fresh token is left untouched (no mint, no rate-limit churn); the
// daemon reads the new token on its next ~10s poll, so no daemon restart is needed.
//
// Usage:  node scripts/ensure-tokens.mjs [--force]
//   --force  mint stale tokens regardless of the market window (manual recovery).

import { spawnSync } from 'node:child_process';
import { statSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketState, istParts } from './lib/marketHours.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOG = join(ROOT, 'scripts', 'tokens.log');
const FORCE = process.argv.includes('--force');
const PRE_OPEN_MIN = 8 * 60 + 45; // 08:45 IST — the normal-mint boundary / SEBI-cycle floor

// Brokers to keep fresh. Fyers is intentionally absent (parked; needs a desktop).
const BROKERS = [
  { name: 'dhan', token: 'mcp/dhan/.token.json', venv: 'mcp/dhan/.venv/Scripts/python.exe', dir: 'mcp/dhan', args: ['mint.py'] },
  { name: 'upstox', token: 'mcp/upstox/.token.json', venv: 'mcp/upstox/.venv/Scripts/python.exe', dir: 'mcp/upstox', args: ['login.py'] },
];

const now = Date.now();
const ist = istParts(now);

function log(msg) {
  const line = `${ist.date} ${ist.hhmm} ${msg}`;
  try { appendFileSync(LOG, line + '\n'); } catch { /* log is best-effort */ }
  process.stdout.write(line + '\n');
}

// Only mint inside the India window: the live 'open' session, or 'pre' once we're past
// the 08:45 mint boundary (so an early-but-late login is ready before the 09:13 open).
const state = marketState(now);
const inWindow = state === 'open' || (state === 'pre' && ist.mins >= PRE_OPEN_MIN);
if (!inWindow && !FORCE) {
  log(`skip — India ${state} ${ist.hhmm}`);
  process.exit(0);
}

// today's 08:45 IST as an epoch — a token older than this predates the pre-open cycle.
// IST is a fixed +05:30 offset (no DST), so this is exact.
const preOpenEpoch = Date.parse(`${ist.date}T08:45:00+05:30`);

let minted = 0, failed = 0;
for (const b of BROKERS) {
  const tokPath = join(ROOT, b.token);
  const fresh = existsSync(tokPath) && statSync(tokPath).mtimeMs >= preOpenEpoch;
  if (fresh && !FORCE) { log(`${b.name} fresh — skip`); continue; }

  const py = join(ROOT, b.venv);
  if (!existsSync(py)) { log(`${b.name} MINT-SKIP — venv missing (${b.venv})`); failed++; continue; }

  const r = spawnSync(py, b.args, { cwd: join(ROOT, b.dir), timeout: 90_000, encoding: 'utf8' });
  // redact anything token-shaped before it ever touches the log; keep the last reason line.
  const reason = ((r.stdout || '') + (r.stderr || ''))
    .replace(/[A-Za-z0-9_.\-]{25,}/g, '<REDACTED>')
    .split('\n').map((s) => s.trim()).filter(Boolean).slice(-1)[0] || '';
  const ok = existsSync(tokPath) && statSync(tokPath).mtimeMs >= preOpenEpoch;
  if (ok) { minted++; log(`${b.name} MINTED (exit ${r.status}) ${reason}`.trim()); }
  else { failed++; log(`${b.name} MINT-FAIL (exit ${r.status}) ${reason}`.trim()); }
}

if (minted || failed) log(`done — minted ${minted}, failed ${failed}`);
process.exit(failed && !minted ? 1 : 0);
