// Completeness / gap report (plan v2 §6) — pure functions over the manifest +
// the F&O ledger. The expectation model comes from each parser's `expects`
// cadence; the F&O side is driven by the LEDGER's actual traded days (a
// contract note is expected exactly where the broker sync recorded realised
// activity — holidays and idle days are excluded by construction, which is
// stricter and truer than a market-hours calendar sweep). Gaps are REPORTED,
// not discovered at ITR time.

import { passRows } from './manifest.mjs';

export const monthOf = (iso) => String(iso || '').slice(0, 7);

// months from..to inclusive, as 'YYYY-MM'
export function monthRange(fromMonth, toMonth) {
  const out = [];
  let [y, m] = String(fromMonth).split('-').map(Number);
  const [ty, tm] = String(toMonth).split('-').map(Number);
  if (!y || !m || !ty || !tm) return out;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ── contract notes: expected per (broker, traded day) ─────────────────────────
// ledgerRows = data/fno-ledger.json rows {date, broker, grossRealised, orders}.
// A traded day = any realised P&L or orders recorded. sinceIso bounds the sweep
// (backfill coverage grows backwards as (h) ingests history).
export function expectedNoteDays(ledgerRows, sinceIso) {
  const expected = new Set();
  for (const r of ledgerRows || []) {
    if (!r?.date || !r?.broker) continue;
    if (sinceIso && r.date < sinceIso) continue;
    if (Math.abs(r.grossRealised || 0) < 0.005 && !(r.orders > 0)) continue;
    expected.add(`${r.broker.toLowerCase()}|${r.date}`);
  }
  return expected;
}

export function coveredNoteDays(manifest) {
  const covered = new Set();
  for (const r of passRows(manifest)) {
    if (r.parser !== 'contract-note') continue;
    const d = r.meta?.date, b = r.meta?.broker;
    if (d && b) covered.add(`${b.toLowerCase()}|${d}`);
  }
  return covered;
}

export function noteGaps(ledgerRows, manifest, sinceIso) {
  const expected = expectedNoteDays(ledgerRows, sinceIso);
  const covered = coveredNoteDays(manifest);
  const gaps = [...expected].filter((k) => !covered.has(k)).sort();
  return {
    expected: expected.size,
    covered: [...expected].filter((k) => covered.has(k)).length,
    gaps: gaps.map((k) => { const [broker, date] = k.split('|'); return { broker, date }; }),
  };
}

// ── monthly docs (payslip, cas-mf): one PASS per month ────────────────────────
// keyMonth pulls the month out of a PASS row for that parser. Baseline: the
// caller's sinceMonth, else the earliest PASS (no baseline → report as such).
export function monthlyGaps(manifest, parserId, { sinceMonth, nowMonth, keyMonth }) {
  const months = new Set();
  for (const r of passRows(manifest)) {
    if (r.parser !== parserId) continue;
    const m = keyMonth(r);
    if (m) months.add(m);
  }
  const first = sinceMonth || [...months].sort()[0];
  if (!first) return { baseline: null, expected: 0, covered: 0, gaps: [] };
  const expected = monthRange(first, nowMonth);
  const gaps = expected.filter((m) => !months.has(m));
  return { baseline: first, expected: expected.length, covered: expected.length - gaps.length, gaps };
}

export const payslipMonth = (r) => r.naturalKey;                        // YYYY-MM
export const casMonth = (r) => monthOf(String(r.naturalKey).split('_')[1]); // period END month

// ── ITR: one per AY once its filing window has closed ────────────────────────
// AY N covers FY (N-1)..N; the belated-filing window closes 31 Dec of year N.
// We expect AYs from sinceAy..the last AY whose Dec-31 has passed.
export function itrGaps(manifest, { sinceAy, now }) {
  const have = new Set(
    passRows(manifest).filter((r) => r.parser === 'itr-json')
      .map((r) => (String(r.naturalKey).match(/^AY(\d{4})/) || [])[1]).filter(Boolean),
  );
  const nowY = now.getUTCFullYear();
  const lastClosedAy = now.getUTCMonth() === 11 && now.getUTCDate() === 31 ? nowY : nowY - 1;
  const gaps = [];
  for (let y = sinceAy; y <= lastClosedAy; y++) if (!have.has(String(y))) gaps.push(`AY${y}-${String((y + 1) % 100).padStart(2, '0')}`);
  return { covered: have.size, gaps };
}

// ── staleness: days since the last PASS per parser vs its cadence ─────────────
const STALE_AFTER_DAYS = { 'per-trading-day': 4, monthly: 40, annual: 400 };

export function staleness(manifest, parsers, now) {
  const out = [];
  for (const p of parsers) {
    const rows = passRows(manifest).filter((r) => r.parser === p.id);
    const last = rows.map((r) => r.ts).sort().at(-1) || null;
    const limit = STALE_AFTER_DAYS[p.expects?.cadence] ?? 60;
    const age = last ? Math.floor((now - new Date(last)) / 86400000) : null;
    out.push({
      parser: p.id, cadence: p.expects?.cadence, lastPass: last, ageDays: age,
      stale: last ? age > limit : rows.length === 0,   // never-passed = stale by definition
    });
  }
  return out;
}

// ── the whole report ──────────────────────────────────────────────────────────
export function buildReport({ manifest, ledgerRows, parsers, now = new Date(), since = {} }) {
  const nowMonth = now.toISOString().slice(0, 7);
  return {
    asOf: now.toISOString(),
    contractNotes: noteGaps(ledgerRows, manifest, since.notesIso),
    payslips: monthlyGaps(manifest, 'payslip', { sinceMonth: since.payslipMonth, nowMonth, keyMonth: payslipMonth }),
    cas: monthlyGaps(manifest, 'cas-mf', { sinceMonth: since.casMonth, nowMonth, keyMonth: casMonth }),
    itr: itrGaps(manifest, { sinceAy: since.itrAy ?? 2024, now }),
    staleness: staleness(manifest, parsers, now),
  };
}
