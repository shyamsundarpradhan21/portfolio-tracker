// Tests for the Trading-tab P&L dashboard aggregation. Expected values are worked
// out by hand from the fixture so a sign flip, a double-count across brokers, or a
// wrong FY/streak boundary fails here rather than shipping to the dashboard.
import { describe, it, expect } from 'vitest';
import {
  dailySeries, summaryStats, quantileBuckets, monthMatrix, monthlyRollup, fyOf,
} from './pnlDaily.js';

const rows = [
  // 2026-06-12 has TWO brokers → must merge into one day
  { date: '2026-04-10', broker: 'Dhan',   sleeve: 'S01', grossRealised: -47080, estCharges: 2898, net: -49978, orders: 56 },
  { date: '2026-05-12', broker: 'Upstox', sleeve: 'S02', grossRealised: 31258,  estCharges: 4674, net: 26584,  orders: 92 },
  { date: '2026-06-12', broker: 'Fyers',  sleeve: 'S02', grossRealised: 50000,  estCharges: 2522, net: 47478,  orders: 40 },
  { date: '2026-06-12', broker: 'Dhan',   sleeve: 'S01', grossRealised: 5200,   estCharges: 200,  net: 5000,   orders: 8  },
  { date: '2026-06-23', broker: 'Dhan',   sleeve: 'S01', grossRealised: 15714,  estCharges: 0,    net: 15714,  orders: 11 },
];

describe('dailySeries — broker merge + sort', () => {
  const s = dailySeries(rows);
  it('collapses to one row per date, ascending', () =>
    expect(s.map((d) => d.date)).toEqual(['2026-04-10', '2026-05-12', '2026-06-12', '2026-06-23']));
  it('sums both brokers on 2026-06-12 (47478 + 5000 = 52478; orders 48)', () => {
    const d = s.find((x) => x.date === '2026-06-12');
    expect(d.net).toBe(52478);
    expect(d.orders).toBe(48);
  });
  it('drops rows with no date', () =>
    expect(dailySeries([{ net: 5 }, ...rows]).length).toBe(4));
});

describe('summaryStats — totals, win%, streaks', () => {
  const st = summaryStats(dailySeries(rows));
  it('net = -49978 + 26584 + 52478 + 15714 = 44798', () => expect(st.net).toBe(44798));
  it('3 win / 1 loss day → 75%', () => { expect(st.winDays).toBe(3); expect(st.lossDays).toBe(1); expect(st.winPct).toBe(75); });
  it('most profitable day is the merged 2026-06-12 at 52478', () =>
    expect(st.mostProfit).toEqual({ date: '2026-06-12', net: 52478 }));
  it('orders total 207, avg over 4 days', () => { expect(st.orders).toBe(207); expect(st.tradingDays).toBe(4); });
  it('best profit streak = 3 (May→Jun12→Jun23), current = 3 wins', () => {
    expect(st.bestStreak).toBe(3); expect(st.currentStreak).toBe(3); expect(st.currentStreakWin).toBe(true);
  });
  it('empty series is all-zero, not NaN', () => {
    const z = summaryStats([]); expect(z.net).toBe(0); expect(z.winPct).toBe(0); expect(z.mostProfit).toBe(null);
  });
});

describe('quantileBuckets — relative to own distribution', () => {
  const b = quantileBuckets(dailySeries(rows));
  it('the loss day is negative, all profit days positive', () => {
    expect(b.get('2026-04-10')).toBeLessThan(0);
    expect(b.get('2026-05-12')).toBeGreaterThan(0);
    expect(b.get('2026-06-12')).toBeGreaterThan(0);
  });
  it('biggest profit day gets the top profit tercile (3)', () =>
    expect(b.get('2026-06-12')).toBe(3));
});

describe('fyOf — Indian FY boundary at Apr 1', () => {
  it('Mar 31 stays in the prior FY', () => expect(fyOf('2026-03-31')).toBe('FY 25-26'));
  it('Apr 1 starts the new FY', () => expect(fyOf('2026-04-01')).toBe('FY 26-27'));
});

describe('monthMatrix — Sun-first calendar', () => {
  const wk = monthMatrix(2026, 5); // June 2026, 1st is a Monday
  it('5 weeks, first row has a leading blank then 01 on Monday', () => {
    expect(wk.length).toBe(5);
    expect(wk[0][0]).toBe(null);
    expect(wk[0][1]).toBe('2026-06-01');
  });
  it('every non-null cell is a valid ISO in-month', () =>
    expect(wk.flat().filter(Boolean).every((d) => d.startsWith('2026-06-'))).toBe(true));
});

describe('monthlyRollup — newest first', () => {
  const m = monthlyRollup(dailySeries(rows));
  it('orders by month descending', () => expect(m.map((x) => x.ym)).toEqual(['2026-06', '2026-05', '2026-04']));
  it('June net = 52478 + 15714 = 68192 over 2 days', () => {
    const jun = m.find((x) => x.ym === '2026-06'); expect(jun.net).toBe(68192); expect(jun.days).toBe(2);
  });
});
