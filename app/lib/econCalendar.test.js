// Tests for the econ-calendar pure helpers: India release computation (cadence-
// driven) and the ForexFactory mapper. Fixed `now` so dates are deterministic.
import { describe, it, expect } from 'vitest';
import { indiaReleases, mapForexFactory, RBI_MPC_DATES } from './econCalendar.js';

const NOW = new Date('2026-06-22T10:00:00Z'); // a Monday mid-June

describe('indiaReleases — computed from the publication cadence', () => {
  const ev = indiaReleases(NOW, 45); // window: 2026-06-22 → 2026-08-06

  it('emits next CPI + IIP on the ~12th for the right reference months', () => {
    const cpi = ev.find((e) => e.title.startsWith('CPI'));
    expect(cpi).toMatchObject({ date: '2026-07-12', title: 'CPI inflation (Jun)', impact: 'high', region: 'india' });
    const iip = ev.find((e) => e.title.startsWith('IIP'));
    expect(iip).toMatchObject({ date: '2026-07-12', title: 'IIP (May)', impact: 'medium' });
  });

  it('emits WPI on the ~14th', () => {
    expect(ev.find((e) => e.title.startsWith('WPI'))).toMatchObject({ date: '2026-07-14', title: 'WPI inflation (Jun)' });
  });

  it('includes an in-window RBI MPC decision and excludes past/far dates', () => {
    expect(ev.find((e) => e.title === 'RBI MPC decision')?.date).toBe('2026-08-06');
    expect(ev.every((e) => e.date >= '2026-06-22' && e.date <= '2026-08-06')).toBe(true);
    expect(ev.find((e) => e.date === '2026-06-12')).toBeUndefined(); // last month's CPI already passed
  });

  it('is sorted ascending, high-impact first on a tie', () => {
    const dates = ev.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
    const jul12 = ev.filter((e) => e.date === '2026-07-12');
    expect(jul12[0].impact).toBe('high'); // CPI(high) before IIP(medium)
  });

  it('no GDP in this short window (next release is end-Aug, out of range)', () => {
    expect(ev.find((e) => e.title.startsWith('GDP'))).toBeUndefined();
  });

  it('RBI_MPC_DATES are maintained ISO dates', () => {
    expect(RBI_MPC_DATES.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });
});

describe('mapForexFactory — normalise the keyless FF feed', () => {
  const feed = [
    { title: 'FOMC Statement', country: 'USD', date: '2026-06-23T14:00:00-04:00', impact: 'High', forecast: '', previous: '' },
    { title: 'CPI m/m', country: 'USD', date: '2026-06-24T08:30:00-04:00', impact: 'High', forecast: '0.2%', previous: '0.1%' },
    { title: 'Loan Prime Rate', country: 'CNY', date: '2026-06-23T01:15:00-04:00', impact: 'High', forecast: '3.0%', previous: '3.0%' },
    { title: 'Stale print', country: 'USD', date: '2026-06-01T08:30:00-04:00', impact: 'Low', forecast: '', previous: '' },
    { title: 'Far print', country: 'USD', date: '2026-08-01T08:30:00-04:00', impact: 'Low', forecast: '', previous: '' },
    { title: 'junk' },
  ];

  it('keeps only upcoming in-horizon US events, mapped + sorted', () => {
    const out = mapForexFactory(feed, NOW, { horizonDays: 14 });
    expect(out.map((e) => e.title)).toEqual(['FOMC Statement', 'CPI m/m']);
    expect(out[1]).toMatchObject({ date: '2026-06-24', impact: 'high', forecast: '0.2%', previous: '0.1%', country: 'USD', region: 'us' });
    expect(out[0].forecast).toBeNull(); // '' → null
  });

  it('excludes non-US unless includeGlobalHigh, then includes high-impact only', () => {
    expect(mapForexFactory(feed, NOW, { horizonDays: 14 }).find((e) => e.country === 'CNY')).toBeUndefined();
    const g = mapForexFactory(feed, NOW, { horizonDays: 14, includeGlobalHigh: true });
    expect(g.find((e) => e.country === 'CNY')?.title).toBe('Loan Prime Rate');
  });

  it('tolerates junk / non-array input', () => {
    expect(mapForexFactory(null, NOW)).toEqual([]);
    expect(mapForexFactory(feed, NOW, { horizonDays: 14 }).every((e) => e.title)).toBe(true);
  });
});
