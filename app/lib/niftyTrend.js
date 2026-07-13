// Daily returns + multi-horizon trend for the Nifty 50 Overview, derived from a
// daily close series ([{date:'YYYY-MM-DD', close}], ascending). Pure — the route
// (/api/nifty-daily) supplies the closes; the math is unit-tested so a window
// off-by-one or a sign flip fails here, not on a deploy. Direction is carried by
// COLOUR at render time; these return signed magnitudes for the caller to colour.

const r2 = (n) => (n == null || !isFinite(+n) ? null : Math.round(+n * 100) / 100);
const pctChange = (from, to) => (from ? ((to - from) / from) * 100 : null);

/**
 * The last `n` sessions' own day-over-day return (close vs the prior close).
 * Returns `[{date, pct}]` oldest→newest, each pct the % move INTO that session.
 * @param {Array<{date:string, close:number}>} closes  ascending
 */
export function dailyReturns(closes, n = 5) {
  const rows = (Array.isArray(closes) ? closes : []).filter((c) => c && isFinite(+c.close));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    out.push({ date: rows[i].date, pct: r2(pctChange(rows[i - 1].close, rows[i].close)) });
  }
  return out.slice(-n);
}

// Calendar lookback per window (days). Trend reads "level now vs level ~N ago".
const WINDOWS = [
  ['1W', 7],
  ['1M', 30],
  ['3M', 91],
  ['6M', 182],
  ['1Y', 365],
];

// The most recent close on or before `targetMs` (a completed session at/just
// before the lookback date). Bars are ascending, so we walk from the end.
function closeAtOrBefore(rows, targetMs) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = Date.parse(rows[i].date);
    if (isFinite(t) && t <= targetMs) return rows[i].close;
  }
  return null;
}

/**
 * % change of the latest close vs the close ~1W/1M/3M/6M/1Y ago (calendar lookback)
 * plus YTD (vs the prior calendar year-end close). Returns
 * `{ '1W':pct|null, '1M':…, '3M':…, '6M':…, YTD:…, '1Y':… }` in that order; a window
 * with insufficient history is null so the UI dashes it. `latest`/`latestDate`
 * override the series tail when the caller has a fresher live level than the last bar.
 * @param {Array<{date:string, close:number}>} closes  ascending
 */
export function trendWindows(closes, latest = null, latestDate = null) {
  const rows = (Array.isArray(closes) ? closes : []).filter((c) => c && isFinite(+c.close) && c.date);
  const out = { '1W': null, '1M': null, '3M': null, '6M': null, YTD: null, '1Y': null };
  if (rows.length < 2) return out;
  const lastClose = latest != null && isFinite(+latest) ? +latest : rows[rows.length - 1].close;
  const lastMs = Date.parse(latestDate || rows[rows.length - 1].date);
  const anchor = isFinite(lastMs) ? lastMs : Date.parse(rows[rows.length - 1].date);
  for (const [key, days] of WINDOWS) {
    const past = closeAtOrBefore(rows, anchor - days * 86400000);
    if (past != null) out[key] = r2(pctChange(past, lastClose));
  }
  // YTD — vs the last close of the PRIOR calendar year (the year-end level).
  const yearStart = Date.UTC(new Date(anchor).getUTCFullYear(), 0, 1);
  const ytdBase = closeAtOrBefore(rows, yearStart - 1);
  if (ytdBase != null) out.YTD = r2(pctChange(ytdBase, lastClose));
  return out;
}
