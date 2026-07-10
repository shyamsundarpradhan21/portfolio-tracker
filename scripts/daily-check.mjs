// Daily-job checker — the self-heal + visibility layer for the ONCE-A-DAY jobs
// (supervisor.ps1 covers the always-on/windowed daemons; this covers the one-shots).
//
// It verifies each daily job's OUTPUT is fresh for today rather than trusting that the
// scheduled task "ran" — a task can report success while its data went stale (Upstox
// fetch failed inside a "successful" evening sync, 2026-07-10), or never fire at all
// (DailyNetworthSnapshot is Interactive + needs a browser, so a 07:00 trigger while the
// laptop is asleep evaporates). A stale+due job is re-triggered via its OWN scheduled task
// (identical to how Task Scheduler launches it).
//
// LATCHED, so it behaves like the DAILY job it guards rather than the hourly tick it rides
// on: the supervisor invokes it ~1/hour for resilience (catch a miss whenever the box is on,
// since it reboots), but each job is acted on / logged only on a TRANSITION —
//   pending → CONFIRMED (fresh) | RERAN (stale, re-run once) | STILL-STALE (re-run didn't take)
// Once resolved for the day it goes SILENT (no output → nothing appended to the checker log).
// Result: ~one line per job per day, not 24 "ok"s — the frequent check stays as a cheap safety
// net (two file-reads when nothing's wrong) without the hourly noise. Re-run stays capped at
// 1/day/job, so a persistently-down job is flagged once, not spammed.
//
//   node scripts/daily-check.mjs              # check + heal; prints a line only on a transition
//   CHECK_DRY=1 node scripts/daily-check.mjs  # print what it WOULD do; never triggers/latches

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

// Per-job latch: { <job>: { confirmed, reran, flagged } } — each a 'YYYY-MM-DD' marking the
// last date that transition fired, so we act/log once per day and then stay quiet.
const STATE_PATH = join(ROOT, 'scripts', 'daily-check.state');
const state = readJSON(STATE_PATH, {});
const mark = (k) => (state[k] ||= {});

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

const events = [];   // only TRANSITIONS land here → the log stays quiet the rest of the day
for (const j of jobs) {
  const s = mark(j.key);
  if (j.skip) continue;                        // not expected today (weekend) — silent
  if (s.confirmed === today) continue;         // already fresh for today — latched, silent
  if (!j.due) continue;                        // not due yet — silent (no hourly "pending")

  if (j.fresh) {
    if (!DRY) s.confirmed = today;             // latch: confirm once, then quiet till tomorrow
    events.push(`${j.key}=CONFIRMED(${j.detail})`);
    continue;
  }
  // stale + due
  if (DRY) { events.push(`${j.key}=STALE(${j.detail}) would-rerun ${j.task}`); continue; }
  if (s.reran !== today) {                     // first stale sighting today → heal once
    try {
      execSync(`schtasks /Run /TN "${j.task}"`, { stdio: 'ignore' });
      s.reran = today;
      events.push(`${j.key}=STALE(${j.detail}) -> re-ran ${j.task}`);
    } catch (e) {
      events.push(`${j.key}=RERUN-FAILED(${String(e.message || e).slice(0, 60)})`);
    }
  } else if (s.flagged !== today) {            // re-ran earlier but still stale → flag once
    s.flagged = today;
    events.push(`${j.key}=STILL-STALE(${j.detail}) after re-run — needs attention`);
  }                                            // else: already flagged today — silent
}

if (!DRY) writeFileSync(STATE_PATH, JSON.stringify(state) + '\n');
// Print (→ appended to the checker log) ONLY when something transitioned. No events = silence.
if (events.length || DRY) {
  process.stdout.write(`${today} ${hhmm} daily-check: ${events.join(' ') || 'all quiet'}${DRY ? '  [dry]' : ''}\n`);
}
