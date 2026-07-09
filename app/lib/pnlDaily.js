// Pure daily-P&L aggregation for the Trading tab's Groww-style dashboard.
// Source: data/fno-ledger.json rows — { date, broker, sleeve, grossRealised,
// estCharges, net, turnover, orders } — one row per broker per captured day.
// No JSX, no runtime globals; everything here is a pure function of its inputs
// so it unit-tests cleanly and the component stays presentational.

const r2 = (n) => Math.round(n * 100) / 100;

// Roll every broker's rows into one record per calendar date.
//   → [{ date, net, gross, charges, orders }]  sorted ascending by date.
export function dailySeries(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.date) continue;
    const d = by.get(r.date) || { date: r.date, net: 0, gross: 0, charges: 0, orders: 0 };
    d.net += r.net || 0;
    d.gross += r.grossRealised || 0;
    // Phase 2c: real contract-note charge where the overlay marked it 'real' (net already recomputed); else est.
    d.charges += (r.chargeSource === 'real' ? (r.realCharge || 0) : (r.estCharges || 0));
    d.orders += r.orders || 0;
    by.set(r.date, d);
  }
  return [...by.values()]
    .map((d) => ({ ...d, net: r2(d.net), gross: r2(d.gross), charges: r2(d.charges) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Indian FY label for an ISO date: 2026-06-24 → "FY 26-27", 2026-02-10 → "FY 25-26".
export function fyOf(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  const start = m >= 4 ? y : y - 1;
  return `FY ${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}
// The Apr-starting calendar year of an FY label's window, for a given iso.
export const fyStartYear = (iso) => {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  return m >= 4 ? y : y - 1;
};

// Headline stats over a day series (already filtered to the period you want).
export function summaryStats(series) {
  if (!series.length) {
    return { net: 0, gross: 0, charges: 0, orders: 0, tradingDays: 0, winDays: 0,
      lossDays: 0, winPct: 0, mostProfit: null, leastProfit: null, bestStreak: 0,
      currentStreak: 0, currentStreakWin: true, avgPerDay: 0,
      winSum: 0, lossSum: 0, profitFactor: null };
  }
  let net = 0, gross = 0, charges = 0, orders = 0, winDays = 0, lossDays = 0;
  let winSum = 0, lossSum = 0; // Σ net of profit days / loss days (lossSum ≤ 0) → profit factor
  let mostProfit = null, leastProfit = null;
  for (const d of series) {
    net += d.net; gross += d.gross; charges += d.charges; orders += d.orders;
    if (d.net > 0) { winDays++; winSum += d.net; } else if (d.net < 0) { lossDays++; lossSum += d.net; }
    if (!mostProfit || d.net > mostProfit.net) mostProfit = { date: d.date, net: d.net };
    if (!leastProfit || d.net < leastProfit.net) leastProfit = { date: d.date, net: d.net };
  }
  // Longest run of profit days, and the trailing (current) run + its direction.
  let bestStreak = 0, run = 0;
  for (const d of series) { if (d.net > 0) { run++; bestStreak = Math.max(bestStreak, run); } else run = 0; }
  // Trailing run of same-direction days. A flat day (net === 0) is neither win nor
  // loss, so it ends the streak; seed the direction from the most recent non-flat
  // day so a flat latest day reads as "no streak" (0), not a 0-length win streak.
  const lastNonFlat = [...series].reverse().find((d) => d.net !== 0);
  const currentStreakWin = lastNonFlat ? lastNonFlat.net > 0 : true;
  let currentStreak = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].net === 0) break;
    if ((series[i].net > 0) === currentStreakWin) currentStreak++; else break;
  }
  const tradingDays = series.length;
  return {
    net: r2(net), gross: r2(gross), charges: r2(charges), orders, tradingDays,
    winDays, lossDays,
    winPct: tradingDays ? Math.round((winDays / tradingDays) * 100) : 0,
    mostProfit, leastProfit,
    bestStreak, currentStreak, currentStreakWin,
    avgPerDay: r2(net / tradingDays),
    winSum: r2(winSum), lossSum: r2(lossSum),
    profitFactor: lossSum !== 0 ? r2(winSum / Math.abs(lossSum)) : null,
  };
}

// Bucket each day's intensity RELATIVE to the user's own distribution (not fixed
// ₹ thresholds): breakeven band first, then profit days split into terciles
// 1/2/3 and loss days into -1/-2/-3 by their magnitude rank.
//   → Map<isoDate, bucket(-3..3)>
export function quantileBuckets(series) {
  const out = new Map();
  if (!series.length) return out;
  const absVals = series.map((d) => Math.abs(d.net)).sort((a, b) => a - b);
  const median = absVals[Math.floor(absVals.length / 2)] || 0;
  const beEps = Math.max(1, 0.05 * median); // anything inside ±5% of typical day ≈ flat

  const terciles = (vals) => {
    // returns a fn value→1|2|3 by rank within `vals` (ascending magnitudes)
    const sorted = [...vals].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const t1 = at(1 / 3), t2 = at(2 / 3);
    // strict upper bound so the single largest magnitude always lands in the top
    // bucket (with `<=` it equals t2 and reads a tier low on small samples).
    return (v) => (v < t1 ? 1 : v < t2 ? 2 : 3);
  };
  const profMag = series.filter((d) => d.net > beEps).map((d) => d.net);
  const lossMag = series.filter((d) => d.net < -beEps).map((d) => Math.abs(d.net));
  const pBucket = terciles(profMag), lBucket = terciles(lossMag);

  for (const d of series) {
    if (Math.abs(d.net) <= beEps) out.set(d.date, 0);
    else if (d.net > 0) out.set(d.date, pBucket(d.net));
    else out.set(d.date, -lBucket(Math.abs(d.net)));
  }
  return out;
}

// Calendar weeks for one month: Sun-first rows of 7, cells are isoDate | null.
//   monthMatrix(2026, 5) → June 2026 → [[null,'2026-06-01',…], …]
export function monthMatrix(year, month0) {
  const first = new Date(year, month0, 1);
  const startDow = first.getDay(); // 0 = Sun
  const days = new Date(year, month0 + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) {
    cells.push(`${year}-${String(month0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Scale several keys of an intraday tape onto ONE shared ₹ axis (always incl. 0),
// for the aggregate net line + the per-broker overlay. Returns { byKey, zeroY }.
// A key with no finite values → byKey[key] = null.
export function scaleLines(points, keys, width, height, pad = 8) {
  const pts = (points || []).filter((p) => p && p.t != null);
  if (pts.length < 2) return null;
  let lo = 0, hi = 0;
  for (const p of pts) for (const k of keys) {
    const v = +p[k]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo, x0 = pad, x1 = width - pad, y0 = pad, y1 = height - pad;
  const vx = (i) => (pts.length === 1 ? (x0 + x1) / 2 : x0 + (i / (pts.length - 1)) * (x1 - x0));
  const vy = (v) => y0 + (hi - v) / span * (y1 - y0);
  const byKey = {};
  for (const k of keys) {
    byKey[k] = pts.some((p) => Number.isFinite(+p[k]))
      ? pts.map((p, i) => (Number.isFinite(+p[k]) ? { x: r2(vx(i)), y: r2(vy(+p[k])), t: p.t } : null))
      : null;
  }
  return { byKey, zeroY: r2(vy(0)), n: pts.length };
}

// Merge the per-sleeve intraday day-change tapes (F&O, India equity, US — each
// [{ t:'HH:MM', net }]) into ONE portfolio tape for the Overview live curve.
// Points are ordered chronologically across the portfolio's trading day: the
// Indian session (09:13→15:32) first, then the US session that opens the same
// evening (18:45→23:59) and runs past midnight (00:00→02:30, ranked after
// evening). Each sleeve's value is carried forward (0 before its first point),
// so net = Σ sleeves at every tick. A sleeve with NO points that day is omitted
// entirely (its key never appears → the chart draws no line for it).
//   parts = { fno:[…], eq:[…], us:[…] }  →  [{ t, net, fno?, eq?, us? }]
const SLEEVE_KEYS = ['fno', 'eq', 'us'];
// minutes-since-midnight, but pre-06:00 (US post-midnight) ranked after evening.
const tRank = (t) => { const [h, m] = String(t).split(':').map(Number); const x = h * 60 + m; return x < 360 ? x + 1440 : x; };
export function mergeLiveTapes(parts = {}) {
  const present = SLEEVE_KEYS.filter((k) => Array.isArray(parts[k]) && parts[k].some((p) => p && p.t != null && Number.isFinite(+p.net)));
  if (!present.length) return [];
  // time → { sleeve: net } from each present tape (last write per minute wins).
  const at = new Map();
  for (const k of present) {
    for (const p of parts[k]) {
      if (!p || p.t == null || !Number.isFinite(+p.net)) continue;
      const slot = at.get(p.t) || {};
      slot[k] = +p.net;
      at.set(p.t, slot);
    }
  }
  const times = [...at.keys()].sort((a, b) => tRank(a) - tRank(b));
  const last = {}; // carried last-known net per sleeve
  const out = [];
  for (const t of times) {
    Object.assign(last, at.get(t));
    let net = 0; const row = { t };
    for (const k of present) { const v = last[k] || 0; row[k] = r2(v); net += v; }
    row.net = r2(net);
    out.push(row);
  }
  return out;
}

// Scale REAL 1-minute OHLC candles ([{ t:'HH:MM', o, h, l, c }], from Yahoo's
// ^NSEI 1m feed) into SVG geometry for the NIFTY 50 watermark. Evenly spaced by
// index across the chart width, normalized to the candles' own price range (an
// index scale, not the ₹ axis). Returns { bars:[{x,openY,closeY,highY,lowY,up}], bw }.
export function scaleCandles(candles, width, height, pad = 8) {
  const cs = (candles || []).filter((c) => c && [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(+v)));
  if (cs.length < 2) return null;
  let lo = Infinity, hi = -Infinity, vmax = 0;
  for (const c of cs) { if (+c.l < lo) lo = +c.l; if (+c.h > hi) hi = +c.h; if (Number.isFinite(+c.v) && +c.v > vmax) vmax = +c.v; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const x0 = pad, x1 = width - pad, y0 = pad, y1 = height - pad;
  const vy = (v) => r2(y0 + (hi - v) / (hi - lo) * (y1 - y0));
  const bars = cs.map((c, i) => ({
    x: r2(x0 + (i / (cs.length - 1)) * (x1 - x0)),
    openY: vy(+c.o), closeY: vy(+c.c), highY: vy(+c.h), lowY: vy(+c.l), up: +c.c >= +c.o,
    v: Number.isFinite(+c.v) ? Math.max(0, +c.v) : null,   // clamp ≥0 so a stray negative can't draw an inverted bar
  }));
  // Expose the price→y mapping (clamped into the plot band) so the component can place S/R
  // lines on the SAME axis as the candles, plus vmax for the volume histogram.
  const priceY = (p) => r2(Math.max(y0, Math.min(y1, y0 + (hi - p) / (hi - lo) * (y1 - y0))));
  return { bars, bw: Math.max(1.2, ((x1 - x0) / cs.length) * 0.6), lo, hi, y0, y1, vmax, priceY };
}

// Intraday support/resistance via swing pivots (option c). A swing HIGH is a candle whose
// high is the max within ±window bars; a swing LOW, the min within ±window. Nearby pivots are
// clustered (band anchored on the group's first price, so width never exceeds `tol`), ranked by
// touch count, then split around the last close into resistances (above) / supports (below) with
// a small `minGap` stand-off that drops noise levels hugging the current price (and keeps the
// every-R>last / every-S<last invariant true on the rounded values). The day high & low are
// added as the outer anchors. Pure → unit-tested. Defensive on sparse/flat.
//   → { resistances:[{price,touches,anchor?}], supports:[...], dayHigh, dayLow, last }
export function niftyLevels(candles, { window = 5, tol = 0.0008, max = 2, minGap = 0.0004 } = {}) {
  const cs = (candles || []).filter((c) => c && [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(+v)));
  const empty = { resistances: [], supports: [], dayHigh: null, dayLow: null, last: null };
  if (cs.length < 3) return empty;
  const last = r2(+cs[cs.length - 1].c);
  let dayHigh = -Infinity, dayLow = Infinity;
  for (const c of cs) { if (+c.h > dayHigh) dayHigh = +c.h; if (+c.l < dayLow) dayLow = +c.l; }
  if (!(dayHigh > dayLow)) return { ...empty, last, dayHigh: r2(dayHigh), dayLow: r2(dayLow) };  // flat day
  const w = Math.max(1, Math.min(window, Math.floor((cs.length - 1) / 2)));
  const highs = [], lows = [];
  for (let i = 0; i < cs.length; i++) {
    let isHigh = true, isLow = true;
    for (let j = Math.max(0, i - w); j <= Math.min(cs.length - 1, i + w); j++) {
      if (j === i) continue;
      if (+cs[j].h > +cs[i].h) isHigh = false;
      if (+cs[j].l < +cs[i].l) isLow = false;
    }
    if (isHigh) highs.push(+cs[i].h);
    if (isLow) lows.push(+cs[i].l);
  }
  // Merge a sorted price list into clustered levels. The tolerance band is anchored on the
  // group's FIRST (lowest) price, not a running mean — so a cluster's total width can never
  // exceed `tol` (a running mean drifts up and absorbs a wider band). price = centroid.
  const cluster = (prices) => {
    const out = [];
    for (const p of [...prices].sort((a, b) => a - b)) {
      const g = out[out.length - 1];
      if (g && Math.abs(p - g.anchor) <= g.anchor * tol) { g.sum += p; g.touches += 1; }
      else out.push({ anchor: p, sum: p, touches: 1 });
    }
    return out.map((g) => ({ price: r2(g.sum / g.touches), touches: g.touches }));
  };
  // Rank by touches, then proximity to last (nearest wins ties).
  const rank = (lvls) => lvls.slice().sort((a, b) => b.touches - a.touches || Math.abs(a.price - last) - Math.abs(b.price - last));
  const resCut = last * (1 + minGap), supCut = last * (1 - minGap);   // stand-off from the current price
  const resistances = rank(cluster(highs).filter((l) => l.price > resCut)).slice(0, max);
  const supports = rank(cluster(lows).filter((l) => l.price < supCut)).slice(0, max);
  // Day high/low as outer anchors (skip if a swing level already sits within tol of them).
  const near = (lvls, p) => lvls.some((l) => Math.abs(l.price - p) <= p * tol);
  const dh = r2(dayHigh), dl = r2(dayLow);
  if (dh > resCut && !near(resistances, dh)) resistances.push({ price: dh, touches: 1, anchor: true });
  if (dl < supCut && !near(supports, dl)) supports.push({ price: dl, touches: 1, anchor: true });
  return { resistances, supports, dayHigh: dh, dayLow: dl, last };
}

// Scale an intraday tape ([{ t:'HH:MM', net }]) into SVG geometry for the Day
// view. Pure: returns coordinates only, the component draws them. The y-range is
// padded and always includes 0 so the zero line (the green/red split) is on-chart.
//   → { pts:[{x,y,t,net}], zeroY, cur, curY, ud } | null
export function scaleIntraday(points, width, height, pad = 8) {
  const pts = (points || []).filter((p) => p && p.t != null && Number.isFinite(+p.net));
  if (!pts.length) return null;
  const vals = pts.map((p) => +p.net);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (lo === hi) { lo -= 1; hi += 1; }        // flat tape → tiny band so it renders
  const span = hi - lo;
  const x0 = pad, x1 = width - pad, y0 = pad, y1 = height - pad;
  const vx = (i) => (pts.length === 1 ? (x0 + x1) / 2 : x0 + (i / (pts.length - 1)) * (x1 - x0));
  const vy = (v) => y0 + (hi - v) / span * (y1 - y0);
  const out = pts.map((p, i) => ({ x: r2(vx(i)), y: r2(vy(+p.net)), t: p.t, net: +p.net }));
  const cur = +pts[pts.length - 1].net;
  return { pts: out, zeroY: r2(vy(0)), cur, curY: r2(vy(cur)), ud: cur >= 0 };
}

// Per-month rollup for a FY (Apr→Mar), for the monthly summary table.
//   → [{ ym:'2026-06', label:'Jun 2026', net, gross, charges, orders, days }]
export function monthlyRollup(series) {
  const by = new Map();
  for (const d of series) {
    const ym = d.date.slice(0, 7);
    const m = by.get(ym) || { ym, net: 0, gross: 0, charges: 0, orders: 0, days: 0 };
    m.net += d.net; m.gross += d.gross; m.charges += d.charges; m.orders += d.orders; m.days++;
    by.set(ym, m);
  }
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return [...by.values()]
    .map((m) => ({ ...m, net: r2(m.net), gross: r2(m.gross), charges: r2(m.charges),
      label: `${MON[+m.ym.slice(5, 7) - 1]} ${m.ym.slice(0, 4)}` }))
    .sort((a, b) => (a.ym < b.ym ? 1 : -1)); // newest first, like Dhan's table
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics calc layer (Trading Journal → Analytics tab). All pure; the ratios
// below assume a CONSTANT deployed-capital base passed in by the caller:
// returns on constant deployed capital (own+client); valid while capital is ~stable — revisit if material flows occur.
// The caller picks ONE representative figure (current or window-average fundsUsed)
// and feeds the SAME `capital` to every ratio (incl. returnsPct). Returns are
// TIME-WEIGHTED — daily net/capital chained geometrically (Π(1+rₜ)−1) — so a deep
// cumulative loss can't push a ratio past −100% (equity stays > 0).
// ─────────────────────────────────────────────────────────────────────────────
const TRADING_DAYS = 252; // annualisation factor for σ / Sharpe / Sortino
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
// sample standard deviation (n−1); 0 for <2 points so callers can guard cleanly.
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const retVals = (returns) => (returns || []).map((x) => (typeof x === 'number' ? x : x.r));

// Per-strategy day series. S01 = Dhan, S02 = Upstox+Fyers — each fno-ledger
// row carries its `sleeve`, so just filter then reuse dailySeries. `all` = every broker.
export function seriesByStrategy(rows) {
  const bySleeve = (s) => dailySeries((rows || []).filter((r) => r && r.sleeve === s));
  return { S01: bySleeve('S01'), S02: bySleeve('S02'), all: dailySeries(rows) };
}

// Cumulative TIME-WEIGHTED return (%) over the series on a constant capital base:
// TWR = Π(1 + netₜ/capital) − 1. Geometric → can't fall below −100%. Empty → 0; no base → null.
export function returnsPct(series, capital) {
  if (!(capital > 0)) return null;
  if (!series || !series.length) return 0;
  let f = 1;
  for (const d of series) f *= 1 + d.net / capital;
  return r2((f - 1) * 100);
}

// Running ₹ cumulative (money-made curve), one point per day, ascending.
export function cumulative(series) {
  let c = 0;
  return (series || []).map((d) => { c += d.net; return { date: d.date, cum: r2(c) }; });
}

// Daily fractional returns on the constant capital base: r = net / capital.
export function dailyReturns(series, capital) {
  if (!(capital > 0)) return [];
  return (series || []).map((d) => ({ date: d.date, r: d.net / capital }));
}

// CAGR (%) — TWR end-of-window growth factor annualised over the series' date span.
export function cagr(series, capital) {
  if (!series || series.length < 2 || !(capital > 0)) return null;
  let f = 1;
  for (const d of series) f *= 1 + d.net / capital;
  if (f <= 0) return null;
  const days = dayDiff(series[0].date, series[series.length - 1].date);
  if (days <= 0) return null;
  return r2((f ** (365 / days) - 1) * 100);
}

// Annualised volatility (%) of the daily-return stream.
export function volatility(returns) {
  return r2(stdev(retVals(returns)) * Math.sqrt(TRADING_DAYS) * 100);
}

// Sharpe — annualised excess return / annualised σ. rf = annual risk-free (fraction).
export function sharpe(returns, rf = 0) {
  const rs = retVals(returns);
  const sd = stdev(rs);
  if (sd === 0) return null;
  return r2((mean(rs) * TRADING_DAYS - rf) / (sd * Math.sqrt(TRADING_DAYS)));
}

// Sortino — Sharpe with downside deviation (RMS of negative returns over N) as denominator.
export function sortino(returns, rf = 0) {
  const rs = retVals(returns);
  if (rs.length < 2) return null;
  const dn = rs.filter((x) => x < 0);
  const dd = dn.length ? Math.sqrt(dn.reduce((s, x) => s + x * x, 0) / rs.length) : 0;
  if (dd === 0) return null;
  return r2((mean(rs) * TRADING_DAYS - rf) / (dd * Math.sqrt(TRADING_DAYS)));
}

// Drawdown over equity = capital + running cum. curve dd ≤ 0 (%). maxDD = worst (most
// negative), avgDD = mean across the window.
export function drawdown(series, capital) {
  const empty = { curve: [], maxDD: 0, avgDD: 0 };
  if (!series || !series.length || !(capital > 0)) return empty;
  let eq = capital, peak = capital, sum = 0, maxDD = 0;
  const curve = series.map((d) => {
    eq *= 1 + d.net / capital;             // geometric (TWR) equity path
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((eq - peak) / peak) * 100 : 0;
    sum += dd;
    if (dd < maxDD) maxDD = dd;
    return { date: d.date, dd: r2(dd) };
  });
  return { curve, maxDD: r2(maxDD), avgDD: r2(sum / curve.length) };
}

// Drawdown episodes — each peak→trough run, with depth (%), trough/recovery dates and
// recovery days (trough → back-to-peak). Sorted deepest-first. ongoing = unrecovered at end.
export function drawdownEpisodes(series, capital) {
  if (!series || !series.length || !(capital > 0)) return [];
  let eq = capital, peak = capital, peakDate = series[0].date, cur = null;
  const eps = [];
  for (const d of series) {
    eq *= 1 + d.net / capital;             // geometric (TWR) equity path
    if (eq >= peak) {
      if (cur) { cur.recoveryDate = d.date; cur.recoveryDays = dayDiff(cur.troughDate, d.date); cur.ongoing = false; eps.push(cur); cur = null; }
      peak = eq; peakDate = d.date;
    } else {
      const dd = ((eq - peak) / peak) * 100;
      if (!cur) cur = { peakDate, depth: 0, troughDate: peakDate, recoveryDate: null, recoveryDays: null, ongoing: true };
      if (dd < cur.depth) { cur.depth = dd; cur.troughDate = d.date; }
    }
  }
  if (cur) eps.push(cur);
  return eps.map((e) => ({ ...e, depth: r2(e.depth) })).sort((a, b) => a.depth - b.depth);
}

// Calmar — CAGR / |maxDD| (both already in %, so the ratio is unit-free).
export function calmar(cagrVal, maxDD) {
  return cagrVal != null && maxDD < 0 ? r2(cagrVal / Math.abs(maxDD)) : null;
}

// Beta = cov(r, b) / var(b). returns/bench: equal-ish daily-return arrays (numbers or {r}).
export function beta(returns, bench) {
  const r = retVals(returns), b = retVals(bench), n = Math.min(r.length, b.length);
  if (n < 2) return null;
  const mr = mean(r.slice(0, n)), mb = mean(b.slice(0, n));
  let cov = 0, varb = 0;
  for (let i = 0; i < n; i++) { cov += (r[i] - mr) * (b[i] - mb); varb += (b[i] - mb) ** 2; }
  return varb === 0 ? null : r2(cov / varb);
}

// Alpha — annualised (%) excess of the strategy over its beta-implied benchmark return.
export function alpha(returns, bench, rf = 0) {
  const be = beta(returns, bench);
  if (be == null) return null;
  const r = retVals(returns), b = retVals(bench), n = Math.min(r.length, b.length);
  const rfD = rf / TRADING_DAYS;
  const dailyAlpha = (mean(r.slice(0, n)) - rfD) - be * (mean(b.slice(0, n)) - rfD);
  return r2(dailyAlpha * TRADING_DAYS * 100);
}

// Best & worst rolling-window net ₹ over `winDays` consecutive trading days.
export function bestWorstWindows(series, winDays) {
  if (!series || !series.length) return { best: null, worst: null };
  const w = Math.max(1, Math.min(winDays, series.length));
  let best = null, worst = null;
  for (let i = 0; i + w <= series.length; i++) {
    const slice = series.slice(i, i + w);
    const rec = { startDate: slice[0].date, endDate: slice[w - 1].date, ret: r2(slice.reduce((s, d) => s + d.net, 0)) };
    if (!best || rec.ret > best.ret) best = rec;
    if (!worst || rec.ret < worst.ret) worst = rec;
  }
  return { best, worst };
}

// Risk:reward — avg winning-day ₹ / avg losing-day ₹ (magnitude). Reads stats from summaryStats.
export function riskReward(stats) {
  if (!stats || !stats.winDays || !stats.lossDays) return null;
  const avgWin = stats.winSum / stats.winDays;
  const avgLoss = Math.abs(stats.lossSum / stats.lossDays);
  return avgLoss === 0 ? null : r2(avgWin / avgLoss);
}

// Trades per trading day.
export function freqOfTrade(series) {
  if (!series || !series.length) return 0;
  return r2(series.reduce((s, d) => s + (d.orders || 0), 0) / series.length);
}

// Broker-wise all-years realised from the ledger rows — one row per broker carrying
// per-FY net, all-time net, OVERLAID charges (real contract-note where the overlay
// marked it, else estimated — the SAME basis as dailySeries / the Overview dashboard),
// and distinct trading days. `order` (broker names, e.g. the live FNO_META order) drives
// row order; brokers absent from it sort after, by all-time net desc. The total row sums
// each column. Returns { fys (ascending), brokers, total }.
export function brokerRealisedMatrix(rows, order = []) {
  const fySet = new Set();
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.date || !r.broker) continue;
    const fy = fyOf(r.date);
    fySet.add(fy);
    let b = by.get(r.broker);
    if (!b) { b = { broker: r.broker, sleeve: r.sleeve || null, byFy: {}, net: 0, charges: 0, days: new Set() }; by.set(r.broker, b); }
    b.byFy[fy] = r2((b.byFy[fy] || 0) + (r.net || 0));
    b.net += r.net || 0;
    b.charges += (r.chargeSource === 'real' ? (r.realCharge || 0) : (r.estCharges || 0));
    b.days.add(r.date);
    if (!b.sleeve && r.sleeve) b.sleeve = r.sleeve;
  }
  const fys = [...fySet].sort();
  const rank = (name) => { const i = order.indexOf(name); return i === -1 ? Infinity : i; };
  const brokers = [...by.values()]
    .map((b) => ({ broker: b.broker, sleeve: b.sleeve, byFy: b.byFy, net: r2(b.net), charges: r2(b.charges), days: b.days.size }))
    .sort((a, b) => (rank(a.broker) - rank(b.broker)) || (b.net - a.net));
  const total = { byFy: {}, net: 0, charges: 0, days: 0 };
  for (const b of brokers) {
    for (const fy of fys) if (b.byFy[fy] != null) total.byFy[fy] = r2((total.byFy[fy] || 0) + b.byFy[fy]);
    total.net = r2(total.net + b.net);
    total.charges = r2(total.charges + b.charges);
    total.days += b.days;
  }
  return { fys, brokers, total };
}

// Risk-o-meter band from annualised volatility (%), bumped one level on a severe drawdown.
// Thresholds are a param so they're easy to retune.
export function riskOMeterBand({ volatility: vol = 0, maxDD = 0 } = {}, t = { low: 15, mod: 25, high: 40 }) {
  const order = ['Low', 'Moderate', 'Elevated', 'High'];
  let band = vol < t.low ? 'Low' : vol < t.mod ? 'Moderate' : vol < t.high ? 'Elevated' : 'High';
  if (Math.abs(maxDD) > 25) band = order[Math.min(order.length - 1, order.indexOf(band) + 1)];
  return band;
}
