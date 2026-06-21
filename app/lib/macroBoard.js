// Pure helpers + config for the Wrap macro board (the percentile sliders).
// For each series we show where today sits in its trailing ~1-yr range (knob
// position + rank percentile + lo/hi range labels) and a regime tone
// (calm / watch / stress) from per-metric thresholds. Kept OUT of the route so
// it's unit-testable without a network round-trip.

/**
 * Where `v` sits within the history `arr`:
 *  - pos: linear 0..100 between the 1-yr low/high (drives the slider knob, so it
 *    lines up with the min/max endpoint labels)
 *  - pctile: rank percentile (% of observations at or below v)
 *  - lo / hi: the range endpoints
 * Returns null when there's nothing usable.
 */
export function rangeStat(v, arr) {
  const xs = (arr || []).filter((x) => x != null && isFinite(x));
  if (v == null || !isFinite(v) || !xs.length) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const pos = hi === lo ? 50 : Math.round(((v - lo) / (hi - lo)) * 100);
  const pctile = Math.round((xs.filter((x) => x <= v).length / xs.length) * 100);
  return { pos: Math.max(0, Math.min(100, pos)), pctile, lo: r2(lo), hi: r2(hi) };
}

/**
 * Regime tone from per-metric thresholds. `dir` = +1 when HIGHER is calmer/better
 * (e.g. GDP, the yield curve), -1 when higher is more stressed (VIX, HY OAS,
 * inflation, unemployment, the dollar for an India book).
 */
export function tone(v, { dir = -1, warn, stress } = {}) {
  if (v == null || !isFinite(v) || warn == null || stress == null) return 'calm';
  const hot = dir < 0 ? v >= stress : v <= stress;
  const warm = dir < 0 ? v >= warn : v <= warn;
  return hot ? 'stress' : warm ? 'warn' : 'calm';
}

const r2 = (n) => (n == null || !isFinite(n) ? null : Math.round(n * 100) / 100);

const DAY_MS = 86400000;

// Value at ~`months` before ISO date `iso`, matched by ACTUAL DATE (the nearest
// observation within `tolDays`), NOT by index position. FRED vintages drop or lag
// months — a missing Oct-2025 shifted CPI's index-offset base by a month, turning a
// 12-mo YoY into a 13-mo change (the 4.3-vs-4.2). Date-anchoring compares against the
// calendar period regardless of gaps, and returns null rather than a wrong-month base
// when nothing lands in the window. `xs` must be ascending by date.
function priorValue(xs, iso, months, tolDays) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!isFinite(y) || !isFinite(m)) return null;
  const target = Date.UTC(y, m - 1 - months, d || 1); // month arithmetic wraps years correctly
  const tolMs = tolDays * DAY_MS;
  let best = null, bestGap = Infinity;
  for (const r of xs) {
    const [ry, rm, rd] = String(r.date).split('-').map(Number);
    const t = Date.UTC(ry, rm - 1, rd || 1);
    const gap = Math.abs(t - target);
    if (gap < bestGap) { bestGap = gap; best = r; }
    if (t > target + tolMs) break; // ascending — once past the window, gaps only grow
  }
  return best && bestGap <= tolMs ? best.v : null;
}

/**
 * Year-over-year % from a monthly level/index series (ascending [{date,v}]). Each
 * point compares against the observation ~12 months earlier BY DATE (priorValue) —
 * robust to missing months. Used for CPI / Core CPI (FRED publishes an index, not a rate).
 */
export function yoy(rows, tolDays = 20) {
  const xs = (rows || []).filter((r) => r && r.v != null && isFinite(r.v));
  const out = [];
  for (const r of xs) {
    const base = priorValue(xs, r.date, 12, tolDays);
    if (base) out.push({ date: r.date, v: (r.v / base - 1) * 100 });
  }
  return out;
}

/** YoY % from a QUARTERLY index series — 12 months earlier by date (wider tolerance
 * for the ~91-day spacing). e.g. India real GDP (quarterly constant-price index). */
export function yoyQ(rows, tolDays = 50) {
  const xs = (rows || []).filter((r) => r && r.v != null && isFinite(r.v));
  const out = [];
  for (const r of xs) {
    const base = priorValue(xs, r.date, 12, tolDays);
    if (base) out.push({ date: r.date, v: (r.v / base - 1) * 100 });
  }
  return out;
}

/** Month-over-month change of a level series — vs the observation ~1 month earlier by
 * date, so a missing month can't turn a 1-mo change into a 2-mo one. e.g. payrolls. */
export function mom(rows, tolDays = 20) {
  const xs = (rows || []).filter((r) => r && r.v != null && isFinite(r.v));
  const out = [];
  for (const r of xs) {
    const prev = priorValue(xs, r.date, 1, tolDays);
    if (prev != null) out.push({ date: r.date, v: r.v - prev });
  }
  return out;
}

// Macro-board series config. `src` is a FRED series id unless `yahoo` is set.
// `kind` controls a derived transform: 'level' (default), 'yoy' (CPI index→YoY),
// 'mom' (payrolls level→monthly change). `dir`/`warn`/`stress` drive the tone.
export const MACRO_GROUPS = [
  {
    group: 'Rates & market',
    series: [
      { key: 'us10y', label: 'US 10Y', src: 'DGS10', unit: '%', d: 2, dir: -1, warn: 4.5, stress: 5 },
      { key: 'spread2s10s', label: '2s10s', src: 'T10Y2Y', unit: ' pp', d: 2, dir: 1, warn: 0.2, stress: 0 },
      { key: 'hyOas', label: 'HY OAS', src: 'BAMLH0A0HYM2', unit: '%', d: 2, dir: -1, warn: 4, stress: 5.5 },
      { key: 'fedFunds', label: 'Fed funds', src: 'DFF', unit: '%', d: 2, dir: -1, warn: 4.75, stress: 5.5 },
      // RBI policy repo rate — no clean API exists, so it's a tracked constant
      // (the rate at each MPC decision). Update at each MPC (~6/yr; next ~Aug 2026);
      // the date-stamp makes a stale value visible and trips the staleness guard.
      { key: 'repo', label: 'RBI repo', unit: '%', d: 2, dir: -1, warn: 6, stress: 6.5, region: 'india',
        track: [
          { date: '2024-12-06', v: 6.50 },
          { date: '2025-02-07', v: 6.25 },
          { date: '2025-04-09', v: 6.00 },
          { date: '2025-06-06', v: 5.50 },
          { date: '2025-10-01', v: 5.50 },
          { date: '2025-12-05', v: 5.25 },
          { date: '2026-06-05', v: 5.25 },
        ] },
      // India 10Y benchmark G-sec yield — FRED INDIRLTLT01STM (keyless CSV / keyed API,
      // same plumbing as the US series). MONTHLY by design: a percentile gauge wants a
      // consistent distribution, and ranking a daily spot against a monthly-average range
      // would read 0/100% on intraday noise — for a slow yield the ~4-week lag barely
      // moves the percentile. The India-rate analogue to US 10Y, beside the RBI repo.
      { key: 'india10y', label: 'India 10Y', src: 'INDIRLTLT01STM', unit: '%', d: 2, dir: -1, warn: 7.5, stress: 8, region: 'india' },
      { key: 'vix', label: 'US VIX', yahoo: '^VIX', unit: '', d: 1, dir: -1, warn: 18, stress: 25 },
      { key: 'indiaVix', label: 'India VIX', yahoo: '^INDIAVIX', unit: '', d: 1, dir: -1, warn: 16, stress: 22, region: 'india' },
    ],
  },
  {
    // The cross-border channels into this book as PERCENTILE gauges — same instruments
    // the railine's Commod·FX ticker shows as bare quotes, but here answering "where in
    // the trailing-1yr range" (the regime read), not "what's the tick". Two different
    // questions, two artifacts; the railine keeps its quotes. Yahoo weekly closes.
    group: 'Cross-asset',
    series: [
      // Higher Brent = imported-inflation / current-account drag on the India book.
      { key: 'brent', label: 'Brent', yahoo: 'BZ=F', unit: '', d: 1, dir: -1, warn: 90, stress: 100 },
      // DXY (broad-dollar basket) sits next to the INR cross so dollar strength and the
      // rupee read side by side — it's an FX gauge, not a rate.
      { key: 'dxy', label: 'DXY', yahoo: 'DX-Y.NYB', unit: '', d: 1, dir: -1, warn: 105, stress: 110 },
      // Weaker INR (higher USD/INR) = the India-book stress read (the US sleeve hedges it,
      // but for an India-centric book a depreciating rupee is the risk-off signal).
      { key: 'usdinr', label: 'USD/INR', yahoo: 'INR=X', unit: '', d: 2, dir: -1, warn: 95, stress: 98 },
      // BTC is here for the levered crypto-miner US sleeve (~22% of it), NOT as broad
      // macro — a regime read on that sleeve (range-top = euphoric/vulnerable, bottom =
      // capitulation). Percentile-only on purpose: the risk is U-shaped, which a monotonic
      // calm/warn/stress tone can't encode, and fixed $ thresholds stale fast on a 2x-range
      // asset — the range-relative knob doesn't. Weekly closes so a 24/7 asset stays clean.
      { key: 'btc', label: 'BTC (miners)', yahoo: 'BTC-USD', scale: 0.001, unit: 'k', d: 1 },
    ],
  },
  {
    group: 'Inflation',
    series: [
      { key: 'cpi', label: 'US CPI', src: 'CPIAUCSL', unit: '%', d: 1, kind: 'yoy', dir: -1, warn: 3, stress: 4 },
      { key: 'coreCpi', label: 'Core CPI', src: 'CPILFESL', unit: '%', d: 1, kind: 'yoy', dir: -1, warn: 3, stress: 4 },
      // India CPI inflation — MoSPI e-Sankhyiki (keyless, live). Already a YoY %
      // (no transform); the FRED OECD mirror this replaced froze at Mar-2025.
      { key: 'indiaCpi', label: 'India CPI', mospi: 'cpi', unit: '%', d: 1, dir: -1, warn: 5, stress: 6, region: 'india' },
    ],
  },
  {
    group: 'Growth',
    series: [
      { key: 'gdp', label: 'US GDP', src: 'A191RL1Q225SBEA', unit: '%', d: 1, dir: 1, warn: 1.5, stress: 0 },
      // India real GDP growth (quarterly YoY %) — MoSPI e-Sankhyiki, already a rate.
      { key: 'indiaGdp', label: 'India GDP', mospi: 'gdp', unit: '%', d: 1, dir: 1, warn: 5, stress: 4, region: 'india' },
      // India IIP — industrial production growth (monthly YoY %), MoSPI e-Sankhyiki.
      { key: 'iip', label: 'India IIP', mospi: 'iip', unit: '%', d: 1, dir: 1, warn: 2, stress: 0, region: 'india' },
      { key: 'umich', label: 'UMich', src: 'UMCSENT', unit: '', d: 1, dir: 1, warn: 70, stress: 60 },
    ],
  },
  {
    group: 'Labour',
    series: [
      { key: 'unemp', label: 'Unemploy.', src: 'UNRATE', unit: '%', d: 1, dir: -1, warn: 4.5, stress: 5.5 },
      { key: 'payrolls', label: 'Nonfarm', src: 'PAYEMS', unit: 'k', d: 0, kind: 'mom', dir: 1, warn: 125, stress: 0 },
      { key: 'jobless', label: 'Jobless', src: 'ICSA', unit: 'k', d: 0, scale: 0.001, dir: -1, warn: 280, stress: 350 },
    ],
  },
];

/**
 * Build one slider cell from a transformed, ascending observation series
 * `[{date,v}]` plus its config. Returns { value, pos, pctile, lo, hi, tone,
 * asOf, unit } or { stale } when empty.
 */
export function boardCell(cfg, series) {
  const xs = (series || []).filter((r) => r && r.v != null && isFinite(r.v));
  if (!xs.length) return { stale: true };
  const last = xs[xs.length - 1];
  const stat = rangeStat(last.v, xs.map((r) => r.v));
  return {
    value: r2(last.v),
    pos: stat ? stat.pos : 50,
    pctile: stat ? stat.pctile : null,
    lo: stat ? stat.lo : null,
    hi: stat ? stat.hi : null,
    tone: tone(last.v, cfg),
    asOf: last.date,
    unit: cfg.unit,
  };
}
