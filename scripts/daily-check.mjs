// Daily-job checker — the self-heal + visibility layer for the ONCE-A-DAY jobs
// (DaemonWatchdog covers the always-on/windowed daemons; this covers the one-shots).
//
// It verifies each daily job's OUTPUT is fresh for today rather than trusting that the
// scheduled task "ran" — a task can report success while its data went stale (Upstox
// fetch failed inside a "successful" evening sync, 2026-07-10), or never fire at all
// (DailyNetworthSnapshot is Interactive + needs a browser, so a 07:00 trigger while the
// laptop is asleep evaporates). A stale+due job is re-triggered via its OWN scheduled
// task (identical to how Task Scheduler launches it), at most ONCE per calendar day per
// job (state file) so a persistently-down job is logged STALE without spamming heavy
// re-runs. Every run appends one status line to scripts/daily-check.log — the checker log,
// so a miss is never silent.
//
// Run by Task Scheduler hourly (see register-daily-check.ps1).
//   node scripts/daily-check.mjs            # check + heal + log
//   CHECK_DRY=1 node scripts/daily-check.mjs  # log what it WOULD do; never triggers

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { istParts } from './lib/marketHours.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p, fb = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const DRY = !!process.env.CHECK_DRY;

const { date: today, dow, mins, hhmm } = istParts(Date.now());
const isWeekday = dow >= 1 && dow <= 5;

const STATE_PATH = join(ROOT, 'scripts', 'daily-check.state');
const state = readJSON(STATE_PATH, {});   // { <job>: 'YYYY-MM-DD' — last date we re-ran it }

// Freshness signals — each is the ACTUAL artifact the job is supposed to produce today.
const sleeves = readJSON(join(ROOT, 'data', 'snapshot-sleeves.json'), {});
const snapLatest = Object.keys(sleeves).sort().pop() || '(none)';

const bs = readJSON(join(ROOT, 'data', 'broker-state.json'), {});
const bsDate = String(bs.syncedAt || '').slice(0, 10);
const brokersOk = !!(bs.brokers?.upstox?.ok && bs.brokers?.dhan?.ok);   // Fyers parked / Kite hand-maintained → excluded

const jobs = [
  {
    key: 'snapshot', task: 'DailyNetworthSnapshot',
    skip: false,
    due: mins >= 7 * 60 + 30,                 // 07:30, every day (snapshots are daily)
    fresh: snapLatest === today,
    detail: snapLatest,
  },
  {
    key: 'brokerSync', task: 'BrokerSyncEvening',
    skip: !isWeekday,                          // weekend: no broker sync is expected
    due: mins >= 18 * 60 + 40,                 // 18:40, after the evening sync
    fresh: bsDate === today && brokersOk,
    detail: `${bsDate}${brokersOk ? '' : ' upstox/dhan!ok'}`,
  },
];

const parts = [];
let reruns = 0;
for (const j of jobs) {
  if (j.skip)      { parts.push(`${j.key}=n/a`); continue; }
  if (j.fresh)     { parts.push(`${j.key}=ok(${j.detail})`); continue; }
  if (!j.due)      { parts.push(`${j.key}=pending(${j.detail})`); continue; }
  if (state[j.key] === today) { parts.push(`${j.key}=STALE(${j.detail}) already-reran-today`); continue; }
  // stale + due + not yet re-run today → heal via its own task
  if (DRY) { parts.push(`${j.key}=STALE(${j.detail}) would-rerun ${j.task}`); continue; }
  try {
    execSync(`schtasks /Run /TN "${j.task}"`, { stdio: 'ignore' });
    state[j.key] = today;
    reruns++;
    parts.push(`${j.key}=RERAN(${j.detail})->${j.task}`);
  } catch (e) {
    parts.push(`${j.key}=RERUN-FAILED(${String(e.message || e).slice(0, 60)})`);
  }
}

if (!DRY) writeFileSync(STATE_PATH, JSON.stringify(state) + '\n');
process.stdout.write(`${today} ${hhmm} daily-check: ${parts.join(' ')}${reruns ? ` -> ${reruns} rerun(s)` : ''}${DRY ? '  [dry]' : ''}\n`);
