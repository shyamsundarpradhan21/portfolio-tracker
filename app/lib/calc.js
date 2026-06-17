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
