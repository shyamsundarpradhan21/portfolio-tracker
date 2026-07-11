// Shared schedule-health core — the job manifest (metadata) + a pure staleness classifier
// and fingerprint extractors. THREE consumers share this one source of "how a job's
// freshness is read", so none of them can drift on it:
//   - scripts/schedule-health.mjs — the CLI freshness surface (reads local files).
//   - app/api/snapshot/route.js   — the nightly cloud cron: NOTIFY (Telegram) on a critical
//                                   STALE; covers the laptop being OFF.
//   - scripts/daily-check.mjs     — the laptop-side SELF-HEAL: re-runs a stale one-shot task;
//                                   covers the laptop being ON. Shares the extractors but keeps
//                                   its own strict-same-day policy (it re-triggers today's run,
//                                   so a cadence tolerance would be wrong for it).

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── fingerprint extractors (pure; each caller feeds them its own parsed JSON) ──
export const maxDateKey = (obj) => obj ? Object.keys(obj).filter((k) => DATE_RE.test(k)).sort().at(-1) ?? null : null;
export const maxRowDate = (rows) => Array.isArray(rows)
  ? rows.map((r) => r?.date).filter((d) => DATE_RE.test(d)).sort().at(-1) ?? null : null;
export const isoDate = (ts) => (typeof ts === 'string' && DATE_RE.test(ts.slice(0, 10))) ? ts.slice(0, 10) : null;
export const firstDate = (obj, keys) => {
  if (!obj) return null;
  for (const k of keys) { const d = isoDate(obj[k]); if (d) return d; }
  return null;
};

// ── staleness ──
// ageDays(dateStr, today) → whole days, floored at 0; null for no fingerprint.
export const ageDays = (d, today) => d ? Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000)) : null;
// classify → 'ok' | 'STALE' | 'unknown' vs maxAgeDays, measured from `today` (YYYY-MM-DD).
export const classify = (d, maxAgeDays, today) => d == null ? 'unknown' : (ageDays(d, today) <= maxAgeDays ? 'ok' : 'STALE');

// ── the machine-checkable schedule inventory (metadata only; each caller supplies the
// fingerprint per id). maxAgeDays: daily jobs run 7d/wk → 2; market-gated jobs skip
// weekends/holidays → 4 (covers a long weekend). ──
export const JOB_META = [
  { id: 'vercel-snapshot',         label: '/api/snapshot · growth cron',        where: 'Vercel',       cadence: 'daily 03:00 IST',          maxAgeDays: 2, critical: true },
  { id: 'daily-networth-snapshot', label: 'DailyMorning · snapshot',            where: 'laptop',       cadence: 'daily 08:55 IST',          maxAgeDays: 2, critical: true },
  { id: 'daily-broker-sync',       label: 'DailyMorning · holdings',            where: 'laptop',       cadence: 'daily 08:55 IST',          maxAgeDays: 2, critical: true },
  { id: 'fno-realised',            label: 'DailyEvening + cloud · F&O realised', where: 'laptop+cloud', cadence: 'weekdays 18:40 IST',       maxAgeDays: 4, critical: true },
  { id: 'capture-in-fno',          label: 'CaptureIntradayIndia · F&O tape',    where: 'laptop',       cadence: 'market days 09:13–15:32',  maxAgeDays: 4, critical: false },
  { id: 'capture-in-eq',           label: 'CaptureIntradayIndia · equity tape', where: 'laptop',       cadence: 'market days 09:13–15:32',  maxAgeDays: 4, critical: false },
  { id: 'capture-us',              label: 'CaptureIntradayUS · US tape',        where: 'laptop',       cadence: 'market days 18:45→02:30',   maxAgeDays: 4, critical: false },
  { id: 'ingest-daemon',           label: 'IngestDaemon · Gmail → notes',       where: 'laptop',       cadence: 'always-on',                maxAgeDays: 7, critical: false,
    note: 'gitignored (laptop-local) — resolves only on the laptop' },
  { id: 'premarket-trail',         label: '/api/premarket · FII/DII trail',     where: 'Vercel',       cadence: 'folded into /api/snapshot', maxAgeDays: 3, critical: false,
    note: 'no separate cron — the snapshot cron builds the trail; premarket is the live route' },
];
