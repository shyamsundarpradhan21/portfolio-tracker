// Market-regime classifier for the algo screen. PRIMARY axis = Nifty TREND (the axis
// VIX misses, and where IV/options strategies actually live); SECONDARY = vol from VIX.
// Pure: inputs are daily NIFTY OHLC + India VIX (data/regime-inputs.json).
//
// TREND (Kaufman efficiency ratio over a trailing window): |net move| / path length.
//   high ER = directional (up/down) · low ER = chop (oscillation with little net move).
// VOL: stressed when VIX level is high OR VIX EXPANDS fast (ΔVIX weighted over level —
//   short premium dies on vol expansion, not merely high vol); else calm.
// Kept COARSE: trend ∈ {up,down,chop} × vol ∈ {calm,stressed}, so thin per-algo live
// history doesn't shatter.

export const DEFAULT_REGIME_PARAMS = {
  trendWindow: 20,     // ~1 trading month
  trendMin: 0.20,      // ER below this = chop (calibrated: 2024 bull → up-majority,
                       //   full 3y ≈ 53% chop / 28% up / 18% down — a realistic mix)
  vixStress: 22,       // India-VIX stress level (macroBoard: stress 22)
  vixExpandPct: 0.10,  // ≥+10% day-over-day VIX = expansion → stressed
};

// Efficiency ratio at index i over a trailing window. null if insufficient history.
export function efficiencyRatio(closes, i, window) {
  if (i < window) return null;
  const net = Math.abs(closes[i] - closes[i - window]);
  let path = 0;
  for (let k = i - window + 1; k <= i; k++) path += Math.abs(closes[k] - closes[k - 1]);
  return path ? net / path : 0;
}

// 'up' | 'down' | 'chop' | null (warm-up). Direction from net sign; chop from low ER.
export function classifyTrend(closes, i, p = DEFAULT_REGIME_PARAMS) {
  const w = p.trendWindow;
  if (i < w) return null;
  const er = efficiencyRatio(closes, i, w);
  if (er == null) return null;
  if (er < p.trendMin) return 'chop';
  return closes[i] - closes[i - w] >= 0 ? 'up' : 'down';
}

// 'calm' | 'stressed' | 'unknown'. Stressed if VIX high OR expanding fast (ΔVIX weighted).
export function classifyVol(vix, vixPrev, p = DEFAULT_REGIME_PARAMS) {
  if (vix == null) return 'unknown';
  const dPct = vixPrev != null && vixPrev > 0 ? (vix - vixPrev) / vixPrev : 0;
  return vix >= p.vixStress || dPct >= p.vixExpandPct ? 'stressed' : 'calm';
}

const isoOf = (dmy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy); return m ? `${m[3]}-${m[2]}-${m[1]}` : dmy; };

// Build date(YYYY-MM-DD) → {trend, vol}. nifty = [{date,o,h,l,c}], vix = [{date,vix}].
export function buildRegimeCalendar(nifty, vix, p = DEFAULT_REGIME_PARAMS) {
  const closes = nifty.map((d) => d.c);
  const vixByDate = new Map(vix.map((v) => [v.date, v.vix]));
  const cal = new Map();
  for (let i = 0; i < nifty.length; i++) {
    const date = nifty[i].date;
    const vp = i > 0 ? vixByDate.get(nifty[i - 1].date) ?? null : null;
    cal.set(date, { trend: classifyTrend(closes, i, p), vol: classifyVol(vixByDate.get(date) ?? null, vp, p) });
  }
  return cal;
}

// Look up a regime for an algo trade-day ('DD/MM/YYYY'). null if not a known trading day.
export function regimeForDate(cal, dmyDate) {
  return cal.get(isoOf(dmyDate)) ?? null;
}

// Distribution of regime labels over the calendar (for the gut-check / sanity).
export function regimeDistribution(cal) {
  const trend = {}, vol = {};
  for (const r of cal.values()) {
    if (r.trend) trend[r.trend] = (trend[r.trend] || 0) + 1;
    vol[r.vol] = (vol[r.vol] || 0) + 1;
  }
  return { trend, vol };
}
