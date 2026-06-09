'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  INDIAN, US, FDS, FD_PIPELINE, MF, MF_FUNDS, MF_CASHFLOWS, UNITS_AS_OF,
  ALGO, SWING, STATIC, PROJECTION, ALLOC_COLORS,
  TRANSACTIONS, CORPORATE_ACTIONS, INDIAN_REALIZED, INDIAN_BENCHMARKS,
  US_CASHFLOWS, US_BENCHMARKS, US_DIVIDENDS, US_REALIZED,
} from './portfolio';
import FY from '../data/fy2526_verified.json';
import ProjectionTab from './ProjectionTab';
import RealizedPanel from './RealizedPanel';

// ─── formatting helpers ───
const cl = (n) => (n >= 0 ? 'grn' : 'red');
const sg = (n) => (n >= 0 ? '+' : '-');
const inrFull = (n) =>
  '₹' + Math.round(n).toLocaleString('en-IN');
// Compact INR: Cr / L / K
function inrC(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return '₹' + (n / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K';
  return '₹' + Math.round(n);
}
const usd = (n) => '$' + Math.abs(n).toFixed(2);
// Percentages and signed-value displays drop the +/− sign — colour (grn/red via
// `cl`) conveys direction, uniformly across the dashboard.
const pctS = (n) => Math.abs(n).toFixed(2) + '%';

// ─── rupee-safe currency (Section 0f) — render ₹ inside a sized span so the
// monospace fallback glyph isn't oversized. Digit-only helpers + JSX wrappers. ───
const Rs = () => <span className="rs">₹</span>;
function inrCd(n) {                       // compact digits, no ₹
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return '' + Math.round(n);
}
const inrFd = (n) => Math.round(n).toLocaleString('en-IN'); // full digits, no ₹
const InrC = ({ n }) => (<span style={{ whiteSpace: 'nowrap' }}><Rs />{inrCd(n)}</span>);            // ₹4.04L
const InrF = ({ n }) => (<span style={{ whiteSpace: 'nowrap' }}><Rs />{inrFd(n)}</span>);            // ₹4,03,803
const SInrC = ({ n }) => (<span style={{ whiteSpace: 'nowrap' }}><Rs />{inrCd(Math.abs(n))}</span>);
const SInrF = ({ n }) => (<span style={{ whiteSpace: 'nowrap' }}><Rs />{inrFd(Math.abs(n))}</span>);
// Render any string that contains ₹ with each glyph sized via .rs (Section 0f).
// Lets pre-formatted strings (CFMemo values, data labels, subs) render safely.
function RsText({ children }) {
  const s = String(children ?? '');
  if (!s.includes('₹')) return <>{s}</>;
  return (
    <>{s.split('₹').map((p, i) => (i === 0 ? <Fragment key={i}>{p}</Fragment> : <Fragment key={i}><Rs />{p}</Fragment>))}</>
  );
}
// Signed full-rupee with grouping, e.g. -₹12,619 / +₹1,06,376
const sFull = (n) => sg(n) + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
const numC = (n) => Math.round(n).toLocaleString('en-IN'); // plain grouped (charges)

const FETCH_TS_KEY = 'nwTracker.cache';
const INSIGHTS_KEY = 'nwTracker.insights';
const MFNAV_KEY = 'nwTracker.mfnav';
const HIST_KEY = 'nwTracker.hist';
const REFRESH_MS = 15 * 60 * 1000;

// ─── mutual-fund derivations (pure; shared by the MF tab + insight payload) ───
// Layers live NAV (from /api/mf-nav) over the static units/cost; falls back to
// casNav per fund when a NAV hasn't resolved.
function deriveMf(mfNav) {
  const fundsNav = (mfNav && mfNav.funds) || {};
  let totVal = 0, totCost = 0;
  const rows = MF_FUNDS.map((f) => {
    const info = fundsNav[f.id];
    const nav = info && isFinite(info.nav) ? info.nav : f.casNav;
    const value = f.units * nav;
    const ret = f.cost ? ((value - f.cost) / f.cost) * 100 : 0;
    totVal += value; totCost += f.cost;
    return { ...f, nav, value, ret, fresh: info ? !!info.fresh : false, navDate: info ? info.date : null };
  });
  rows.forEach((r) => { r.share = totVal ? (r.value / totVal) * 100 : 0; });
  const sub = (pred) => {
    const a = rows.filter(pred);
    const v = a.reduce((s, r) => s + r.value, 0);
    const c = a.reduce((s, r) => s + r.cost, 0);
    return { value: v, cost: c, ret: c ? ((v - c) / c) * 100 : 0 };
  };
  const v = (id) => { const r = rows.find((x) => x.id === id); return r ? r.value : 0; };
  const alloc = {
    equity: v('flexi') + v('nifty50') + v('midcap') + v('next50') + v('small') + v('elss'),
    arbitrage: v('arb'),
    debt: 0,
  };
  // Real market-cap allocation from each fund's `mcap` weights (index funds are
  // exact by mandate; ELSS = LargeMidcap 250 50/50). Funds without `mcap`
  // (actively-managed Flexi Cap) fall into an honest "Multi" bucket until a
  // factsheet split is supplied. No fabricated 70/20/10.
  const cap = { large: 0, mid: 0, small: 0, multi: 0, hedged: 0 };
  rows.forEach((r) => {
    if (!r.mcap) { cap.multi += r.value; return; }
    ['large', 'mid', 'small', 'multi', 'hedged'].forEach((k) => {
      if (r.mcap[k]) cap[k] += r.value * r.mcap[k];
    });
  });
  return {
    rows, totVal, totCost,
    totRet: totCost ? ((totVal - totCost) / totCost) * 100 : 0,
    jio: sub((r) => r.platform === 'JioBLK'),
    elss: sub((r) => r.platform === 'Zerodha'),
    alloc, cap, v,
  };
}

// ─── fixed-deposit derivations (pure; no external feed — driven by the system
// clock only). Indian cumulative FDs compound quarterly: A = P(1 + r/400)^4t.
// Recomputed on mount and hourly so accrued interest and the deploy countdown
// tick on their own. Simple interest (P×r×t) is intentionally never used. ───
const DAY_MS = 86400000;
const YEAR_MS = 365.25 * DAY_MS;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const compound = (P, ratePct, years) => P * Math.pow(1 + ratePct / 400, 4 * years);

function deriveFds(now) {
  const t = now.getTime();
  let principal = 0, accrued = 0, maturity = 0, weightedRate = 0;
  const rows = FDS.map((f) => {
    const openT = new Date(f.open).getTime();
    const matT = new Date(f.matures).getTime();
    const totalYears = (matT - openT) / YEAR_MS;
    const elapsedYears = clamp((t - openT) / YEAR_MS, 0, totalYears);
    const maturityValue = compound(f.principal, f.rate, totalYears);
    const accruedSoFar = compound(f.principal, f.rate, elapsedYears) - f.principal;
    principal += f.principal;
    accrued += accruedSoFar;
    maturity += maturityValue;
    weightedRate += f.principal * f.rate;
    return {
      ...f, totalYears, elapsedYears, maturityValue,
      maturityInterest: maturityValue - f.principal,
      accruedSoFar, progress: totalYears ? (elapsedYears / totalYears) * 100 : 0,
    };
  });

  // Countdown badge on the nearest FUTURE deploy only.
  const pipeline = FD_PIPELINE.map((f) => ({
    ...f, days: Math.ceil((new Date(f.deploy).getTime() - t) / DAY_MS),
  }));
  let nextIdx = -1;
  pipeline.forEach((f, i) => {
    if (f.days >= 0 && (nextIdx === -1 || f.days < pipeline[nextIdx].days)) nextIdx = i;
  });
  if (nextIdx >= 0) {
    const d = pipeline[nextIdx].days;
    pipeline[nextIdx] = {
      ...pipeline[nextIdx],
      badge: d === 0 ? 'NEXT · TODAY' : d === 1 ? 'NEXT · 1 DAY' : `NEXT · ${d} DAYS`,
    };
  }

  return {
    rows, principal, accrued, maturity,
    blendedRate: principal ? weightedRate / principal : 0,
    pipeline,
    pipelineTotal: FD_PIPELINE.reduce((s, f) => s + f.amount, 0),
    nextPipeline: nextIdx >= 0 ? pipeline[nextIdx] : null,
  };
}

// XIRR via Newton-Raphson, bisection fallback. cfs: [{ date: Date, amount }].
function xirr(cfs) {
  if (!cfs || cfs.length < 2) return null;
  const t0 = cfs[0].date.getTime();
  const yr = cfs.map((c) => (c.date.getTime() - t0) / (365 * 864e5));
  const npv = (r) => cfs.reduce((s, c, i) => s + c.amount / Math.pow(1 + r, yr[i]), 0);
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
  // bisection fallback over a wide bracket
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

// Portfolio XIRR vs the Nifty-50 counterfactual (same dated rupees, benchmark NAVs).
function mfXirr(mf, mfNav) {
  const today = new Date();
  const base = MF_CASHFLOWS.map((c) => ({ date: new Date(c.date), amount: c.amount }));
  const port = xirr([...base, { date: today, amount: mf.totVal }]);
  let benchRet = null, benchVal = null;
  const bench = mfNav && mfNav.benchmark;
  if (bench && bench.navByDate && isFinite(bench.latestNav)) {
    let units = 0, ok = true;
    for (const c of MF_CASHFLOWS) {
      const nav = bench.navByDate[c.date];
      if (!isFinite(nav) || nav <= 0) { ok = false; break; }
      units += (-c.amount) / nav;
    }
    if (ok) {
      benchVal = units * bench.latestNav;
      benchRet = xirr([...base, { date: today, amount: benchVal }]);
    }
  }
  return {
    port: port != null ? port * 100 : null,
    bench: benchRet != null ? benchRet * 100 : null,
    benchVal,
    benchName: (bench && bench.name) || 'Nifty 50 Index',
  };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "2026-06-05" → "05 Jun 2026"
function fmtNavDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]} ${MON[+m[2] - 1]} ${m[1]}` : null;
}
// Date → "07 Jun 2026"
function fmtDateObj(d) {
  return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
const isoOf = (d) => d.toISOString().slice(0, 10);

// Map the US holding's asset `cat` to a GICS sector for the sector chart (the
// Category column keeps the raw `cat`). Names match Vested's sector split.
const US_SECTOR = {
  ETF: 'Diversified ETF', Crypto: 'Crypto', Bond: 'Fixed Income',
  Commodity: 'Commodity', Tech: 'Information Technology', Financial: 'Financials',
  Fintech: 'Financials', Consumer: 'Consumer Staples', Industrial: 'Industrials',
  Healthcare: 'Health Care',
};
const US_SECTOR_OVERRIDE = {
  SHW: 'Materials', AMZN: 'Consumer Discretionary',
  GOOG: 'Communication Services', META: 'Communication Services', DIS: 'Communication Services',
};
const usSectorOf = (s) => US_SECTOR_OVERRIDE[s.sym] || US_SECTOR[s.cat] || s.cat;

// ETF sector look-through (approx published weights) so the US sector split
// lines up with Vested, which cracks ETFs into underlying sectors rather than a
// single "ETF" slice. Refresh weights at the monthly update if they drift.
const ETF_LOOKTHROUGH = {
  QQQM: { 'Information Technology': 0.50, 'Communication Services': 0.16, 'Consumer Discretionary': 0.14, 'Health Care': 0.06, 'Consumer Staples': 0.04, 'Industrials': 0.05, 'Financials': 0.01, 'All Others': 0.04 },
  IVV:  { 'Information Technology': 0.33, 'Financials': 0.14, 'Communication Services': 0.09, 'Health Care': 0.10, 'Consumer Discretionary': 0.10, 'Consumer Staples': 0.06, 'Industrials': 0.08, 'Materials': 0.02, 'All Others': 0.08 },
  SCHD: { 'Financials': 0.19, 'Consumer Staples': 0.19, 'Health Care': 0.16, 'Industrials': 0.13, 'Information Technology': 0.10, 'Consumer Discretionary': 0.08, 'Communication Services': 0.05, 'Materials': 0.04, 'All Others': 0.06 },
  EFA:  { 'Financials': 0.21, 'Industrials': 0.17, 'Health Care': 0.12, 'Consumer Discretionary': 0.11, 'Information Technology': 0.09, 'Consumer Staples': 0.09, 'Materials': 0.07, 'Communication Services': 0.04, 'All Others': 0.10 },
  EEM:  { 'Information Technology': 0.24, 'Financials': 0.23, 'Consumer Discretionary': 0.13, 'Communication Services': 0.09, 'Materials': 0.07, 'Consumer Staples': 0.05, 'Industrials': 0.06, 'All Others': 0.13 },
};
// US market-cap buckets (direct stocks) — Mega / Large / Mid / Small, matching
// Vested's tiers. Bonds/commodity are excluded from the cap split (equity only).
const US_CAP = {
  AAPL: 'Mega', MSFT: 'Mega', NVDA: 'Mega', GOOG: 'Mega', AMZN: 'Mega', META: 'Mega', AVGO: 'Mega',
  TSM: 'Mega', JPM: 'Mega', V: 'Mega', MA: 'Mega', ASML: 'Mega', CRM: 'Mega', ADBE: 'Mega',
  KO: 'Mega', PG: 'Mega', PEP: 'Mega', TMO: 'Mega',
  MCO: 'Large', INTU: 'Large', DE: 'Large', DIS: 'Large', COIN: 'Large', HOOD: 'Large',
  FTNT: 'Large', CPRT: 'Large', SHW: 'Large', PYPL: 'Large',
  MARA: 'Mid', RIOT: 'Mid', CORZ: 'Mid', CLSK: 'Mid', IREN: 'Mid',
  HUT: 'Small', KEEL: 'Small', CIFR: 'Small', WULF: 'Small', APLD: 'Small', BTDR: 'Small', GLXY: 'Small',
};
// Cap look-through for equity ETFs (approx), so the split follows Vested.
const ETF_CAP = {
  QQQM: { Mega: 0.62, Large: 0.30, Mid: 0.08 },
  IVV:  { Mega: 0.50, Large: 0.38, Mid: 0.12 },
  SCHD: { Mega: 0.38, Large: 0.47, Mid: 0.15 },
  EFA:  { Mega: 0.28, Large: 0.52, Mid: 0.20 },
  EEM:  { Mega: 0.22, Large: 0.48, Mid: 0.25, Small: 0.05 },
};

// Shared categorical palette for ALL allocation visuals (Indian sector & cap,
// US sector, MF market-cap) — uniform slice colours across tabs. These are
// category hues, NOT the semantic green/red used for gains/losses.
const SECTOR_PALETTE = ['var(--blu)', 'var(--pur)', 'var(--cyn)', 'var(--grn)', 'var(--pnk)', 'var(--acc)', '#7A8CA8'];
const OTHERS_COLOR = 'var(--txt3)';

// Market open/closed by the exchange's own wall clock — deterministic, unlike
// Yahoo's marketState which lagged and mislabelled sessions. Mon–Fri only;
// holidays are not modelled (acceptable for a personal tracker).
function marketOpenByClock(timeZone, startMin, endMin) {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t) => p.find((x) => x.type === t)?.value;
    const wd = get('weekday');
    if (wd === 'Sat' || wd === 'Sun') return false;
    let hh = parseInt(get('hour'), 10); if (hh === 24) hh = 0;
    const mins = hh * 60 + parseInt(get('minute'), 10);
    return mins >= startMin && mins < endMin;
  } catch { return null; }
}
// NSE 09:15–15:30 IST · NYSE 09:30–16:00 ET
const nseOpenNow = () => marketOpenByClock('Asia/Kolkata', 555, 930);
const nyseOpenNow = () => marketOpenByClock('America/New_York', 570, 960);
const daysBetween = (fromIso, now) =>
  Math.ceil((new Date(fromIso).getTime() - now.getTime()) / DAY_MS);

// Apply any bonus corporate action whose ex-date has passed to the holdings, so
// quantities/avg-cost adjust automatically once the date arrives (cost basis is
// unchanged). Dividends don't change qty. Pure — keyed off `now`.
function applyCorpActions(holdings, now) {
  const today = isoOf(now);
  return holdings.map((h) => {
    let qty = h.qty, cost = h.cost;
    CORPORATE_ACTIONS.forEach((a) => {
      if (a.type === 'bonus' && a.sym === h.sym && a.ex <= today) {
        const [num, den] = a.ratio.split(':').map(Number); // '1:3' → 1 per 3 held
        const bonus = Math.floor((qty * num) / den);
        const newQty = qty + bonus;
        if (newQty > 0) { cost = (qty * cost) / newQty; qty = newQty; }
      }
    });
    return { ...h, qty, cost }; // h.inv (original cost basis) is preserved
  });
}

// CAGR over the invested-WEIGHTED average holding period.
// Y = years from Σ(invested·date)/Σinvested to today; (value/Σinv)^(1/Y) − 1.
function weightedCagr(transactions, currentValue, now) {
  let sumInv = 0, sumWeightedT = 0;
  transactions.forEach((t) => {
    const tms = new Date(t.date).getTime();
    sumInv += t.invested;
    sumWeightedT += t.invested * tms;
  });
  if (!sumInv) return { cagr: null, years: null };
  const avgT = sumWeightedT / sumInv;
  const years = (now.getTime() - avgT) / YEAR_MS;
  if (years <= 0) return { cagr: null, years };
  const cagr = Math.pow(currentValue / sumInv, 1 / years) - 1;
  return { cagr: isFinite(cagr) ? cagr * 100 : null, years };
}

// Same-dated-rupees counterfactual for one benchmark series. For each
// transaction, buy units at the index level on-or-before its date; value the
// units at today's level. Returns { value, xirr, ret } or null if unresolved.
function benchCounterfactual(series, transactions, now) {
  if (!series || !Array.isArray(series.closes) || !series.closes.length) return null;
  const closes = [...series.closes].sort((a, b) => (a.date < b.date ? -1 : 1));
  // Reject series that don't actually cover the holding window — otherwise every
  // pre-history date snaps to the first (≈ latest) close and the counterfactual
  // collapses to ~0%. A too-short/new ETF series is treated as unresolved ("—").
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
    units += t.invested / lvl;
    invested += t.invested;
    cfs.push({ date: new Date(t.date), amount: -t.invested });
  });
  if (!ok || !units) return null;
  const value = units * latest;
  cfs.push({ date: now, amount: value });
  const x = xirr(cfs);
  const c = weightedCagr(transactions, value, now);
  return {
    value,
    xirr: x != null ? x * 100 : null,
    cagr: c.cagr,
    ret: invested ? ((value - invested) / invested) * 100 : null,
  };
}

// Value-focused (fractional shares), plus the extra Category column. USD.
const US_COLS = [
  { key: 'sym', label: 'Ticker', num: false },
  { key: 'cat', label: 'Category', num: false },
  { key: 'livePrice', label: 'Live $', num: true },
  { key: 'liveVal', label: 'Value $', num: true },
  { key: 'inv', label: 'Invested $', num: true },
  { key: 'livePl', label: 'P&L $', num: true },
  { key: 'livePct', label: 'P&L %', num: true },
  { key: 'dayPct', label: 'Day %', num: true },
];

// Distil live state into a compact payload for the /api/insights route.
// Only outlier holdings are sent to reduce prompt tokens by ~40%.
function buildInsightPayload(prices, fx, mfNav, hist) {
  const rate = fx || 88;
  const r2 = (n) => (n == null ? null : +n.toFixed(2));

  const now = new Date();
  const heldIndian = applyCorpActions(INDIAN, now);
  let inInv = 0, inVal = 0;
  const sectorVal = {};
  const allIndian = heldIndian.map((s) => {
    const q = prices[s.ns];
    const lp = q && !q.error ? q.price : null;
    const v = lp != null ? s.qty * lp : null;
    const pl = v != null ? v - s.inv : null;
    inInv += s.inv;
    if (v != null) { inVal += v; sectorVal[s.sector] = (sectorVal[s.sector] || 0) + v; }
    return {
      sym: s.sym, sector: s.sector, cap: s.cap, qty: s.qty, avgCost: s.cost, livePrice: r2(lp),
      val: v, plPct: pl != null ? r2((pl / s.inv) * 100) : null,
      dayPct: q && !q.error ? r2(q.pct) : null,
    };
  });
  // Send only positions with significant P&L or intraday moves
  const indian = allIndian.filter(
    (r) => (r.plPct != null && Math.abs(r.plPct) > 10) ||
            (r.dayPct != null && Math.abs(r.dayPct) > 2),
  );
  // Structured Indian-equity signals for the indian_stocks insight key.
  const inValuedRows = allIndian.filter((r) => r.plPct != null);
  const inWinner = inValuedRows.length ? inValuedRows.reduce((a, b) => (b.plPct > a.plPct ? b : a)) : null;
  const inLaggard = inValuedRows.length ? inValuedRows.reduce((a, b) => (b.plPct < a.plPct ? b : a)) : null;
  const inTopPos = inValuedRows.length && inVal ? inValuedRows.reduce((a, b) => ((b.val || 0) > (a.val || 0) ? b : a)) : null;
  const inTopSectorEntry = Object.entries(sectorVal).sort((a, b) => b[1] - a[1])[0] || null;
  const inXirrCf = TRANSACTIONS.map((t) => ({ date: new Date(t.date), amount: -t.invested }));
  const inTotInv = TRANSACTIONS.reduce((s, t) => s + t.invested, 0);
  const inXirr = inVal ? xirr([...inXirrCf, { date: now, amount: inVal }]) : null;
  const inPlPct = inInv && inVal ? ((inVal - inInv) / inInv) * 100 : null;

  // S02 swing book live unrealised P&L (for the algo insight).
  let swInv = 0, swVal = 0, swValued = true;
  SWING.forEach((s) => {
    const q = prices[s.ns];
    const lp = q && !q.error ? q.price : null;
    swInv += s.inv;
    if (lp != null) swVal += s.qty * lp; else swValued = false;
  });
  const swPl = swValued ? swVal - swInv : null;

  let usInv = 0, usVal = 0;
  const allUs = US.map((s) => {
    const q = prices[s.sym];
    const lp = q && !q.error ? q.price : null;
    const v = lp != null ? s.qty * lp : null;
    const pl = v != null ? v - s.inv : null;
    usInv += s.inv;
    if (v != null) usVal += v;
    return {
      sym: s.sym, qty: +s.qty.toFixed(4), avgCost: s.cost, livePrice: r2(lp),
      plPct: pl != null && s.inv ? r2((pl / s.inv) * 100) : null,
      dayPct: q && !q.error ? r2(q.pct) : null,
      _val: v,
    };
  });
  // Always include top 3 holdings by value (concentration context) + outliers
  const top3Syms = new Set(
    [...allUs].filter((r) => r._val != null)
      .sort((a, b) => b._val - a._val).slice(0, 3).map((r) => r.sym),
  );
  const us = allUs
    .filter(
      (r) => top3Syms.has(r.sym) ||
              (r.plPct != null && Math.abs(r.plPct) > 15) ||
              (r.dayPct != null && Math.abs(r.dayPct) > 3),
    )
    .map(({ _val, ...rest }) => rest);

  const usInr = usVal * rate;
  const mfd = deriveMf(mfNav);
  const mx = mfXirr(mfd, mfNav);
  const fds = deriveFds(new Date());
  const totalAssets = inVal + usInr + fds.principal + fds.accrued + STATIC.algo + mfd.totVal;
  const nw = totalAssets - STATIC.loan;

  // Largest position + worst drag, for the MF insight.
  const mfSorted = [...mfd.rows].sort((a, b) => b.value - a.value);
  const largest = mfSorted[0];
  const drag = [...mfd.rows].sort((a, b) => a.ret - b.ret)[0];
  const capTotal = mfd.cap.large + mfd.cap.mid + mfd.cap.small + mfd.cap.multi + mfd.cap.hedged || 1;
  const mfSignal = {
    invested: Math.round(mfd.totCost),
    value: Math.round(mfd.totVal),
    returnPct: r2(mfd.totRet),
    xirrPct: r2(mx.port),
    benchmarkXirrPct: r2(mx.bench),
    xirrDeltaPct: mx.port != null && mx.bench != null ? r2(mx.port - mx.bench) : null,
    perFund: mfd.rows.map((f) => ({ name: f.name, ret: r2(f.ret), sharePct: r2(f.share) })),
    drag: drag ? `${drag.name} ${r2(drag.ret)}%` : null,
    largest: largest ? `${largest.name} (${r2(largest.share)}% of MF)` : null,
    mix: `equity ${r2((mfd.alloc.equity / (mfd.totVal || 1)) * 100)}%, arbitrage ${r2((mfd.alloc.arbitrage / (mfd.totVal || 1)) * 100)}%`,
    capTilt: `large ${r2((mfd.cap.large / capTotal) * 100)}%, mid ${r2((mfd.cap.mid / capTotal) * 100)}%, small ${r2((mfd.cap.small / capTotal) * 100)}%, multi/flexi ${r2((mfd.cap.multi / capTotal) * 100)}%, hedged ${r2((mfd.cap.hedged / capTotal) * 100)}%`,
    sip: '₹20K/mo JioBlackRock SIP registered, first installment pending; seeded ₹20K (13-Jan-26) + ₹30K (20-Mar-26); ELSS 3-yr lock-in to 26-Feb-2027',
    caveats:
      'Short ~4-month window for the JioBlackRock contributions — XIRR is highly sensitive and not indicative of skill. ' +
      'Benchmark is a pure Nifty 50 index, so the portfolio\'s midcap/smallcap tilt flatters the comparison. ' +
      'Do not over-claim outperformance.',
  };

  return {
    timestamp: new Date().toISOString(),
    overview: {
      netWorthL: +(nw / 1e5).toFixed(2),
      totalAssetsL: +(totalAssets / 1e5).toFixed(2),
      indianPlPct: inInv && inVal ? r2(((inVal - inInv) / inInv) * 100) : null,
      usPlPct: usInv && usVal ? r2(((usVal - usInv) / usInv) * 100) : null,
    },
    indian,
    indianSummary: `${indian.length}/${INDIAN.length} shown (|P&L|>10% or |day|>2%)`,
    indianStocks: (() => {
      const todayIso = isoOf(now);
      const heldSet = new Set(INDIAN.map((h) => h.sym));
      const inBench = INDIAN_BENCHMARKS.map((b) => {
        let cf = null;
        if (hist && hist.series && inVal) {
          for (const sym of b.yahooSyms) { cf = benchCounterfactual(hist.series[sym], TRANSACTIONS, now); if (cf) break; }
        }
        return `${b.label} XIRR ${cf && cf.xirr != null ? cf.xirr.toFixed(1) + '%' : '—'} / return ${cf && cf.ret != null ? cf.ret.toFixed(1) + '%' : '—'}`;
      }).join('; ');
      const caUp = CORPORATE_ACTIONS.filter((a) => heldSet.has(a.sym) && a.ex >= todayIso)
        .map((a) => `${a.sym} ${a.type === 'bonus' ? 'bonus ' + a.ratio : 'dividend ₹' + a.perShare + '/sh'} ex ${a.ex}`).join('; ');
      const caDone = CORPORATE_ACTIONS.filter((a) => heldSet.has(a.sym) && a.ex < todayIso)
        .map((a) => `${a.sym} ${a.type === 'dividend' ? 'dividend ₹' + a.perShare + '/sh' : 'bonus ' + a.ratio} (ex ${a.ex})`).join('; ');
      return (
        `Invested ₹${Math.round(inInv)}, value ₹${Math.round(inVal)}, unrealized ${inPlPct != null ? (inPlPct >= 0 ? '+' : '') + inPlPct.toFixed(1) + '%' : '?'} (${sFull(inVal - inInv)}). ` +
        `NOTE: these large-cap holdings are tracked but held OUTSIDE the personal ITR account, so they generate no personal realised P&L/CG; the only domestic equity gains in the ITR are small delivery STCG (FY25-26 +₹1,476). Do not frame these as the user's taxable trades. ` +
        `Portfolio XIRR ${inXirr != null ? (inXirr * 100).toFixed(1) + '%' : '?'} annualised. Benchmarks (same dated rupees): ${inBench || 'unresolved'}. ` +
        `Top sector ${inTopSectorEntry ? inTopSectorEntry[0] + ' ' + (inVal ? (inTopSectorEntry[1] / inVal * 100).toFixed(0) : '?') + '%' : '?'}; largest position ${inTopPos ? inTopPos.sym + ' ' + (inVal && inTopPos.val ? (inTopPos.val / inVal * 100).toFixed(0) : '?') + '%' : '?'}. ` +
        `Winner ${inWinner ? inWinner.sym + ' ' + (inWinner.plPct >= 0 ? '+' : '') + inWinner.plPct + '%' : '?'}; laggard ${inLaggard ? inLaggard.sym + ' ' + inLaggard.plPct + '%' : '?'}. ` +
        `Corporate actions — upcoming: ${caUp || 'none'}; recently executed: ${caDone || 'none'} (mention executed actions here in the live tab). ` +
        `CAVEATS (must respect): XIRR is annualised over a ~5-month average holding — a short window, indicative not proven edge; index benchmark returns are price-only (ex-dividend); do not call short-window outperformance skill.`
      );
    })(),
    us,
    usSummary: `${us.length}/${US.length} shown (top 3 by value + |P&L|>15% or |day|>3%)`,
    usdInr: r2(rate),
    mutualFunds: mfSignal,
    fixedDeposits:
      `Active: ${fds.rows.length} FDs, ${inrC(fds.principal)} principal + ${inrC(fds.accrued)} accrued so far ` +
      `(quarterly compounding, never simple interest), value at maturity ${inrC(fds.maturity)}. ` +
      `Blended rate ${fds.blendedRate.toFixed(2)}% vs ~6% retail CPI inflation — ${fds.blendedRate > 6 ? 'real return positive' : 'barely keeping pace with inflation'}. ` +
      `Holdings: ` + fds.rows.map((f) => `${f.bank} ${inrC(f.principal)} @${f.rate}% (${f.progress.toFixed(0)}% to maturity ${fmtNavDate(f.matures)})`).join('; ') + '. ' +
      `Laddered across Slice/ICICI/HDFC/SBI with staggered quarterly maturities — spreads reinvestment risk and keeps each bank's annual interest below the ₹40,000 Sec 194A TDS-deduction threshold. ` +
      `Pipeline ${inrC(fds.pipelineTotal)} (${FD_PIPELINE.length} FDs, excluded from net worth until deployed)` +
      (fds.nextPipeline
        ? `, next deployment: ${fds.nextPipeline.bank} ${inrC(fds.nextPipeline.amount)} ${fds.nextPipeline.days <= 0 ? 'today' : `in ${fds.nextPipeline.days}d`} (${fmtNavDate(fds.nextPipeline.deploy)})`
        : '') +
      `. Today is ${new Date().toISOString().slice(0, 10)}.`,
    algo:
      `FY25-26 net F&O ${sFull(FY.combined2526.net)} (S01 ${sFull(FY.s01.fy2526.total.net)}, S02 ${sFull(FY.s02.fy2526.total.net)}). ` +
      `FY26-27 YTD: S01 ${sFull(FY.s01.fy2627.net)} (Dhan), S02 ${sFull(FY.s02.fy2627.net)} (Fyers) realised` +
      (swPl != null ? `, swing unrealised ${sFull(swPl)}` : '') +
      `. Loss CF pool entering FY26-27 ₹5.97L (non-spec ₹5.13L + spec ₹84,307; STCG ₹4,700 consumed). Realised F&O +₹98,012 absorbing oldest non-spec tranche (equity swing is STCG — does not offset F&O CF). Own capital ₹7.30L (S01 ₹3.9L + S02 ₹3.4L).`,
  };
}

export default function Page() {
  const [tab, setTab] = useState(0);
  const [prices, setPrices] = useState({});
  const [usdInr, setUsdInr] = useState(null);
  const [status, setStatus] = useState({ msg: 'Connecting to markets…', type: '' });
  const [lastUpdate, setLastUpdate] = useState('—');
  const [markets, setMarkets] = useState({ nse: null, nyse: null });
  const [loading, setLoading] = useState(false);
  const [usSort, setUsSort] = useState({ col: 'liveVal', dir: -1 });
  const [mfNav, setMfNav] = useState(null);
  const [mfSort, setMfSort] = useState({ key: 'value', dir: -1 });
  // Indian holdings sort (sorts the DATA array; header listeners bound once via
  // JSX at mount — never re-bound on refresh).
  const [inSort, setInSort] = useState({ key: 'val', dir: -1 });
  const [swSort, setSwSort] = useState({ key: 'pl', dir: -1 });
  // Benchmark weekly history (2y) for the same-dated-rupees counterfactual.
  const [hist, setHist] = useState(null);
  // LTP flash: per-symbol last price + tick direction, recomputed on each fetch.
  const [flash, setFlash] = useState({});
  const prevPrices = useRef({});
  // FD tab has no external feed — accrued interest & deploy countdown are pure
  // functions of the system clock. Recompute on mount and hourly.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Market open/closed driven by the exchange clock, refreshed each minute — so
  // the pills are correct even on a cached load and flip exactly at the bell.
  useEffect(() => {
    const upd = () => setMarkets({ nse: nseOpenNow(), nyse: nyseOpenNow() });
    upd();
    const id = setInterval(upd, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsOn, setInsightsOn] = useState(() => {
    try { return localStorage.getItem('nwTracker.insightsOn') !== 'false'; } catch { return true; }
  });
  const toggleInsights = () =>
    setInsightsOn((prev) => {
      const next = !prev;
      try { localStorage.setItem('nwTracker.insightsOn', String(next)); } catch {}
      return next;
    });
  const timer = useRef(null);

  // Show the loading shimmer only until the first set of insights arrives.
  const insightsFirstLoad = insightsLoading && insights == null;

  const fxRate = usdInr || 88; // fallback only for display before first load

  // ─── fetch ───
  const fetchBatch = async (symbols) => {
    const url = '/api/quotes?symbols=' + encodeURIComponent(symbols.join(','));
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    return data.quotes || {};
  };

  // Mutual-fund NAV (once-daily, server-cached 24h). Returns null on failure;
  // the UI then falls back to per-fund casNav.
  const fetchMfNav = async () => {
    try {
      const res = await fetch('/api/mf-nav', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // Benchmark weekly history (2y, server-cached 1h). Null on failure → the
  // Indian tab shows "—" for any series that doesn't resolve.
  const fetchHistory = async () => {
    try {
      // Indian + US benchmark candidate tickers; 5y range so US deposits back to
      // 2024 are covered. The client picks the first candidate that resolves.
      const syms = [...new Set([
        ...INDIAN_BENCHMARKS.flatMap((b) => b.yahooSyms),
        ...US_BENCHMARKS.flatMap((b) => b.yahooSyms),
      ])].join(',');
      const res = await fetch('/api/history?range=5y&symbols=' + encodeURIComponent(syms), { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // Ask Claude for tab-specific insights from the freshly-fetched data.
  const fetchInsights = useCallback(async (pricesArg, fxArg, mfArg, histArg) => {
    const payload = buildInsightPayload(pricesArg, fxArg, mfArg, histArg);
    // No live data yet → nothing worth analysing; skip the call.
    if (payload.overview.indianPlPct == null && payload.overview.usPlPct == null) return;
    setInsightsLoading(true);
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.insights) {
          setInsights(data.insights);
          try {
            sessionStorage.setItem(INSIGHTS_KEY, JSON.stringify({ ts: Date.now(), insights: data.insights }));
          } catch {}
        }
      }
    } catch {
      // leave any prior insights in place
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  const doRefresh = useCallback(async (opts = {}) => {
    setLoading(true);
    setStatus({ msg: 'Fetching live prices…', type: '' });
    try {
      const inSyms = INDIAN.map((s) => s.ns)
        .concat(SWING.map((s) => s.ns))
        .concat(['INR=X']);
      const usSyms = US.map((s) => s.sym);
      const [inData, usData, mfData, histData] = await Promise.all([
        fetchBatch(inSyms),
        fetchBatch(usSyms),
        fetchMfNav(),
        fetchHistory(),
      ]);
      const merged = { ...inData, ...usData };
      // LTP flash: compare new prices against the last seen; mark up/down ticks.
      const tick = {};
      Object.keys(merged).forEach((k) => {
        const np = merged[k] && !merged[k].error ? merged[k].price : null;
        const op = prevPrices.current[k];
        if (np != null && op != null && np !== op) tick[k] = np > op ? 'up' : 'down';
        if (np != null) prevPrices.current[k] = np;
      });
      if (Object.keys(tick).length) setFlash(tick);
      setPrices(merged);
      if (histData) {
        setHist(histData);
        try { sessionStorage.setItem(HIST_KEY, JSON.stringify({ ts: Date.now(), hist: histData })); } catch {}
      }
      if (mfData) {
        setMfNav(mfData);
        try { sessionStorage.setItem(MFNAV_KEY, JSON.stringify({ ts: Date.now(), mfNav: mfData })); } catch {}
      }

      const fx = inData['INR=X']?.price;
      if (fx) setUsdInr(fx);

      // Market open/closed is derived from the exchange clock (see the effect
      // above), not from Yahoo's marketState — so it stays correct here.

      const t = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      setStatus({ msg: 'Updated at ' + t, type: '' });
      setLastUpdate('Last updated ' + t);
      try {
        sessionStorage.setItem(
          FETCH_TS_KEY,
          JSON.stringify({ ts: Date.now(), prices: merged, usdInr: fx || usdInr }),
        );
      } catch {}

      // Generate AI insights only on explicit request (manual refresh / first
      // load) — never on the 15-min auto-refresh, to keep API spend minimal.
      // Called once both equities AND NAV have resolved. Respects the toggle.
      if (opts.insights && insightsOn) fetchInsights(merged, fx || usdInr, mfData || mfNav, histData || hist);
    } catch (e) {
      setStatus({ msg: 'Error: ' + (e.message || 'fetch failed'), type: 'err' });
    } finally {
      setLoading(false);
    }
  }, [usdInr, fetchInsights, insightsOn]);

  // ─── boot: hydrate from cache, then refresh + interval ───
  useEffect(() => {
    // Reuse insights cached for this tab session (avoids a fresh API call on
    // every reload). They only refresh when the user clicks ↻ Refresh.
    let haveInsights = false;
    try {
      const ic = JSON.parse(sessionStorage.getItem(INSIGHTS_KEY) || 'null');
      if (ic && ic.insights) {
        setInsights(ic.insights);
        haveInsights = true;
      }
    } catch {}

    // Mutual-fund NAV is cached 24h server-side; reuse any session copy too.
    let cachedMfNav = null;
    try {
      const mc = JSON.parse(sessionStorage.getItem(MFNAV_KEY) || 'null');
      if (mc && mc.mfNav) { cachedMfNav = mc.mfNav; setMfNav(mc.mfNav); }
    } catch {}

    // Benchmark history is cached 1h server-side; reuse any session copy.
    let cachedHist = null;
    try {
      const hc = JSON.parse(sessionStorage.getItem(HIST_KEY) || 'null');
      if (hc && hc.hist) { cachedHist = hc.hist; setHist(hc.hist); }
    } catch {}

    let hydrated = false;
    try {
      const c = JSON.parse(sessionStorage.getItem(FETCH_TS_KEY) || 'null');
      if (c && Date.now() - c.ts < 10 * 60 * 1000) {
        setPrices(c.prices || {});
        if (c.usdInr) setUsdInr(c.usdInr);
        const age = Math.round((Date.now() - c.ts) / 60000);
        setStatus({ msg: `Cached prices (${age}m ago)`, type: 'stale' });
        setLastUpdate(`Cached ${age}min ago`);
        hydrated = true;
        // Only call the API if we don't already have insights and the toggle is on.
        if (!haveInsights && insightsOn) fetchInsights(c.prices || {}, c.usdInr, cachedMfNav, cachedHist);
      }
    } catch {}
    // Fresh load with no cached prices: fetch prices + one set of insights.
    if (!hydrated) doRefresh({ insights: !haveInsights && insightsOn });
    // Auto-refresh keeps prices live but does NOT regenerate insights.
    timer.current = setInterval(doRefresh, REFRESH_MS);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── derived: Indian ───
  // Holdings auto-adjust for bonus corporate actions once the ex-date passes
  // (keyed off `now`); invested (h.inv) is the original cost basis, preserved.
  const heldIndian = useMemo(() => applyCorpActions(INDIAN, now), [now]);
  const indian = useMemo(() => {
    let inv = 0, val = 0, valued = true;
    const rows = heldIndian.map((s) => {
      const q = prices[s.ns];
      const ltp = q && !q.error ? q.price : null;
      const v = ltp != null ? s.qty * ltp : null;
      const pl = v != null ? v - s.inv : null;
      const pct = pl != null ? (pl / s.inv) * 100 : null;
      inv += s.inv;
      if (v != null) val += v; else valued = false;
      return { ...s, ltp, val: v, pl, pct, day: q && !q.error ? q.pct : null, ns: `${s.sym}.NS` };
    });
    const pl = val - inv;
    return { rows, inv, val, pl, pct: inv ? (pl / inv) * 100 : 0, valued };
  }, [prices, heldIndian]);

  // Sort the holdings DATA (header onClick bound once via JSX; survives refresh).
  const inSorted = useMemo(() => {
    const arr = [...indian.rows];
    const { key, dir } = inSort;
    arr.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'string') return dir * String(av).localeCompare(String(bv));
      return dir * ((av ?? -Infinity) - (bv ?? -Infinity));
    });
    return arr;
  }, [indian, inSort]);
  const sortIn = (key) =>
    setInSort((s) =>
      s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'sym' || key === 'name' ? 1 : -1 },
    );

  // ─── derived: Indian analytics (XIRR / CAGR / benchmarks / sectors / movers) ───
  const inStats = useMemo(() => {
    const value = indian.val;
    const totalInvested = TRANSACTIONS.reduce((s, t) => s + t.invested, 0);
    let portXirr = null, cagr = null, years = null;
    if (indian.valued && value) {
      const cfs = TRANSACTIONS.map((t) => ({ date: new Date(t.date), amount: -t.invested }));
      const x = xirr([...cfs, { date: now, amount: value }]);
      portXirr = x != null ? x * 100 : null;
      const c = weightedCagr(TRANSACTIONS, value, now);
      cagr = c.cagr; years = c.years;
    }
    // sector / cap concentration (by live value)
    const sectorMap = {}, capMap = {};
    indian.rows.forEach((r) => {
      if (r.val == null) return;
      sectorMap[r.sector] = (sectorMap[r.sector] || 0) + r.val;
      capMap[r.cap] = (capMap[r.cap] || 0) + r.val;
    });
    const sectors = Object.entries(sectorMap)
      .map(([label, val]) => ({ label, val, pct: value ? (val / value) * 100 : 0 }))
      .sort((a, b) => b.val - a.val);
    const caps = ['Large', 'Mid', 'Small']
      .map((label) => ({ label, val: capMap[label] || 0, pct: value ? ((capMap[label] || 0) / value) * 100 : 0 }));
    // movers + concentration
    const valued = indian.rows.filter((r) => r.pct != null);
    const winner = valued.length ? valued.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    const laggard = valued.length ? valued.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
    const topPos = valued.length && value ? valued.reduce((a, b) => (b.val > a.val ? b : a)) : null;
    // benchmark counterfactuals (same dated rupees) — try each candidate ticker
    // and use the first that resolves AND covers the holding window.
    const cfFor = (b) => {
      if (!hist || !hist.series || !indian.valued || !value) return null;
      for (const sym of b.yahooSyms) {
        const cf = benchCounterfactual(hist.series[sym], TRANSACTIONS, now);
        if (cf) return cf;
      }
      return null;
    };
    const benchmarks = INDIAN_BENCHMARKS.map((b) => {
      const cf = cfFor(b);
      return { ...b, value: cf ? cf.value : null, xirr: cf ? cf.xirr : null, cagr: cf ? cf.cagr : null, ret: cf ? cf.ret : null };
    });
    return {
      value, totalInvested, portXirr, cagr, years, sectors, caps,
      winner, laggard, topPos, benchmarks,
      topSector: sectors[0] || null,
    };
  }, [indian, hist, now]);

  // Corporate actions: upcoming (ex ≥ today) populate the panel; executed go to
  // the footline. Impact is computed against the current held quantity.
  // Day change in rupees: Σ qty·(ltp − prevClose), derived from each stock's
  // day % and live value (prevClose = val / (1 + day%/100)).
  const indianDay = useMemo(() => {
    let dayPl = 0, prevTot = 0;
    indian.rows.forEach((r) => {
      if (r.val == null || r.day == null) return;
      const prev = r.val / (1 + r.day / 100);
      dayPl += r.val - prev;
      prevTot += prev;
    });
    return { dayPl, dayPct: prevTot ? (dayPl / prevTot) * 100 : 0 };
  }, [indian]);
  const indianDayPl = indianDay.dayPl;
  const indianDayPct = indianDay.dayPct;

  // ─── derived: US ───
  const usData = useMemo(() => {
    let inv = 0, val = 0;
    const rows = US.map((s) => {
      const q = prices[s.sym];
      const lp = q && !q.error ? q.price : null;
      const v = lp != null ? s.qty * lp : null;
      const pl = v != null ? v - s.inv : null;
      const pct = pl != null && s.inv ? (pl / s.inv) * 100 : null;
      inv += s.inv;
      if (v != null) val += v;
      return {
        ...s, livePrice: lp, liveVal: v, livePl: pl, livePct: pct,
        dayPct: q && !q.error ? q.pct : null,
      };
    });
    const pl = val - inv;
    return { rows, inv, val, pl, pct: inv ? (pl / inv) * 100 : 0 };
  }, [prices]);

  const usSorted = useMemo(() => {
    const arr = [...usData.rows];
    const { col, dir } = usSort;
    arr.sort((a, b) => {
      const av = a[col], bv = b[col];
      if (typeof av === 'string') return dir * String(av).localeCompare(String(bv));
      return dir * ((bv ?? -Infinity) - (av ?? -Infinity));
    });
    return arr;
  }, [usData, usSort]);

  const sortUs = (col) =>
    setUsSort((s) =>
      s.col === col ? { col, dir: -s.dir } : { col, dir: col === 'sym' || col === 'name' ? 1 : -1 },
    );

  // ─── derived: US analytics (XIRR/CAGR/benchmarks + category mix / movers) ───
  // Real dated cashflows now come from the Vested statement (US_CASHFLOWS, USD),
  // so the US tab gets money-weighted XIRR/CAGR and same-dated-dollars benchmarks
  // just like the Indian tab. All US figures here are in USD.
  const usStats = useMemo(() => {
    const value = usData.val;
    // Sector split with ETF look-through (matches Vested's methodology).
    const secMap = {};
    usData.rows.forEach((r) => {
      if (r.liveVal == null) return;
      const lt = ETF_LOOKTHROUGH[r.sym];
      if (lt) { Object.entries(lt).forEach(([sec, w]) => { secMap[sec] = (secMap[sec] || 0) + r.liveVal * w; }); }
      else { const k = usSectorOf(r); secMap[k] = (secMap[k] || 0) + r.liveVal; }
    });
    let sectors = Object.entries(secMap)
      .map(([label, val]) => ({ label, val, pct: value ? (val / value) * 100 : 0 }))
      .sort((a, b) => b.val - a.val);
    // Top 6 + "All Others", like the Vested sector split.
    if (sectors.length > 7) {
      const head = sectors.slice(0, 6).filter((x) => x.label !== 'All Others');
      const restVal = value - head.reduce((s, x) => s + x.val, 0);
      sectors = [...head, { label: 'All Others', val: restVal, pct: value ? (restVal / value) * 100 : 0, other: true }];
    }
    // Market-cap split (equity only, Vested tiers) — equity ETFs use cap look-
    // through; bonds/commodity are excluded from the denominator.
    const capMap = { Mega: 0, Large: 0, Mid: 0, Small: 0 };
    let equityVal = 0;
    usData.rows.forEach((r) => {
      if (r.liveVal == null) return;
      const lt = ETF_CAP[r.sym];
      if (lt) { Object.entries(lt).forEach(([k, w]) => { capMap[k] += r.liveVal * w; }); equityVal += r.liveVal; }
      else if (['Bond', 'Commodity', 'ETF'].includes(r.cat)) { /* non-equity / non-looked-through ETF: skip */ }
      else { capMap[US_CAP[r.sym] || 'Large'] += r.liveVal; equityVal += r.liveVal; }
    });
    const caps = ['Mega', 'Large', 'Mid', 'Small'].map((label) => ({ label, val: capMap[label], pct: equityVal ? (capMap[label] / equityVal) * 100 : 0 }));
    const valued = usData.rows.filter((r) => r.livePct != null);
    const winner = valued.length ? valued.reduce((a, b) => (b.livePct > a.livePct ? b : a)) : null;
    const laggard = valued.length ? valued.reduce((a, b) => (b.livePct < a.livePct ? b : a)) : null;
    const topPos = valued.length && value ? valued.reduce((a, b) => ((b.liveVal || 0) > (a.liveVal || 0) ? b : a)) : null;
    let dayPl = 0, prevTot = 0;
    usData.rows.forEach((r) => {
      if (r.liveVal == null || r.dayPct == null) return;
      const prev = r.liveVal / (1 + r.dayPct / 100);
      dayPl += r.liveVal - prev; prevTot += prev;
    });
    // Money-weighted XIRR/CAGR on net external capital ($), + benchmarks.
    const netInvested = US_CASHFLOWS.reduce((s, c) => s + c.invested, 0);
    let xr = null, cagr = null, years = null;
    if (value) {
      const cfs = US_CASHFLOWS.map((c) => ({ date: new Date(c.date), amount: -c.invested }));
      const x = xirr([...cfs, { date: now, amount: value }]);
      xr = x != null ? x * 100 : null;
      const c = weightedCagr(US_CASHFLOWS, value, now);
      cagr = c.cagr; years = c.years;
    }
    const cfFor = (b) => {
      if (!hist || !hist.series || !value) return null;
      for (const sym of b.yahooSyms) {
        const cf = benchCounterfactual(hist.series[sym], US_CASHFLOWS, now);
        if (cf) return cf;
      }
      return null;
    };
    const benchmarks = US_BENCHMARKS.map((b) => {
      const cf = cfFor(b);
      return { ...b, value: cf ? cf.value : null, xirr: cf ? cf.xirr : null, cagr: cf ? cf.cagr : null, ret: cf ? cf.ret : null };
    });
    return {
      value, sectors, caps, winner, laggard, topPos, topSector: sectors[0] || null,
      dayPl, dayPct: prevTot ? (dayPl / prevTot) * 100 : 0,
      netInvested, xirr: xr, cagr, years, benchmarks,
    };
  }, [usData, hist, now]);

  // ─── derived: S02 swing book (live NSE) ───
  const swing = useMemo(() => {
    let inv = 0, val = 0, valued = true;
    const rows = SWING.map((s) => {
      const q = prices[s.ns];
      const ltp = q && !q.error ? q.price : null;
      const v = ltp != null ? s.qty * ltp : null;
      const pl = v != null ? v - s.inv : null;
      const pct = pl != null ? (pl / s.inv) * 100 : null;
      inv += s.inv;
      if (v != null) val += v; else valued = false;
      return { ...s, ltp, val: v, pl, pct };
    });
    const pl = val - inv;
    return { rows, inv, val, pl, pct: inv ? (pl / inv) * 100 : 0, valued };
  }, [prices]);

  // Sort the swing book DATA (header listeners bound once via JSX).
  const swingSorted = useMemo(() => {
    const arr = [...swing.rows];
    const { key, dir } = swSort;
    arr.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'string') return dir * String(av).localeCompare(String(bv));
      return dir * ((av ?? -Infinity) - (bv ?? -Infinity));
    });
    return arr;
  }, [swing, swSort]);
  const sortSw = (key) =>
    setSwSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'sym' ? 1 : -1 }));

  // FY26-27 algo YTD = S01 net + S02 net + live swing unrealised
  const ytdRealised = FY.s01.fy2627.net + FY.s02.fy2627.net;
  const ytdTotal = swing.valued ? ytdRealised + swing.pl : null;

  // CF absorption: only realised F&O income eats into the non-spec *business*
  // loss carryforward. Equity swing P&L is capital gains (STCG) — it can never
  // offset the F&O business CF, so it is intentionally excluded here.
  const cfEntering = Math.abs(FY.carryforward.find((c) => c.accent).val); // 5,97,318
  const cfAfterRealised = cfEntering - ytdRealised;                       // 4,99,306

  // ─── derived: mutual funds (live NAV layered over CAS units) ───
  const mf = useMemo(() => deriveMf(mfNav), [mfNav]);
  const mfx = useMemo(() => mfXirr(mf, mfNav), [mf, mfNav]);

  // ─── derived: fixed deposits (system clock only — no external feed) ───
  const fds = useMemo(() => deriveFds(now), [now]);

  // Sort the holdings DATA (never the DOM); re-sorts on every render so the
  // chosen order survives a NAV refresh. Header onClick is bound by React.
  const mfSorted = useMemo(() => {
    const arr = [...mf.rows];
    const { key, dir } = mfSort;
    arr.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'string') return dir * String(av).localeCompare(String(bv));
      return dir * ((av ?? -Infinity) - (bv ?? -Infinity));
    });
    return arr;
  }, [mf, mfSort]);

  const sortMf = (key) =>
    setMfSort((s) =>
      s.key === key
        ? { key, dir: -s.dir }
        : { key, dir: key === 'name' || key === 'platform' ? 1 : -1 },
    );

  // ─── derived: overview / net worth ───
  // FD contribution is principal + accrued interest (quarterly compounding,
  // recomputed live) — pipeline FDs are excluded until their deploy date.
  const ov = useMemo(() => {
    const usInr = usData.val * fxRate;
    const fdValue = fds.principal + fds.accrued;
    const totalAssets =
      indian.val + usInr + fdValue + STATIC.algo + mf.totVal;
    const nw = totalAssets - STATIC.loan;
    return { usInr, fdValue, totalAssets, nw };
  }, [indian.val, usData.val, fxRate, mf.totVal, fds.principal, fds.accrued]);

  // Allocation donut segments — live values where available, else snapshot.
  // `key` ties each sleeve to its forward drift rule in PROJECTION.allocRules.
  const donutSegs = [
    { key: 'algo',   label: 'Algo Capitals',  value: STATIC.algo,        color: ALLOC_COLORS.algo },
    { key: 'fd',     label: 'Fixed Deposits', value: ov.fdValue,         color: ALLOC_COLORS.fd },
    { key: 'indian', label: 'Indian Stocks',  value: indian.val || 471000, color: ALLOC_COLORS.indian },
    { key: 'us',     label: 'US Stocks',      value: ov.usInr || 443000, color: ALLOC_COLORS.us },
    { key: 'mf',     label: 'Mutual Funds',   value: mf.jio.value,       color: ALLOC_COLORS.mf },
    { key: 'elss',   label: 'ELSS',           value: mf.elss.value,      color: ALLOC_COLORS.elss },
  ];

  // Stable sleeve array for the Projection tab — only changes when a live value
  // actually moves (not on every minute-tick re-render), so the chart/controls
  // don't churn while the user is scrubbing or a play loop is running.
  const projSleeves = useMemo(() => donutSegs.map((s) => ({ ...s, value: Math.round(s.value || 0) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [STATIC.algo, Math.round(ov.fdValue || 0), Math.round(indian.val || 0), Math.round(ov.usInr || 0), Math.round(mf.jio.value || 0), Math.round(mf.elss.value || 0)]);

  const pulseCls = 'pulse' + (status.type ? ' ' + status.type : '');
  const mktPill = (open) =>
    open == null ? 'mkt-closed' : open ? 'mkt-open' : 'mkt-closed';
  const mktTxt = (open) => (open == null ? '—' : open ? 'OPEN' : 'CLOSED');

  const Skel = ({ w = 90, h = 18 }) => (
    <span className="skel" style={{ width: w, height: h, display: 'inline-block' }}>&nbsp;</span>
  );

  return (
    <div className="wrap">
      {/* STATUS BAR */}
      <div className="topbar">
        <div className="topbar-left">
          <div className={pulseCls} />
          <span className="status-txt">{status.msg}</span>
        </div>
        <div className="mkt-tag">
          <span className={'mkt-pill ' + mktPill(markets.nse)}>NSE {mktTxt(markets.nse)}</span>
          <span className={'mkt-pill ' + mktPill(markets.nyse)}>NYSE {mktTxt(markets.nyse)}</span>
        </div>
        <button
          className="refresh-btn"
          onClick={toggleInsights}
          title={insightsOn ? 'AI insights ON — click to disable' : 'AI insights OFF — click to enable'}
          style={{ opacity: insightsOn ? 1 : 0.4 }}
        >
          ✨ AI {insightsOn ? 'ON' : 'OFF'}
        </button>
        <button
          className={'refresh-btn' + (loading ? ' loading' : '')}
          onClick={() => doRefresh({ insights: true })}
          title="Refresh prices and regenerate AI insights"
        >
          ↻ {loading ? 'Updating…' : 'Refresh'}
        </button>
      </div>

      {/* HEADER */}
      <div className="hdr">
        <div>
          <div className="hdr-lbl">Net worth — live<span className="spark">✦</span></div>
          <div className="hdr-val">{indian.valued && usdInr ? <InrC n={ov.nw} /> : <Skel w={130} h={24} />}</div>
          <div className="hdr-sub">
            Tracked assets <InrC n={ov.totalAssets} /> · Loan ~<Rs />7.50L · excl. savings
          </div>
        </div>
        <div className="hdr-date">
          <div>USD/INR: <strong>{usdInr ? <><Rs />{usdInr.toFixed(2)}</> : '—'}</strong></div>
          <div style={{ marginTop: 3, fontSize: 10, color: 'var(--txt3)' }}>{lastUpdate}</div>
        </div>
      </div>

      {/* TABS */}
      <div className="tabs">
        {['Overview', 'Indian Stocks', 'Fixed Deposits', 'Mutual Funds', 'US Stocks', 'Algo', 'Projection'].map(
          (t, i) => (
            <button key={t} className={'tab' + (tab === i ? ' on' : '')} onClick={() => setTab(i)}>
              {t}
            </button>
          ),
        )}
      </div>

      {/* OVERVIEW */}
      {tab === 0 && (
        <div>
          <InsightBanner text={insightsOn ? insights?.overview : null} loading={insightsOn && insightsFirstLoad} />
          <div className="ov-top">
            <div className="card ov-donut">
              <div className="lbl" style={{ marginBottom: 8 }}>allocation</div>
              <Donut segments={donutSegs} />
            </div>
            <div className="ov-cards">
              <div className="g3">
                <div className="csm">
                  <div className="lbl">net worth</div>
                  <div className="vlg">{usdInr ? <InrC n={ov.nw} /> : <Skel />}</div>
                  <div className="sub">assets minus loan</div>
                </div>
                <div className="csm">
                  <div className="lbl">total tracked assets</div>
                  <div className="vlg">{usdInr ? <InrC n={ov.totalAssets} /> : <Skel />}</div>
                  <div className="sub">6 asset classes</div>
                </div>
                <div className="csm">
                  <div className="lbl">liabilities</div>
                  <div className="vlg" style={{ color: 'var(--red)' }}>~<Rs />7.50L</div>
                  <div className="sub">personal loan, est. outstanding</div>
                </div>
              </div>
              {/* Dense per-sleeve grid — every asset class at a glance (0g). */}
              <div className="g5">
                <div className="csm">
                  <div className="lbl">Indian equity</div>
                  <div className="vmd">{indian.valued ? <InrC n={indian.val} /> : <Skel w={64} h={18} />}</div>
                  <div className={'sub ' + (indian.valued ? cl(indian.pl) : '')}>
                    {indian.valued ? <SInrC n={indian.pl} /> : `${INDIAN.length} stocks`}
                    {indian.valued ? ` · ${pctS(indian.pct)}` : ''}
                  </div>
                </div>
                <div className="csm">
                  <div className="lbl">Mutual funds</div>
                  <div className="vmd"><InrC n={mf.totVal} /></div>
                  <div className={'sub ' + cl(mf.totRet)}>{pctS(mf.totRet)} · live NAV</div>
                </div>
                <div className="csm">
                  <div className="lbl">Fixed deposits</div>
                  <div className="vmd"><InrC n={ov.fdValue} /></div>
                  <div className="sub grn">+<InrF n={fds.accrued} /> accrued</div>
                </div>
                <div className="csm">
                  <div className="lbl">US equity</div>
                  <div className="vmd">{usData.val ? <InrC n={ov.usInr} /> : <Skel w={64} h={18} />}</div>
                  <div className={'sub ' + (usData.val ? cl(usData.pl) : '')}>
                    {usData.val ? <RsText>{`${pctS(usData.pct)} @₹${fxRate.toFixed(0)}`}</RsText> : `${US.length} holdings`}
                  </div>
                </div>
                <div className="csm">
                  <div className="lbl">Algo capital</div>
                  <div className="vmd"><InrC n={STATIC.algo} /></div>
                  <div className={'sub ' + (ytdTotal != null ? cl(ytdTotal) : '')}>
                    {ytdTotal != null ? <>FY27 <SInrC n={ytdTotal} /></> : 'own capital'}
                  </div>
                </div>
              </div>
              {/* Monthly SIP summary — fills the space beside the donut */}
              <div className="card ov-fill">
                <div className="fxc" style={{ marginBottom: 12 }}>
                  <div className="lbl" style={{ margin: 0 }}>monthly SIP commitment</div>
                  <div className="vmd" style={{ color: 'var(--acc)' }}>{MF.sip.total}</div>
                </div>
                <div className="g3">
                  {MF.sip.items.map((s, i) => (
                    <div className="mini" key={s.label} style={{ borderLeft: `3px solid ${['var(--blu)','var(--grn)','var(--acc)'][i] || 'var(--brd2)'}` }}>
                      <div className="sub" style={{ margin: 0 }}>{s.label}</div>
                      <div className="vsm" style={{ marginTop: 4 }}>{s.val}</div>
                    </div>
                  ))}
                </div>
                <div className="sub" style={{ marginTop: 12, paddingTop: 10, borderTop: '.5px solid var(--brd)' }}>
                  ✦ Auto-deployed every month · {MF.sip.items.length} streams feeding equities, US SIP &amp; conviction picks
                </div>
              </div>
            </div>
          </div>
          <CFMemo
            title="Loss Carryforward — Tax Asset"
            rows={[
              { label: 'Non-spec F&O', val: sFull(-FY.cf.nonSpec), sub: 'Sec 72 · 8-yr · offsets future F&O profit only' },
              { label: 'Speculative (intraday)', val: sFull(-FY.cf.speculative), sub: 'Sec 73 · 4-yr · ₹16,958 expires AY28-29 first' },
              { label: 'Pool entering FY26-27', val: sFull(-FY.cf.poolEnteringFY2627), accent: true, sub: `${inrFull(FY.cf.fy2627Realised)} realised absorbed → ${inrC(FY.cf.poolEnteringFY2627 - FY.cf.fy2627Realised)} remaining` },
            ]}
          />
        </div>
      )}

      {/* INDIAN STOCKS — live NSE; sortable holdings, XIRR/CAGR vs a low-
          correlation benchmark set, corporate-actions window. */}
      {tab === 1 && (() => {
        const IN_COLS = [
          { key: 'sym', label: 'Stock', num: false },
          { key: 'qty', label: 'Qty', num: true },
          { key: 'cost', label: 'Avg cost', num: true },
          { key: 'ltp', label: 'LTP', num: true },
          { key: 'inv', label: 'Invested', num: true },
          { key: 'val', label: 'Value', num: true },
          { key: 'pl', label: 'P&L', num: true },
          { key: 'pct', label: 'Return %', num: true },
          { key: 'day', label: 'Day %', num: true },
        ];
        const fmtX = (n) => (n == null ? '—' : Math.abs(n).toFixed(1) + '%');
        const capColor = { Large: 'var(--blu)', Mid: 'var(--pur)', Small: 'var(--cyn)' };
        const secColors = SECTOR_PALETTE;
        return (
        <div>
          <InsightBanner text={insightsOn ? insights?.indian_stocks : null} loading={insightsOn && insightsFirstLoad} />
          <div className="sec" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <FreshnessTag mode="live" marketState={{ open: markets.nse, label: `NSE ${markets.nse ? 'OPEN' : 'CLOSED'} · Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` }} />
          </div>

          {/* SECTION 3 — six summary cards + realized P&L */}
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">Invested (cost)</div>
              <div className="vmd"><InrC n={indian.inv} /></div>
              <div className="sub">{INDIAN.length} positions · ~₹30K equal-weight</div>
            </div>
            <div className="csm">
              <div className="lbl">Current value</div>
              <div className="vmd">{indian.valued ? <InrC n={indian.val} /> : <Skel w={90} h={20} />}</div>
              <div className="sub">live NSE · LTP × qty</div>
            </div>
            <div className="csm">
              <div className="lbl">Unrealized P&amp;L</div>
              <div className={'vmd ' + (indian.valued ? cl(indian.pl) : '')}>
                {indian.valued ? <SInrC n={indian.pl} /> : <Skel w={80} h={20} />}
              </div>
              <div className="sub">{indian.valued ? pctS(indian.pct) + ' · value − invested' : 'value − invested'}</div>
            </div>
          </div>
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">Day change</div>
              <div className={'vmd ' + (indian.valued ? cl(indianDayPl) : '')}>
                {indian.valued ? <SInrC n={indianDayPl} /> : <Skel w={80} h={20} />}
              </div>
              <div className="sub">{indian.valued ? `${pctS(indianDayPct)} since prev close` : 'intraday move'}</div>
            </div>
            <div className="csm">
              <div className="lbl">CAGR (annualised)</div>
              <div className={'vmd ' + (inStats.cagr != null ? cl(inStats.cagr) : '')}>
                {inStats.cagr != null ? fmtX(inStats.cagr) : <Skel w={70} h={20} />}
              </div>
              <div className="sub">money-weighted · ~5mo window</div>
            </div>
            <div className="csm">
              <div className="lbl">Realized P&amp;L (YTD)</div>
              <div className={'vmd ' + cl(INDIAN_REALIZED.ytd)}><SInrF n={INDIAN_REALIZED.ytd} /></div>
              <div className="sub">{INDIAN_REALIZED.ytdLabel} · overall below</div>
            </div>
          </div>

          {/* SECTION 2 — benchmark + SECTION concentration (single 2-col grid) */}
          <div className="g2 sec">
            <div className="card">
              <div className="ctitle" style={{ marginBottom: 4 }}>vs Benchmarks</div>
              <div className="sub" style={{ marginBottom: 14 }}>Same dated rupees — your ₹{inrCd(inStats.totalInvested)} deployed into each instead.</div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Instrument</th><th className="ra">XIRR</th><th className="ra">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ color: 'var(--txt)', fontWeight: 600 }}>Your portfolio</td>
                    <td className={'ra mono ' + (inStats.portXirr != null ? cl(inStats.portXirr) : 'mut')}>{fmtX(inStats.portXirr)}</td>
                    <td className="ra mono">{indian.valued ? <InrC n={indian.val} /> : '—'}</td>
                  </tr>
                  {inStats.benchmarks.map((b) => (
                    <tr key={b.key}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                          {b.label}
                        </span>
                      </td>
                      <td className={'ra mono ' + (b.xirr != null ? cl(b.xirr) : 'mut')}>{fmtX(b.xirr)}</td>
                      <td className="ra mono mut">{b.value != null ? <InrC n={b.value} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sub" style={{ marginTop: 12 }}>
                CAGR {inStats.cagr != null ? Math.abs(inStats.cagr).toFixed(1) + '%' : '—'}
                {inStats.years != null ? ` over a ${inStats.years.toFixed(1)}-yr weighted holding` : ''} · price-only (ex-dividend) index returns.
              </div>
              <div className="sub" style={{ marginTop: 8, color: 'var(--txt3)', lineHeight: 1.6 }}>
                Annualised over a ~5-month average holding — a short window; indicative, not proven edge.
                Index returns are price-only (ex-dividend).
              </div>
            </div>

            <div className="card">
              <div className="ctitle" style={{ marginBottom: 14 }}>Sector &amp; Cap Mix</div>
              {inStats.sectors.map((s, i) => (
                <div key={s.label} className="seg-row">
                  <span className="seg-lbl">{s.label}</span>
                  <span className="seg-trk"><span className="seg-fil" style={{ width: Math.min(100, s.pct) + '%', background: secColors[i % secColors.length] }} /></span>
                  <span className="seg-val"><InrC n={s.val} /> · {s.pct.toFixed(0)}%</span>
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--brd)', margin: '14px 0' }} />
              {inStats.caps.map((c) => (
                <div key={c.label} className="seg-row">
                  <span className="seg-lbl">{c.label} cap</span>
                  <span className="seg-trk"><span className="seg-fil" style={{ width: Math.min(100, c.pct) + '%', background: capColor[c.label] }} /></span>
                  <span className="seg-val"><InrC n={c.val} /> · {c.pct.toFixed(0)}%</span>
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--brd)', margin: '14px 0' }} />
              <div className="g3">
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>Winner</div>
                  <div className="vsm grn">{inStats.winner ? inStats.winner.sym : '—'}</div>
                  <div className={'sub ' + (inStats.winner ? cl(inStats.winner.pct) : '')}>{inStats.winner ? pctS(inStats.winner.pct) : 'live'}</div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>Drag</div>
                  <div className="vsm red">{inStats.laggard ? inStats.laggard.sym : '—'}</div>
                  <div className={'sub ' + (inStats.laggard ? cl(inStats.laggard.pct) : '')}>{inStats.laggard ? pctS(inStats.laggard.pct) : 'live'}</div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>Largest</div>
                  <div className="vsm">{inStats.topPos ? inStats.topPos.sym : '—'}</div>
                  <div className="sub">{inStats.topPos && indian.val ? ((inStats.topPos.val / indian.val) * 100).toFixed(0) + '% of book' : 'by value'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 5 — sortable holdings (sorts the DATA array; LTP flash) */}
          <div className="card sec">
            <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="ctitle">Holdings</div>
              <div className="sub" style={{ margin: 0 }}>
                {indian.valued
                  ? <><InrC n={indian.inv} /> → <InrC n={indian.val} /> · <span className={cl(indian.pl)}><SInrC n={indian.pl} /> ({pctS(indian.pct)})</span></>
                  : 'loading live prices…'}
              </div>
            </div>
            <div className="ovx">
              <table className="tbl" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    {IN_COLS.map((c) => (
                      <th key={c.key} className={c.num ? 'ra' : ''} onClick={() => sortIn(c.key)}>
                        {c.label} {inSort.key === c.key ? (inSort.dir < 0 ? '↓' : '↑') : '↕'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inSorted.map((s) => (
                    <tr key={s.sym}>
                      <td style={{ color: 'var(--txt)', fontWeight: 600 }} className="mono">
                        {s.sym}
                        <div style={{ fontSize: 10.5, color: 'var(--txt3)', fontWeight: 400, marginTop: 2, fontFamily: 'var(--body)' }}>
                          {s.name} · {s.sector} · {s.cap}
                        </div>
                      </td>
                      <td className="ra mut mono">{s.qty}</td>
                      <td className="ra mut mono"><InrF n={s.cost} /></td>
                      <td className="ra mono">
                        {s.ltp != null
                          ? <span key={s.sym + '-' + s.ltp} className={flash[s.ns] ? 'flash-' + flash[s.ns] : ''}><InrF n={s.ltp} /></span>
                          : <Skel w={48} h={11} />}
                      </td>
                      <td className="ra mono"><InrC n={s.inv} /></td>
                      <td className="ra mono">{s.val != null ? <InrC n={s.val} /> : '—'}</td>
                      <td className={'ra mono ' + (s.pl != null ? cl(s.pl) : 'mut')}>
                        {s.pl != null ? <SInrF n={s.pl} /> : '—'}
                      </td>
                      <td className={'ra mono ' + (s.pct != null ? cl(s.pct) : 'mut')}>
                        {s.pct != null ? pctS(s.pct) : '—'}
                      </td>
                      <td className={'ra mono ' + (s.day != null ? cl(s.day) : 'mut')}>
                        {s.day != null ? pctS(s.day) : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td colSpan={4}>Total — {INDIAN.length} positions</td>
                    <td className="ra"><InrC n={indian.inv} /></td>
                    <td className="ra">{indian.valued ? <InrC n={indian.val} /> : '…'}</td>
                    <td className={'ra ' + cl(indian.pl)}>{indian.valued ? <SInrC n={indian.pl} /> : '…'}</td>
                    <td className={'ra ' + cl(indian.pl)}>{indian.valued ? pctS(indian.pct) : '…'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="sub" style={{ marginTop: 10 }}>Click headers to sort · live LTP from NSE, flashes on each tick.</div>
          </div>

          {/* Realized P&L — scalable, scope-aware (Zerodha tradebook · avg-cost) */}
          <RealizedPanel
            data={INDIAN_REALIZED}
            currency="inr"
            className="sec"
            note="Avg-cost realised gains/losses booked across all exits. The filed ITR capital-gains figure is in the card below."
          />

          <CFMemo
            title="Equity Tax — FY24-25 Capital Gains"
            lead="Last filed year's equity capital gains in this account (ITR):"
            rows={[
              { label: 'FY24-25 LTCG (Sec 112A)', val: '₹2,789', color: 'var(--grn)', sub: 'equity shares held >12m · within ₹1.25L exemption → nil tax' },
              { label: 'FY24-25 STCG (equity MF)', val: '₹1,083', color: 'var(--red)', sub: 'short-term loss, set off against LTCG' },
            ]}
          />
        </div>
        );
      })()}

      {/* FIXED DEPOSITS — no external feed; everything below is a pure
          function of the system clock (recomputed on mount + hourly). */}
      {tab === 2 && (
        <div>
          <InsightBanner text={insightsOn ? insights?.fixed_deposits : null} loading={insightsOn && insightsFirstLoad} />
          <div className="sec" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <FreshnessTag mode="manual" date={`${fmtDateObj(now)} · accrued recalculated daily`} />
          </div>
          <div className="g4 sec">
            <div className="csm">
              <div className="lbl">active deployed</div>
              <div className="vmd"><InrC n={fds.principal} /></div>
              <div className="sub">{FDS.length} FDs · Slice, ICICI, HDFC</div>
            </div>
            <div className="csm">
              <div className="lbl">accrued interest</div>
              <div className="vmd grn"><InrF n={fds.accrued} /></div>
              <div className="sub">compounding quarterly · live</div>
            </div>
            <div className="csm">
              <div className="lbl">value at maturity</div>
              <div className="vmd"><InrC n={fds.maturity} /></div>
              <div className="sub">+<InrF n={fds.maturity - fds.principal} /> total interest</div>
            </div>
            <div className="csm">
              <div className="lbl">blended rate</div>
              <div className="vmd">{fds.blendedRate.toFixed(2)}%</div>
              <div className="sub">weighted by principal</div>
            </div>
          </div>
          <div className="card sec">
            <div className="lbl" style={{ marginBottom: 10 }}>active FDs</div>
            <div className="ovx">
              <table className="tbl" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Bank</th><th>FD</th><th>Matures</th>
                    <th className="ra">Principal</th><th className="ra">Rate</th>
                    <th className="ra">Accrued</th><th className="ra">At maturity</th>
                  </tr>
                </thead>
                <tbody>
                  {fds.rows.map((f) => (
                    <tr key={f.bank + f.label}>
                      <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.bank}</td>
                      <td className="mut">{f.label}</td>
                      <td style={{ minWidth: 140 }}>
                        <div className="mut" style={{ marginBottom: 4 }}>{fmtNavDate(f.matures)}</div>
                        <span className="bar-trk" style={{ display: 'block', height: 4 }}>
                          <span
                            className="bar-fil"
                            style={{ width: f.progress.toFixed(1) + '%', height: 4, background: 'linear-gradient(90deg, var(--grn), #5FE3B0)' }}
                          />
                        </span>
                        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 3 }}>{f.progress.toFixed(0)}% elapsed</div>
                      </td>
                      <td className="ra mono"><InrC n={f.principal} /></td>
                      <td className="ra grn mono">{f.rate.toFixed(2)}%</td>
                      <td className="ra grn mono"><InrF n={f.accruedSoFar} /></td>
                      <td className="ra">
                        <div className="mono"><InrC n={f.maturityValue} /></div>
                        <div style={{ fontSize: 10, color: 'var(--txt3)' }}>+<InrF n={f.maturityInterest} /></div>
                      </td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td colSpan={3}>Total — {fds.rows.length} FDs</td>
                    <td className="ra"><InrC n={fds.principal} /></td>
                    <td className="ra">{fds.blendedRate.toFixed(2)}%</td>
                    <td className="ra grn"><InrF n={fds.accrued} /></td>
                    <td className="ra"><InrC n={fds.maturity} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="fxc" style={{ marginBottom: 10 }}>
              <div className="lbl" style={{ margin: 0 }}>Pipeline — Not Yet Deployed</div>
              <div className="sub" style={{ margin: 0 }}>
                Pipeline <InrC n={fds.pipelineTotal} /> · Grand total <InrC n={fds.principal + fds.pipelineTotal} />
              </div>
            </div>
            <div className="ovx">
              <table className="tbl" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Bank</th><th>FD</th><th>Deploy date</th><th>Maturity</th>
                    <th>Tenure</th><th className="ra">Amount</th><th />
                  </tr>
                </thead>
                <tbody>
                  {fds.pipeline.map((f) => (
                    <tr key={f.bank + f.label}>
                      <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.bank}</td>
                      <td className="mut">{f.label}</td>
                      <td className="mut">{fmtNavDate(f.deploy)}</td>
                      <td className="mut">{fmtNavDate(f.maturity)}</td>
                      <td className="mut">{f.tenure}</td>
                      <td className="ra mono"><InrC n={f.amount} /></td>
                      <td>{f.badge && <span className="badge ba">{f.badge}</span>}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td colSpan={5}>Total pipeline</td>
                    <td className="ra"><InrC n={fds.pipelineTotal} /></td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 10, paddingTop: 10, borderTop: '.5px solid var(--brd)' }}>
              Strategy: maturities laddered quarterly across 4 banks (Slice, ICICI, HDFC, SBI) — spreads reinvestment risk and
              keeps each bank's annual interest below the ₹40,000 Sec 194A TDS-deduction threshold. All figures compound
              quarterly from each FD's open date; pipeline stays out of net worth and "deployed" totals until its deploy date arrives.
            </div>
          </div>
        </div>
      )}

      {/* MUTUAL FUNDS */}
      {tab === 3 && (() => {
        const mfDate = (mf.rows.find((r) => r.navDate) || {}).navDate || null;
        const allocSegs = [
          { label: 'Equity',    val: mf.alloc.equity,    color: 'var(--pur)' },
          { label: 'Arbitrage', val: mf.alloc.arbitrage, color: 'var(--blu)' },
          { label: 'Debt',      val: mf.alloc.debt,      color: 'var(--txt3)' },
        ];
        const capSegs = [
          { label: 'Large',       val: mf.cap.large,  color: 'var(--blu)' },
          { label: 'Mid',         val: mf.cap.mid,    color: 'var(--pur)' },
          { label: 'Small',       val: mf.cap.small,  color: 'var(--grn)' },
          { label: 'Multi/Flexi', val: mf.cap.multi,  color: 'var(--pnk)' },
          { label: 'Hedged',      val: mf.cap.hedged, color: 'var(--acc)' },
        ];
        const capTot = capSegs.reduce((s, x) => s + x.val, 0) || 1;
        const fmtX = (n) => (n == null ? '—' : Math.abs(n).toFixed(1) + '%');
        const delta = mfx.port != null && mfx.bench != null ? mfx.port - mfx.bench : null;
        const platStyle = (p) => p === 'JioBLK'
          ? { background: 'rgba(155,138,251,.16)', color: '#BCAEFF' }
          : { background: 'rgba(52,211,153,.16)', color: '#6EE7B7' };
        const MF_COLS = [
          { key: 'name', label: 'Fund · share', num: false },
          { key: 'platform', label: 'Platform', num: false },
          { key: 'units', label: 'Units', num: true },
          { key: 'nav', label: 'NAV', num: true },
          { key: 'value', label: 'Value', num: true },
          { key: 'cost', label: 'Cost', num: true },
          { key: 'ret', label: 'Return', num: true },
        ];
        return (
        <div>
          <InsightBanner text={insightsOn ? insights?.mutual_funds : null} loading={insightsOn && insightsFirstLoad} />

          {/* Summary strip */}
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">total invested</div>
              <div className="vmd"><InrF n={mf.totCost} /></div>
              <div className="sub">{MF_FUNDS.length} funds · 2 platforms</div>
            </div>
            <div className="csm">
              <div className="fxc">
                <div className="lbl" style={{ margin: 0 }}>current value</div>
                <FreshnessTag mode="nav" date={mfDate} />
              </div>
              <div className="vmd grn" style={{ marginTop: 6 }}><InrF n={mf.totVal} /></div>
              <div className="sub">live NAV × CAS units ({UNITS_AS_OF})</div>
            </div>
            <div className="csm">
              <div className="lbl">total return</div>
              <div className={'vmd ' + cl(mf.totRet)}>{pctS(mf.totRet)}</div>
              <div className="sub"><SInrF n={mf.totVal - mf.totCost} /> abs</div>
            </div>
          </div>

          {/* 3-up analytics */}
          <div className="mf-g3">
            {/* XIRR vs Nifty 50 */}
            <div className="card">
              <div className="ctitle" style={{ marginBottom: 12 }}>XIRR vs Nifty 50</div>
              <div className="g2">
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>Your portfolio</div>
                  <div className={'vmd ' + (mfx.port != null ? cl(mfx.port) : '')}>{fmtX(mfx.port)}</div>
                  <div className="sub">annualised</div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>Nifty 50</div>
                  <div className={'vmd ' + (mfx.bench != null ? cl(mfx.bench) : '')}>{fmtX(mfx.bench)}</div>
                  <div className="sub">same dated rupees</div>
                </div>
              </div>
              {delta != null && (
                <div style={{ marginTop: 12 }}>
                  <span className="verdict" style={delta >= 0
                    ? { background: 'var(--grn-bg)', color: 'var(--grn)' }
                    : { background: 'var(--red-bg)', color: 'var(--red)' }}>
                    {delta >= 0 ? '▲ Ahead' : '▼ Behind'} by {Math.abs(delta).toFixed(1)} pts
                  </span>
                </div>
              )}
            </div>

            {/* Asset allocation */}
            <div className="card">
              <div className="ctitle" style={{ marginBottom: 12 }}>Asset Allocation</div>
              {allocSegs.map((s) => {
                const pct = mf.totVal ? (s.val / mf.totVal) * 100 : 0;
                return (
                  <div key={s.label} style={{ marginBottom: 10 }}>
                    <div className="fxc" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: 'var(--txt2)' }}>{s.label}</span>
                      <span className="mono" style={{ fontSize: 12 }}><InrC n={s.val} /> · {pct.toFixed(1)}%</span>
                    </div>
                    <span className="bar-trk" style={{ display: 'block' }}>
                      <span className="bar-fil" style={{ width: pct + '%', background: s.color }} />
                    </span>
                  </div>
                );
              })}
              <div className="sub" style={{ marginTop: 10 }}>Arbitrage held as a cash-like sleeve, separate from equity.</div>
            </div>

            {/* Market cap */}
            <div className="card">
              <div className="ctitle" style={{ marginBottom: 4 }}>Market Cap</div>
              <div className="sub" style={{ marginBottom: 12 }}>Each fund is bucketed wholly by its mandate; Flexi Cap &amp; ELSS are multi-cap (no fabricated cap split).</div>
              <div className="mf-stack">
                {capSegs.map((s) => (
                  <span key={s.label} style={{ width: (s.val / capTot) * 100 + '%', background: s.color }} />
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                {capSegs.map((s) => (
                  <div key={s.label} className="fxc" style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--txt2)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <span className="mf-dot" style={{ background: s.color }} />{s.label}
                    </span>
                    <span className="mono" style={{ fontSize: 12 }}><InrC n={s.val} /> · {((s.val / capTot) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Holdings */}
          <div className="card sec">
            <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="ctitle">Holdings</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="mf-chip"><span className="mf-dot" style={{ background: '#BCAEFF' }} />JioBlackRock <InrF n={mf.jio.value} /> <span className={cl(mf.jio.ret)} style={{ marginLeft: 2 }}>{pctS(mf.jio.ret)}</span></span>
                <span className="mf-chip"><span className="mf-dot" style={{ background: '#6EE7B7' }} />Zerodha ELSS <InrF n={mf.elss.value} /> <span className={cl(mf.elss.ret)} style={{ marginLeft: 2 }}>{pctS(mf.elss.ret)}</span></span>
              </div>
            </div>
            <div className="ovx">
              <table className="tbl" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    {MF_COLS.map((c) => (
                      <th key={c.key} className={c.num ? 'ra' : ''} onClick={() => sortMf(c.key)}>
                        {c.label} {mfSort.key === c.key ? (mfSort.dir < 0 ? '↓' : '↑') : '↕'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mfSorted.map((f) => (
                    <tr key={f.id}>
                      <td style={{ color: 'var(--txt)', fontWeight: 500 }}>
                        {f.name}
                        <div style={{ fontSize: 10.5, color: 'var(--txt3)', fontWeight: 400, marginTop: 2 }}>
                          {f.cat} · {f.share.toFixed(1)}%
                        </div>
                      </td>
                      <td><span className="mf-pill" style={platStyle(f.platform)}>{f.platform}</span></td>
                      <td className="ra mono mut">{f.units.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                      <td className="ra mono">{f.nav.toFixed(4)}</td>
                      <td className="ra mono"><InrF n={f.value} /></td>
                      <td className="ra mono mut"><InrF n={f.cost} /></td>
                      <td className={'ra mono ' + cl(f.ret)}>{pctS(f.ret)}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td colSpan={4}>Total — {MF_FUNDS.length} funds</td>
                    <td className="ra"><InrF n={mf.totVal} /></td>
                    <td className="ra"><InrF n={mf.totCost} /></td>
                    <td className={'ra ' + cl(mf.totRet)}>{pctS(mf.totRet)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
              JioBlackRock: <Rs />20K/mo SIP active, first installment pending — seeded <Rs />20K (13-Jan-26) + <Rs />30K (20-Mar-26).
              Zerodha ELSS: 3-yr lock-in, unlocks 26-Feb-2027.
            </div>
          </div>

          <CFMemo
            title="MF Redemption Tax — FY25-26 Capital Gains"
            rows={[
              { label: 'FY25-26 MF redemptions', val: 'Nil', color: 'var(--txt2)', sub: FY.cf.cg2526.mfStcgNote },
              { label: 'STCG loss carried into FY26-27', val: '₹0', color: 'var(--grn)', sub: FY.cf.stcgNote },
            ]}
          />
        </div>
        );
      })()}

      {/* US STOCKS — live NYSE; mirrors the Indian tab (XIRR/CAGR/benchmarks
          from US_CASHFLOWS, sector allocation, sortable holdings + Category). */}
      {tab === 4 && (() => {
        const fmtX = (n) => (n == null ? '—' : Math.abs(n).toFixed(1) + '%');
        return (
        <div>
          <InsightBanner text={insightsOn ? insights?.us_stocks : null} loading={insightsOn && insightsFirstLoad} />
          <div className="sec" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <FreshnessTag mode="live" marketState={{ open: markets.nyse, label: `NYSE ${markets.nyse ? 'OPEN' : 'CLOSED'} · Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` }} />
          </div>

          {/* Summary cards — USD headline, subtle ₹ equivalent in the sub-line */}
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">Invested (cost)</div>
              <div className="vmd">${usData.inv.toFixed(2)}</div>
              <div className="sub">≈<span className="mut"><InrC n={usData.inv * fxRate} /></span> · {US.length} holdings</div>
            </div>
            <div className="csm">
              <div className="lbl">Current value</div>
              <div className="vmd">{usData.val ? '$' + usData.val.toFixed(2) : <Skel w={90} h={20} />}</div>
              <div className="sub">{usData.val && usdInr ? <>≈<span className="mut"><InrC n={ov.usInr} /></span> @ <Rs />{usdInr.toFixed(2)}</> : 'live NYSE'}</div>
            </div>
            <div className="csm">
              <div className="lbl">Unrealized P&amp;L</div>
              <div className={'vmd ' + (usData.val ? cl(usData.pl) : '')}>
                {usData.val ? usd(usData.pl) : <Skel w={80} h={20} />}
              </div>
              <div className="sub">{usData.val ? <>{pctS(usData.pct)} · ≈<span className="mut"><InrC n={Math.abs(usData.pl) * fxRate} /></span></> : 'value − cost'}</div>
            </div>
          </div>
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">Day change</div>
              <div className={'vmd ' + (usData.val ? cl(usStats.dayPl) : '')}>
                {usData.val ? usd(usStats.dayPl) : <Skel w={80} h={20} />}
              </div>
              <div className="sub">{usData.val ? <>{pctS(usStats.dayPct)} · ≈<span className="mut"><InrC n={Math.abs(usStats.dayPl) * fxRate} /></span></> : 'since prev close'}</div>
            </div>
            <div className="csm">
              <div className="lbl">CAGR (annualised)</div>
              <div className={'vmd ' + (usStats.cagr != null ? cl(usStats.cagr) : '')}>
                {usStats.cagr != null ? fmtX(usStats.cagr) : <Skel w={70} h={20} />}
              </div>
              <div className="sub">money-weighted · since Mar 2024</div>
            </div>
            <div className="csm">
              <div className="lbl">Realized P&amp;L (YTD)</div>
              <div className={'vmd ' + cl(US_REALIZED.ytdUsd)}>${Math.abs(US_REALIZED.ytdUsd).toFixed(2)}</div>
              <div className="sub">{US_REALIZED.ytdLabel} · ≈<span className="mut"><InrC n={Math.abs(US_REALIZED.ytdUsd) * fxRate} /></span> · overall below</div>
            </div>
          </div>

          {/* vs Benchmarks + category allocation (single 2-col grid) */}
          <div className="g2 sec">
            <div className="card">
              <div className="ctitle" style={{ marginBottom: 4 }}>vs Benchmarks</div>
              <div className="sub" style={{ marginBottom: 14 }}>Same dated dollars — your ${Math.round(usStats.netInvested)} <span className="mut">(≈<InrC n={usStats.netInvested * fxRate} />)</span> deployed into each instead.</div>
              <table className="tbl">
                <thead>
                  <tr><th>Instrument</th><th className="ra">XIRR</th><th className="ra">Value</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ color: 'var(--txt)', fontWeight: 600 }}>Your portfolio</td>
                    <td className={'ra mono ' + (usStats.xirr != null ? cl(usStats.xirr) : 'mut')}>{fmtX(usStats.xirr)}</td>
                    <td className="ra mono">{usData.val ? '$' + usData.val.toFixed(0) : '—'}</td>
                  </tr>
                  {usStats.benchmarks.map((b) => (
                    <tr key={b.key}>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />{b.label}
                      </span></td>
                      <td className={'ra mono ' + (b.xirr != null ? cl(b.xirr) : 'mut')}>{fmtX(b.xirr)}</td>
                      <td className="ra mono mut">{b.value != null ? '$' + b.value.toFixed(0) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sub" style={{ marginTop: 12 }}>
                CAGR {usStats.cagr != null ? Math.abs(usStats.cagr).toFixed(1) + '%' : '—'}
                {usStats.years != null ? ` over a ${usStats.years.toFixed(1)}-yr weighted holding` : ''} · price-only (ex-dividend) index returns.
              </div>
              <div className="sub" style={{ marginTop: 8, color: 'var(--txt3)', lineHeight: 1.6 }}>
                Money-weighted on net external capital from the Vested statement. Index returns are price-only (ex-dividend);
                your portfolio's total return includes reinvested dividends, so it is modestly flattered in comparison.
              </div>
            </div>
            <div className="card">
              <div className="ctitle" style={{ marginBottom: 14 }}>Sector &amp; Cap Mix</div>
              {usStats.sectors.map((c, i) => (
                <div key={c.label} className="seg-row">
                  <span className="seg-lbl" style={{ width: 120 }}>{c.label}</span>
                  <span className="seg-trk"><span className="seg-fil" style={{ width: Math.min(100, c.pct) + '%', background: c.other ? OTHERS_COLOR : SECTOR_PALETTE[i % SECTOR_PALETTE.length] }} /></span>
                  <span className="seg-val">${(c.val).toFixed(0)} · {c.pct.toFixed(0)}%</span>
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--brd)', margin: '14px 0' }} />
              {usStats.caps.filter((c) => c.val > 0).map((c) => (
                <div key={c.label} className="seg-row">
                  <span className="seg-lbl" style={{ width: 120 }}>{c.label} cap</span>
                  <span className="seg-trk"><span className="seg-fil" style={{ width: Math.min(100, c.pct) + '%', background: { Mega: 'var(--blu)', Large: 'var(--pur)', Mid: 'var(--cyn)', Small: 'var(--pnk)' }[c.label] }} /></span>
                  <span className="seg-val">${(c.val).toFixed(0)} · {c.pct.toFixed(0)}%</span>
                </div>
              ))}
              <div style={{ height: 1, background: 'var(--brd)', margin: '14px 0' }} />
              <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginBottom: 10, lineHeight: 1.5 }}>Sector &amp; cap use ETF look-through to align with Vested (equity only); direct stocks by GICS.</div>
              <div className="g3">
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>Winner</div>
                  <div className="vsm grn">{usStats.winner ? usStats.winner.sym : '—'}</div>
                  <div className={'sub ' + (usStats.winner ? cl(usStats.winner.livePct) : '')}>{usStats.winner ? pctS(usStats.winner.livePct) : 'live'}</div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>Drag</div>
                  <div className="vsm red">{usStats.laggard ? usStats.laggard.sym : '—'}</div>
                  <div className={'sub ' + (usStats.laggard ? cl(usStats.laggard.livePct) : '')}>{usStats.laggard ? pctS(usStats.laggard.livePct) : 'live'}</div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>Largest</div>
                  <div className="vsm">{usStats.topPos ? usStats.topPos.sym : '—'}</div>
                  <div className="sub">{usStats.topPos && usData.val ? ((usStats.topPos.liveVal / usData.val) * 100).toFixed(0) + '% of book' : 'by value'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Sortable holdings (data-array sort; live tick-flash) */}
          <div className="card sec">
            <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="ctitle">Holdings</div>
              <div className="sub" style={{ margin: 0 }}>
                {usData.val ? `$${usData.inv.toFixed(2)} → $${usData.val.toFixed(2)} · ` : 'loading live prices… '}
                <span className={cl(usData.pl)}>{usData.val ? usd(usData.pl) + ` (${pctS(usData.pct)})` : ''}</span>
              </div>
            </div>
            <div className="ovx">
              <table className="tbl" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    {US_COLS.map((c) => (
                      <th key={c.key} className={c.num ? 'ra' : ''} onClick={() => sortUs(c.key)}>
                        {c.label} {usSort.col === c.key ? (usSort.dir < 0 ? '↓' : '↑') : '↕'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usSorted.map((s) => (
                    <tr key={s.sym}>
                      <td style={{ color: 'var(--txt)', fontWeight: 600 }} className="mono">
                        {s.sym}
                        <div style={{ fontSize: 10.5, color: 'var(--txt3)', fontWeight: 400, marginTop: 2, fontFamily: 'var(--body)' }}>{s.name} · {s.cat}</div>
                      </td>
                      <td><span className="mf-pill" style={{ background: 'var(--sur2)', color: 'var(--txt2)' }}>{s.cat}</span></td>
                      <td className="ra mono">
                        {s.livePrice != null
                          ? <span key={s.sym + '-' + s.livePrice} className={flash[s.sym] ? 'flash-' + flash[s.sym] : ''}>${s.livePrice.toFixed(2)}</span>
                          : <Skel w={40} h={11} />}
                      </td>
                      <td className="ra mono">{s.liveVal != null ? usd(s.liveVal) : '—'}</td>
                      <td className="ra mono mut">${s.inv.toFixed(2)}</td>
                      <td className={'ra mono ' + (s.livePl != null ? cl(s.livePl) : 'mut')}>
                        {s.livePl != null ? usd(s.livePl) : '—'}
                      </td>
                      <td className={'ra mono ' + (s.livePct != null ? cl(s.livePct) : 'mut')}>
                        {s.livePct != null ? pctS(s.livePct) : '—'}
                      </td>
                      <td className={'ra mono ' + (s.dayPct != null ? cl(s.dayPct) : 'mut')}>
                        {s.dayPct != null ? pctS(s.dayPct) : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td colSpan={3}>Total — {US.length} holdings</td>
                    <td className="ra">{usData.val ? '$' + usData.val.toFixed(2) : '…'}</td>
                    <td className="ra">${usData.inv.toFixed(2)}</td>
                    <td className={'ra ' + cl(usData.pl)}>{usData.val ? usd(usData.pl) : '…'}</td>
                    <td className={'ra ' + cl(usData.pl)}>{usData.val ? pctS(usData.pct) : '…'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="sub" style={{ marginTop: 10 }}>Click headers to sort · live prices from Yahoo Finance, flash on each tick, converted at live USD/INR.</div>
          </div>

          {/* Realized P&L + Dividend Income, side by side */}
          <div className="g2 sec">
            {/* Realized P&L — scalable, scope-aware (Vested ledger · avg-cost) */}
            <RealizedPanel
              data={US_REALIZED}
              currency="usd"
              fxRate={fxRate}
              note="Realised gains from Vested's lot-level P&L report (split/lot-adjusted). Filed foreign-STCG is in the ITR-verified card below."
            />

            {/* Dividend income (from the Vested statement) */}
            <div className="card">
              <div className="fxc" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="ctitle">Dividend Income</div>
                  <div className="sub" style={{ margin: 0 }}>Vested statement · as of {US_DIVIDENDS.asOf}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="vmd grn">${US_DIVIDENDS.netAllTime.toFixed(2)}</div>
                  <div className="sub" style={{ margin: 0 }}>net all-time (≈<InrC n={US_DIVIDENDS.netAllTime * fxRate} />)</div>
                </div>
              </div>
              <div className="g2 sec">
                <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>gross all-time</div><div className="vsm grn">${US_DIVIDENDS.grossAllTime.toFixed(2)}</div></div>
                <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>tax withheld</div><div className="vsm red">${US_DIVIDENDS.taxAllTime.toFixed(2)}</div></div>
                <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>last 12 months</div><div className="vsm grn">${US_DIVIDENDS.last12Gross.toFixed(2)}</div></div>
                <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>this FY (26-27)</div><div className="vsm">${(US_DIVIDENDS.fy.find((f) => f.label === 'FY26-27')?.amt || 0).toFixed(2)}</div></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {US_DIVIDENDS.top.map((t, i) => (
                  <span key={t.sym} className="mf-chip"><span className="mf-dot" style={{ background: SECTOR_PALETTE[i % SECTOR_PALETTE.length] }} />{t.sym} ${t.amt.toFixed(2)}</span>
                ))}
              </div>
              <div className="sub" style={{ marginTop: 12, color: 'var(--txt3)' }}>25% US withholding at source; creditable against Indian tax via the DTAA.</div>
            </div>
          </div>

          <CFMemo
            title="Foreign Equity Tax — FY25-26 Capital Gains"
            rows={[
              { label: 'FY25-26 foreign STCG', val: '+₹27,694', color: 'var(--grn)', sub: FY.cf.cg2526.foreignStcgNote },
              { label: 'STCG loss carried into FY26-27', val: '₹0', color: 'var(--grn)', sub: FY.cf.stcgNote },
            ]}
          />
        </div>
        );
      })()}

      {/* ALGO */}
      {tab === 5 && (
        <div>
          <InsightBanner text={insightsOn ? insights?.algo : null} loading={insightsOn && insightsFirstLoad} />
          <div className="sec" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <FreshnessTag mode="manual" date="FY25-26 ITR-verified · swing live" />
          </div>

          {/* SUMMARY */}
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">own capital</div>
              <div className="vmd"><RsText>{ALGO.summary.deployed}</RsText></div>
              <div className="sub"><RsText>{ALGO.summary.deployedNote}</RsText></div>
            </div>
            <div className="csm">
              <div className="lbl">FY 2025-26</div>
              <div className={'vmd ' + cl(FY.combined2526.net)}><SInrF n={FY.combined2526.net} /></div>
              <div className="sub">realised value</div>
            </div>
            <div className="csm">
              <div className="lbl">FY26-27 YTD</div>
              <div className={'vmd ' + (ytdTotal != null ? cl(ytdTotal) : '')}>{ytdTotal != null ? <SInrF n={ytdTotal} /> : <Skel w={90} h={15} />}</div>
              <div className="sub">
                <span className="grn">S01 <SInrF n={FY.s01.fy2627.net} /></span> ·{' '}
                <span className="grn">S02 <SInrF n={FY.s02.fy2627.net} /></span> ·{' '}
                swing {swing.valued ? <span className={cl(swing.pl)}><SInrF n={swing.pl} /></span> : '…'}
              </div>
            </div>
          </div>

          <div className="g2 sec">
            {/* S01 */}
            <div className="card card-accent" style={{ borderLeftColor: 'var(--acc)', display: 'flex', flexDirection: 'column' }}>
              <div className="fxc" style={{ marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{ALGO.s01.title}</div>
                  <div className="sub" style={{ margin: 0 }}>{ALGO.s01.broker}</div>
                </div>
                <span className="badge ba">{ALGO.s01.badge}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <div className="mini">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="lbl" style={{ margin: '0 0 3px' }}>pool</div>
                      <div className="sub" style={{ margin: 0 }}><RsText>{ALGO.s01.pool}</RsText></div>
                    </div>
                    <div style={{ fontSize: 23, fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--mono)', flexShrink: 0, letterSpacing: '-.5px' }}><RsText>{ALGO.s01.deployed}</RsText></div>
                  </div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                    FY2025-26 <span className="badge bb" style={{ fontSize: 9 }}>ITR-verified</span>
                  </div>
                  <BrokerTable data={FY.s01.fy2526} />
                </div>
                <YtdFno label={`FY2026-27 YTD — ${FY.s01.fy2627.label}`} data={FY.s01.fy2627} />
                <div className="mini" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                    CF absorption — FY26-27 <span className="badge bb" style={{ fontSize: 9 }}>ITR</span>
                  </div>
                  <div className="fxc">
                    <span style={{ color: 'var(--txt2)' }}>CF entering FY26-27</span>
                    <span className="red mono"><SInrF n={-cfEntering} /></span>
                  </div>
                  <div className="fxc" style={{ marginTop: 8 }}>
                    <span style={{ color: 'var(--txt2)' }}>Realised F&amp;O YTD (S01 + S02)</span>
                    <span className="grn mono"><SInrF n={ytdRealised} /></span>
                  </div>
                  <div className="fxc" style={{ marginTop: 10, paddingTop: 8, borderTop: '.5px solid var(--brd)' }}>
                    <span style={{ color: 'var(--txt2)' }}>CF remaining</span>
                    <span className="red mono"><SInrF n={-cfAfterRealised} /></span>
                  </div>
                </div>
              </div>
            </div>

            {/* S02 */}
            <div className="card card-accent" style={{ borderLeftColor: 'var(--grn)', display: 'flex', flexDirection: 'column' }}>
              <div className="fxc" style={{ marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{ALGO.s02.title}</div>
                  <div className="sub" style={{ margin: 0 }}>{ALGO.s02.broker}</div>
                </div>
                <span className="badge bg">{ALGO.s02.badge}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <div className="mini">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="lbl" style={{ margin: '0 0 3px' }}>capital</div>
                      <div className="sub" style={{ margin: 0 }}><RsText>{ALGO.s02.capital}</RsText></div>
                    </div>
                    <div style={{ fontSize: 23, fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--mono)', flexShrink: 0, letterSpacing: '-.5px' }}><RsText>{ALGO.s02.deployed}</RsText></div>
                  </div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                    FY2025-26 <span className="badge bb" style={{ fontSize: 9 }}>ITR-verified</span>
                  </div>
                  <BrokerTable data={FY.s02.fy2526} />
                </div>
                <YtdFno label={`FY2026-27 YTD — ${FY.s02.fy2627.label}`} data={FY.s02.fy2627} />
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                    Swing positions <span className={'badge ' + (markets.nse ? 'bg' : '')} style={{ fontSize: 9, ...(markets.nse ? {} : { background: 'rgba(90,90,114,.2)', color: 'var(--txt3)' }) }}>{markets.nse ? 'LIVE' : 'NSE CLOSED'}</span>
                  </div>
                  <div className="ovx">
                  <table className="tbl" style={{ minWidth: 360 }}>
                    <thead>
                      <tr>
                        {[['sym', 'Symbol', false], ['qty', 'Qty', true], ['cost', 'Avg', true], ['ltp', 'LTP', true], ['pl', 'P&L', true], ['pct', '%', true]].map(([k, label, num]) => (
                          <th key={k} className={num ? 'ra' : ''} onClick={() => sortSw(k)}>
                            {label} {swSort.key === k ? (swSort.dir < 0 ? '↓' : '↑') : '↕'}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {swingSorted.map((r) => (
                        <tr key={r.sym}>
                          <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{r.sym}</td>
                          <td className="ra mut">{r.qty}</td>
                          <td className="ra mut mono">{r.cost.toFixed(2)}</td>
                          <td className="ra mono">{r.ltp != null ? r.ltp.toFixed(2) : <Skel w={42} h={11} />}</td>
                          <td className={'ra mono ' + (r.pl != null ? cl(r.pl) : 'mut')}>
                            {r.pl != null ? <SInrF n={r.pl} /> : '—'}
                          </td>
                          <td className={'ra mono ' + (r.pct != null ? cl(r.pct) : 'mut')}>
                            {r.pct != null ? pctS(r.pct) : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="tot">
                        <td>Total</td>
                        <td />
                        <td className="ra"><InrF n={swing.inv} /></td>
                        <td className="ra">{swing.valued ? inrFull(swing.val) : '…'}</td>
                        <td className={'ra ' + cl(swing.pl)}>{swing.valued ? <SInrF n={swing.pl} /> : '…'}</td>
                        <td className={'ra ' + cl(swing.pl)}>{swing.valued ? pctS(swing.pct) : '…'}</td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* BOTTOM STRIP — FY25-26 realised only (capital is shown above) */}
          <div className="csm sec">
            <span style={{ color: 'var(--txt2)' }}>
              FY25-26 combined — Gross: <span className="grn"><SInrF n={FY.combined2526.gross} /></span> ·
              Charges: <span className="red"><RsText>{inrFull(FY.combined2526.charges)}</RsText></span> ·
              Net F&amp;O (Sch BP): <span className={cl(FY.combined2526.net)}><SInrF n={FY.combined2526.net} /></span>
              {'  '}
              <span className="mut">(S01 <SInrF n={FY.s01.fy2526.total.net} /> · S02 <SInrF n={FY.s02.fy2526.total.net} />)</span>
            </span>
          </div>

          {/* CF PANEL */}
          <div className="card">
            <div className="lbl" style={{ marginBottom: 10, display: 'flex', gap: 6 }}>
              F&amp;O Loss Carryforward <span className="badge bb" style={{ fontSize: 9 }}>ITR-verified · entering FY26-27</span>
            </div>
            <div className="g4">
              {FY.carryforward.map((c) => (
                <div className="csm" key={c.label} style={c.accent ? { borderColor: 'rgba(232,160,48,.35)' } : {}}>
                  <div className="sub" style={{ margin: 0 }}>{c.label}</div>
                  <div className="vsm" style={{ marginTop: 4, color: c.consumed ? 'var(--grn)' : 'var(--red)' }}>
                    {c.consumed ? <><Rs />0</> : <SInrF n={c.val} />}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PROJECTION — forward net-worth projection (rolling, 1/5/10/30Y), driven
          live by net worth + sleeve mix + the assumptions in PROJECTION. */}
      {tab === 6 && (
        <div>
          <div className="sec">
            <FreshnessTag mode="manual" date={`forward projection · from net worth ${inrCd(ov.nw)} today`} />
          </div>
          <ProjectionTab nw={Math.round(ov.nw)} loan={STATIC.loan} sleeves={projSleeves} baseYear={now.getFullYear()} />
        </div>
      )}

      <div style={{ textAlign: 'center', color: 'var(--txt3)', fontSize: 10, marginTop: 18 }}>
        Live prices via Yahoo Finance · auto-refresh every 15 min · for personal tracking only
      </div>
    </div>
  );
}

function Stat({ label, val }) {
  return (
    <div className="csm" style={{ flex: 1, minWidth: 120, padding: '9px 12px' }}>
      <div className="lbl" style={{ marginBottom: 2 }}>{label}</div>
      <div className="vsm">{val}</div>
    </div>
  );
}

// One freshness indicator for the whole dashboard — same dot+text grammar, copy
// differs by asset class. mode: 'live' (intraday equities, the only "LIVE"),
// 'nav' (once-daily mutual funds), 'manual' (FDs / algo / retirement).
// Uniform freshness coding across the dashboard:
//   green = live & market open · grey = market closed · amber = cached/stale · grey = manual
function FreshnessTag({ mode, date, marketState }) {
  let dot = 'var(--txt3)', text = '';
  if (mode === 'live') {
    const open = marketState && marketState.open;
    dot = open ? 'var(--grn)' : 'var(--txt3)';
    text = (open ? 'LIVE · ' : '') + (marketState ? marketState.label : '');
  } else if (mode === 'nav') {
    const f = fmtNavDate(date);
    if (f) { dot = 'var(--grn)'; text = `NAV as of ${f}`; }
    else { dot = 'var(--acc)'; text = 'Showing last-known NAV (CAS 05 Jun 2026)'; }
  } else {
    dot = 'var(--txt3)'; text = `as of ${date || 'manual'}`;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--txt2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      {text}
    </span>
  );
}

// Reusable loss-carryforward memo — surfaced on every tab where a loss type
// actually applies. Single source of truth: data/fy2526_verified.json → cf.
function CFMemo({ title, lead, rows, foot }) {
  return (
    <div className="card sec">
      <div className="lbl" style={{ marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        {title} <span className="badge bb" style={{ fontSize: 9 }}>ITR-verified</span>
      </div>
      {lead && <div className="sub" style={{ marginTop: 0, marginBottom: rows ? 12 : 0, lineHeight: 1.6 }}>{lead}</div>}
      {rows && (
        <div className="g3">
          {rows.map((r) => (
            <div className="csm" key={r.label} style={r.accent ? { borderColor: 'rgba(232,160,48,.35)' } : {}}>
              <div className="sub" style={{ margin: 0 }}>{r.label}</div>
              <div className="vsm" style={{ marginTop: 4, color: r.color || 'var(--red)' }}><RsText>{String(r.val).replace(/^[+\-−]/, '')}</RsText></div>
              {r.sub && <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}><RsText>{r.sub}</RsText></div>}
            </div>
          ))}
        </div>
      )}
      {foot && <div className="sub" style={{ marginTop: rows ? 12 : 0, paddingTop: rows ? 10 : 0, borderTop: rows ? '.5px solid var(--brd)' : 'none', lineHeight: 1.6 }}>{foot}</div>}
    </div>
  );
}

// Static FY broker breakdown (Gross / Charges / Net) — ITR-verified figures.
function BrokerTable({ data }) {
  const { rows, total } = data;
  return (
    <div className="ovx">
    <table className="tbl">
      <thead>
        <tr>
          <th>Broker</th><th className="ra">Gross</th><th className="ra">Charges</th><th className="ra">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.broker}>
            <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{r.broker}</td>
            <td className={'ra mono ' + cl(r.gross)}><SInrF n={r.gross} /></td>
            <td className="ra mono mut">{numC(r.charges)}</td>
            <td className={'ra mono ' + cl(r.net)}><SInrF n={r.net} /></td>
          </tr>
        ))}
        <tr className="tot">
          <td>Total</td>
          <td className={'ra ' + cl(total.gross)}><SInrF n={total.gross} /></td>
          <td className="ra mut">{numC(total.charges)}</td>
          <td className={'ra ' + cl(total.net)}><SInrF n={total.net} /></td>
        </tr>
      </tbody>
    </table>
    </div>
  );
}

// Current-year YTD realised F&O (Gross / Charges / Net) + optional extra row.
function YtdFno({ label, data, extra }) {
  return (
    <div className="mini">
      <div className="lbl" style={{ marginBottom: 6 }}>{label}</div>
      <div className="fxc"><span style={{ color: 'var(--txt2)' }}>Gross</span><span className={'mono ' + cl(data.gross)}><SInrF n={data.gross} /></span></div>
      <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>Charges</span><span className="mono mut">{numC(data.charges)}</span></div>
      <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>Net realised</span><span className={'mono ' + cl(data.net)}><SInrF n={data.net} /></span></div>
      {extra && (
        <div className="fxc" style={{ marginTop: 3 }}>
          <span style={{ color: 'var(--txt2)' }}>{extra.label}</span>{extra.node}
        </div>
      )}
    </div>
  );
}

function Donut({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 168, thick = 24, r = (size - thick) / 2, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sur2)" strokeWidth={thick} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map((seg) => {
            const frac = total ? seg.value / total : 0;
            const dash = frac * C;
            const el = (
              <circle
                key={seg.label} cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={seg.color} strokeWidth={thick}
                strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc}
              >
                <title>{`${seg.label}: ₹${(seg.value / 1e5).toFixed(2)}L (${(frac * 100).toFixed(1)}%)`}</title>
              </circle>
            );
            acc += dash;
            return el;
          })}
        </g>
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fill="var(--txt3)"
          fontSize="9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>assets</text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fill="var(--txt)"
          fontSize="17" fontWeight="700" fontFamily="var(--mono)"><tspan fontSize="13">₹</tspan>{inrCd(total)}</text>
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px', width: '100%' }}>
        {segments.map((seg) => (
          <div key={seg.label} className="fxc" style={{ gap: 6 }}
            title={`₹${(seg.value / 1e5).toFixed(2)}L`}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--txt2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {seg.label}
              </span>
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--txt)' }}>
              {total ? ((seg.value / total) * 100).toFixed(1) : '0'}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Amber AI-insight banner — renders a shimmer while loading, nothing if the
// tab has no insight worth flagging.
function InsightBanner({ text, loading }) {
  if (loading) {
    return (
      <div className="alert sec insight">
        <div className="insight-body" style={{ flex: 1 }}>
          <span>⚠</span>
          <span className="insight-shimmer" />
        </div>
        <span className="insight-tag">AI insight</span>
      </div>
    );
  }
  if (!text) return null;
  return (
    <div className="alert sec insight">
      <div className="insight-body">
        <span>⚠</span>
        <span>{text}</span>
      </div>
      <span className="insight-tag">AI insight</span>
    </div>
  );
}
