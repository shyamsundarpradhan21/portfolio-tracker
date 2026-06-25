// Tests for the Trading-tab P&L dashboard aggregation. Expected values are worked
// out by hand from the fixture so a sign flip, a double-count across brokers, or a
// wrong FY/streak boundary fails here rather than shipping to the dashboard.
import { describe, it, expect } from 'vitest';
import {
  dailySeries, summaryStats, quantileBuckets, monthMatrix, monthlyRollup, fyOf,
  scaleIntraday, scaleCandles, mergeLiveTapes, niftyLevels,
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
  it('a flat latest day reads as no streak (0), not a 0-length win streak', () => {
    const s = summaryStats([
      { date: '2026-06-22', net: 100, gross: 100, charges: 0, orders: 1 },
      { date: '2026-06-23', net: 200, gross: 200, charges: 0, orders: 1 },
      { date: '2026-06-24', net: 0, gross: 0, charges: 0, orders: 1 }, // flat
    ]);
    expect(s.currentStreak).toBe(0);
    expect(s.currentStreakWin).toBe(true); // direction from the last non-flat (wins), but streak is 0
  });
  it('trailing losses give a loss streak', () => {
    const s = summaryStats([
      { date: '2026-06-22', net: 100, gross: 100, charges: 0, orders: 1 },
      { date: '2026-06-23', net: -50, gross: -50, charges: 0, orders: 1 },
      { date: '2026-06-24', net: -30, gross: -30, charges: 0, orders: 1 },
    ]);
    expect(s.currentStreak).toBe(2);
    expect(s.currentStreakWin).toBe(false);
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

describe('scaleIntraday — Day-view chart geometry', () => {
  it('returns null for an empty/too-short tape', () => {
    expect(scaleIntraday([], 100, 100)).toBe(null);
    expect(scaleIntraday([{ t: '09:20', net: 'x' }], 100, 100)).toBe(null);
  });
  it('always keeps 0 on-chart so the green/red split renders', () => {
    const g = scaleIntraday([{ t: '09:20', net: 100 }, { t: '09:25', net: 300 }], 100, 100, 0);
    expect(g.zeroY).toBe(100);        // 0 is the minimum → bottom of the 0..100 box
    expect(g.curY).toBe(0);           // max value → top
  });
  it('cur is the last point and ud flags its sign', () => {
    const up = scaleIntraday([{ t: '09:20', net: 5 }, { t: '15:30', net: 42 }], 200, 100);
    expect(up.cur).toBe(42); expect(up.ud).toBe(true);
    const dn = scaleIntraday([{ t: '09:20', net: 5 }, { t: '15:30', net: -42 }], 200, 100);
    expect(dn.cur).toBe(-42); expect(dn.ud).toBe(false);
  });
  it('x spans the padded width left→right', () => {
    const g = scaleIntraday([{ t: 'a', net: 1 }, { t: 'b', net: 2 }, { t: 'c', net: 3 }], 100, 100, 10);
    expect(g.pts[0].x).toBe(10);
    expect(g.pts[2].x).toBe(90);
  });
});

describe('scaleCandles — NIFTY 1-min OHLC watermark geometry', () => {
  const cs = [
    { t: '09:15', o: 100, h: 110, l: 95, c: 105 },
    { t: '09:16', o: 105, h: 108, l: 100, c: 102 },
    { t: '09:17', o: 102, h: 120, l: 101, c: 118 },
  ];
  it('returns null for too few / malformed candles', () => {
    expect(scaleCandles([], 100, 100)).toBe(null);
    expect(scaleCandles([{ t: 'a', o: 1, h: 2, l: 0, c: 'x' }, { t: 'b', o: 1, h: 2, l: 0, c: 1 }], 100, 100)).toBe(null);
  });
  it('spans the padded width left→right by index', () => {
    const g = scaleCandles(cs, 100, 100, 10);
    expect(g.bars[0].x).toBe(10);
    expect(g.bars[2].x).toBe(90);
  });
  it('maps the range high to the top and low to the bottom', () => {
    const g = scaleCandles(cs, 100, 100, 0);
    expect(g.bars[2].highY).toBe(0);    // 120 is the overall high → top
    expect(g.bars[0].lowY).toBe(100);   // 95 is the overall low → bottom
  });
  it('flags up/down candles by close vs open', () => {
    const g = scaleCandles(cs, 100, 100);
    expect(g.bars[0].up).toBe(true);    // 105 >= 100
    expect(g.bars[1].up).toBe(false);   // 102 < 105
  });
});

describe('mergeLiveTapes — Overview portfolio curve', () => {
  it('returns [] when no sleeve has data', () => {
    expect(mergeLiveTapes({})).toEqual([]);
    expect(mergeLiveTapes({ fno: [], eq: [{ t: '09:20', net: 'x' }] })).toEqual([]);
  });
  it('sums sleeves per tick, carrying each forward (0 before its first point)', () => {
    const t = mergeLiveTapes({
      fno: [{ t: '09:20', net: 100 }, { t: '09:30', net: 250 }],
      eq: [{ t: '09:30', net: 40 }],
    });
    expect(t.map((p) => [p.t, p.net, p.fno, p.eq])).toEqual([
      ['09:20', 100, 100, 0],     // eq hasn't started → 0
      ['09:30', 290, 250, 40],    // 250 + 40
    ]);
  });
  it('omits a sleeve with no points entirely (no overlay line)', () => {
    const t = mergeLiveTapes({ fno: [{ t: '09:20', net: 5 }, { t: '09:21', net: 6 }] });
    expect('us' in t[0]).toBe(false);
    expect('eq' in t[0]).toBe(false);
    expect(t[0].fno).toBe(5);
  });
  it('orders the Indian session before the US overnight (post-midnight last)', () => {
    const t = mergeLiveTapes({
      eq: [{ t: '09:20', net: 10 }, { t: '15:30', net: 20 }],
      us: [{ t: '18:45', net: 5 }, { t: '01:30', net: 8 }],
    });
    expect(t.map((p) => p.t)).toEqual(['09:20', '15:30', '18:45', '01:30']);
    // net carries the settled equity through the evening US session
    expect(t[t.length - 1].net).toBe(28); // eq 20 + us 8
  });
});

describe('monthlyRollup — newest first', () => {
  const m = monthlyRollup(dailySeries(rows));
  it('orders by month descending', () => expect(m.map((x) => x.ym)).toEqual(['2026-06', '2026-05', '2026-04']));
  it('June net = 52478 + 15714 = 68192 over 2 days', () => {
    const jun = m.find((x) => x.ym === '2026-06'); expect(jun.net).toBe(68192); expect(jun.days).toBe(2);
  });
});

describe('scaleCandles — S/R axis mapping + volume', () => {
  const cs = [
    { t: '09:15', o: 100, h: 110, l: 95, c: 105, v: 10 },
    { t: '09:16', o: 105, h: 108, l: 100, c: 102, v: 40 },
    { t: '09:17', o: 102, h: 120, l: 90, c: 118, v: 25 },
  ];
  it('exposes lo/hi and a clamped price→y mapping on the same axis as the bars', () => {
    const g = scaleCandles(cs, 100, 100, 0);
    expect(g.lo).toBe(90); expect(g.hi).toBe(120);
    expect(g.priceY(120)).toBe(0);    // hi → top
    expect(g.priceY(90)).toBe(100);   // lo → bottom
    expect(g.priceY(999)).toBe(0);    // clamped into the plot band
    expect(g.priceY(-999)).toBe(100);
  });
  it('carries per-bar volume and the day max', () => {
    const g = scaleCandles(cs, 100, 100);
    expect(g.vmax).toBe(40);
    expect(g.bars.map((b) => b.v)).toEqual([10, 40, 25]);
  });
  it('vmax is 0 and bar.v null when the feed has no volume', () => {
    const g = scaleCandles([{ t: 'a', o: 1, h: 2, l: 0, c: 1 }, { t: 'b', o: 1, h: 3, l: 0, c: 2 }], 100, 100);
    expect(g.vmax).toBe(0);
    expect(g.bars[0].v).toBe(null);
  });
});

describe('niftyLevels — intraday swing S/R (option c)', () => {
  const mk = (h, l, c) => ({ t: '', o: c, h, l, c });
  // A clean rise to a peak (idx5, h=120) then a fall to a trough (idx9, l=88); last close 97.
  const cs = [
    mk(102, 98, 100), mk(104, 99, 103), mk(108, 102, 107), mk(112, 106, 110), mk(115, 109, 113),
    mk(120, 112, 114), mk(113, 107, 108), mk(109, 100, 101), mk(103, 92, 95), mk(98, 88, 90), mk(99, 93, 97),
  ];
  const out = niftyLevels(cs);
  it('returns empty for fewer than 3 candles', () => {
    const e = niftyLevels([mk(1, 0, 0.5), mk(1, 0, 0.5)]);
    expect(e.resistances).toEqual([]); expect(e.supports).toEqual([]);
  });
  it('returns no levels on a flat day (dayHigh === dayLow)', () => {
    const f = niftyLevels([mk(100, 100, 100), mk(100, 100, 100), mk(100, 100, 100)]);
    expect(f.resistances).toEqual([]); expect(f.supports).toEqual([]);
    expect(f.dayHigh).toBe(100); expect(f.dayLow).toBe(100);
  });
  it('anchors the day high/low and last close', () => {
    expect(out.dayHigh).toBe(120); expect(out.dayLow).toBe(88); expect(out.last).toBe(97);
  });
  it('places every resistance ABOVE and every support BELOW the last close', () => {
    expect(out.resistances.length).toBeGreaterThan(0);
    expect(out.supports.length).toBeGreaterThan(0);
    expect(out.resistances.every((l) => l.price > out.last)).toBe(true);
    expect(out.supports.every((l) => l.price < out.last)).toBe(true);
  });
  it('detects the swing high (≈120) as resistance and swing low (≈88) as support', () => {
    expect(out.resistances.some((l) => Math.abs(l.price - 120) < 0.5)).toBe(true);
    expect(out.supports.some((l) => Math.abs(l.price - 88) < 0.5)).toBe(true);
  });
});
