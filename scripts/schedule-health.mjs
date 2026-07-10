#!/usr/bin/env node
// schedule-health.mjs — one freshness surface for every scheduled job.
//
// The whole point (see tasks/todo.md "Minimalism across all scheduled tasks"): every
// durable job already leaves a DATED FINGERPRINT in a committed artifact — a date key,
// a `syncedAt`, an `updatedAt`. This reads those and reports, per job, whether the
// newest thing it produced is within its expected cadence. No new infra, no monitoring
// stack — just the fingerprints that already exist. Turns a silent 3-week freeze into a
// one-glance STALE.
//
// Blind spots are reported HONESTLY as `unknown` (never a false `ok`): the gitignored
// laptop-local files (gmail-state / fno-overlay) and the KV-only premarket trail aren't
// visible from the committed repo, so this check can't see them from a fresh clone.
//
//   node scripts/schedule-health.mjs          # table + summary; exit 1 if any critical STALE
//   node scripts/schedule-health.mjs --json    # machine-readable (for the future app strip)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── fingerprint helpers ──────────────────────────────────────────────────────
const readJson = (rel) => {
  try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')); }
  catch { return null; }                       // missing / gitignored / unparseable → null
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const maxDateKey = (obj) => obj ? Object.keys(obj).filter((k) => DATE_RE.test(k)).sort().at(-1) ?? null : null;
const maxRowDate = (rows) => Array.isArray(rows)
  ? rows.map((r) => r?.date).filter((d) => DATE_RE.test(d)).sort().at(-1) ?? null : null;
const isoDate = (ts) => (typeof ts === 'string' && DATE_RE.test(ts.slice(0, 10))) ? ts.slice(0, 10) : null;
const firstDate = (obj, keys) => {                // first parseable date across candidate keys
  if (!obj) return null;
  for (const k of keys) { const d = isoDate(obj[k]); if (d) return d; }
  return null;
};

// today (UTC) as the staleness reference; printed in the header so the basis is transparent.
// HEALTH_TODAY=YYYY-MM-DD overrides it — for testing the STALE path and for "what was stale as of date X".
const TODAY = DATE_RE.test(process.env.HEALTH_TODAY || '') ? process.env.HEALTH_TODAY : new Date().toISOString().slice(0, 10);
const ageDays = (d) => d ? Math.max(0, Math.round((Date.parse(TODAY) - Date.parse(d)) / 86_400_000)) : null;

// ── the job manifest (this IS the machine-checkable schedule inventory) ───────
// maxAgeDays: daily jobs run 7d/wk → 2; market-gated jobs skip weekends/holidays → 4 (covers a long weekend).
const JOBS = [
  { label: '/api/snapshot · growth cron',        where: 'Vercel',      cadence: 'daily 03:00 IST',        maxAgeDays: 2, critical: true,
    fp: () => maxDateKey(readJson('data/growth.json')?.days) },
  { label: 'DailyNetworthSnapshot',              where: 'laptop',      cadence: 'daily 07:00 IST',        maxAgeDays: 2, critical: true,
    fp: () => maxDateKey(readJson('data/snapshot-sleeves.json')) },
  { label: 'DailyBrokerSync · holdings',         where: 'laptop',      cadence: 'daily 06:00 IST',        maxAgeDays: 2, critical: true,
    fp: () => isoDate(readJson('data/broker-state.json')?.syncedAt) },
  { label: 'F&O realised · evening + cloud',     where: 'laptop+cloud',cadence: 'weekdays 18:30 IST',     maxAgeDays: 4, critical: true,
    fp: () => maxRowDate(readJson('data/fno-ledger.json')?.rows) },
  { label: 'CaptureIntradayIndia · F&O tape',    where: 'laptop',      cadence: 'market days 09:13–15:32', maxAgeDays: 4, critical: false,
    fp: () => isoDate(readJson('data/fno-intraday.json')?.updatedAt) },
  { label: 'CaptureIntradayIndia · equity tape', where: 'laptop',      cadence: 'market days 09:13–15:32', maxAgeDays: 4, critical: false,
    fp: () => isoDate(readJson('data/eq-intraday.json')?.updatedAt) },
  { label: 'CaptureIntradayUS · US tape',        where: 'laptop',      cadence: 'market days 18:45→02:30', maxAgeDays: 4, critical: false,
    fp: () => isoDate(readJson('data/us-intraday.json')?.updatedAt) },
  // ── honest blind spots: not visible from the committed repo ──
  { label: 'IngestDaemon · Gmail → notes',       where: 'laptop',      cadence: 'always-on',              maxAgeDays: 7, critical: false,
    note: 'gitignored (laptop-local) — resolves only on the laptop',
    fp: () => firstDate(readJson('data/gmail-state.json'), ['lastProcessedAt', 'lastProcessed', 'updatedAt', 'ts']) },
  { label: '/api/premarket · FII/DII trail',     where: 'Vercel',      cadence: 'daily 00:30 UTC',        maxAgeDays: 3, critical: false,
    note: 'route exists but NO cron in vercel.json — trail lives in KV, not repo (drift, see todo #3)',
    fp: () => null },
];

// ── evaluate ─────────────────────────────────────────────────────────────────
const rows = JOBS.map((j) => {
  const last = j.fp();
  const age = ageDays(last);
  const status = last == null ? 'unknown' : (age <= j.maxAgeDays ? 'ok' : 'STALE');
  return { ...j, last, age, status };
});

const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
const failed = rows.some((r) => r.critical && r.status === 'STALE');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ today: TODAY, ok: failed ? false : true, counts,
    jobs: rows.map(({ fp, ...r }) => r) }, null, 2));
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
