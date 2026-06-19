// Pure calculation helpers — no React, no imports, safe to use anywhere.

export const DAY_MS  = 86400000;
export const YEAR_MS = 365.25 * DAY_MS;
export const clampN  = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const compound = (P, ratePct, years) => P * Math.pow(1 + ratePct / 400, 4 * years);

/** Newton-Raphson XIRR with bisection fallback. cfs: [{ date: Date, amount }] */
export function xirr(cfs) {
  if (!cfs || cfs.length < 2) return null;
  const t0 = cfs[0].date.getTime();
  const yr  = cfs.map((c) => (c.date.getTime() - t0) / (365 * 864e5));
  const npv  = (r) => cfs.reduce((s, c, i) => s + c.amount / Math.pow(1 + r, yr[i]), 0);
  const dnpv = (r) => cfs.reduce((s, c, i) => s - (yr[i] * c.amount) / Math.pow(1 + r, yr[i] + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 60; i++) {
    const f = npv(r), d = dnpv(r);
    if (!isFinite(f) || !isFinite(d) || d === 0) break;
    let nr = r - f / d;
    if (nr <= -0.9999) nr = -0.9999;
    if (Math.abs(nr - r) < 1e-8) { r = nr; break; }
    r = nr;
  }
  if (isFinite(r) && Math.abs(npv(r)) < 1) return r;
  let lo = -0.9999, hi = 100, flo = npv(lo);
  if (!isFinite(flo)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-6) return mid;
    if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Weighted-average CAGR: Y = Σ(inv·date)/Σinv to today. */
export function weightedCagr(transactions, currentValue, now) {
  let sumInv = 0, sumWeightedT = 0;
  transactions.forEach((t) => {
    const tms = new Date(t.date).getTime();
    sumInv += t.invested; sumWeightedT += t.invested * tms;
  });
  if (!sumInv) return { cagr: null, years: null };
  const avgT  = sumWeightedT / sumInv;
  const years = (now.getTime() - avgT) / YEAR_MS;
  if (years <= 0) return { cagr: null, years };
  const cagr = Math.pow(currentValue / sumInv, 1 / years) - 1;
  return { cagr: isFinite(cagr) ? cagr * 100 : null, years };
}

/** Same-dated-rupees/dollars counterfactual for one benchmark series. */
export function benchCounterfactual(series, transactions, now) {
  if (!series || !Array.isArray(series.closes) || !series.closes.length) return null;
  const closes = [...series.closes].sort((a, b) => (a.date < b.date ? -1 : 1));
  const earliestTx = transactions.reduce((m, t) => (t.date < m ? t.date : m), '9999');
  if (closes[0].date > earliestTx || closes.length < 8) return null;
  const levelOnOrBefore = (iso) => {
    let lvl = null;
    for (const c of closes) { if (c.date <= iso) lvl = c.close; else break; }
    return lvl ?? closes[0].close;
  };
  const latest = isFinite(series.latest) ? series.latest : closes[closes.length - 1].close;
  let units = 0, invested = 0, ok = true;
  const cfs = [];
  transactions.forEach((t) => {
    const lvl = levelOnOrBefore(t.date);
    if (!isFinite(lvl) || lvl <= 0) { ok = false; return; }
    units += t.invested / lvl; invested += t.invested;
    cfs.push({ date: new Date(t.date), amount: -t.invested });
  });
  if (!ok || !units) return null;
  const value = units * latest;
  cfs.push({ date: now, amount: value });
  const x = xirr(cfs);
  const c = weightedCagr(transactions, value, now);
  return {
    value,
    xirr:  x  != null ? x * 100   : null,
    cagr:  c.cagr,
    ret:   invested ? ((value - invested) / invested) * 100 : null,
  };
}

/** Portfolio beta / annualised volatility vs Nifty-50. Weekly regression. */
export function computeBetaVol(hist, held, _now) {
  if (!hist || !hist.series) return null;
  let mkt = null;
  for (const s of ['^NSEI', 'NIFTYBEES.NS']) {
    const ser = hist.series[s];
    if (ser && Array.isArray(ser.closes) && ser.closes.length >= 24) { mkt = ser; break; }
  }
  if (!mkt) return null;
  const mapOf = (ser) => {
    const m = {};
    ((ser && ser.closes) || []).forEach((c) => { if (isFinite(c.close) && c.close > 0) m[c.date] = c.close; });
    return m;
  };
  const mm     = mapOf(mkt);
  const dates  = Object.keys(mm).sort();
  const holds  = held.map((h) => ({ qty: h.qty, m: mapOf(hist.series[h.ns]) }));
  const last   = holds.map(() => null);
  const pv = [], mv = [];
  for (const d of dates) {
    let v = 0, ok = true;
    for (let i = 0; i < holds.length; i++) {
      const c = holds[i].m[d];
      if (c != null) last[i] = c;
      if (last[i] == null) { ok = false; break; }
      v += holds[i].qty * last[i];
    }
    if (!ok) continue;
    pv.push(v); mv.push(mm[d]);
  }
  if (pv.length < 24) return null;
  const rp = [], rm = [];
  for (let i = 1; i < pv.length; i++) {
    if (pv[i-1] > 0 && mv[i-1] > 0) { rp.push(pv[i]/pv[i-1]-1); rm.push(mv[i]/mv[i-1]-1); }
  }
  if (rp.length < 20) return null;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const mp = mean(rp), mkm = mean(rm);
  let cov = 0, vm = 0, vp = 0;
  for (let i = 0; i < rp.length; i++) {
    cov += (rp[i]-mp)*(rm[i]-mkm); vm += (rm[i]-mkm)**2; vp += (rp[i]-mp)**2;
  }
  const n = rp.length; cov /= n; vm /= n; vp /= n;
  const beta  = vm > 0 ? cov / vm : null;
  const alpha = beta != null ? (mp - beta * mkm) * 52 : null;
  // Annualised Sharpe from the weekly series: mean weekly return in excess of
  // the risk-free rate, per unit of weekly σ, scaled by √52. RF ≈ India 1-yr
  // T-bill (~6.5%). A risk-adjusted return that can't be read off the benchmark
  // table — pairs with the volatility stat ("is the bumpiness worth it?").
  const RF_ANNUAL = 0.065;
  const sharpe = vp > 0 ? ((mp - RF_ANNUAL / 52) / Math.sqrt(vp)) * Math.sqrt(52) : null;
  return {
    beta, alpha, sharpe,
    vol:    Math.sqrt(vp * 52) * 100,
    mktVol: Math.sqrt(vm * 52) * 100,
    rsq:    (vp > 0 && vm > 0) ? (cov * cov) / (vp * vm) : null,
    weeks:  pv.length,
  };
}

// ── Generalised sensitivity regressions (macro scenario engine) ──────────────
// computeBetaVol above is hardwired to Nifty + the full Indian book. The macro
// engine needs the same weekly-returns math for ANY basket vs ANY driver, and
// must report R²/lookback so a weak fit can be visually flagged (not rendered
// as if it were a hard number).

const _closeMap = (ser) => {
  const m = {};
  ((ser && ser.closes) || []).forEach((c) => { if (isFinite(c.close) && c.close > 0) m[c.date] = c.close; });
  return m;
};

// Build a weekly basket-value series aligned to `driverMap`'s dates, carrying
// each holding's last-known close forward. Returns { dates, pv, dv } where pv is
// basket value and dv is the driver level, only for weeks where every holding
// has a price. symOf(h) → the hist.series key for that holding.
function _alignedSeries(hist, held, driverMap, symOf) {
  const dates = Object.keys(driverMap).sort();
  const holds = held.map((h) => ({ qty: h.qty, m: _closeMap(hist.series[symOf(h)]) }));
  const last = holds.map(() => null);
  const pv = [], dv = [];
  for (const d of dates) {
    let v = 0, ok = true;
    for (let i = 0; i < holds.length; i++) {
      const c = holds[i].m[d];
      if (c != null) last[i] = c;
      if (last[i] == null) { ok = false; break; }
      v += holds[i].qty * last[i];
    }
    if (!ok) continue;
    pv.push(v); dv.push(driverMap[d]);
  }
  return { pv, dv };
}

// Ordinary least squares of series y on series x → slope, R². `ann` is the
// periods-per-year annualisation factor (52 weekly, 12 monthly).
function _ols(y, x, ann = 52) {
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const my = mean(y), mx = mean(x);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < y.length; i++) { cov += (y[i]-my)*(x[i]-mx); vx += (x[i]-mx)**2; vy += (y[i]-my)**2; }
  const n = y.length; cov /= n; vx /= n; vy /= n;
  return {
    slope: vx > 0 ? cov / vx : null,
    rsq:   (vx > 0 && vy > 0) ? (cov*cov)/(vx*vy) : null,
    volY:  Math.sqrt(vy * ann) * 100,
    volX:  Math.sqrt(vx * ann) * 100,
  };
}

// OLS with the slope's standard error, 95% CI (normal approx) and the sample
// size `n` — needed to gate a regression on observation count, not just R².
// Sample size and goodness-of-fit are SEPARATE quality signals; both returned.
function _olsCI(y, x) {
  const n = y.length;
  if (n < 3) return null; // can't form a residual variance with <3 points
  const mean = (a) => a.reduce((s, v) => s + v, 0) / n;
  const my = mean(y), mx = mean(x);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (y[i]-my)*(x[i]-mx); sxx += (x[i]-mx)**2; syy += (y[i]-my)**2; }
  if (sxx <= 0) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) { const e = y[i] - (intercept + slope * x[i]); sse += e * e; }
  const dof = n - 2;
  const se = dof > 0 ? Math.sqrt((sse / dof) / sxx) : null;
  const rsq = syy > 0 ? (sxy * sxy) / (sxx * syy) : null;
  const T = 1.96; // normal approx — honest enough for the range we disclose
  return { slope, rsq, se, n, ciLo: se != null ? slope - T * se : null, ciHi: se != null ? slope + T * se : null };
}

/**
 * Returns-beta of a holdings basket vs a benchmark price series.
 * @param cadence 'weekly' | 'monthly' — sets the annualisation factor (52 / 12).
 *   The driver series' own date grid defines the alignment; cadence only scales
 *   the annualised vols and the min-observations bar.
 * @returns { beta, rsq, weeks, vol, mktVol } or null if data is insufficient.
 */
export function regressHoldings(hist, held, benchSyms, symOf, cadence = 'weekly', rfAnnual = 0.065) {
  if (!hist || !hist.series || !held || !held.length) return null;
  const ann = cadence === 'monthly' ? 12 : 52;
  const minObs = cadence === 'monthly' ? 12 : 24;
  let mkt = null;
  for (const s of benchSyms) {
    const ser = hist.series[s];
    if (ser && Array.isArray(ser.closes) && ser.closes.length >= minObs) { mkt = ser; break; }
  }
  if (!mkt) return null;
  const { pv, dv } = _alignedSeries(hist, held, _closeMap(mkt), symOf);
  if (pv.length < minObs) return null;
  const rp = [], rm = [];
  for (let i = 1; i < pv.length; i++) {
    if (pv[i-1] > 0 && dv[i-1] > 0) { rp.push(pv[i]/pv[i-1]-1); rm.push(dv[i]/dv[i-1]-1); }
  }
  if (rp.length < minObs - 4) return null;
  const o = _ols(rp, rm, ann);
  // Annualised Sharpe from the basket's OWN return series (excess of the per-period
  // risk-free), so any sleeve gets a risk-adjusted read — not just beta. rfAnnual
  // defaults to the India 1-yr T-bill; pass the local risk-free for a USD book.
  const mp = rp.reduce((s, r) => s + r, 0) / rp.length;
  let vp = 0; for (const r of rp) vp += (r - mp) ** 2; vp /= rp.length;
  const sharpe = vp > 0 ? ((mp - rfAnnual / ann) / Math.sqrt(vp)) * Math.sqrt(ann) : null;
  return { beta: o.slope, sharpe, rsq: o.rsq, vol: o.volY, mktVol: o.volX, weeks: pv.length };
}

/**
 * Duration proxy: sensitivity of a basket's RETURN to CHANGES in a yield level
 * series (e.g. ^TNX, the US 10Y — quoted in %). Slope = fractional return per
 * +1bp move, with R²/lookback for flagging.
 * @param cadence 'weekly' | 'monthly'.
 * @returns { perBp, rsq, weeks } or null.
 */
export function regressVsYield(hist, held, yieldSyms, symOf, cadence = 'weekly') {
  if (!hist || !hist.series || !held || !held.length) return null;
  const ann = cadence === 'monthly' ? 12 : 52;
  const minObs = cadence === 'monthly' ? 12 : 24;
  let ys = null;
  for (const s of yieldSyms) {
    const ser = hist.series[s];
    if (ser && Array.isArray(ser.closes) && ser.closes.length >= minObs) { ys = ser; break; }
  }
  if (!ys) return null;
  const { pv, dv } = _alignedSeries(hist, held, _closeMap(ys), symOf); // dv = yield level (%)
  if (pv.length < minObs) return null;
  const rp = [], dy = [];
  for (let i = 1; i < pv.length; i++) {
    if (pv[i-1] > 0) { rp.push(pv[i]/pv[i-1]-1); dy.push((dv[i]-dv[i-1]) * 100); } // Δ in bps
  }
  if (rp.length < minObs - 4) return null;
  const o = _ols(rp, dy, ann);
  return { perBp: o.slope, rsq: o.rsq, weeks: pv.length };
}

/**
 * Sensitivity of a return series to period-over-period CHANGES in the VIX level.
 * Caller supplies index-aligned `returns` and period-end `vixLevels` (same
 * length; returns[0] may be null when there's no prior period). Regresses
 * return[i] on ΔVIX[i] = vix[i] − vix[i−1]. Used for BOTH the Stratzy book's
 * own monthly P&L and a long-history short-vol proxy — the slope is fractional
 * return per +1 VIX point.
 * @returns { perVixPt, rsq, se, n, ciLo, ciHi } or null when <3 usable pairs.
 *   `n` (observation count) is FIRST-CLASS: the caller gates the confidence
 *   tier on it, because a slope from a handful of points is noise, not a fit.
 */
export function regressVsVix(returns, vixLevels) {
  if (!Array.isArray(returns) || !Array.isArray(vixLevels) || returns.length !== vixLevels.length) return null;
  const r = [], dv = [];
  for (let i = 1; i < returns.length; i++) {
    const ret = returns[i], v = vixLevels[i], vp = vixLevels[i - 1];
    if (ret != null && isFinite(ret) && v != null && vp != null && isFinite(v) && isFinite(vp)) {
      r.push(ret); dv.push(v - vp);
    }
  }
  const o = _olsCI(r, dv);
  if (!o) return null;
  return { perVixPt: o.slope, rsq: o.rsq, se: o.se, n: o.n, ciLo: o.ciLo, ciHi: o.ciHi };
}

/** Apply bonus corporate actions (ex-date passed) to holdings. */
export function applyCorpActions(holdings, now, CORPORATE_ACTIONS, isoOf) {
  const today = isoOf(now);
  return holdings.map((h) => {
    let qty = h.qty, cost = h.cost;
    CORPORATE_ACTIONS.forEach((a) => {
      if (a.type === 'bonus' && a.sym === h.sym && a.ex <= today) {
        const [num, den] = a.ratio.split(':').map(Number);
        const bonus  = Math.floor((qty * num) / den);
        const newQty = qty + bonus;
        if (newQty > 0) { cost = (qty * cost) / newQty; qty = newQty; }
      }
    });
    return { ...h, qty, cost };
  });
}
