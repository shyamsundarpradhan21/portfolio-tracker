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

/**
 * Year-over-year % series from a monthly level/index series (ascending
 * [{date,v}]). YoY[i] = (v[i]/v[i-12] - 1) * 100. Used for CPI / Core CPI, which
 * FRED publishes as an index, not a rate.
 */
export function yoy(rows) {
  const xs = (rows || []).filter((r) => r && r.v != null && isFinite(r.v));
  const out = [];
  for (let i = 12; i < xs.length; i++) {
    const base = xs[i - 12].v;
    if (base) out.push({ date: xs[i].date, v: (xs[i].v / base - 1) * 100 });
  }
  return out;
}

/** Year-over-year % from a QUARTERLY index series (4 periods = 1 year) — e.g.
 * India real GDP, which FRED publishes as a quarterly constant-price index. */
export function yoyQ(rows) {
  const xs = (rows || []).filter((r) => r && r.v != null && isFinite(r.v));
  const out = [];
  for (let i = 4; i < xs.length; i++) {
    const base = xs[i - 4].v;
    if (base) out.push({ date: xs[i].date, v: (xs[i].v / base - 1) * 100 });
  }
  return out;
}

/** Month-over-month change of a level series (ascending [{date,v}]) — e.g. payrolls. */
export function mom(rows) {
  const xs = (rows || []).filter((r) => r && r.v != null && isFinite(r.v));
  const out = [];
  for (let i = 1; i < xs.length; i++) out.push({ date: xs[i].date, v: xs[i].v - xs[i - 1].v });
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
      { key: 'vix', label: 'US VIX', yahoo: '^VIX', unit: '', d: 1, dir: -1, warn: 18, stress: 25 },
      { key: 'indiaVix', label: 'India VIX', yahoo: '^INDIAVIX', unit: '', d: 1, dir: -1, warn: 16, stress: 22, region: 'india' },
      { key: 'dxy', label: 'DXY', yahoo: 'DX-Y.NYB', unit: '', d: 1, dir: -1, warn: 105, stress: 110 },
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
