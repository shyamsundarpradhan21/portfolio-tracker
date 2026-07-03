// Completeness-report tests — includes the phase-(i) proof encoded as a unit
// test: a deliberately-missing month/day MUST be flagged.

import { describe, it, expect } from 'vitest';
import { emptyManifest, appendRow } from './manifest.mjs';
import {
  monthRange, expectedNoteDays, noteGaps, monthlyGaps, payslipMonth, casMonth,
  itrGaps, staleness, buildReport, reasonClass, unresolvedTally,
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

describe('unresolved intake (FAIL + UNRECOGNIZED accumulation)', () => {
  const fail = (m, parser, file, reason, ts) =>
    appendRow(m, { file, sha256: sha(file), source: 'manual', status: 'FAIL', parser, reason, ...(ts ? { ts } : {}) });
  const fail2 = (m, parser, file, key, reason, ts) =>   // FAIL carrying a naturalKey (real CN rows do)
    appendRow(m, { file, sha256: sha(file), source: 'manual', status: 'FAIL', parser, naturalKey: key, reason, ...(ts ? { ts } : {}) });
  const unrec = (m, file, ts) =>
    appendRow(m, { file, sha256: sha(file), source: 'manual', status: 'UNRECOGNIZED', reason: 'no parser claimed the file', ...(ts ? { ts } : {}) });

  it('classifies fail reasons into coarse buckets (real manifest reasons)', () => {
    expect(reasonClass('REFUSED: checksum FAIL')).toBe('checksum-fail');
    expect(reasonClass("account 1: balance 874.5 != sum(values) 0 (holdings don't reconcile)")).toBe('reconcile-fail');
    expect(reasonClass('no CAS_PW_* decrypts')).toBe('password/decrypt');
    expect(reasonClass('no CAS_PW_* in scripts/cas-parser/.env')).toBe('password/decrypt');
    expect(reasonClass('CDSL depository CAS (demat holdings) — not a CAMS/KFintech MF CAS; out of scope for ledger:mf')).toBe('out-of-scope');
    expect(reasonClass('cas-parser gave no porcelain status (exit 1): Traceback (most recent call last):')).toBe('engine-error');
    expect(reasonClass('no folios parsed')).toBe('empty-parse');
    expect(reasonClass('parse-payslip --write exit 1 (slip already copied to data/reports/)')).toBe('wrapper-error');
    expect(reasonClass('something unforeseen')).toBe('other');
    expect(reasonClass(null)).toBe('unspecified');
  });

  it('groups FAIL by (parser, reason-class); UNRECOGNIZED collapse to logical files', () => {
    const m = emptyManifest();
    fail(m, 'contract-note', 'CN_A.pdf', 'REFUSED: checksum FAIL', '2026-06-01T00:00:00Z');
    fail(m, 'contract-note', 'CN_B.pdf', 'REFUSED: checksum FAIL', '2026-06-02T00:00:00Z');
    fail(m, 'cas-mf', 'MAY2023_TXN.pdf', "account 1: balance 859.5 != sum(values) 0 (holdings don't reconcile)", '2026-06-03T00:00:00Z');
    unrec(m, 'NSEFUTURES.pdf', '2026-06-04T00:00:00Z');
    unrec(m, 'deadbeef-NSEFUTURES.pdf', '2026-06-05T00:00:00Z');   // re-drop of the SAME logical file
    unrec(m, 'QR.png', '2026-06-06T00:00:00Z');

    const u = unresolvedTally(m);
    expect(u.failed.total).toBe(3);
    expect(u.failed.groups[0]).toMatchObject({ parser: 'contract-note', reasonClass: 'checksum-fail', count: 2 }); // biggest first
    expect(u.failed.groups[0].examples).toEqual(['CN_A.pdf', 'CN_B.pdf']);
    expect(u.failed.groups.find((g) => g.parser === 'cas-mf').reasonClass).toBe('reconcile-fail');

    expect(u.unrecognized.total).toBe(2);       // distinct logical files (current-state, not events)
    expect(u.unrecognized.distinct).toBe(2);    // 2 logical files (NSEFUTURES collapsed across the sha-prefix re-drop)
    const nse = u.unrecognized.files.find((f) => f.file === 'NSEFUTURES.pdf');
    expect(nse.attempts).toBe(2);               // both re-drop events still tracked as attempts
    expect(u.unrecognized.files[0].file).toBe('QR.png');  // latest-first
  });

  it('supersede: a FAIL resolved by a LATER PASS of the same naturalKey is excluded (current-state)', () => {
    const m = emptyManifest();
    // CN-1: FAILed, then re-ingested & PASSed later (different bytes) -> resolved, must NOT count
    fail2(m, 'contract-note', 'CN_A.pdf', 'CN-1', 'REFUSED: checksum FAIL', '2026-07-01T00:00:00Z');
    appendRow(m, { file: 'CN_A.pdf', sha256: sha('CN_A_v2'), source: 'reingest:fix', status: 'PASS', parser: 'contract-note', naturalKey: 'CN-1', ts: '2026-07-03T00:00:00Z' });
    // CN-2: still failing (no PASS) -> the only survivor
    fail2(m, 'contract-note', 'CN_B.pdf', 'CN-2', 'REFUSED: checksum FAIL', '2026-07-02T00:00:00Z');
    const u = unresolvedTally(m);
    expect(u.failed.total).toBe(1);   // CN-1 superseded by its later PASS; only CN-2 remains
    expect(u.failed.groups).toHaveLength(1);
    expect(u.failed.groups[0]).toMatchObject({ parser: 'contract-note', reasonClass: 'checksum-fail', count: 1 });
    expect(u.failed.groups[0].examples).toEqual(['CN_B.pdf']);
  });

  it('supersede is document-scoped: a PASS of a DIFFERENT key does not clear a failing doc', () => {
    const m = emptyManifest();
    fail2(m, 'contract-note', 'X.pdf', 'CN-9', 'REFUSED: checksum FAIL', '2026-07-01T00:00:00Z');
    appendRow(m, { file: 'Y.pdf', sha256: sha('Y'), source: 'reingest', status: 'PASS', parser: 'contract-note', naturalKey: 'CN-OTHER', ts: '2026-07-03T00:00:00Z' });
    expect(unresolvedTally(m).failed.total).toBe(1);   // CN-9 still failing; CN-OTHER's PASS is unrelated
  });

  it('re-drops of the same failing document count once (logical, not events)', () => {
    const m = emptyManifest();
    fail2(m, 'contract-note', 'CN.pdf', 'CN-1', 'REFUSED: checksum FAIL', '2026-07-01T00:00:00Z');
    fail2(m, 'contract-note', 'deadbeef-CN.pdf', 'CN-1', 'REFUSED: checksum FAIL', '2026-07-02T00:00:00Z');  // re-drop, same key
    expect(unresolvedTally(m).failed.total).toBe(1);   // 2 FAIL events, 1 logical document
  });

  it('PASS and DUP rows never enter the unresolved tally', () => {
    const m = emptyManifest();
    pass(m, 'payslip', '2026-06');
    appendRow(m, { file: 'dup.pdf', sha256: sha('d'), source: 'manual', status: 'DUP', parser: 'payslip', of: sha('x') });
    const u = unresolvedTally(m);
    expect(u).toEqual({ failed: { total: 0, groups: [] }, unrecognized: { total: 0, distinct: 0, files: [] } });
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
    expect(r.unresolved).toEqual({ failed: { total: 0, groups: [] }, unrecognized: { total: 0, distinct: 0, files: [] } });
  });
});
