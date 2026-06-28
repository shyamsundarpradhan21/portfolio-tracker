// Tests for the Trading-tab P&L dashboard aggregation. Expected values are worked
// out by hand from the fixture so a sign flip, a double-count across brokers, or a
// wrong FY/streak boundary fails here rather than shipping to the dashboard.
import { describe, it, expect } from 'vitest';
import {
  dailySeries, summaryStats, quantileBuckets, monthMatrix, monthlyRollup, fyOf,
  scaleIntraday, scaleCandles, mergeLiveTapes, niftyLevels,
  seriesByStrategy, returnsPct, cumulative, dailyReturns, cagr, volatility,
  sharpe, sortino, drawdown, drawdownEpisodes, calmar, beta, alpha,
  bestWorstWindows, riskReward, freqOfTrade, riskOMeterBand,
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
  it('drops a swing level hugging the last price (min stand-off) but keeps the far one', () => {
    // window:1 → strict local extremes. idx1 high 100.02 sits just above last (100), inside the
    // ~0.04% stand-off, so it must be dropped; idx3 high 103 is far and must survive.
    const o = niftyLevels([
      mk(99.5, 98, 99), mk(100.02, 98, 99.5), mk(99.6, 97, 99), mk(103, 96, 100.5),
      mk(99, 95, 98), mk(95, 90, 96), mk(96, 94, 100),
    ], { window: 1 });
    expect(o.last).toBe(100);
    expect(o.resistances.some((l) => l.price > 100 && l.price < 100.1)).toBe(false); // 100.04 dropped
    expect(o.resistances.some((l) => Math.abs(l.price - 103) < 0.5)).toBe(true);     // 103 kept
    expect(o.resistances.every((l) => l.price > o.last)).toBe(true);
    expect(o.supports.some((l) => Math.abs(l.price - 90) < 0.5)).toBe(true);         // swing low 90
  });
});

// ── Analytics calc layer (Phase A) ───────────────────────────────────────────

describe('seriesByStrategy — sleeve split + combined', () => {
  const s = seriesByStrategy(rows);
  it('S01 = Dhan rows only (3 days), 06-12 is just Dhan (5000)', () => {
    expect(s.S01.map((d) => d.date)).toEqual(['2026-04-10', '2026-06-12', '2026-06-23']);
    expect(s.S01.find((d) => d.date === '2026-06-12').net).toBe(5000);
  });
  it('S02 = Upstox+Fyers (2 days), 06-12 is just Fyers (47478)', () => {
    expect(s.S02.map((d) => d.date)).toEqual(['2026-05-12', '2026-06-12']);
    expect(s.S02.find((d) => d.date === '2026-06-12').net).toBe(47478);
  });
  it('all = every broker merged (4 days, 06-12 = 52478)', () => {
    expect(s.all.length).toBe(4);
    expect(s.all.find((d) => d.date === '2026-06-12').net).toBe(52478);
  });
});

describe('summaryStats — profit factor + win/loss sums', () => {
  const st = summaryStats(dailySeries(rows));
  it('winSum = 26584+52478+15714 = 94776, lossSum = -49978', () => {
    expect(st.winSum).toBe(94776); expect(st.lossSum).toBe(-49978);
  });
  it('profitFactor = 94776/49978 ≈ 1.9', () => expect(st.profitFactor).toBe(1.9));
  it('no losing days → profitFactor null', () => {
    const w = summaryStats([{ date: '2026-06-01', net: 10, gross: 10, charges: 0, orders: 1 },
      { date: '2026-06-02', net: 20, gross: 20, charges: 0, orders: 1 }]);
    expect(w.lossSum).toBe(0); expect(w.profitFactor).toBe(null);
  });
  it('empty series → profitFactor null, sums 0', () => {
    const z = summaryStats([]); expect(z.profitFactor).toBe(null); expect(z.winSum).toBe(0); expect(z.lossSum).toBe(0);
  });
});

describe('returnsPct — cumulative TWR on a constant base', () => {
  // +10% then −10% on 100k: 1.1 × 0.9 = 0.99 → −1% (geometric, NOT 0)
  it('+10% then −10% compounds to −1%', () =>
    expect(returnsPct([{ net: 10000 }, { net: -10000 }], 100000)).toBe(-1));
  it('single +20k on 100k = +20%', () => expect(returnsPct([{ net: 20000 }], 100000)).toBe(20));
  it('empty → 0, no base → null', () => {
    expect(returnsPct([], 100000)).toBe(0);
    expect(returnsPct([{ net: 1 }], 0)).toBe(null);
  });
});

describe('cumulative — running ₹ curve', () => {
  const c = cumulative(dailySeries(rows));
  it('first = first day net, last = total net (44798)', () => {
    expect(c[0].cum).toBe(-49978); expect(c[c.length - 1].cum).toBe(44798);
  });
  it('mid points accumulate (−23394, 29084)', () =>
    expect(c.map((x) => x.cum)).toEqual([-49978, -23394, 29084, 44798]));
});

describe('dailyReturns — fractional on constant base', () => {
  it('r = net / capital', () =>
    expect(dailyReturns([{ date: 'a', net: 100 }, { date: 'b', net: -50 }], 1000))
      .toEqual([{ date: 'a', r: 0.1 }, { date: 'b', r: -0.05 }]));
  it('no capital → []', () => expect(dailyReturns([{ date: 'a', net: 1 }], 0)).toEqual([]));
});

describe('cagr — TWR annualised', () => {
  // 1.1 × 1.1 = 1.21 growth factor over exactly 365d → 21% CAGR
  const s = [{ date: '2025-01-01', net: 10000 }, { date: '2026-01-01', net: 10000 }];
  it('+10%/+10% over 365d → 21%', () => expect(cagr(s, 100000)).toBe(21));
  it('guards: single point / no capital → null', () => {
    expect(cagr([{ date: '2025-01-01', net: 1 }], 100000)).toBe(null);
    expect(cagr(s, 0)).toBe(null);
  });
});

describe('volatility / sharpe / sortino', () => {
  it('volatility of constant returns is 0', () =>
    expect(volatility([{ r: 0.02 }, { r: 0.02 }, { r: 0.02 }])).toBe(0));
  it('volatility annualises σ (±1% → ≈18.33%)', () =>
    expect(volatility([{ r: 0.01 }, { r: -0.01 }, { r: 0.01 }, { r: -0.01 }])).toBeCloseTo(18.33, 1));
  it('sharpe null on zero variance, positive for positive-mean', () => {
    expect(sharpe([{ r: 0.01 }, { r: 0.01 }])).toBe(null);
    expect(sharpe([{ r: 0.01 }, { r: 0.03 }])).toBeGreaterThan(0);
  });
  it('sortino null when no negative returns, finite when some', () => {
    expect(sortino([{ r: 0.01 }, { r: 0.02 }])).toBe(null);
    expect(sortino([{ r: -0.01 }, { r: 0.03 }])).toBeGreaterThan(0);
  });
});

describe('drawdown — geometric (TWR) underwater depth', () => {
  // geometric equity on 1000 base: r = +.1,+.1,−.3,−.1,+.5
  //   1100, 1210(peak), 847, 762.3, 1143.45
  const s = [
    { date: '2026-01-01', net: 100 }, { date: '2026-01-02', net: 100 },
    { date: '2026-01-03', net: -300 }, { date: '2026-01-04', net: -100 },
    { date: '2026-01-05', net: 500 },
  ];
  const dd = drawdown(s, 1000);
  it('day-3 dd = (847−1210)/1210 = −30%', () => expect(dd.curve[2].dd).toBe(-30));
  it('max dd at day-4 = (762.3−1210)/1210 = −37%', () => expect(dd.maxDD).toBe(-37));
  it('avg dd = (0+0−30−37−5.5)/5 = −14.5%', () => expect(dd.avgDD).toBeCloseTo(-14.5, 2));
  it('no capital → empty', () => expect(drawdown(s, 0)).toEqual({ curve: [], maxDD: 0, avgDD: 0 }));
});

describe('drawdownEpisodes — geometric peak→trough→recovery', () => {
  // 1000 base, r = +.2,−.4,+.7 → eq 1200(peak), 720, 1224 (recovers > 1200 on day 3)
  const s = [{ date: '2026-01-01', net: 200 }, { date: '2026-01-02', net: -400 }, { date: '2026-01-03', net: 700 }];
  const eps = drawdownEpisodes(s, 1000);
  it('one recovered episode, depth −40, trough 01-02, 1 recovery day', () => {
    expect(eps.length).toBe(1);
    expect(eps[0].depth).toBe(-40);
    expect(eps[0].troughDate).toBe('2026-01-02');
    expect(eps[0].recoveryDays).toBe(1);
    expect(eps[0].ongoing).toBe(false);
  });
  it('an unrecovered drawdown is flagged ongoing', () => {
    const o = drawdownEpisodes([{ date: '2026-01-01', net: 200 }, { date: '2026-01-02', net: -400 }], 1000);
    expect(o[0].ongoing).toBe(true); expect(o[0].recoveryDays).toBe(null); expect(o[0].depth).toBe(-40);
  });
  it('sorted deepest first', () => {
    // eq: 1200(peak),1080,1404(recover,peak),702,1263.6 → ep1 −10 (recovered), ep2 −50 (ongoing)
    const o = drawdownEpisodes([
      { date: '2026-01-01', net: 200 }, { date: '2026-01-02', net: -100 }, { date: '2026-01-03', net: 300 },
      { date: '2026-01-04', net: -500 }, { date: '2026-01-05', net: 800 },
    ], 1000);
    expect(o.length).toBe(2);
    expect(o[0].depth).toBe(-50); expect(o[1].depth).toBe(-10);
  });
});

describe('TWR continuity — tiny returns ≈ arithmetic on a stable window (2nd guard)', () => {
  it('small daily P&L vs a large base: TWR ≈ Σnet/capital', () => {
    const s = [{ net: 100 }, { net: 200 }, { net: -50 }]; // Σ=250 on 1,000,000
    const twr = returnsPct(s, 1_000_000);
    const arith = (250 / 1_000_000) * 100; // 0.025%
    expect(Math.abs(twr - arith)).toBeLessThan(0.01);
  });
});

describe('calmar', () => {
  it('CAGR / |maxDD|', () => expect(calmar(45, -15)).toBe(3));
  it('null when no drawdown or no cagr', () => {
    expect(calmar(45, 0)).toBe(null); expect(calmar(null, -15)).toBe(null);
  });
});

describe('beta / alpha — vs benchmark', () => {
  const a = [{ r: 0.01 }, { r: 0.02 }, { r: -0.01 }];
  it('identical series → beta 1, alpha 0', () => {
    expect(beta(a, a)).toBe(1); expect(alpha(a, a)).toBe(0);
  });
  it('returns = 2× bench → beta 2, alpha 0', () => {
    const two = a.map((x) => ({ r: x.r * 2 }));
    expect(beta(two, a)).toBe(2); expect(alpha(two, a)).toBe(0);
  });
  it('null with <2 aligned points', () => expect(beta([{ r: 0.01 }], a)).toBe(null));
});

describe('bestWorstWindows — rolling net over a window', () => {
  const s = [
    { date: 'd1', net: 10 }, { date: 'd2', net: -5 }, { date: 'd3', net: 20 },
    { date: 'd4', net: -30 }, { date: 'd5', net: 15 },
  ];
  const bw = bestWorstWindows(s, 2);
  it('best 2-day window = d2→d3 (+15)', () => {
    expect(bw.best.ret).toBe(15); expect(bw.best.startDate).toBe('d2'); expect(bw.best.endDate).toBe('d3');
  });
  it('worst 2-day window = d4→d5 (−15)', () => {
    expect(bw.worst.ret).toBe(-15); expect(bw.worst.startDate).toBe('d4'); expect(bw.worst.endDate).toBe('d5');
  });
});

describe('riskReward / freqOfTrade / riskOMeterBand', () => {
  const st = summaryStats(dailySeries(rows));
  it('riskReward = avgWin/avgLoss = 31592/49978 ≈ 0.63', () => expect(riskReward(st)).toBe(0.63));
  it('riskReward null with no losing days', () =>
    expect(riskReward({ winDays: 2, lossDays: 0, winSum: 100, lossSum: 0 })).toBe(null));
  it('freqOfTrade = 207 orders / 4 days = 51.75', () => expect(freqOfTrade(dailySeries(rows))).toBe(51.75));
  it('freqOfTrade empty → 0', () => expect(freqOfTrade([])).toBe(0));
  it('risk-o-meter bands by volatility', () => {
    expect(riskOMeterBand({ volatility: 10 })).toBe('Low');
    expect(riskOMeterBand({ volatility: 20 })).toBe('Moderate');
    expect(riskOMeterBand({ volatility: 30 })).toBe('Elevated');
    expect(riskOMeterBand({ volatility: 50 })).toBe('High');
  });
  it('a severe drawdown bumps the band up one level', () =>
    expect(riskOMeterBand({ volatility: 20, maxDD: -30 })).toBe('Elevated'));
});
