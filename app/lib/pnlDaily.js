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
    d.charges += r.estCharges || 0;
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
      lossDays: 0, winPct: 0, mostProfit: null, bestStreak: 0, currentStreak: 0,
      currentStreakWin: true, avgPerDay: 0 };
  }
  let net = 0, gross = 0, charges = 0, orders = 0, winDays = 0, lossDays = 0;
  let mostProfit = null, leastProfit = null;
  for (const d of series) {
    net += d.net; gross += d.gross; charges += d.charges; orders += d.orders;
    if (d.net > 0) winDays++; else if (d.net < 0) lossDays++;
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

// Scale REAL 1-minute OHLC candles ([{ t:'HH:MM', o, h, l, c }], from Yahoo's
// ^NSEI 1m feed) into SVG geometry for the NIFTY 50 watermark. Evenly spaced by
// index across the chart width, normalized to the candles' own price range (an
// index scale, not the ₹ axis). Returns { bars:[{x,openY,closeY,highY,lowY,up}], bw }.
export function scaleCandles(candles, width, height, pad = 8) {
  const cs = (candles || []).filter((c) => c && [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(+v)));
  if (cs.length < 2) return null;
  let lo = Infinity, hi = -Infinity;
  for (const c of cs) { if (+c.l < lo) lo = +c.l; if (+c.h > hi) hi = +c.h; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const x0 = pad, x1 = width - pad, y0 = pad, y1 = height - pad;
  const vy = (v) => r2(y0 + (hi - v) / (hi - lo) * (y1 - y0));
  const bars = cs.map((c, i) => ({
    x: r2(x0 + (i / (cs.length - 1)) * (x1 - x0)),
    openY: vy(+c.o), closeY: vy(+c.c), highY: vy(+c.h), lowY: vy(+c.l), up: +c.c >= +c.o,
  }));
  return { bars, bw: Math.max(1.2, ((x1 - x0) / cs.length) * 0.6) };
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
