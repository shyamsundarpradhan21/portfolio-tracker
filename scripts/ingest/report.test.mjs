// Completeness-report tests — includes the phase-(i) proof encoded as a unit
// test: a deliberately-missing month/day MUST be flagged.

import { describe, it, expect } from 'vitest';
import { emptyManifest, appendRow } from './manifest.mjs';
import {
  monthRange, expectedNoteDays, noteGaps, monthlyGaps, payslipMonth, casMonth,
  itrGaps, staleness, buildReport,
} from './report.mjs';

const sha = (s) => s.padEnd(64, '0');
const pass = (m, parser, naturalKey, extra = {}) =>
  appendRow(m, { file: `${parser}-${naturalKey}`, sha256: sha(naturalKey), source: 'manual', status: 'PASS', parser, naturalKey, ...extra });

describe('monthRange', () => {
  it('inclusive, year-rolling', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-03', '2026-03')).toEqual(['2026-03']);
    expect(monthRange('bad', '2026-03')).toEqual([]);
  });
});

describe('contract-note gaps', () => {
  const ledger = [
    { date: '2026-06-30', broker: 'Dhan', grossRealised: 100 },
    { date: '2026-07-01', broker: 'Dhan', grossRealised: -50 },
    { date: '2026-07-01', broker: 'Upstox', grossRealised: 20 },
    { date: '2026-07-01', broker: 'Fyers', grossRealised: 0, orders: 0 },   // idle → not expected
    { date: '2026-05-01', broker: 'Dhan', grossRealised: 10 },              // before since → excluded
  ];
  it('expects one note per traded (broker, day); idle days excluded', () => {
    const e = expectedNoteDays(ledger, '2026-06-01');
    expect(e.has('dhan|2026-06-30')).toBe(true);
    expect(e.has('upstox|2026-07-01')).toBe(true);
    expect(e.has('fyers|2026-07-01')).toBe(false);
    expect(e.has('dhan|2026-05-01')).toBe(false);
    expect(e.size).toBe(3);
  });
  it('flags the deliberately-missing day (phase-i proof)', () => {
    const m = emptyManifest();
    pass(m, 'contract-note', 'CN1', { meta: { date: '2026-06-30', broker: 'dhan' } });
    pass(m, 'contract-note', 'CN2', { meta: { date: '2026-07-01', broker: 'upstox' } });
    // dhan 2026-07-01 deliberately NOT ingested
    const r = noteGaps(ledger, m, '2026-06-01');
    expect(r.expected).toBe(3);
    expect(r.covered).toBe(2);
    expect(r.gaps).toEqual([{ broker: 'dhan', date: '2026-07-01' }]);
  });
  it('broker case-insensitive matching', () => {
    const m = emptyManifest();
    pass(m, 'contract-note', 'CN1', { meta: { date: '2026-06-30', broker: 'Dhan' } });
    expect(noteGaps([{ date: '2026-06-30', broker: 'dhan', grossRealised: 1 }], m).gaps).toEqual([]);
  });
});

describe('monthly gaps (payslip / cas)', () => {
  it('flags the deliberately-missing month (phase-i proof)', () => {
    const m = emptyManifest();
    pass(m, 'payslip', '2026-04');
    pass(m, 'payslip', '2026-06');            // 2026-05 missing
    const r = monthlyGaps(m, 'payslip', { nowMonth: '2026-07', keyMonth: payslipMonth });
    expect(r.baseline).toBe('2026-04');
    expect(r.gaps).toEqual(['2026-05', '2026-07']);
  });
  it('cas month comes from the period END inside the naturalKey', () => {
    const m = emptyManifest();
    pass(m, 'cas-mf', '2026-06-01_2026-06-30-abcd1234');
    const r = monthlyGaps(m, 'cas-mf', { nowMonth: '2026-06', keyMonth: casMonth });
    expect(r.gaps).toEqual([]);
    expect(r.covered).toBe(1);
  });
  it('no baseline → honest empty report, not fake gaps', () => {
    const r = monthlyGaps(emptyManifest(), 'payslip', { nowMonth: '2026-07', keyMonth: payslipMonth });
    expect(r).toEqual({ baseline: null, expected: 0, covered: 0, gaps: [] });
  });
});

describe('itr gaps', () => {
  it('expects each AY whose belated window (31 Dec) closed', () => {
    const m = emptyManifest();
    pass(m, 'itr-json', 'AY2024-25-ITR3');
    pass(m, 'itr-json', 'AY2025-26-ITR3');
    // as of mid-2026: AY2026-27's window hasn't closed → not yet expected
    const r = itrGaps(m, { sinceAy: 2024, now: new Date('2026-07-02T12:00:00Z') });
    expect(r.gaps).toEqual([]);
    const r2 = itrGaps(emptyManifest(), { sinceAy: 2024, now: new Date('2026-07-02T12:00:00Z') });
    expect(r2.gaps).toEqual(['AY2024-25', 'AY2025-26']);
  });
});

describe('staleness', () => {
  const parsers = [
    { id: 'contract-note', expects: { cadence: 'per-trading-day' } },
    { id: 'payslip', expects: { cadence: 'monthly' } },
  ];
  it('flags never-passed and over-age parsers', () => {
    const m = emptyManifest();
    appendRow(m, { file: 'x', sha256: sha('a'), source: 'manual', status: 'PASS', parser: 'contract-note', naturalKey: 'CN1', ts: '2026-06-20T10:00:00Z' });
    const s = staleness(m, parsers, new Date('2026-07-02T10:00:00Z'));
    const cn = s.find((x) => x.parser === 'contract-note');
    expect(cn.ageDays).toBe(12);
    expect(cn.stale).toBe(true);              // > 4 trading-day cadence limit
    expect(s.find((x) => x.parser === 'payslip').stale).toBe(true);  // never passed
  });
  it('fresh PASS is not stale', () => {
    const m = emptyManifest();
    appendRow(m, { file: 'x', sha256: sha('a'), source: 'manual', status: 'PASS', parser: 'payslip', naturalKey: '2026-06', ts: '2026-06-28T10:00:00Z' });
    const s = staleness(m, parsers, new Date('2026-07-02T10:00:00Z'));
    expect(s.find((x) => x.parser === 'payslip').stale).toBe(false);
  });
});

describe('buildReport', () => {
  it('assembles all sections', () => {
    const m = emptyManifest();
    pass(m, 'payslip', '2026-06');
    const r = buildReport({
      manifest: m,
      ledgerRows: [{ date: '2026-07-01', broker: 'Dhan', grossRealised: 5 }],
      parsers: [{ id: 'payslip', expects: { cadence: 'monthly' } }],
      now: new Date('2026-07-02T10:00:00Z'),
    });
    expect(r.contractNotes.expected).toBe(1);
    expect(r.contractNotes.gaps).toHaveLength(1);
    expect(r.payslips.gaps).toEqual(['2026-07']);
    expect(r.itr.gaps.length).toBeGreaterThan(0);
    expect(r.staleness).toHaveLength(1);
  });
});
