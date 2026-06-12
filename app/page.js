'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  INDIAN, US, FDS, MF, MF_FUNDS, MF_CASHFLOWS, MF_SIP, UNITS_AS_OF,
  ALGO, SWING, STATIC, PROJECTION, ALLOC_COLORS,
  TRANSACTIONS, CORPORATE_ACTIONS, INDIAN_REALIZED, INDIAN_BENCHMARKS,
  US_CASHFLOWS, US_BENCHMARKS, US_DIVIDENDS, US_REALIZED, loanOutstanding,
  PAYSLIPS,
} from './portfolio';
import FY from '../data/fy2526_verified.json';

import { nseOpenNow, nyseOpenNow, marketStateFromQuotes } from './lib/market';
import { dayOrNight } from './lib/suntimes';
import { getSnapshots, recordSnapshot } from './lib/snapshots';
import { buildBackfill } from './lib/backfill';
import { cmpfCorpus } from './lib/cmpf';
import { cmpsTotalPaid, cmpsMonthlyPension, cmpsServiceYears, CMPS_RETIREMENT_DATE } from './lib/cmps';
import {
  xirr, weightedCagr, benchCounterfactual, computeBetaVol,
  applyCorpActions, compound, clampN, DAY_MS, YEAR_MS,
} from './lib/calc';
import {
  cl, isoOf, inrC, inrCd, inrFull, fmtNavDate, InrC, InrF, SInrC, SInrF, sFull, Rs, pctS,
} from './lib/fmt';
import { ETF_LOOKTHROUGH, ETF_CAP, US_CAP, usSectorOf } from './lib/constants';
const COLORS = ALLOC_COLORS;

import OverviewTab  from './components/tabs/OverviewTab';
import IndianTab    from './components/tabs/IndianTab';
import FDTab        from './components/tabs/FDTab';
import MFTab        from './components/tabs/MFTab';
import USTab        from './components/tabs/USTab';
import AlgoTab      from './components/tabs/AlgoTab';
import Skel         from './components/shared/Skel';
import FreshnessTag from './components/shared/FreshnessTag';

// ─── cache keys ───────────────────────────────────────────────────────────────
const FETCH_TS_KEY  = 'nwTracker.cache';
const INSIGHTS_KEY  = 'nwTracker.insights';
const MFNAV_KEY     = 'nwTracker.mfnav';
const HIST_KEY      = 'nwTracker.hist';
const REFRESH_MS    = 15 * 60 * 1000;

// ─── pure derivations ─────────────────────────────────────────────────────────
function deriveMf(mfNav) {
  const fundsNav = (mfNav && mfNav.funds) || {};
  let totVal = 0, totCost = 0;
  const rows = MF_FUNDS.map((f) => {
    const info  = fundsNav[f.id];
    const nav   = info && isFinite(info.nav) ? info.nav : f.casNav;
    const value = f.units * nav;
    const ret   = f.cost ? ((value - f.cost) / f.cost) * 100 : 0;
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
  const alloc = { equity: v('flexi') + v('nifty50') + v('midcap') + v('next50') + v('small') + v('elss'), arbitrage: v('arb'), debt: 0 };
  const cap = { large: 0, mid: 0, small: 0, multi: 0, hedged: 0 };
  rows.forEach((r) => {
    if (!r.mcap) { cap.multi += r.value; return; }
    ['large','mid','small','multi','hedged'].forEach((k) => { if (r.mcap[k]) cap[k] += r.value * r.mcap[k]; });
  });
  return { rows, totVal, totCost, totRet: totCost ? ((totVal - totCost) / totCost) * 100 : 0, jio: sub((r) => r.platform === 'JioBLK'), elss: sub((r) => r.platform === 'Zerodha'), alloc, cap, v };
}

function deriveFds(now) {
  const t = now.getTime();
  let principal = 0, accrued = 0, maturity = 0, weightedRate = 0;
  // Lifecycle is derived from the clock, not just the ledger: an 'active' row
  // past maturity automatically becomes CASH IN (frozen at maturity value,
  // out of the FD sleeve) — the ledger is only edited on redeployment.
  // 'closed' rows are history; 'pipeline' is future cash.
  const matured = FDS.filter((f) => f.status === 'active' && new Date(f.matures).getTime() <= t).map((f) => {
    const totalYears = (new Date(f.matures).getTime() - new Date(f.open).getTime()) / YEAR_MS;
    const maturityValue = compound(f.principal, f.rate, totalYears);
    return { ...f, maturityValue, maturityInterest: maturityValue - f.principal };
  });
  const maturedCash = matured.reduce((s, f) => s + f.maturityValue, 0);
  const rows = FDS.filter((f) => f.status === 'active' && new Date(f.matures).getTime() > t).map((f) => {
    const openT        = new Date(f.open).getTime();
    const matT         = new Date(f.matures).getTime();
    const totalYears   = (matT - openT) / YEAR_MS;
    const elapsedYears = clampN((t - openT) / YEAR_MS, 0, totalYears);
    const maturityValue  = compound(f.principal, f.rate, totalYears);
    const accruedSoFar   = compound(f.principal, f.rate, elapsedYears) - f.principal;
    principal += f.principal; accrued += accruedSoFar; maturity += maturityValue; weightedRate += f.principal * f.rate;
    return { ...f, totalYears, elapsedYears, maturityValue, maturityInterest: maturityValue - f.principal, accruedSoFar, progress: totalYears ? (elapsedYears / totalYears) * 100 : 0 };
  });
  const closed = FDS.filter((f) => f.status === 'closed').map((f) => {
    const totalYears = (new Date(f.matures).getTime() - new Date(f.open).getTime()) / YEAR_MS;
    const maturityValue = f.rate != null ? compound(f.principal, f.rate, totalYears) : f.principal;
    return { ...f, maturityValue, maturityInterest: maturityValue - f.principal };
  });
  const pipeline = FDS.filter((f) => f.status === 'pipeline')
    .map((f) => ({ ...f, deploy: f.open, maturity: f.matures, amount: f.principal, days: Math.ceil((new Date(f.open).getTime() - t) / DAY_MS) }));
  let nextIdx = -1;
  pipeline.forEach((f, i) => { if (f.days >= 0 && (nextIdx === -1 || f.days < pipeline[nextIdx].days)) nextIdx = i; });
  if (nextIdx >= 0) {
    const d = pipeline[nextIdx].days;
    pipeline[nextIdx] = { ...pipeline[nextIdx], badge: d === 0 ? 'NEXT · TODAY' : d === 1 ? 'NEXT · 1 DAY' : `NEXT · ${d} DAYS` };
  }
  return { rows, closed, matured, maturedCash, principal, accrued, maturity, blendedRate: principal ? weightedRate / principal : 0, pipeline, pipelineTotal: pipeline.reduce((s, f) => s + f.amount, 0), nextPipeline: nextIdx >= 0 ? pipeline[nextIdx] : null };
}

function mfXirr(mf, mfNav) {
  const today = new Date();
  const base  = MF_CASHFLOWS.map((c) => ({ date: new Date(c.date), amount: c.amount }));
  const port  = xirr([...base, { date: today, amount: mf.totVal }]);
  let benchRet = null, benchVal = null;
  const bench = mfNav && mfNav.benchmark;
  if (bench && bench.navByDate && isFinite(bench.latestNav)) {
    let units = 0, ok = true;
    for (const c of MF_CASHFLOWS) { const nav = bench.navByDate[c.date]; if (!isFinite(nav) || nav <= 0) { ok = false; break; } units += (-c.amount) / nav; }
    if (ok) { benchVal = units * bench.latestNav; benchRet = xirr([...base, { date: today, amount: benchVal }]); }
  }
  return { port: port != null ? port * 100 : null, bench: benchRet != null ? benchRet * 100 : null, benchVal, benchName: (bench && bench.name) || 'Nifty 50 Index' };
}

// ─── tabs config ──────────────────────────────────────────────────────────────
// Projection now lives inside the Overview tab; the header asset cards are the
// primary nav (each opens its tab) and the live net-worth figure opens Overview.
// ─── page component ───────────────────────────────────────────────────────────
export default function Page() {
  const [tab, setTab]               = useState(0);
  const [prices, setPrices]         = useState({});
  const [usdInr, setUsdInr]         = useState(null);
  const [status, setStatus]         = useState({ msg: 'Connecting…', type: '' });
  const [lastUpdate, setLastUpdate] = useState('—');
  const [markets, setMarkets]       = useState({ nse: null, nyse: null });
  const [loading, setLoading]       = useState(false);
  const [mfNav, setMfNav]           = useState(null);
  const [hist, setHist]             = useState(null);
  const [flash, setFlash]           = useState({});
  const [ath, setAth]               = useState(false); // all-time-high celebration
  const [heroKey, setHeroKey]       = useState(0);     // bumped once when NW first loads
  const prevPrices                  = useRef({});
  const headerRef                   = useRef(null);
  const prevNw                      = useRef(null);

  // Day/night + per-tab theme: set data attributes on <html> so CSS variables cascade
  const TAB_KEYS = ['overview', 'indian', 'fd', 'mf', 'us', 'algo'];

  // Tabs are URL-addressable (#overview … #algo): deep-linkable, reload-safe,
  // and back/forward navigable. State stays the source of truth; the hash syncs.
  const selectTab = useCallback((i) => {
    setTab(i);
    const key = '#' + (TAB_KEYS[i] || 'overview');
    try { if (window.location.hash !== key) history.pushState(null, '', key); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const fromHash = () => {
      const i = TAB_KEYS.indexOf((window.location.hash || '').slice(1));
      if (i >= 0) setTab(i);
    };
    fromHash(); // honor a deep link on first load
    window.addEventListener('popstate', fromHash);
    window.addEventListener('hashchange', fromHash);
    return () => { window.removeEventListener('popstate', fromHash); window.removeEventListener('hashchange', fromHash); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme mode: 'auto' (sunrise/sunset), 'day', or 'night'. Persisted.
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem('nwTracker.theme') || 'auto'; } catch { return 'auto'; }
  });
  // Geolocation for accurate sunrise/sunset; falls back to India's centroid.
  const [geo, setGeo] = useState(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { timeout: 8000, maximumAge: 3600_000 }
    );
  }, []);
  const cycleTheme = () => setThemeMode((m) => {
    const next = m === 'auto' ? 'day' : m === 'day' ? 'night' : 'auto';
    try { localStorage.setItem('nwTracker.theme', next); } catch {}
    return next;
  });

  useEffect(() => {
    const apply = () => {
      let time;
      if (themeMode === 'day' || themeMode === 'night') {
        time = themeMode;
      } else {
        const lat = geo?.lat ?? 20.59, lng = geo?.lng ?? 78.96; // India centroid fallback
        time = dayOrNight(new Date(), lat, lng);
      }
      document.documentElement.dataset.time = time;
    };
    apply();
    // Re-check every minute so auto mode flips at the real sunrise/sunset
    const id = setInterval(apply, 60_000);
    return () => clearInterval(id);
  }, [themeMode, geo]);
  useEffect(() => {
    document.documentElement.dataset.tab = TAB_KEYS[tab] ?? 'overview';
  }, [tab]);
  const [now, setNow]               = useState(() => new Date());

  // sorts
  const [inSort, setInSort]   = useState({ key: 'val',     dir: -1 });
  const [usSort, setUsSort]   = useState({ col: 'liveVal', dir: -1 });
  const [mfSort, setMfSort]   = useState({ key: 'value',   dir: -1 });
  const [swSort, setSwSort]   = useState({ key: 'pl',      dir: -1 });

  // insights
  const [insights, setInsights]               = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsOn, setInsightsOn]           = useState(() => { try { return localStorage.getItem('nwTracker.insightsOn') !== 'false'; } catch { return true; } });
  // Regeneration "ticket" — bumped when fresh insights are wanted. The payload
  // effect below runs after render, so it reads fully-recomputed derived state
  // (no need to thread prices/fx/nav through as arguments).
  const [insightsReq, setInsightsReq] = useState(0);
  const requestInsights = useCallback(() => setInsightsReq((n) => n + 1), []);
  const toggleInsights = () => setInsightsOn((prev) => { const next = !prev; try { localStorage.setItem('nwTracker.insightsOn', String(next)); } catch {} if (next) requestInsights(); return next; });
  const insightsFirstLoad = insightsLoading && insights == null;
  const timer = useRef(null);

  // Approximate FX fallback used only for ≈₹ conversion sub-text until the live
  // rate arrives — headline figures (NW, assets, snapshots) gate on live usdInr.
  const fxRate = usdInr || 88;

  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60 * 60 * 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    // Yahoo's marketState is holiday-aware; the wall-clock check is only a
    // fallback for the window before the first quote batch lands.
    const upd = () => {
      const nseSt  = marketStateFromQuotes(prices, (s) => s.endsWith('.NS'));
      const nyseSt = marketStateFromQuotes(prices, (s) => !s.endsWith('.NS') && !s.includes('='));
      setMarkets({
        nse:  nseSt  ? nseSt  === 'REGULAR' : nseOpenNow(),
        nyse: nyseSt ? nyseSt === 'REGULAR' : nyseOpenNow(),
        nseState: nseSt, nyseState: nyseSt,
      });
    };
    upd(); const id = setInterval(upd, 60 * 1000); return () => clearInterval(id);
  }, [prices]);

  // ─── fetch ──────────────────────────────────────────────────────────────────
  const fetchBatch = async (symbols) => {
    const res = await fetch('/api/quotes?symbols=' + encodeURIComponent(symbols.join(',')), { cache: 'no-store' });
    if (!res.ok) throw new Error('API ' + res.status);
    return (await res.json()).quotes || {};
  };
  const fetchMfNav = async () => { try { const res = await fetch('/api/mf-nav', { cache: 'no-store' }); return res.ok ? await res.json() : null; } catch { return null; } };
  const fetchHistory = async () => {
    try {
      const syms = [...new Set([...INDIAN_BENCHMARKS.flatMap((b) => b.yahooSyms), ...US_BENCHMARKS.flatMap((b) => b.yahooSyms), ...INDIAN.map((h) => `${h.sym}.NS`), ...US.map((h) => h.sym)])].join(',');
      const res = await fetch('/api/history?range=5y&symbols=' + encodeURIComponent(syms), { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };

  const doRefresh = useCallback(async (opts = {}) => {
    setLoading(true); setStatus({ msg: 'Fetching live prices…', type: '' });
    try {
      const inSyms = INDIAN.map((s) => s.ns).concat(SWING.map((s) => s.ns)).concat(['INR=X']);
      const [inData, usData, mfData, histData] = await Promise.all([fetchBatch(inSyms), fetchBatch(US.map((s) => s.sym)), fetchMfNav(), fetchHistory()]);
      const merged = { ...inData, ...usData };
      const tick = {};
      Object.keys(merged).forEach((k) => {
        const np = merged[k] && !merged[k].error ? merged[k].price : null, op = prevPrices.current[k];
        if (np != null && op != null && np !== op) tick[k] = np > op ? 'up' : 'down';
        if (np != null) prevPrices.current[k] = np;
      });
      if (Object.keys(tick).length) setFlash(tick);
      setPrices(merged);
      if (histData) { setHist(histData); try { sessionStorage.setItem(HIST_KEY, JSON.stringify({ ts: Date.now(), hist: histData })); } catch {} }
      if (mfData)   { setMfNav(mfData);  try { sessionStorage.setItem(MFNAV_KEY, JSON.stringify({ ts: Date.now(), mfNav: mfData })); } catch {} }
      const fx = inData['INR=X']?.price;
      if (fx) setUsdInr(fx);
      const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setStatus({ msg: 'Updated at ' + t, type: '' }); setLastUpdate('Last updated ' + t);
      try { sessionStorage.setItem(FETCH_TS_KEY, JSON.stringify({ ts: Date.now(), prices: merged, usdInr: fx || usdInr })); } catch {}
      if (opts.insights && insightsOn) requestInsights();
    } catch (e) { setStatus({ msg: 'Error: ' + (e.message || 'fetch failed'), type: 'err' }); }
    finally { setLoading(false); }
  }, [usdInr, requestInsights, insightsOn]);

  useEffect(() => {
    // Show last-known insights immediately (localStorage — survives sessions);
    // the hash-gated effect below decides whether a fresh API call is needed.
    try { const ic = JSON.parse(localStorage.getItem(INSIGHTS_KEY) || 'null'); if (ic?.insights) setInsights(ic.insights); } catch {}
    try { const mc = JSON.parse(sessionStorage.getItem(MFNAV_KEY) || 'null'); if (mc?.mfNav) setMfNav(mc.mfNav); } catch {}
    try { const hc = JSON.parse(sessionStorage.getItem(HIST_KEY) || 'null'); if (hc?.hist) setHist(hc.hist); } catch {}
    let hydrated = false;
    try {
      const c = JSON.parse(sessionStorage.getItem(FETCH_TS_KEY) || 'null');
      if (c && Date.now() - c.ts < 10 * 60 * 1000) {
        setPrices(c.prices || {}); if (c.usdInr) setUsdInr(c.usdInr);
        const age = Math.round((Date.now() - c.ts) / 60000);
        setStatus({ msg: `Cached prices (${age}m ago)`, type: 'stale' }); setLastUpdate(`Cached ${age}min ago`);
        hydrated = true;
        if (insightsOn) requestInsights();
      }
    } catch {}
    if (!hydrated) doRefresh({ insights: insightsOn });
    timer.current = setInterval(doRefresh, REFRESH_MS);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── derived: Indian ────────────────────────────────────────────────────────
  const heldIndian = useMemo(() => applyCorpActions(INDIAN, now, CORPORATE_ACTIONS, isoOf), [now]);
  const indian = useMemo(() => {
    let inv = 0, val = 0, valued = true;
    const rows = heldIndian.map((s) => {
      const q = prices[s.ns]; const ltp = q && !q.error ? q.price : null;
      const v = ltp != null ? s.qty * ltp : null; const pl = v != null ? v - s.inv : null;
      inv += s.inv; if (v != null) val += v; else valued = false;
      return { ...s, ltp, val: v, pl, pct: pl != null ? (pl / s.inv) * 100 : null, day: q && !q.error ? q.pct : null };
    });
    return { rows, inv, val, pl: val - inv, pct: inv ? ((val - inv) / inv) * 100 : 0, valued };
  }, [prices, heldIndian]);

  const inSorted = useMemo(() => {
    const arr = [...indian.rows]; const { key, dir } = inSort;
    arr.sort((a, b) => { const av = a[key], bv = b[key]; return typeof av === 'string' ? dir * String(av).localeCompare(String(bv)) : dir * ((av ?? -Infinity) - (bv ?? -Infinity)); });
    return arr;
  }, [indian, inSort]);
  const sortIn = (key) => setInSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'sym' || key === 'name' ? 1 : -1 });

  const inStats = useMemo(() => {
    const value = indian.val; const totalInvested = TRANSACTIONS.reduce((s, t) => s + t.invested, 0);
    let portXirr = null, cagr = null, years = null;
    if (indian.valued && value) {
      const cfs = TRANSACTIONS.map((t) => ({ date: new Date(t.date), amount: -t.invested }));
      const x = xirr([...cfs, { date: now, amount: value }]); portXirr = x != null ? x * 100 : null;
      const c = weightedCagr(TRANSACTIONS, value, now); cagr = c.cagr; years = c.years;
    }
    const sectorMap = {}, capMap = {};
    indian.rows.forEach((r) => { if (r.val == null) return; sectorMap[r.sector] = (sectorMap[r.sector] || 0) + r.val; capMap[r.cap] = (capMap[r.cap] || 0) + r.val; });
    const sectors = Object.entries(sectorMap).map(([label, val]) => ({ label, val, pct: value ? (val / value) * 100 : 0 })).sort((a, b) => b.val - a.val);
    const caps = ['Large','Mid','Small'].map((label) => ({ label, val: capMap[label] || 0, pct: value ? ((capMap[label] || 0) / value) * 100 : 0 }));
    const valued = indian.rows.filter((r) => r.pct != null);
    const winner  = valued.length ? valued.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    const laggard = valued.length ? valued.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
    const topPos  = valued.length && value ? valued.reduce((a, b) => (b.val > a.val ? b : a)) : null;
    const cfFor = (b) => { if (!hist?.series || !indian.valued || !value) return null; for (const sym of b.yahooSyms) { const cf = benchCounterfactual(hist.series[sym], TRANSACTIONS, now); if (cf) return cf; } return null; };
    const benchmarks = INDIAN_BENCHMARKS.map((b) => { const cf = cfFor(b); return { ...b, value: cf?.value ?? null, xirr: cf?.xirr ?? null, cagr: cf?.cagr ?? null, ret: cf?.ret ?? null }; });
    return { value, totalInvested, portXirr, cagr, years, sectors, caps, winner, laggard, topPos, benchmarks, topSector: sectors[0] || null };
  }, [indian, hist, now]);

  const indianRisk = useMemo(() => { const reg = computeBetaVol(hist, heldIndian, now); return { ...(reg || {}), hasReg: !!reg }; }, [hist, heldIndian, now]);

  const indianDay = useMemo(() => {
    let dayPl = 0, prevTot = 0;
    indian.rows.forEach((r) => { if (r.val == null || r.day == null) return; const prev = r.val / (1 + r.day / 100); dayPl += r.val - prev; prevTot += prev; });
    return { dayPl, dayPct: prevTot ? (dayPl / prevTot) * 100 : 0 };
  }, [indian]);

  // ─── derived: US ────────────────────────────────────────────────────────────
  const usData = useMemo(() => {
    let inv = 0, val = 0;
    const rows = US.map((s) => {
      const q = prices[s.sym]; const lp = q && !q.error ? q.price : null;
      const v = lp != null ? s.qty * lp : null; const pl = v != null ? v - s.inv : null;
      inv += s.inv; if (v != null) val += v;
      return { ...s, livePrice: lp, liveVal: v, livePl: pl, livePct: pl != null && s.inv ? (pl / s.inv) * 100 : null, dayPct: q && !q.error ? q.pct : null };
    });
    return { rows, inv, val, pl: val - inv, pct: inv ? ((val - inv) / inv) * 100 : 0 };
  }, [prices]);

  const usSorted = useMemo(() => {
    const arr = [...usData.rows]; const { col, dir } = usSort;
    arr.sort((a, b) => { const av = a[col], bv = b[col]; return typeof av === 'string' ? dir * String(av).localeCompare(String(bv)) : dir * ((bv ?? -Infinity) - (av ?? -Infinity)); });
    return arr;
  }, [usData, usSort]);
  const sortUs = (col) => setUsSort((s) => s.col === col ? { col, dir: -s.dir } : { col, dir: col === 'sym' ? 1 : -1 });

  const usStats = useMemo(() => {
    const value = usData.val;
    const secMap = {};
    usData.rows.forEach((r) => {
      if (r.liveVal == null) return;
      const lt = ETF_LOOKTHROUGH[r.sym];
      if (lt) { Object.entries(lt).forEach(([sec, w]) => { secMap[sec] = (secMap[sec] || 0) + r.liveVal * w; }); }
      else { const k = usSectorOf(r); secMap[k] = (secMap[k] || 0) + r.liveVal; }
    });
    let sectors = Object.entries(secMap).map(([label, val]) => ({ label, val, pct: value ? (val / value) * 100 : 0 })).sort((a, b) => b.val - a.val);
    if (sectors.length > 7) {
      const head = sectors.slice(0, 6).filter((x) => x.label !== 'All Others');
      const restVal = value - head.reduce((s, x) => s + x.val, 0);
      sectors = [...head, { label: 'All Others', val: restVal, pct: value ? (restVal / value) * 100 : 0, other: true }];
    }
    const capMap = { Mega: 0, Large: 0, Mid: 0, Small: 0 }; let equityVal = 0;
    usData.rows.forEach((r) => {
      if (r.liveVal == null) return;
      const lt = ETF_CAP[r.sym];
      if (lt) { Object.entries(lt).forEach(([k, w]) => { capMap[k] += r.liveVal * w; }); equityVal += r.liveVal; }
      else if (['Bond','Commodity','ETF'].includes(r.cat)) {}
      else { capMap[US_CAP[r.sym] || 'Large'] += r.liveVal; equityVal += r.liveVal; }
    });
    const caps = ['Mega','Large','Mid','Small'].map((label) => ({ label, val: capMap[label], pct: equityVal ? (capMap[label] / equityVal) * 100 : 0 }));
    const valued  = usData.rows.filter((r) => r.livePct != null);
    const winner  = valued.length ? valued.reduce((a, b) => (b.livePct > a.livePct ? b : a)) : null;
    const laggard = valued.length ? valued.reduce((a, b) => (b.livePct < a.livePct ? b : a)) : null;
    const topPos  = valued.length && value ? valued.reduce((a, b) => ((b.liveVal || 0) > (a.liveVal || 0) ? b : a)) : null;
    let dayPl = 0, prevTot = 0;
    usData.rows.forEach((r) => { if (r.liveVal == null || r.dayPct == null) return; const prev = r.liveVal / (1 + r.dayPct / 100); dayPl += r.liveVal - prev; prevTot += prev; });
    const netInvested = US_CASHFLOWS.reduce((s, c) => s + c.invested, 0);
    let xr = null, cagr = null, years = null;
    if (value) {
      const cfs = US_CASHFLOWS.map((c) => ({ date: new Date(c.date), amount: -c.invested }));
      const x = xirr([...cfs, { date: now, amount: value }]); xr = x != null ? x * 100 : null;
      const c = weightedCagr(US_CASHFLOWS, value, now); cagr = c.cagr; years = c.years;
    }
    const cfFor = (b) => { if (!hist?.series || !value) return null; for (const sym of b.yahooSyms) { const cf = benchCounterfactual(hist.series[sym], US_CASHFLOWS, now); if (cf) return cf; } return null; };
    const benchmarks = US_BENCHMARKS.map((b) => { const cf = cfFor(b); return { ...b, value: cf?.value ?? null, xirr: cf?.xirr ?? null, cagr: cf?.cagr ?? null, ret: cf?.ret ?? null }; });
    return { value, sectors, caps, winner, laggard, topPos, topSector: sectors[0] || null, dayPl, dayPct: prevTot ? (dayPl / prevTot) * 100 : 0, netInvested, xirr: xr, cagr, years, benchmarks };
  }, [usData, hist, now]);

  // ─── derived: swing ─────────────────────────────────────────────────────────
  const swing = useMemo(() => {
    let inv = 0, val = 0, valued = true;
    const rows = SWING.map((s) => {
      const q = prices[s.ns]; const ltp = q && !q.error ? q.price : null;
      const v = ltp != null ? s.qty * ltp : null; const pl = v != null ? v - s.inv : null;
      inv += s.inv; if (v != null) val += v; else valued = false;
      return { ...s, ltp, val: v, pl, pct: pl != null ? (pl / s.inv) * 100 : null };
    });
    return { rows, inv, val, pl: val - inv, pct: inv ? ((val - inv) / inv) * 100 : 0, valued };
  }, [prices]);

  const swingSorted = useMemo(() => {
    const arr = [...swing.rows]; const { key, dir } = swSort;
    arr.sort((a, b) => { const av = a[key], bv = b[key]; return typeof av === 'string' ? dir * String(av).localeCompare(String(bv)) : dir * ((av ?? -Infinity) - (bv ?? -Infinity)); });
    return arr;
  }, [swing, swSort]);
  const sortSw = (key) => setSwSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'sym' ? 1 : -1 }));

  const ytdRealised = FY.s01.fy2627.net + FY.s02.fy2627.net;
  const ytdTotal    = swing.valued ? ytdRealised + swing.pl : null;
  const cfEntering  = Math.abs(FY.carryforward.find((c) => c.accent).val);
  const cfAfterRealised = cfEntering - ytdRealised;

  // ─── derived: MF / FD / overview ────────────────────────────────────────────
  const mf = useMemo(() => deriveMf(mfNav), [mfNav]);
  const mfx = useMemo(() => mfXirr(mf, mfNav), [mf, mfNav]);

  // Counterfactual XIRRs for the MF cashflows against the Indian index series
  // already fetched for the equity tab — extra benchmarks beyond Nifty 50.
  const mfBench = useMemo(() => {
    if (!hist?.series) return [];
    const txs = MF_CASHFLOWS.filter((c) => c.amount < 0).map((c) => ({ date: c.date, invested: -c.amount }));
    if (!txs.length) return [];
    return INDIAN_BENCHMARKS.map((b) => {
      for (const sym of b.yahooSyms) {
        const cf = benchCounterfactual(hist.series[sym], txs, now);
        if (cf) return { key: b.key, label: b.label, color: b.color, xirr: cf.xirr };
      }
      return { key: b.key, label: b.label, color: b.color, xirr: null };
    });
  }, [hist, now]);
  const fds = useMemo(() => deriveFds(now), [now]);

  const mfSorted = useMemo(() => {
    const arr = [...mf.rows]; const { key, dir } = mfSort;
    arr.sort((a, b) => { const av = a[key], bv = b[key]; return typeof av === 'string' ? dir * String(av).localeCompare(String(bv)) : dir * ((av ?? -Infinity) - (bv ?? -Infinity)); });
    return arr;
  }, [mf, mfSort]);
  const sortMf = (key) => setMfSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' || key === 'platform' ? 1 : -1 });

  const ov = useMemo(() => {
    // maturedCash: auto-matured FDs awaiting redeployment — still wealth
    // (cash in bank), just no longer earning in the FD sleeve.
    const usInr = usData.val * fxRate; const fdValue = fds.principal + fds.accrued + fds.maturedCash;
    // Algo capital (STATIC.algo) is deliberately EXCLUDED from net worth: its
    // account equity isn't marked to market daily (profits sit in the pool,
    // get distributed to clients, or compound on no fixed schedule), so it
    // can't honestly sit next to the live-priced sleeves. It stays fully
    // tracked on the Algo tab and the header card.
    const pfValue = cmpfCorpus(new Date());
    const totalAssets = indian.val + usInr + fdValue + mf.totVal + pfValue;
    const loan = loanOutstanding(new Date());
    const cmpsPaid = cmpsTotalPaid(new Date());
    const cmpsPension = cmpsMonthlyPension(new Date());
    const cmpsService = cmpsServiceYears(new Date());
    return { usInr, fdValue, pfValue, totalAssets, loan, nw: totalAssets - loan, cmpsPaid, cmpsPension, cmpsService };
  }, [indian.val, usData.val, fxRate, mf.totVal, fds.principal, fds.accrued, fds.maturedCash]);

  const projInvested0 = useMemo(() => {
    const gains = (indian.pl || 0) + (usData.pl || 0) * fxRate + (mf.totVal - mf.totCost) + (fds.accrued || 0);
    return Math.round((ov.nw || 0) - gains);
  }, [ov.nw, indian.pl, usData.pl, fxRate, mf.totVal, mf.totCost, fds.accrued]);

  // ── AI insights — compact aggregates payload, hash-gated ─────────────────────
  // Builds one summary string per sleeve (~500 input tokens — never the full
  // holdings books) and POSTs to /api/insights. A coarse data hash (NW to 0.1L,
  // returns to 0.5pt, plus the calendar date) skips the API call entirely when
  // nothing material changed; results persist in localStorage across sessions.
  useEffect(() => {
    if (!insightsReq || !insightsOn) return;
    if (!(indian.valued && usData.val && usdInr)) return; // wait for live data

    const r1 = (n) => (n == null || !isFinite(n) ? 'n/a' : n.toFixed(1));
    const L = (n) => (n / 1e5).toFixed(2) + 'L';
    const movers = (rows, key) => {
      const v = rows.filter((r) => r[key] != null).sort((a, b) => b[key] - a[key]);
      if (!v.length) return 'n/a';
      const f = (r) => `${r.sym} ${r[key].toFixed(1)}%`;
      return `best ${v.slice(0, 3).map(f).join(', ')}; worst ${v.slice(-3).reverse().map(f).join(', ')}`;
    };
    const payload = {
      asOf: new Date().toISOString().slice(0, 16) + 'Z',
      usdInr: +usdInr.toFixed(2),
      overview:
        `net worth ₹${L(ov.nw)} (assets ₹${L(ov.totalAssets)} − loan ₹${L(ov.loan)}) · ` +
        `Indian P&L ${r1(indian.pct)}% (day ${r1(indianDay.dayPct)}%) · US P&L ${r1(usData.pct)}% (day ${r1(usStats.dayPct)}%)`,
      indian:
        `${INDIAN.length} stocks ₹${L(indian.inv)}→₹${L(indian.val)} · XIRR ${r1(inStats.portXirr)}% vs ${inStats.benchmarks[0]?.label || 'benchmark'} ${r1(inStats.benchmarks[0]?.xirr)}% · ` +
        `top sector ${inStats.topSector ? `${inStats.topSector.label} ${r1(inStats.topSector.pct)}%` : 'n/a'} · ` +
        `largest ${inStats.topPos ? `${inStats.topPos.sym} ${r1((inStats.topPos.val / (indian.val || 1)) * 100)}% of book` : 'n/a'} · ` +
        `movers: ${movers(indian.rows, 'pct')} · CAVEAT ${inStats.years != null ? `~${Math.max(1, Math.round(inStats.years * 12))}-month` : 'short'} window, indicative`,
      indianRisk: indianRisk.hasReg
        ? `beta ${indianRisk.beta?.toFixed(2)} · alpha ${indianRisk.alpha?.toFixed(2)} · vol ${r1(indianRisk.vol)}% vs Nifty ${r1(indianRisk.mktVol)}% (weekly regression)`
        : 'n/a',
      us:
        `${US.length} holdings $${usData.inv.toFixed(0)}→$${usData.val.toFixed(0)} · XIRR ${r1(usStats.xirr)}% · ` +
        `top sector ${usStats.topSector ? `${usStats.topSector.label} ${r1(usStats.topSector.pct)}%` : 'n/a'} (ETF look-through) · ` +
        `movers: ${movers(usData.rows, 'livePct')}`,
      mutualFunds:
        `invested ₹${Math.round(mf.totCost)} value ₹${Math.round(mf.totVal)} (${r1(mf.totRet)}%) · XIRR ${r1(mfx.port)}% vs Nifty ${r1(mfx.bench)}% · ` +
        `mix equity ${r1((mf.alloc.equity / (mf.totVal || 1)) * 100)}% arbitrage ${r1((mf.alloc.arbitrage / (mf.totVal || 1)) * 100)}% · ` +
        `SIP ₹${Math.round(MF_SIP.monthly / 1000)}K/mo ${MF_SIP.platformShort}` +
        `${(() => { const e = MF_FUNDS.find((f) => f.id === 'elss'); if (!e) return ''; const d = new Date(e.bought + 'T00:00:00Z'); return `, ELSS locked to ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}-${String(d.getUTCFullYear() + MF_SIP.elssLockYears).slice(2)}`; })()} · CAVEAT very small base + short window`,
      fixedDeposits:
        `₹${L(fds.principal)} across ${fds.rows.length} FDs · blended ${fds.blendedRate.toFixed(2)}% · accrued ₹${Math.round(fds.accrued)} · ` +
        `quarterly ladder, per-bank interest kept under the ₹40K TDS threshold`,
      algo:
        `own capital ₹${(STATIC.algo / 1e5).toFixed(1)}L (off-NW) · ${FY.labels.currentShort} realised S01 +₹${FY.s01.fy2627.net} S02 +₹${FY.s02.fy2627.net}` +
        `${swing.valued ? ` · swing MTM ₹${Math.round(swing.pl)}` : ''} · F&O loss carryforward pool ₹${(FY.cf.poolEnteringFY2627 / 1e5).toFixed(2)}L (tax asset)`,
    };

    // Coarse hash — regenerate only on a material move or a new calendar day.
    const hash = JSON.stringify([
      Math.round(ov.nw / 1e4),
      Math.round(indian.pct * 2) / 2,
      Math.round(usData.pct * 2) / 2,
      Math.round((indianDay.dayPct || 0) * 2) / 2,
      Math.round(mf.totRet * 2) / 2,
      new Date().toISOString().slice(0, 10),
    ]);
    try {
      const c = JSON.parse(localStorage.getItem(INSIGHTS_KEY) || 'null');
      if (c?.insights && c.hash === hash) { setInsights(c.insights); return; } // unchanged — no API spend
    } catch {}

    let stale = false;
    (async () => {
      setInsightsLoading(true);
      try {
        const res = await fetch('/api/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok && !stale) {
          const d = await res.json();
          if (d.insights) {
            setInsights(d.insights);
            try { localStorage.setItem(INSIGHTS_KEY, JSON.stringify({ ts: Date.now(), hash, insights: d.insights })); } catch {}
          }
        }
      } catch {} finally { if (!stale) setInsightsLoading(false); }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightsReq]);

  // NW sleeves only — algo capital is excluded from net worth (see ov above),
  // so it appears in neither the allocation view nor the projection model.
  // No fabricated fallbacks: until live prices land, unvalued sleeves are 0
  // (the projection/allocation simply under-represent them for a few seconds)
  // rather than showing stale hardcoded figures as if they were real.
  const donutSegs = [
    { key: 'fd',     label: 'Fixed Deposits', value: ov.fdValue,      color: ALLOC_COLORS.fd     },
    { key: 'indian', label: 'Indian Stocks',  value: indian.val || 0, color: ALLOC_COLORS.indian },
    { key: 'us',     label: 'US Stocks',      value: ov.usInr   || 0, color: ALLOC_COLORS.us     },
    { key: 'mf',     label: 'Mutual Funds',   value: mf.jio.value,    color: ALLOC_COLORS.mf     },
    { key: 'elss',   label: 'ELSS',           value: mf.elss.value,   color: ALLOC_COLORS.elss   },
    { key: 'pf',     label: 'CMPF',           value: ov.pfValue || 0, color: ALLOC_COLORS.pf     },
  ];

  const projSleeves = useMemo(
    () => donutSegs.map((s) => ({ ...s, value: Math.round(s.value || 0) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.round(ov.fdValue || 0), Math.round(indian.val || 0), Math.round(ov.usInr || 0), Math.round(mf.jio.value || 0), Math.round(mf.elss.value || 0), Math.round(ov.pfValue || 0)],
  );

  const pulseCls = 'pulse' + (status.type ? ' ' + status.type : '');
  const mktPill = (open, st) => (st === 'PRE' || st === 'POST') ? 'mkt-pre' : open ? 'mkt-open' : 'mkt-closed';
  const mktTxt  = (open, st) => st === 'PRE' ? 'PRE' : st === 'POST' ? 'POST' : open == null ? '—' : open ? 'OPEN' : 'CLOSED';

  // Daily net-worth snapshots → the historical growth curve on Overview.
  const [snapshots, setSnapshots] = useState([]);
  useEffect(() => { setSnapshots(getSnapshots()); }, []);

  // Ledger-reconstructed weekly history fills the curve before real dailies
  // began. Computed fresh per load (nothing synthetic is persisted); real
  // snapshots always win from their first date onward.
  const [fxHist, setFxHist] = useState(null);
  useEffect(() => {
    let dead = false;
    const dates = [...TRANSACTIONS.map((t) => t.date), ...US_CASHFLOWS.map((c) => c.date), ...MF_CASHFLOWS.map((c) => c.date)].sort();
    fetch(`/api/fx-history?start=${(dates[0] || '2024-01-01').slice(0, 7)}-01`)
      .then((r) => r.json())
      .then((j) => { if (!dead && j.rates) setFxHist(j.rates); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);
  const chartSnapshots = useMemo(() => {
    const synth = buildBackfill(hist?.series, fxHist, usdInr, mfNav);
    if (!synth.length) return snapshots;
    const firstReal = snapshots[0]?.d;
    return [...synth.filter((s) => !firstReal || s.d < firstReal), ...snapshots];
  }, [hist, fxHist, usdInr, snapshots, mfNav]);
  useEffect(() => {
    // US readiness checked explicitly: usdInr arrives with the INDIAN quote
    // batch, so without usData.val the guard would pass on a US-only outage
    // and persist a net worth missing the whole US sleeve.
    if (!(indian.valued && usData.val > 0 && usdInr)) return;
    setSnapshots(recordSnapshot({
      d: isoOf(new Date()),
      nw: Math.round(ov.nw),
      assets: Math.round(ov.totalAssets),
      invested: Math.round(projInvested0),
    }));
  }, [indian.valued, usData.val, usdInr, ov.nw, ov.totalAssets, projInvested0]);

  // NW hero: fire entrance animation once when live NW first becomes available,
  // and detect all-time-high (NW > every prior snapshot) for the celebration.
  useEffect(() => {
    if (!indian.valued || !usdInr) return;
    const nw = Math.round(ov.nw);
    if (prevNw.current === null) {
      setHeroKey((k) => k + 1); // trigger .hdr-val-enter once
    }
    if (prevNw.current !== null && chartSnapshots.length > 0) {
      const allTimeHigh = chartSnapshots.every((s) => nw >= (s.nw ?? 0));
      if (allTimeHigh && nw > (prevNw.current ?? 0)) {
        setAth(true);
        setTimeout(() => setAth(false), 3000);
      }
    }
    prevNw.current = nw;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indian.valued, usdInr, ov.nw]);

  // Header asset cards double as the primary navigation — each opens its tab.
  const headerCards = [
    { label: 'Indian equity', tab: 1, live: markets.nse,
      val: indian.valued ? <InrC n={indian.val} /> : <Skel w={58} h={18} />,
      sub: indian.valued ? <span className={cl(indian.pl)}><SInrC n={indian.pl} /> · {pctS(indian.pct)}</span> : `${INDIAN.length} stocks` },
    { label: 'Mutual funds', tab: 3,
      val: <InrC n={mf.totVal} />,
      sub: <><span className={cl(mf.totRet)}>{pctS(mf.totRet)}</span> · live NAV</> },
    { label: 'Fixed deposits', tab: 2,
      val: <InrC n={ov.fdValue} />,
      sub: <><span className="grn"><InrF n={fds.accrued} /></span> accrued</> },
    { label: 'US equity', tab: 4, live: markets.nyse,
      val: usData.val ? <InrC n={ov.usInr} /> : <Skel w={58} h={18} />,
      sub: usData.val ? <><span className={cl(usData.pl)}>{pctS(usData.pct)}</span> @<Rs />{fxRate.toFixed(0)}</> : `${US.length} holdings` },
    { label: 'Algo capital', tab: 5, live: markets.nse, tip: 'Tracked separately — excluded from net worth (not marked to market daily)',
      val: <InrC n={STATIC.algo} />,
      sub: ytdTotal != null ? <>{FY.labels.currentShort} <span className={cl(ytdTotal)}><SInrC n={ytdTotal} /></span> · off-NW</> : 'own capital · off-NW' },
  ];

  // ─── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="layout">
      {/* MAIN CONTENT */}
      <main className="main">
        {/* STICKY GLOBAL HEADER — utility bar + live NW + asset-card nav */}
        <div className="main-header" ref={headerRef}>
          <div className="topbar">
            <div className="topbar-left">
              <div className={pulseCls} />
              <span className="status-txt">{status.msg}</span>
            </div>
            <div className="topbar-right">
              <span className={'mkt-pill ' + mktPill(markets.nse, markets.nseState)}><span className="live-dot" />NSE {mktTxt(markets.nse, markets.nseState)}</span>
              <span className={'mkt-pill ' + mktPill(markets.nyse, markets.nyseState)}><span className="live-dot" />NYSE {mktTxt(markets.nyse, markets.nyseState)}</span>
              <span className="status-txt">USD/INR <strong style={{ color: 'var(--txt)' }}>{usdInr ? <><Rs />{usdInr.toFixed(2)}</> : '—'}</strong></span>
              <span className="status-txt" style={{ color: 'var(--txt3)' }}>{lastUpdate}</span>
              <button className="hdr-toggle" onClick={toggleInsights} aria-pressed={insightsOn} style={{ opacity: insightsOn ? 1 : 0.45 }} title={`AI insights ${insightsOn ? 'on' : 'off'}`}>✨</button>
              <button className="hdr-toggle" onClick={cycleTheme} title={`Theme: ${themeMode} (follows sunrise/sunset)`}>{themeMode === 'auto' ? '🌗' : themeMode === 'day' ? '☀️' : '🌙'}</button>
              <button className={'hdr-toggle' + (loading ? ' loading' : '')} onClick={() => doRefresh({ insights: true })} title="Refresh" aria-label="Refresh">↻</button>
            </div>
          </div>

          <div className="hdr-grid">
            {/* Live net worth — clicking it opens Overview. Assets/Liabilities are figures only. */}
            <button className={'hdr-hero' + (tab === 0 ? ' active' : '')} onClick={() => selectTab(0)} title="Open Overview">
              <div className="page-header-lbl">
                Net worth — live{' '}
                <span className={'spark' + (ath ? ' ath-spark' : '')}>✦</span>
                {ath && <span className="spark ath-spark" style={{ marginLeft: 3 }}>✦</span>}
                {ath && <span className="spark ath-spark" style={{ marginLeft: 3 }}>✦</span>}
              </div>
              <div key={heroKey} className={'hdr-val' + (heroKey > 0 ? ' hdr-val-enter' : '') + (ath ? ' ath-moment' : '')}>
                {indian.valued && usdInr ? <InrC n={ov.nw} /> : <Skel w={150} h={36} />}
              </div>
              <div className="page-header-sub">
                Assets <strong>{indian.valued && usdInr ? <InrC n={ov.totalAssets} /> : '—'}</strong>
                {' · '}Liabilities <strong style={{ color: 'var(--red)' }}><InrC n={ov.loan} /></strong>
                {indian.valued && usdInr ? (
                  // Atomic chunk: wraps to the next line whole, never splitting
                  // the figure from its label (frees width for the hero value).
                  <span style={{ whiteSpace: 'nowrap' }}
                    title={`Net worth ${inrFull(Math.round(ov.nw))} + algo capital ${inrFull(STATIC.algo)} + algo FY P&L ${inrFull(Math.round(ytdTotal || 0))} (realised + swing MTM)`}>
                    {' · '}incl. algo <strong style={{ color: 'var(--acc)' }}><InrC n={ov.nw + STATIC.algo + (ytdTotal || 0)} /></strong>
                  </span>
                ) : <>{' · '}excl. algo</>}
              </div>
            </button>

            {/* Asset-class cards — primary navigation */}
            <div className="hdr-cards">
              {headerCards.map((c) => (
                <button key={c.label} className={'hdr-card' + (tab === c.tab ? ' active' : '')} onClick={() => selectTab(c.tab)} title={c.tip || `Open ${c.label}`}>
                  <div className="lbl">{c.label}{'live' in c ? <span className={'live-dot' + (c.live ? ' on' : '')} /> : null}</div>
                  <div className="vmd">{c.val}</div>
                  <div className="sub">{c.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* TAB CONTENT — key forces a remount on tab switch so tabEnter plays */}
        <div className="tab-content" key={tab}>
          {tab === 0 && (
            <OverviewTab ov={ov} fx={fxRate}
              insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              FY={FY} snapshots={chartSnapshots}
              projSleeves={projSleeves} projInvested0={projInvested0} loan={ov.loan} baseYear={now.getFullYear()}
              payslips={PAYSLIPS} dataReady={!!(indian.valued && usData.val > 0 && usdInr)}
              cmpsPension={ov.cmpsPension} cmpsService={ov.cmpsService} cmpsRetirement={CMPS_RETIREMENT_DATE} />
          )}
          {tab === 1 && (
            <IndianTab indian={indian} indianDayPl={indianDay.dayPl} indianDayPct={indianDay.dayPct}
              inStats={inStats} indianRisk={indianRisk} inSorted={inSorted} inSort={inSort} sortIn={sortIn}
              flash={flash} markets={markets} lastUpdate={lastUpdate} insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              INDIAN={INDIAN} INDIAN_REALIZED={INDIAN_REALIZED} CORPORATE_ACTIONS={CORPORATE_ACTIONS} FY={FY} />
          )}
          {tab === 2 && (
            <FDTab fds={fds} now={now} insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad} />
          )}
          {tab === 3 && (
            <MFTab mf={mf} mfx={mfx} mfBench={mfBench} mfSorted={mfSorted} mfSort={mfSort} sortMf={sortMf}
              insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              MF_FUNDS={MF_FUNDS} UNITS_AS_OF={UNITS_AS_OF} FY={FY} />
          )}
          {tab === 4 && (
            <USTab usData={usData} usStats={usStats} usSorted={usSorted} usSort={usSort} sortUs={sortUs}
              ov={ov} fxRate={fxRate} flash={flash} markets={markets} lastUpdate={lastUpdate}
              insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              US={US} US_REALIZED={US_REALIZED} US_DIVIDENDS={US_DIVIDENDS} FY={FY} />
          )}
          {tab === 5 && (
            <AlgoTab swing={swing} swingSorted={swingSorted} swSort={swSort} sortSw={sortSw}
              markets={markets} ytdTotal={ytdTotal} ytdRealised={ytdRealised}
              cfEntering={cfEntering} cfAfterRealised={cfAfterRealised}
              insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              ALGO={ALGO} FY={FY} />
          )}
        </div>

        <div style={{ textAlign: 'center', color: 'var(--txt3)', fontSize: 'var(--fs-2xs)', marginTop: 32, paddingBottom: 16 }}>
          Live prices via Yahoo Finance · auto-refresh every 15 min · personal use only
        </div>
      </main>
    </div>
  );
}
