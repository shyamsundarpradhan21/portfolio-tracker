#!/usr/bin/env node
// schedule-health.mjs — one freshness surface for every scheduled job.
//
// The whole point (see tasks/todo.md "Minimalism across all scheduled tasks"): every
// durable job already leaves a DATED FINGERPRINT in a committed artifact — a date key,
// a `syncedAt`, an `updatedAt`. This reads those and reports, per job, whether the
// newest thing it produced is within its expected cadence. No new infra, no monitoring
// stack — just the fingerprints that already exist. Turns a silent 3-week freeze into a
// one-glance STALE. The JOB manifest + classifier are shared with the cloud alerter
// (app/api/snapshot) via scripts/lib/scheduleHealth.mjs — one manifest, no cadence drift.
//
// Blind spots are reported HONESTLY as `unknown` (never a false `ok`): the gitignored
// laptop-local files (gmail-state / fno-overlay) and the KV-only premarket trail aren't
// visible from the committed repo, so this check can't see them from a fresh clone.
//
//   node scripts/schedule-health.mjs          # table + summary; exit 1 if any critical STALE
//   node scripts/schedule-health.mjs --json    # machine-readable (for the app strip / alerter)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JOB_META, classify, ageDays, DATE_RE, maxDateKey, maxRowDate, isoDate, firstDate } from './lib/scheduleHealth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => {
  try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); }
  catch { return null; }                       // missing / gitignored / unparseable → null
};

// today (UTC) as the staleness reference; printed in the header so the basis is transparent.
// HEALTH_TODAY=YYYY-MM-DD overrides it — for testing the STALE path and for "what was stale as of date X".
const TODAY = DATE_RE.test(process.env.HEALTH_TODAY || '') ? process.env.HEALTH_TODAY : new Date().toISOString().slice(0, 10);

// fingerprint extractors keyed by job id (local-file reads; the shared manifest is metadata-only).
const FP = {
  'vercel-snapshot': () => maxDateKey(readJson('data/growth.json')?.days),
  'daily-networth-snapshot': () => maxDateKey(readJson('data/snapshot-sleeves.json')),
  'daily-broker-sync': () => isoDate(readJson('data/broker-state.json')?.syncedAt),
  'fno-realised': () => maxRowDate(readJson('data/fno-ledger.json')?.rows),
  'capture-in-fno': () => isoDate(readJson('data/fno-intraday.json')?.updatedAt),
  'capture-in-eq': () => isoDate(readJson('data/eq-intraday.json')?.updatedAt),
  'capture-us': () => isoDate(readJson('data/us-intraday.json')?.updatedAt),
  'ingest-daemon': () => firstDate(readJson('data/gmail-state.json'), ['lastProcessedAt', 'lastProcessed', 'updatedAt', 'ts']),
  'premarket-trail': () => null,
};

// ── evaluate ─────────────────────────────────────────────────────────────────
const rows = JOB_META.map((j) => {
  const last = (FP[j.id] || (() => null))();
  return { ...j, last, age: ageDays(last, TODAY), status: classify(last, j.maxAgeDays, TODAY) };
});

const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
const failed = rows.some((r) => r.critical && r.status === 'STALE');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ today: TODAY, ok: !failed, counts, jobs: rows }, null, 2));
  process.exit(failed ? 1 : 0);
}

// ── render ───────────────────────────────────────────────────────────────────
const GLYPH = { ok: '\x1b[32m ok  \x1b[0m', STALE: '\x1b[31mSTALE\x1b[0m', unknown: '\x1b[90m  ?  \x1b[0m' };
const pad = (s, n) => String(s).padEnd(n);
const w = Math.max(...rows.map((r) => r.label.length));

console.log(`\nSchedule health · reference today = ${TODAY} (UTC)\n`);
for (const r of rows) {
  const ageStr = r.last ? `${r.age}d ago` : '—';
  console.log(`  ${GLYPH[r.status]}  ${pad(r.label, w)}  ${pad(r.last ?? 'no fingerprint', 12)}  ${pad(ageStr, 8)}  ${r.cadence}`);
  if (r.note && r.status !== 'ok') console.log(`         ${pad('', w)}  \x1b[90m↳ ${r.note}\x1b[0m`);
}
console.log(`\n  ${counts.ok || 0} ok · ${counts.STALE || 0} stale · ${counts.unknown || 0} unknown` +
  (failed ? '   \x1b[31m← critical job STALE\x1b[0m' : '') + '\n');

process.exit(failed ? 1 : 0);
