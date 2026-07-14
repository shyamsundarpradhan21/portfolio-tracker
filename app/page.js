'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  INDIAN, US, FDS, MF_FUNDS, MF_CASHFLOWS, MF_SIP, UNITS_AS_OF,
  ALGO, SWING, STATIC, PROJECTION, ALLOC_COLORS,
  TRANSACTIONS, CORPORATE_ACTIONS, INDIAN_REALIZED, INDIAN_BENCHMARKS,
  US_CASHFLOWS, US_BENCHMARKS, US_DIVIDENDS, US_REALIZED, loanOutstanding,
  PAYSLIPS, hydratePortfolio, isPortfolioHydrated,
} from './portfolio';
import { deriveFY } from './lib/fnoLedger';
import { APP, hydrateAppData } from './lib/appData';
import { usBuyLedger } from './lib/deposits';
import MARKET_WRAP from '../data/market-wrap.json';
import { classifyRegime } from './lib/regime';

// FY (current-FY F&O blocks rolled on the frozen ITR seed) is computed INSIDE
// Dashboard now — fySeed/fnoLedger are hydrated at runtime (out of the bundle).

import { nseOpenNow, nyseOpenNow, marketStateFromQuotes } from './lib/market';
import { dayOrNight } from './lib/suntimes';
import { getSnapshots, recordSnapshot, historicalSnapshots, syncSnapshotsFromKv, pushSnapshotToKv } from './lib/snapshots';
import { getFiiDiiTrail, recordFiiDii } from './lib/fiidii';
import { buildBackfill } from './lib/backfill';
import { cmpfCorpus, cmpfPaid, cmpfDailyAccrual } from './lib/cmpf';
import { cmpsTotalPaid, cmpsMonthlyPension, cmpsServiceYears, CMPS_RETIREMENT_DATE, CMPS_MIN_QUALIFYING_YEARS, CMPS_VEST_DATE } from './lib/cmps';
import {
  xirr, weightedCagr, benchCounterfactual, computeBetaVol,
  regressHoldings, regressVsYield, regressVsVix,
  applyCorpActions, compound, clampN, DAY_MS, YEAR_MS,
} from './lib/calc';
import {
  cl, isoOf, inrC, inrCd, inrFull, fmtNavDate, InrC, InrF, SInrC, SInrF, sFull, Rs, pctS, CurrencyProvider,
} from './lib/fmt';
import { ETF_LOOKTHROUGH, ETF_CAP, US_CAP, usSectorOf } from './lib/constants';
import { reconcileSleeve } from './lib/brokerState';
const COLORS = ALLOC_COLORS;

// SWING_R (broker-reconciled swing book) is computed INSIDE Dashboard now — the
// private data is hydrated at runtime, so it can't be derived at module scope.
// INDIAN reconcile is corp-action-aware — computed from heldIndian (post-bonus/
// split) inside the component, so an action the app already applies isn't flagged.

import { AiContext } from './components/shared/AiContext';
import OverviewTab  from './components/tabs/OverviewTab';
import IndianTab    from './components/tabs/IndianTab';
import FDTab        from './components/tabs/FDTab';
import MFTab        from './components/tabs/MFTab';
import USTab        from './components/tabs/USTab';
import AlgoTab      from './components/tabs/AlgoTab';
import MacroTab     from './components/tabs/MacroTab';
import Skel         from './components/shared/Skel';
import AnimatedNumber from './components/shared/AnimatedNumber';
import { LiveInrC } from './components/shared/Live';
import FreshnessTag from './components/shared/FreshnessTag';

// ─── cache keys ───────────────────────────────────────────────────────────────
const FETCH_TS_KEY  = 'nwTracker.cache';
const INSIGHTS_KEY  = 'nwTracker.insights';
const MFNAV_KEY     = 'nwTracker.mfnav';
const HIST_KEY      = 'nwTracker.hist';
const MACRO_KEY     = 'nwTracker.macro';
const PREMKT_KEY    = 'nwTracker.premarket';
const USSENT_KEY    = 'nwTracker.usSentiment';
const INDSENT_KEY   = 'nwTracker.indiaSentiment';
const MBOARD_KEY    = 'nwTracker.macroBoard';
const PNEWS_KEY     = 'nwTracker.portfolioNews';
const NEWS_KEY      = 'nwTracker.marketNews';
const NIFTY50_KEY   = 'nwTracker.nifty50';
const NASDAQ_KEY    = 'nwTracker.nasdaq100';
const NIFTYDLY_KEY  = 'nwTracker.niftyDaily';
const DIVID_KEY     = 'nwTracker.dividends';
const REFRESH_MS    = 15 * 60 * 1000;


// True only if at least one sleeve carries real text. The route degrades to an
// all-empty object when the key/schema is misconfigured; never cache or surface
// that — treat it as a miss so a fixed backend self-heals without a hard reload.
const hasInsight = (o) =>
  !!o && typeof o === 'object' &&
  Object.values(o).some(
    (v) => v && typeof v === 'object' &&
      (v.performance || v.outlook || v.macro || v.s || v.w || v.o || v.t),
  );

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
  // NAV-freshness: `fresh` only means "resolved from AMFI", not "current" — over a
  // weekend/holiday the latest NAV is days old. Treat it as live only when every fund
  // resolved AND the newest NAV date is within ~2 days; else surface the date so the
  // card never claims "live" on stale data.
  const navDate = rows.map((r) => r.navDate).filter(Boolean).sort().slice(-1)[0] || null;
  const navLive = rows.length > 0 && rows.every((r) => r.fresh) && navDate != null && (Date.now() - Date.parse(navDate)) < 2 * 86400 * 1000;
  return { rows, totVal, totCost, totRet: totCost ? ((totVal - totCost) / totCost) * 100 : 0, jio: sub((r) => r.platform === 'JioBLK'), elss: sub((r) => r.platform === 'Zerodha'), alloc, cap, v, navDate, navLive };
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
// Gate: fetch the private portfolio data (served out-of-bundle from /api/portfolio),
// hydrate the portfolio module in place, THEN mount the dashboard — so every
// consumer reads filled values. Mirrors how the app already gates on live prices.
export default function Page() {
  const [pReady, setPReady] = useState(isPortfolioHydrated());
  const [pErr, setPErr] = useState(false);
  useEffect(() => {
    if (isPortfolioHydrated()) { setPReady(true); return; }
    let on = true;
    fetch('/api/portfolio')
      .then((r) => { if (!r.ok) throw new Error('portfolio ' + r.status); return r.json(); })
      .then((d) => { if (on) { hydratePortfolio(d); hydrateAppData(d._app); setPReady(true); } })
      .catch(() => { if (on) setPErr(true); });
    return () => { on = false; };
  }, []);
  if (pErr) return (
    <div className="layout"><main className="main" style={{ padding: 48 }}>
      <div className="ctitle">Couldn’t load portfolio data</div>
      <div className="sub" style={{ marginTop: 8 }}>The data service is unreachable — refresh to retry.</div>
    </main></div>
  );
  if (!pReady) return (
    <div className="layout"><main className="main" style={{ padding: 48 }}>
      <div className="sub">Loading portfolio…</div>
    </main></div>
  );
  return <Dashboard />;
}

function Dashboard() {
  // Computed here (not at module scope) because SWING / fySeed / fnoLedger only
  // exist after runtime hydration.
  const SWING_R = useMemo(() => reconcileSleeve(SWING, 'SWING'), []);
  const FY = useMemo(() => deriveFY(APP.fySeed, APP.fnoLedger), []);
  const [tab, setTab]               = useState(0);
  const [prices, setPrices]         = useState({});
  const [usdInr, setUsdInr]         = useState(null);
  const [status, setStatus]         = useState({ msg: 'Connecting…', type: '' });
  const [lastUpdate, setLastUpdate] = useState('—');
  const [markets, setMarkets]       = useState({ nse: null, nyse: null });
  const [loading, setLoading]       = useState(false);
  const [mfNav, setMfNav]           = useState(null);
  const [hist, setHist]             = useState(null);
  const [macro, setMacro]           = useState(null); // live macro clock (FRED + Yahoo)
  const [premarket, setPremarket]   = useState(null); // pre-open companion: overnight cues + FII/DII trail
  const [usSentiment, setUsSentiment] = useState(null); // US leading/coincident sentiment (/api/us-sentiment)
  const [indiaSentiment, setIndiaSentiment] = useState(null); // India leading/coincident sentiment (/api/india-sentiment)
  const [macroBoard, setMacroBoard] = useState(null); // macro percentile sliders (FRED + Yahoo, /api/macro-board)
  const [portfolioNews, setPortfolioNews] = useState(null); // per-holding sentiment headlines (/api/portfolio-news)
  const [marketNews, setMarketNews] = useState(null); // market-headline ticker (/api/news)
  const [nifty50, setNifty50]       = useState(null); // Nifty 50 heatmap + movers (lazy — only on the Wrap tab)
  const [nifty50Loading, setN50Loading] = useState(false);
  const [nasdaq, setNasdaq]         = useState(null); // Nasdaq 100 heatmap (lazy — only on the Wrap tab, US view)
  const [nasdaqLoading, setNdqLoading]  = useState(false);
  const [niftyDaily, setNiftyDaily] = useState(null); // ^NSEI daily closes → Nifty Overview returns/trend (lazy, Wrap tab)
  const [dividends, setDividends]   = useState(null); // upcoming dividends for held stocks (lazy, Wrap tab)
  const [fiidiiTrail, setFiidiiTrail] = useState([]); // 10-session FII/DII flow trail (localStorage, builds forward)
  const [flash, setFlash]           = useState({});
  const [ath, setAth]               = useState(false); // all-time-high celebration
  const [heroKey, setHeroKey]       = useState(0);     // bumped once when NW first loads
  const prevPrices                  = useRef({});
  const headerRef                   = useRef(null);
  const prevNw                      = useRef(null);
  // Phase 1.5 — hero fit-to-width: grow the net-worth figure so its rendered width ≈ the
  // widest subtext line (Assets/Liabilities), per agentation mqxjsxxz-2jwh10. Refs feed the
  // JS fitter below (no scaleX/letter-space distortion — pure font-size growth).
  const heroBtnRef                  = useRef(null);
  const heroValRef                  = useRef(null);
  const heroSubRef                  = useRef(null);

  // RSP-001: state-driven scroll affordance for the asset-card strip. Edge fades show
  // only when there is more to reveal that direction, so the horizontal scroll is never
  // silent. ResizeObserver catches both viewport changes and card-content width shifts.
  const hdrCardsRef                 = useRef(null);
  const [hdrEdge, setHdrEdge]       = useState({ l: false, r: false });
  const updHdrEdge = useCallback(() => {
    const el = hdrCardsRef.current; if (!el) return;
    const l = el.scrollLeft > 2;
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setHdrEdge((p) => (p.l === l && p.r === r ? p : { l, r }));
  }, []);
  // Scroll the asset-card strip by ~one viewport-width worth (the ‹ › buttons use this).
  const scrollHdr = useCallback((dir) => {
    const el = hdrCardsRef.current; if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.7), behavior: 'smooth' });
  }, []);
  useEffect(() => {
    const el = hdrCardsRef.current; if (!el) return;
    updHdrEdge();
    const ro = new ResizeObserver(updHdrEdge);
    ro.observe(el);
    window.addEventListener('resize', updHdrEdge);
    // Mouse wheel → horizontal: a plain vertical wheel scrolls the strip sideways (no Shift needed).
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth + 2) return;
      el.scrollLeft += e.deltaY; e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro.disconnect(); window.removeEventListener('resize', updHdrEdge); el.removeEventListener('wheel', onWheel); };
  }, [updHdrEdge]);

  // Day/night + per-tab theme: set data attributes on <html> so CSS variables cascade
  const TAB_KEYS = ['overview', 'indian', 'fd', 'mf', 'us', 'algo', 'macro'];

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

  // Global display currency for the US sleeve: 'usd' (native) or 'inr' (converted
  // at the live USD/INR so the US cards read in ₹, consistent with the Indian
  // cards). Persisted; defaults to native $ so nothing changes until toggled.
  const [currency, setCurrency] = useState(() => {
    try { return localStorage.getItem('nwTracker.currency') || 'inr'; } catch { return 'inr'; }
  });
  const toggleCurrency = () => setCurrency((c) => {
    const next = c === 'usd' ? 'inr' : 'usd';
    try { localStorage.setItem('nwTracker.currency', next); } catch {}
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
  const [insightsTs, setInsightsTs]           = useState(null); // when the shown analysis was generated (cache ts), drives the fresh/cached label
  const [insightsLoading, setInsightsLoading] = useState(false);
  // Placement of the AI cards: ON scatters them across each tab, OFF keeps them
  // consolidated in the Pulse tab. The unified header ↻ flips this ON as it
  // regenerates, so a manual refresh surfaces the fresh analysis. Persisted;
  // default off (consolidated) on first run.
  const [insightsOn, setInsightsOn] = useState(() => {
    try { return localStorage.getItem('nwTracker.insightsOn') === 'true'; } catch { return false; }
  });
  // Regeneration "ticket" — bumped when fresh insights are wanted. The payload
  // effect below runs after render, so it reads fully-recomputed derived state
  // (no need to thread prices/fx/nav through as arguments).
  const [insightsReq, setInsightsReq] = useState(0);
  const requestInsights = useCallback(() => setInsightsReq((n) => n + 1), []);
  // Force a fresh whole-app analysis (used by the Pulse-tab refresh).
  const refreshInsights = () => requestInsights();
  // AI analysis is its own header toggle now: turning it ON generates a fresh
  // whole-app analysis; OFF consolidates the cards. Persisted across sessions.
  const toggleInsights = () => setInsightsOn((on) => {
    const next = !on;
    try { localStorage.setItem('nwTracker.insightsOn', String(next)); } catch {}
    if (next) requestInsights();
    return next;
  });
  // Header ↻ — refresh live prices; regenerate AI only if the AI toggle is on, so
  // the analysis call is opt-in. The 15-min auto-refresh calls doRefresh() directly.
  const refreshAll = () => { doRefresh(); if (insightsOn) requestInsights(); };
  // After a refresh the status line flashes for a few minutes, then clears (errors stay).
  useEffect(() => {
    if (!status.msg || status.type === 'err') return undefined;
    const t = setTimeout(() => setStatus((s) => (s.type === 'err' ? s : { ...s, msg: '' })), 180000);
    return () => clearTimeout(t);
  }, [status.msg, status.type]);
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
      // '^TNX' (US 10Y yield) and '^IXIC' (Nasdaq Composite) feed the macro
      // sensitivity regressions (duration proxy + Nasdaq beta).
      // '^TNX'/'^IXIC' feed the macro regressions; '^GDAXI','^FTSE','000300.SS',
      // 'BTC-USD','GC=F' are the Performance-curve compare benchmarks (Nifty +
      // Nasdaq already covered by the benchmark/macro syms above).
      const syms = [...new Set([...INDIAN_BENCHMARKS.flatMap((b) => b.yahooSyms), ...US_BENCHMARKS.flatMap((b) => b.yahooSyms), ...INDIAN.map((h) => `${h.sym}.NS`), ...SWING.map((h) => h.ns), ...US.map((h) => h.sym), '^TNX', '^IXIC', '^GDAXI', '^FTSE', '000300.SS', 'BTC-USD', 'GC=F'])].join(',');
      const res = await fetch('/api/history?range=5y&symbols=' + encodeURIComponent(syms), { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const fetchMacro = async () => { try { const res = await fetch('/api/macro', { cache: 'no-store' }); return res.ok ? await res.json() : null; } catch { return null; } };
  const fetchPremarket = async () => { try { const res = await fetch('/api/premarket', { cache: 'no-store' }); return res.ok ? await res.json() : null; } catch { return null; } };
  const fetchUsSentiment = async () => { try { const res = await fetch('/api/us-sentiment', { cache: 'no-store' }); return res.ok ? await res.json() : null; } catch { return null; } };
  const fetchIndiaSentiment = async () => { try { const res = await fetch('/api/india-sentiment', { cache: 'no-store' }); return res.ok ? await res.json() : null; } catch { return null; } };
  const fetchMacroBoard = async () => { try { const res = await fetch('/api/macro-board', { cache: 'no-store' }); return res.ok ? await res.json() : null; } catch { return null; } };

  const doRefresh = useCallback(async (opts = {}) => {
    setLoading(true); setStatus({ msg: 'Fetching live prices…', type: '' });
    try {
      const inSyms = INDIAN.map((s) => s.ns).concat(SWING.map((s) => s.ns)).concat(['INR=X']);
      const [inData, usData, mfData, histData, macroData, premarketData, usSentData, indiaSentData, mboardData] = await Promise.all([fetchBatch(inSyms), fetchBatch(US.map((s) => s.sym)), fetchMfNav(), fetchHistory(), fetchMacro(), fetchPremarket(), fetchUsSentiment(), fetchIndiaSentiment(), fetchMacroBoard()]);
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
      if (macroData) { setMacro(macroData); try { sessionStorage.setItem(MACRO_KEY, JSON.stringify({ ts: Date.now(), macro: macroData })); } catch {} }
      if (premarketData) { setPremarket(premarketData); try { sessionStorage.setItem(PREMKT_KEY, JSON.stringify({ ts: Date.now(), premarket: premarketData })); } catch {} }
      if (usSentData) { setUsSentiment(usSentData); try { sessionStorage.setItem(USSENT_KEY, JSON.stringify({ ts: Date.now(), usSentiment: usSentData })); } catch {} }
      if (indiaSentData) { setIndiaSentiment(indiaSentData); try { sessionStorage.setItem(INDSENT_KEY, JSON.stringify({ ts: Date.now(), indiaSentiment: indiaSentData })); } catch {} }
      if (mboardData) { setMacroBoard(mboardData); try { sessionStorage.setItem(MBOARD_KEY, JSON.stringify({ ts: Date.now(), macroBoard: mboardData })); } catch {} }
      if (mfData)   { setMfNav(mfData);  try { sessionStorage.setItem(MFNAV_KEY, JSON.stringify({ ts: Date.now(), mfNav: mfData })); } catch {} }
      const fx = inData['INR=X']?.price;
      if (fx) setUsdInr(fx);
      const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setStatus({ msg: 'Updated at ' + t, type: '' }); setLastUpdate('Last updated ' + t);
      try { sessionStorage.setItem(FETCH_TS_KEY, JSON.stringify({ ts: Date.now(), prices: merged, usdInr: fx || usdInr })); } catch {}
    } catch (e) { setStatus({ msg: 'Error: ' + (e.message || 'fetch failed'), type: 'err' }); }
    finally { setLoading(false); }
    // Prices only — AI insights are fired exclusively by the ✨ toggle, never by a price refresh.
  }, [usdInr]);

  useEffect(() => {
    // Show last-known insights immediately (localStorage — survives sessions);
    // the hash-gated effect below decides whether a fresh API call is needed.
    try { const ic = JSON.parse(localStorage.getItem(INSIGHTS_KEY) || 'null'); if (hasInsight(ic?.insights)) { setInsights(ic.insights); setInsightsTs(ic.ts || null); } } catch {}
    try { const mc = JSON.parse(sessionStorage.getItem(MFNAV_KEY) || 'null'); if (mc?.mfNav) setMfNav(mc.mfNav); } catch {}
    try { const hc = JSON.parse(sessionStorage.getItem(HIST_KEY) || 'null'); if (hc?.hist) setHist(hc.hist); } catch {}
    try { const mac = JSON.parse(sessionStorage.getItem(MACRO_KEY) || 'null'); if (mac?.macro) setMacro(mac.macro); } catch {}
    try { const pm = JSON.parse(sessionStorage.getItem(PREMKT_KEY) || 'null'); if (pm?.premarket) setPremarket(pm.premarket); } catch {}
    try { const us = JSON.parse(sessionStorage.getItem(USSENT_KEY) || 'null'); if (us?.usSentiment) setUsSentiment(us.usSentiment); } catch {}
    try { const ind = JSON.parse(sessionStorage.getItem(INDSENT_KEY) || 'null'); if (ind?.indiaSentiment) setIndiaSentiment(ind.indiaSentiment); } catch {}
    try { const mb = JSON.parse(sessionStorage.getItem(MBOARD_KEY) || 'null'); if (mb?.macroBoard) setMacroBoard(mb.macroBoard); } catch {}
    let hydrated = false;
    try {
      const c = JSON.parse(sessionStorage.getItem(FETCH_TS_KEY) || 'null');
      if (c && Date.now() - c.ts < 10 * 60 * 1000) {
        setPrices(c.prices || {}); if (c.usdInr) setUsdInr(c.usdInr);
        const age = Math.round((Date.now() - c.ts) / 60000);
        setStatus({ msg: `Cached prices (${age}m ago)`, type: 'stale' }); setLastUpdate(`Cached ${age}min ago`);
        hydrated = true;
      }
    } catch {}
    if (!hydrated) doRefresh();
    // AI is NOT auto-fired on load — cached insights (loaded above) display as-is,
    // and a fresh whole-app call happens only when the user clicks the ✨ toggle
    // (by which point live data is ready). Keeps reloads at zero AI cost.
    timer.current = setInterval(doRefresh, REFRESH_MS);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── derived: Indian ────────────────────────────────────────────────────────
  const heldIndian = useMemo(() => applyCorpActions(INDIAN, now, CORPORATE_ACTIONS, isoOf), [now]);
  // Drift-check Kite against the corp-action-adjusted book (not raw INDIAN), so a
  // bonus/split the app already applied isn't flagged as a phantom mismatch.
  const indianRec = useMemo(() => reconcileSleeve(heldIndian, 'INDIAN'), [heldIndian]);
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

  // Equity stats over an arbitrary holdings set + cashflow ledger — shared by the
  // Zerodha-only book (inStats, AI overview) and the combined Zerodha+swing book
  // (eqStats, Indian tab). Pure over (rows, value, valued, txns) + hist/now closure.
  const equityStats = (rows, value, valued, txns) => {
    const totalInvested = txns.reduce((s, t) => s + t.invested, 0);
    let portXirr = null, cagr = null, years = null;
    if (valued && value) {
      const cfs = txns.map((t) => ({ date: new Date(t.date), amount: -t.invested }));
      const x = xirr([...cfs, { date: now, amount: value }]); portXirr = x != null ? x * 100 : null;
      const c = weightedCagr(txns, value, now); cagr = c.cagr; years = c.years;
    }
    const sectorMap = {}, capMap = {};
    rows.forEach((r) => { if (r.val == null) return; sectorMap[r.sector] = (sectorMap[r.sector] || 0) + r.val; capMap[r.cap] = (capMap[r.cap] || 0) + r.val; });
    const sectors = Object.entries(sectorMap).map(([label, val]) => ({ label, val, pct: value ? (val / value) * 100 : 0 })).sort((a, b) => b.val - a.val);
    const caps = ['Large','Mid','Small'].map((label) => ({ label, val: capMap[label] || 0, pct: value ? ((capMap[label] || 0) / value) * 100 : 0 }));
    const vr = rows.filter((r) => r.pct != null);
    const winner  = vr.length ? vr.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    const laggard = vr.length ? vr.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
    const topPos  = vr.length && value ? vr.reduce((a, b) => (b.val > a.val ? b : a)) : null;
    const cfFor = (b) => { if (!hist?.series || !valued || !value) return null; for (const sym of b.yahooSyms) { const cf = benchCounterfactual(hist.series[sym], txns, now); if (cf) return cf; } return null; };
    const benchmarks = INDIAN_BENCHMARKS.map((b) => { const cf = cfFor(b); return { ...b, value: cf?.value ?? null, xirr: cf?.xirr ?? null, cagr: cf?.cagr ?? null, ret: cf?.ret ?? null }; });
    return { value, totalInvested, portXirr, cagr, years, sectors, caps, winner, laggard, topPos, benchmarks, topSector: sectors[0] || null };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inStats = useMemo(() => equityStats(indian.rows, indian.val, indian.valued, TRANSACTIONS), [indian, hist, now]);

  const indianRisk = useMemo(() => { const reg = computeBetaVol(hist, heldIndian.concat(SWING), now); return { ...(reg || {}), hasReg: !!reg }; }, [hist, heldIndian, now]);

  const indianDay = useMemo(() => {
    let dayPl = 0, prevTot = 0;
    indian.rows.forEach((r) => { if (r.val == null || r.day == null) return; const prev = r.val / (1 + r.day / 100); dayPl += r.val - prev; prevTot += prev; });
    return { dayPl, dayPct: prevTot ? (dayPl / prevTot) * 100 : 0 };
  }, [indian]);


  // ─── derived: US ────────────────────────────────────────────────────────────
  const usData = useMemo(() => {
    let inv = 0, val = 0, valued = true;
    const rows = US.map((s) => {
      const q = prices[s.sym]; const lp = q && !q.error ? q.price : null;
      const v = lp != null ? s.qty * lp : null; const pl = v != null ? v - s.inv : null;
      inv += s.inv; if (v != null) val += v; else valued = false;   // valued guard (was missing — audit flag): a US quote failure must drop the hero to the book close, not silently undercount
      return { ...s, livePrice: lp, liveVal: v, livePl: pl, livePct: pl != null && s.inv ? (pl / s.inv) * 100 : null, dayPct: q && !q.error ? q.pct : null };
    });
    return { rows, inv, val, valued, pl: val - inv, pct: inv ? ((val - inv) / inv) * 100 : 0 };
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
    // US return is measured on ACTUAL BUYS (cost basis), not account deposits — so
    // idle-cash drag doesn't dilute the XIRR/CAGR/benchmark. Pairs with value =
    // securities-only (usData.val). usBuys = net buys per date (Buy +, Sell −).
    const usBuys = usBuyLedger(APP.usTrades);
    const netInvested = usBuys.reduce((s, c) => s + c.invested, 0);
    let xr = null, cagr = null, years = null;
    if (value) {
      const cfs = usBuys.map((c) => ({ date: new Date(c.date), amount: -c.invested }));
      const x = xirr([...cfs, { date: now, amount: value }]); xr = x != null ? x * 100 : null;
      const c = weightedCagr(usBuys, value, now); cagr = c.cagr; years = c.years;
    }
    const cfFor = (b) => { if (!hist?.series || !value) return null; for (const sym of b.yahooSyms) { const cf = benchCounterfactual(hist.series[sym], usBuys, now); if (cf) return cf; } return null; };
    const benchmarks = US_BENCHMARKS.map((b) => { const cf = cfFor(b); return { ...b, value: cf?.value ?? null, xirr: cf?.xirr ?? null, cagr: cf?.cagr ?? null, ret: cf?.ret ?? null }; });
    return { value, sectors, caps, winner, laggard, topPos, topSector: sectors[0] || null, dayPl, dayPct: prevTot ? (dayPl / prevTot) * 100 : 0, netInvested, xirr: xr, cagr, years, benchmarks };
  }, [usData, hist, now]);

  // ─── derived: swing ─────────────────────────────────────────────────────────
  const swing = useMemo(() => {
    // The broker feed carries no sector/cap/buy-date for the swing book, so they're
    // tagged here (all bought 2026-02-09, confirmed from the Upstox tradebook) — this
    // folds swing into the combined sector/cap mix and the money-weighted CAGR.
    const META = {
      BANKBARODA: { name: 'Bank of Baroda',   sector: 'Banking',     cap: 'Large', bought: '2026-02-09' },
      AVANTEL:    { name: 'Avantel',          sector: 'Industrials', cap: 'Small', bought: '2026-02-09' },
      TDPOWERSYS: { name: 'TD Power Systems', sector: 'Industrials', cap: 'Small', bought: '2026-02-09' },
      HAPPSTMNDS: { name: 'Happiest Minds',   sector: 'Technology',  cap: 'Small', bought: '2026-02-09' },
      LAURUSLABS: { name: 'Laurus Labs',      sector: 'Pharma',      cap: 'Mid',   bought: '2026-02-09' },
    };
    let inv = 0, val = 0, valued = true;
    const rows = SWING_R.rows.map((s) => {
      const q = prices[s.ns]; const ltp = q && !q.error ? q.price : null;
      const v = ltp != null ? s.qty * ltp : null; const pl = v != null ? v - s.inv : null;
      const m = META[s.sym] || {};
      inv += s.inv; if (v != null) val += v; else valued = false;
      return { ...s, ltp, val: v, pl, pct: pl != null ? (pl / s.inv) * 100 : null, day: q && !q.error ? q.pct : null, name: s.name ?? m.name, sector: m.sector, cap: m.cap, bought: m.bought };
    });
    return { rows, inv, val, pl: val - inv, pct: inv ? ((val - inv) / inv) * 100 : 0, valued };
  }, [prices]);

  // Swing is overnight delivery equity (NSE, marked-to-market live) — reclassified
  // as part of the INDIAN EQUITY sleeve, NOT F&O trading. `indianEq` = held holdings
  // + swing; it feeds net worth, the allocation/sleeve breakdown and the header card.
  // The holdings-only `indian` stays for the per-stock XIRR/benchmark analysis.
  const indianEq = useMemo(() => {
    const inv = indian.inv + swing.inv;
    const val = (indian.val || 0) + (swing.val || 0);
    return { inv, val, pl: val - inv, pct: inv ? ((val - inv) / inv) * 100 : 0, valued: indian.valued && swing.valued };
  }, [indian, swing]);

  // Combined equity analytics = held holdings + swing (swing entered as cashflows at
  // its buy dates). Feeds the Indian tab's CAGR / benchmarks / sector mix / winner-
  // drag; the Zerodha-only inStats still backs the AI overview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const eqStats = useMemo(() => {
    const swTxns = swing.rows.filter((r) => r.bought).map((r) => ({ date: r.bought, invested: r.inv }));
    return equityStats([...indian.rows, ...swing.rows], indianEq.val, indianEq.valued, [...TRANSACTIONS, ...swTxns]);
  }, [indian, swing, indianEq, hist, now]);

  const swingSorted = useMemo(() => {
    const arr = [...swing.rows]; const { key, dir } = swSort;
    arr.sort((a, b) => { const av = a[key], bv = b[key]; return typeof av === 'string' ? dir * String(av).localeCompare(String(bv)) : dir * ((av ?? -Infinity) - (bv ?? -Infinity)); });
    return arr;
  }, [swing, swSort]);
  const sortSw = (key) => setSwSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'sym' ? 1 : -1 }));

  // Two views of trading P&L:
  //   ytdRealised — FULL account P&L (tax/CF view: the whole pooled account
  //                 is taxed in the user's hands, so CF absorption uses it)
  //   ytdOwn      — same as ytdRealised now: the account is 100% owner-capital, so the
  //                 owner keeps the full F&O P&L. Kept as a distinct name for the
  //                 net-worth-adjacent figure.
  const ytdRealised = FY.s01.current.net + FY.s02.current.net;
  const ytdOwn      = ytdRealised;
  // Swing P&L is no longer trading — it lives in the Indian-equity sleeve (net
  // worth) now, so the Trading figures are pure F&O.
  const ytdTotal    = ytdOwn;       // own F&O share — the only trading figure shown near NW
  const ytdAccountTotal = ytdRealised; // full F&O account P&L for the Trading tab
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

  // TRADING_EQUITY (business-entity model) — the F&O trading business's owner equity =
  // account value + open MTM, book-valued "at close" (broker-state = last sync). Dhan is
  // ledger-reconciled; Upstox is sync-trusted (its Payments API last-20 can't reconstruct
  // the 2.5yr history). Funds are cash (no pledged INDIAN/SWING collateral) + F&O MTM →
  // disjoint from every live-priced sleeve, so adding it to NW does NOT double-count.
  const tradingEquity = useMemo(() => {
    const b = APP.brokerState || {};
    const f = (k) => (b.funds?.[k]?.available || 0) + (b.funds?.[k]?.utilized || 0);
    const m = (k) => (b.positions?.[k]?.rows || []).filter((r) => (+r.netQty || 0) !== 0).reduce((a, r) => a + (r.unrealized || 0), 0);
    return Math.round(f('dhan') + m('DHAN_FNO') + f('upstox') + m('UPSTOX_FNO') + f('fyers') + m('FYERS_FNO'));
  }, []);

  const ov = useMemo(() => {
    // maturedCash: auto-matured FDs awaiting redeployment — still wealth
    // (cash in bank), just no longer earning in the FD sleeve.
    const usInr = usData.val * fxRate; const fdValue = fds.principal + fds.accrued + fds.maturedCash;
    // Trading business equity (account value + open MTM, 100% owner) IS in net worth,
    // but as a BOOK-VALUED line ("at close"), not a live sleeve: broker-sourced, so
    // live-marking it would silently stale during absence. It sits beside the live-priced
    // personal sleeves, honestly stale + return-reconciling (business-entity-model.md).
    // (STATIC.algo — the allocated-capital config — stays a separate Algo-tab display.)
    const pfValue = cmpfCorpus(new Date());
    const personalAssets = indianEq.val + usInr + fdValue + mf.totVal + pfValue;   // live-priced sleeves
    const totalAssets = personalAssets + tradingEquity;                             // + trading business equity (book-valued, at close)
    const loan = loanOutstanding(new Date());
    const cmpsPaid = cmpsTotalPaid(new Date());
    const cmpsPension = cmpsMonthlyPension(new Date());
    const cmpsService = cmpsServiceYears(new Date());
    // pension only vests at the minimum qualifying service; before that, leaving = refund
    const cmpsVested = cmpsService >= CMPS_MIN_QUALIFYING_YEARS;
    const cmpsVestYear = CMPS_VEST_DATE.getFullYear();
    return { usInr, fdValue, pfValue, personalAssets, tradingEquity, totalAssets, loan, personalNw: personalAssets - loan, nw: totalAssets - loan, cmpsPaid, cmpsPension, cmpsService, cmpsVested, cmpsVestYear };
  }, [indianEq.val, usData.val, fxRate, mf.totVal, fds.principal, fds.accrued, fds.maturedCash, tradingEquity]);

  // Sub-step B — EOD-book close fallback for the hero net worth. When live quotes aren't
  // fully resolved (Yahoo failed / pre-load / laptop-off) we mark net worth from the
  // durable EOD close (APP.eodBook, served) instead of a skeleton, and LABEL it "at close".
  // SAME F&O-EXCLUDED NW definition as the live path (the book's netWorth is built from the
  // same sleeves). Graceful: no book → skeleton exactly as before. (F&O-in-NW is a separate
  // decision — see tasks/resilience-benchmark.md; this does NOT change what's counted.)
  const nwBook     = APP.eodBook?.sleeveValues?.netWorth ?? null;
  const liveMarked = indianEq.valued && usData.valued && !!usdInr;
  const bookMark   = !liveMarked && nwBook != null;
  const bookDate   = APP.eodBook?.date || (APP.eodBook?.asOf || '').slice(0, 10);

  const projInvested0 = useMemo(() => {
    const gains = (indianEq.pl || 0) + (usData.pl || 0) * fxRate + (mf.totVal - mf.totCost) + (fds.accrued || 0);
    return Math.round((ov.nw || 0) - gains);
  }, [ov.nw, indianEq.pl, usData.pl, fxRate, mf.totVal, mf.totCost, fds.accrued]);

  // ── Macro sensitivities — computed weekly-returns regressions (with R²) ──────
  // US-tech beta carves out the gold ETF (GLDM) so a defensive holding doesn't
  // dilute the high-beta read. India basket = holdings + swing book.
  const usExGold = useMemo(() => US.filter((h) => h.sym !== 'GLDM'), []);
  const regUsNdx = useMemo(() => regressHoldings(hist, usExGold, ['^IXIC', '^NDX', 'QQQ'], (h) => h.sym, 'weekly', 0.043), [hist, usExGold]);
  // US sleeve risk read for the insights card — same engine as the Indian book,
  // benchmarked to Nasdaq with the US 1-yr T-bill (~4.3%) as the risk-free.
  const usRisk = useMemo(() => ({ ...(regUsNdx || {}), hasReg: !!regUsNdx }), [regUsNdx]);
  const regUsDur = useMemo(() => regressVsYield(hist, usExGold, ['^TNX'], (h) => h.sym), [hist, usExGold]);
  const indiaHeld = useMemo(() => heldIndian.concat(SWING), [heldIndian]);
  const regIndia = useMemo(() => regressHoldings(hist, indiaHeld, ['^NSEI', 'NIFTYBEES.NS'], (h) => h.ns), [hist, indiaHeld]);

  // Vol-sleeve VIX sensitivity from the Stratzy book's OWN monthly P&L
  // (data/vol_pnl.json) aligned to month-end ^VIX (macro.vixMonthly). Return
  // basis: pnl ÷ prior-month equity; falls back to pnl ÷ deployed capital when a
  // month doesn't track equity. Returns null when there's no series — the tier
  // resolver then degrades to the stated assumption. n is reported so the engine
  // can refuse to label a handful of points a "regression".
  const regVolVix = useMemo(() => {
    const vm = macro?.vixMonthly;
    if (!Array.isArray(APP.volPnl) || APP.volPnl.length < 2 || !vm || !Object.keys(vm).length) return null;
    const rows = [...APP.volPnl].filter((r) => r && r.month).sort((a, b) => a.month.localeCompare(b.month));
    const returns = [], vix = [];
    for (let i = 0; i < rows.length; i++) {
      const priorEq = i > 0 ? rows[i - 1].equity : null;
      let ret = null;
      if (i > 0 && priorEq) ret = rows[i].pnl / priorEq;
      else if (i > 0 && rows[i].capital) ret = rows[i].pnl / rows[i].capital;
      returns.push(ret);
      vix.push(vm[rows[i].month] ?? null);
    }
    return regressVsVix(returns, vix);
  }, [macro]);

  // Scenario model — live sleeve values (₹) + the computed sensitivities. All
  // figures read from the live memos; nothing here is hardcoded.
  const macroModel = useMemo(() => {
    const goldRow = usData.rows.find((r) => r.sym === 'GLDM');
    const goldUsd = goldRow?.liveVal || 0;
    const usExGoldUsd = (usData.val || 0) - goldUsd;
    const indiaV = (indian.val || 0) + (swing.valued ? swing.val : 0);
    const vixLive = macro?.live?.vix && !macro.live.vix.stale ? macro.live.vix.value : null;
    return {
      fx: fxRate,
      vix: vixLive,
      sleeves: {
        us:    { v: usExGoldUsd * fxRate, betaNdx: regUsNdx?.beta ?? null, rsqNdx: regUsNdx?.rsq ?? null, weeksNdx: regUsNdx?.weeks ?? null, perBp: regUsDur?.perBp ?? null, rsqDur: regUsDur?.rsq ?? null, weeksDur: regUsDur?.weeks ?? null },
        india: { v: indiaV, betaNifty: regIndia?.beta ?? null, rsqNifty: regIndia?.rsq ?? null, weeksNifty: regIndia?.weeks ?? null },
        vol:   { cap: STATIC.algo, book: regVolVix, proxy: macro?.volProxy && !macro.volProxy.stale ? macro.volProxy : null },
        gold:  { v: goldUsd * fxRate },
        fd:    { v: ov.fdValue },
      },
    };
  }, [usData, indian.val, swing, fxRate, macro, regUsNdx, regUsDur, regIndia, regVolVix, ov.fdValue]);

  // Nifty 50 heatmap + movers — lazy: fetched only when the Wrap tab (6)
  // is open, since it pulls 50 constituent quotes. Cached in sessionStorage for
  // 5 min so tab toggles don't re-hammer Yahoo; hydrate from cache instantly.
  useEffect(() => {
    if (tab !== 6) return;
    try {
      const c = JSON.parse(sessionStorage.getItem(NIFTY50_KEY) || 'null');
      if (c?.nifty50) setNifty50(c.nifty50);
      if (c?.ts && Date.now() - c.ts < 5 * 60 * 1000) return; // fresh enough
    } catch {}
    let dead = false;
    setN50Loading(true);
    fetch('/api/nifty50', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead || !j) return;
        setNifty50(j);
        try { sessionStorage.setItem(NIFTY50_KEY, JSON.stringify({ ts: Date.now(), nifty50: j })); } catch {}
      })
      .catch(() => {})
      .finally(() => { if (!dead) setN50Loading(false); });
    return () => { dead = true; };
  }, [tab]);

  // Nasdaq 100 heatmap — lazy: fetched only when the Wrap tab (6) is open (renders
  // on the US view), same sessionStorage-cached pattern as the Nifty 50 feed above.
  useEffect(() => {
    if (tab !== 6) return;
    try {
      const c = JSON.parse(sessionStorage.getItem(NASDAQ_KEY) || 'null');
      if (c?.nasdaq) setNasdaq(c.nasdaq);
      if (c?.ts && Date.now() - c.ts < 5 * 60 * 1000) return; // fresh enough
    } catch {}
    let dead = false;
    setNdqLoading(true);
    fetch('/api/nasdaq100', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead || !j) return;
        setNasdaq(j);
        try { sessionStorage.setItem(NASDAQ_KEY, JSON.stringify({ ts: Date.now(), nasdaq: j })); } catch {}
      })
      .catch(() => {})
      .finally(() => { if (!dead) setNdqLoading(false); });
    return () => { dead = true; };
  }, [tab]);

  // Nifty 50 Overview extras — lazy on the Wrap tab (6): ^NSEI daily closes (drive
  // the daily-returns + trend strips and the hero sparkline) and the upcoming-dividend
  // calendar (held stocks). Same sessionStorage-cached, cache-first pattern as above;
  // both degrade to empty if the feed is down (the cards hide honestly).
  useEffect(() => {
    if (tab !== 6) return;
    let freshDaily = false, freshDiv = false;
    try {
      const c = JSON.parse(sessionStorage.getItem(NIFTYDLY_KEY) || 'null');
      if (c?.niftyDaily) { setNiftyDaily(c.niftyDaily); freshDaily = c.ts && Date.now() - c.ts < 5 * 60 * 1000; }
    } catch {}
    try {
      const c = JSON.parse(sessionStorage.getItem(DIVID_KEY) || 'null');
      if (c?.dividends) { setDividends(c.dividends); freshDiv = c.ts && Date.now() - c.ts < 5 * 60 * 1000; }
    } catch {}
    if (freshDaily && freshDiv) return; // both fresh enough
    let dead = false;
    fetch('/api/nifty-daily?range=1y', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead || !j) return;
        setNiftyDaily(j);
        try { sessionStorage.setItem(NIFTYDLY_KEY, JSON.stringify({ ts: Date.now(), niftyDaily: j })); } catch {}
      })
      .catch(() => {});
    fetch('/api/dividends', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead || !j) return;
        setDividends(j);
        try { sessionStorage.setItem(DIVID_KEY, JSON.stringify({ ts: Date.now(), dividends: j })); } catch {}
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [tab]);

  // Per-holding headlines (sentiment-shaded cards) — lazy, only on the Wrap tab;
  // ~18 RSS fetches server-side, so kept off the price-refresh path. Cached 10 min.
  useEffect(() => {
    if (tab !== 6) return;
    try {
      const c = JSON.parse(sessionStorage.getItem(PNEWS_KEY) || 'null');
      if (c?.news) setPortfolioNews(c.news);
      if (c?.ts && Date.now() - c.ts < 10 * 60 * 1000) return; // fresh enough
    } catch {}
    let dead = false;
    fetch('/api/portfolio-news', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead || !j) return;
        setPortfolioNews(j);
        try { sessionStorage.setItem(PNEWS_KEY, JSON.stringify({ ts: Date.now(), news: j })); } catch {}
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [tab]);

  // Market headlines for the ticker — lazy, only on the Wrap tab. Cached 10 min.
  useEffect(() => {
    if (tab !== 6) return;
    try {
      const c = JSON.parse(sessionStorage.getItem(NEWS_KEY) || 'null');
      if (c?.news) setMarketNews(c.news);
      if (c?.ts && Date.now() - c.ts < 10 * 60 * 1000) return; // fresh enough
    } catch {}
    let dead = false;
    fetch('/api/news', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead || !j) return;
        setMarketNews(j);
        try { sessionStorage.setItem(NEWS_KEY, JSON.stringify({ ts: Date.now(), news: j })); } catch {}
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [tab]);

  // Deterministic market-regime read (no LLM) from the live macro clock — drives
  // the Pulse headline + the topbar pill. States current conditions, never predicts.
  const regime = useMemo(() => classifyRegime(macro?.live), [macro]);
  // Surface the regime on <html data-regime> so the Market Wrap tab's accent can
  // track the market mood (bullish → lime … risk-off → coral) — see globals.css.
  useEffect(() => {
    const s = regime?.state;
    if (s && s !== 'unavailable') document.documentElement.dataset.regime = s;
  }, [regime]);

  // Compact live-macro backdrop string (FRED + Yahoo) fed to the AI pulse read.
  const macroClockStr = useMemo(() => {
    const L = macro?.live; if (!L) return '';
    const parts = [];
    const add = (lbl, d, unit = '') => { if (d && !d.stale) parts.push(`${lbl} ${d.value}${unit}${d.change != null ? ` (${d.change >= 0 ? '+' : ''}${d.change.toFixed(2)})` : ''}`); };
    add('US10Y', L.us10y, '%'); add('2s10s', L.spread2s10s, 'pp'); add('HY OAS', L.hyOas, '%');
    add('NFCI', L.nfci); add('VIX', L.vix); add('DXY', L.dxy); add('Brent', L.brent, '$');
    if (L.vixTerm && !L.vixTerm.stale) parts.push(`VIX term ${L.vixTerm.state}`);
    return parts.length ? `Macro clock: ${parts.join(' · ')}` : '';
  }, [macro]);

  // ── AI insights — compact aggregates payload, manual refresh ────────────────
  // Builds one summary string per sleeve (~500 input tokens — never the full
  // holdings books) and POSTs to /api/insights. Fires ONLY on an explicit ✨
  // click (insightsReq bump), so each refresh is one deliberate, user-paced call
  // — refresh weekly/monthly as needed. Results persist in localStorage and show
  // with their last-analysed date until the next refresh.
  useEffect(() => {
    if (!insightsReq) return; // generate regardless of placement — Pulse needs it even when banners are off
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
        ? `beta ${indianRisk.beta?.toFixed(2)} · Sharpe ${indianRisk.sharpe?.toFixed(2)} · vol ${r1(indianRisk.vol)}% vs Nifty ${r1(indianRisk.mktVol)}% (weekly regression)`
        : 'n/a',
      us:
        `${US.length} holdings $${usData.inv.toFixed(0)}→$${usData.val.toFixed(0)} · XIRR ${r1(usStats.xirr)}% · ` +
        `top sector ${usStats.topSector ? `${usStats.topSector.label} ${r1(usStats.topSector.pct)}%` : 'n/a'} (ETF look-through) · ` +
        `movers: ${movers(usData.rows, 'livePct')}`,
      usRisk: usRisk.hasReg
        ? `beta ${usRisk.beta?.toFixed(2)} vs Nasdaq · Sharpe ${usRisk.sharpe?.toFixed(2)} · vol ${r1(usRisk.vol)}% vs Nasdaq ${r1(usRisk.mktVol)}% (weekly regression)`
        : 'n/a',
      mutualFunds:
        `invested ₹${Math.round(mf.totCost)} value ₹${Math.round(mf.totVal)} (${r1(mf.totRet)}%) · XIRR ${r1(mfx.port)}% vs Nifty ${r1(mfx.bench)}% · ` +
        `mix equity ${r1((mf.alloc.equity / (mf.totVal || 1)) * 100)}% arbitrage ${r1((mf.alloc.arbitrage / (mf.totVal || 1)) * 100)}% · ` +
        `SIP ₹${Math.round(MF_SIP.monthly / 1000)}K/mo ${MF_SIP.platformShort}` +
        `${(() => { const e = MF_FUNDS.find((f) => f.id === 'elss'); if (!e) return ''; const d = new Date(e.bought + 'T00:00:00Z'); return `, ELSS locked to ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}-${String(d.getUTCFullYear() + MF_SIP.elssLockYears).slice(2)}`; })()} · CAVEAT very small base + short window`,
      fixedDeposits:
        `₹${L(fds.principal)} across ${fds.rows.length} FDs · blended ${fds.blendedRate.toFixed(2)}% · accrued ₹${Math.round(fds.accrued)} · ` +
        `quarterly ladder, per-bank interest kept under the ₹40K TDS threshold`,
      algo:
        `trading business equity ₹${(ov.tradingEquity / 1e5).toFixed(2)}L IN net worth (account value + open MTM, book-valued at close; Dhan reconciled + Upstox sync-trusted) · ${FY.labels.currentShort} realised S01 +₹${FY.s01.current.net} S02 +₹${FY.s02.current.net}` +
        `${swing.valued ? ` · swing MTM ₹${Math.round(swing.pl)}` : ''} · F&O loss carryforward pool ₹${(FY.cf.poolEntering / 1e5).toFixed(2)}L (tax asset)`,
      macroClock: macroClockStr, // live FRED+Yahoo backdrop for the pulse read
    };

    let stale = false;
    (async () => {
      setInsightsLoading(true);
      try {
        const res = await fetch('/api/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok && !stale) {
          const d = await res.json();
          if (hasInsight(d.insights)) {
            const ts = Date.now();
            setInsights(d.insights); setInsightsTs(ts);
            try { localStorage.setItem(INSIGHTS_KEY, JSON.stringify({ ts, insights: d.insights })); } catch {}
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
  // Order: Indian leads (left-aligned), with FD between Indian and US so the two
  // close hues (Indian blue / US indigo) are NEVER adjacent in any allocation chart.
  // CMPF (pf) is still forced right-most by AllocBar's sort.
  const donutSegs = [
    { key: 'indian', label: 'Indian Stocks',  value: indianEq.val || 0, color: ALLOC_COLORS.indian },
    { key: 'fd',     label: 'Fixed Deposits', value: ov.fdValue,      color: ALLOC_COLORS.fd     },
    { key: 'us',     label: 'US Stocks',      value: ov.usInr   || 0, color: ALLOC_COLORS.us     },
    // ELSS is folded into Mutual Funds — one MF sleeve (jio + the Zerodha ELSS
    // tax-saver). mf.totVal/totCost already sum both; the MF tab still shows ELSS
    // as its own fund with its lock caveat.
    { key: 'mf',     label: 'Mutual Funds',   value: mf.totVal,       color: ALLOC_COLORS.mf     },
    // Trading business equity (book-valued, at close) — a slice so the donut total ties
    // to the headline. Own class in AllocBar (personal Equity/Debt stay pure). CMPF still last.
    { key: 'trading', label: 'Trading', value: ov.tradingEquity || 0, color: ALLOC_COLORS.algo },
    { key: 'pf',     label: 'CMPF',           value: ov.pfValue || 0, color: ALLOC_COLORS.pf     },
  ];

  const projSleeves = useMemo(
    () => donutSegs.map((s) => ({ ...s, value: Math.round(s.value || 0) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.round(ov.fdValue || 0), Math.round(indianEq.val || 0), Math.round(ov.usInr || 0), Math.round(mf.totVal || 0), Math.round(ov.tradingEquity || 0), Math.round(ov.pfValue || 0)],
  );

  // Per-sleeve value + invested basis (keys match projSleeves) — feeds the daily
  // snapshot's per-sleeve breakdown and the growth pills' gain-attribution
  // waffles. invested = cost basis, so value − invested = that sleeve's gain.
  const sleeveBasis = useMemo(() => ({
    fd:     { v: Math.round(ov.fdValue || 0),    i: Math.round((fds.principal || 0) + (fds.maturedCash || 0)) },
    indian: { v: Math.round(indianEq.val || 0),    i: Math.round(indianEq.inv || 0) },
    us:     { v: Math.round(ov.usInr || 0),      i: Math.round((usData.inv || 0) * fxRate) },
    mf:     { v: Math.round(mf.totVal || 0),  i: Math.round(mf.totCost || 0) },  // incl. ELSS (folded into MF)
    // Trading: basis = value → gain 0 here (the business P&L is the Trading tab, kept OUT
    // of the personal money-made / gain-attribution curve, per the business-entity model).
    trading:{ v: Math.round(ov.tradingEquity || 0), i: Math.round(ov.tradingEquity || 0) },
    pf:     { v: Math.round(ov.pfValue || 0),    i: cmpfPaid(new Date()) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ov.fdValue, ov.usInr, ov.pfValue, ov.tradingEquity, indianEq.val, indianEq.inv, usData.inv, fxRate, mf.totVal, mf.totCost, fds.principal, fds.maturedCash]);

  // Live single-day P&L per sleeve (INR). Only the equity sleeves move intraday
  // (live quotes carry day-change); FD/MF/CMPF accrue smoothly, so ~0 for today.
  // Per-sleeve attribution of TODAY's net-worth change. Equity contributes its day P&L
  // only when its own market actually traded today — on a weekend/holiday the quote's
  // day-change is the prior session's (stale), so it's 0, not carried forward. FD + CMPF
  // accrue every calendar day regardless, each as value × rate/365 (a smooth per-day
  // figure that doesn't spike when an FD is deployed or matures). MF/ELSS only move on
  // NAV days; left at 0 here.
  const daySleeveGain = useMemo(() => {
    const today = isoOf(now);
    const sess = premarket?.sessions || {};
    const nseTraded  = (sess.nifty?.asOf || null) === today;
    const nyseTraded = (sess.sp500?.asOf || null) === today;
    return {
      indian: nseTraded  ? Math.round(indianDay.dayPl || 0)         : 0,
      us:     nyseTraded ? Math.round((usStats.dayPl || 0) * fxRate) : 0,
      fd:     Math.round(((fds.principal + fds.accrued) * (fds.blendedRate / 100)) / 365), // blendedRate is a percent

      mf: 0,
      pf:     cmpfDailyAccrual(now),
    };
  }, [indianDay.dayPl, usStats.dayPl, fxRate, now, fds.principal, fds.accrued, fds.blendedRate, premarket?.sessions?.nifty?.asOf, premarket?.sessions?.sp500?.asOf]);

  const pulseCls = 'pulse' + (status.type ? ' ' + status.type : '');
  const mktPill = (open, st) => (st === 'PRE' || st === 'POST') ? 'mkt-pre' : open ? 'mkt-open' : 'mkt-closed';
  const mktTxt  = (open, st) => st === 'PRE' ? 'PRE' : st === 'POST' ? 'POST' : open == null ? '—' : open ? 'OPEN' : 'CLOSED';

  // Daily net-worth snapshots → the historical growth curve on Overview.
  const [snapshots, setSnapshots] = useState([]);
  useEffect(() => { setSnapshots(getSnapshots()); syncSnapshotsFromKv().then(setSnapshots); }, []);

  // FII/DII trail: prefer the cross-device server trail (Vercel KV, persisted by
  // /api/premarket + the daily cron in vercel.json) so it's gap-free and follows
  // across devices; fall back to the per-browser localStorage trail (builds
  // forward) when no store is wired — e.g. local dev. Hydrate from localStorage
  // first so the chart isn't empty before pre-market resolves.
  useEffect(() => { setFiidiiTrail(getFiiDiiTrail()); }, []);
  useEffect(() => {
    const serverTrail = premarket?.fiidii?.trail;
    if (Array.isArray(serverTrail) && serverTrail.length) { setFiidiiTrail(serverTrail); return; }
    const latest = premarket?.fiidii && !premarket.fiidii.stale ? premarket.fiidii.latest : null;
    if (latest?.date) setFiidiiTrail(recordFiiDii(latest, premarket?.fiiDerivs));
  }, [premarket?.fiidii?.trail, premarket?.fiidii?.latest?.date, premarket?.fiiDerivs?.asOf]);

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
    // Past precedence: SNAPSHOT.md (committed, human-verified) overrides the
    // synthetic backfill near its dates; the browser's daily snapshots win
    // from their first recorded day. Missing invested fills forward so the
    // XIRR never sees a phantom withdrawal.
    const md = historicalSnapshots();
    const synth = buildBackfill(hist?.series, fxHist, usdInr, mfNav);
    const firstReal = snapshots[0]?.d;
    const mdDates = new Set(md.map((s) => s.d));
    const near = (d) => { const t = new Date(d + 'T00:00:00Z').getTime(); return md.some((h) => Math.abs(new Date(h.d + 'T00:00:00Z').getTime() - t) < 4 * 864e5); };
    const past = [...synth.filter((s) => !mdDates.has(s.d) && !near(s.d)), ...md]
      .filter((s) => !firstReal || s.d < firstReal)
      .sort((a, b) => (a.d < b.d ? -1 : 1));
    let lastInv = 0;
    return [...past, ...snapshots].map((s) => {
      if (s.invested == null) return { ...s, invested: lastInv };
      lastInv = s.invested; return s;
    });
  }, [hist, fxHist, usdInr, snapshots, mfNav]);
  useEffect(() => {
    // US readiness checked explicitly: usdInr arrives with the INDIAN quote
    // batch, so without usData.val the guard would pass on a US-only outage
    // and persist a net worth missing the whole US sleeve.
    if (!(indian.valued && usData.val > 0 && usdInr)) return;
    // Daily snapshot — the NW is correct every calendar day: equity holds at its last
    // close while FD + CMPF accrue (both are date-based in `ov`), so a weekend point is
    // accurate, not stale. (Stale-vs-fresh is handled in the DAY attribution, not here.)
    const snap = {
      d: isoOf(new Date()),
      nw: Math.round(ov.nw),
      assets: Math.round(ov.totalAssets),
      invested: Math.round(projInvested0),
      sl: sleeveBasis, // per-sleeve {v,i} so past windows can attribute gains by class
    };
    setSnapshots(recordSnapshot(snap));
    pushSnapshotToKv(snap); // mirror to the cross-device KV store (owner-namespaced, fire-and-forget)
  }, [indian.valued, usData.val, usdInr, ov.nw, ov.totalAssets, projInvested0, sleeveBasis]);

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

  // Phase 1.5 — fit the net-worth hero figure to the width of its subtext line, so the
  // number stretches "till the last L of Liabilities". Pure font-size growth (no scaleX /
  // letter-spacing distortion). useLayoutEffect (pre-paint, no flash) + ResizeObserver on
  // the hero box (viewport + subtext-width changes). Fires on the SETTLED target (ov.nw /
  // assets / loan) — at this point AnimatedNumber still shows the prior settled value, never
  // a mid-tick frame, so the measurement is stable. The font-size transition is suppressed
  // DURING the measure passes (else each pass reads a mid-animation width and the correction
  // overshoots — the +122px bug from the mock) and restored next frame.
  useLayoutEffect(() => {
    const btn = heroBtnRef.current;
    if (!btn) return;
    if (!(indian.valued && usdInr)) { const f = heroValRef.current; if (f) f.style.removeProperty('font-size'); return; } // skeleton — keep base

    const textW = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
    const fit = () => {
      // read refs FRESH each call — the .hdr-val node remounts once (heroKey bump on first
      // NW load), so a captured node would go stale and we'd fit a detached element.
      const fig = heroValRef.current, sub = heroSubRef.current;
      if (!fig || !sub) return;
      let subW = 0; // widest subtext line's TEXT width (Range — independent of container stretch)
      sub.querySelectorAll(':scope > div').forEach((line) => { subW = Math.max(subW, textW(line)); });
      if (subW < 1) return;
      const prevTrans = fig.style.transition;
      fig.style.transition = 'none';                       // suppress during measure (overshoot fix)
      fig.style.removeProperty('font-size');               // → base clamp (.hdr-val font-size is !important)
      const base = parseFloat(getComputedStyle(fig).fontSize);
      void fig.offsetWidth;
      const heroW0 = textW(fig);
      if (heroW0 < 1) { fig.style.transition = prevTrans; return; }
      const MIN = base * 0.7, MAX = base * 2.4;
      let fs = Math.max(MIN, Math.min(MAX, base * (subW / heroW0)));
      fig.style.setProperty('font-size', fs.toFixed(2) + 'px', 'important'); void fig.offsetWidth;
      const heroW1 = textW(fig);                           // correction pass (mono → nails sub-px)
      fs = Math.max(MIN, Math.min(MAX, fs * (subW / heroW1)));
      fig.style.setProperty('font-size', fs.toFixed(2) + 'px', 'important'); void fig.offsetWidth;
      requestAnimationFrame(() => { fig.style.transition = prevTrans; }); // restore for future changes
    };

    fit();
    // Observe the GRID, not the button: once the figure is the widest element in the hero,
    // the button's width is figure-driven (constant as the viewport changes) so a button RO
    // misses viewport shrinks and never refits down. The grid's width is viewport-driven and
    // figure-independent, so it fires on exactly the changes that move subW.
    const grid = btn.parentElement;
    let lastW = -1;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (Math.abs(w - lastW) > 1) { lastW = w; fit(); }
    });
    ro.observe(grid || btn);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indian.valued, usdInr, heroKey, Math.round(ov.nw), Math.round(ov.totalAssets), Math.round(ov.loan), Math.round(ytdTotal || 0)]);

  // Header asset cards double as the primary navigation — each opens its tab.
  const headerCards = [
    // Every card's sub is the uniform growth/dip figure: absolute gain · return %,
    // coloured by direction (cl). FD's % is accrued-on-principal; Trading's is P&L
    // on own capital — so all five read the same shape.
    { label: 'Indian equity', cls: 'hc-indian', tab: 1, live: markets.nse,
      val: indian.valued ? <LiveInrC n={indianEq.val} /> : <Skel w={58} h={18} />,
      sub: indian.valued ? <span className={cl(indianEq.pl)}><SInrC n={indianEq.pl} /> · {pctS(indianEq.pct)}</span> : `${INDIAN.length} stocks + swing` },
    { label: 'Mutual funds', cls: 'hc-mf', tab: 3,
      val: <LiveInrC n={mf.totVal} />,
      sub: mf.totVal ? <span className={cl(mf.totVal - mf.totCost)}><SInrC n={mf.totVal - mf.totCost} /> · {pctS(mf.totRet)}</span> : 'NAV n/a' },
    { label: 'Fixed deposits', cls: 'hc-fd', tab: 2,
      val: <LiveInrC n={ov.fdValue} />,
      sub: <span className={cl(fds.accrued)}><SInrC n={fds.accrued} /> · {pctS(fds.principal ? (fds.accrued / fds.principal) * 100 : 0)}</span> },
    { label: 'US equity', cls: 'hc-us', tab: 4, live: markets.nyse,
      val: usData.val ? <LiveInrC n={ov.usInr} /> : <Skel w={58} h={18} />,
      sub: usData.val ? <span className={cl(usData.pl)}><SInrC n={usData.pl * fxRate} /> · {pctS(usData.pct)}</span> : `${US.length} holdings` },
    { label: 'Trading', cls: 'hc-algo', tab: 5, live: markets.nse, tip: 'Trading business equity — account value + open MTM, IN net worth as a book-valued line (at close; Dhan reconciled + Upstox sync-trusted). 100% owner.',
      val: <InrC n={ov.tradingEquity} />,
      sub: ytdTotal != null ? <span className={cl(ytdTotal)}><SInrC n={ytdTotal} /> · {pctS(ov.tradingEquity ? (ytdTotal / ov.tradingEquity) * 100 : 0)}</span> : 'at close · in NW' },
  ];

  // ─── render ─────────────────────────────────────────────────────────────────
  return (
    <CurrencyProvider mode={currency} fx={fxRate}>
    <div className="layout">
      {/* MAIN CONTENT */}
      <main className="main">
        {/* STICKY GLOBAL HEADER — utility bar + live NW + asset-card nav */}
        <div className="main-header" ref={headerRef}>
          <div className="topbar">
            <div className="topbar-left">
              {/* Net worth — live LABEL only (the figure stays in the hero). Opens Overview. */}
              <button className={'topbar-nw' + (tab === 0 ? ' active' : '')} onClick={() => selectTab(0)} title="Open Overview — net worth (incl. trading business equity, at close)">
                <span className="topbar-nw-lbl">Net worth — {bookMark ? 'at close' : 'live'} <span className={'spark' + (ath ? ' ath-spark' : '')}>✦</span></span>
              </button>
            </div>
            <div className="topbar-center">
              <span className={'mkt-pill ' + mktPill(markets.nse, markets.nseState)}><span className="live-dot" />NSE {mktTxt(markets.nse, markets.nseState)}</span>
              <button className={'pulse-pill' + (tab === 6 ? ' active' : '')} onClick={() => selectTab(6)} title="Market Wrap — India & US market regimes: index moves, sectors, FII/DII flows, and the macro backdrop">
                <span className="pulse-spark">✦</span>Market Wrap
              </button>
              <span className={'mkt-pill ' + mktPill(markets.nyse, markets.nyseState)}><span className="live-dot" />NYSE {mktTxt(markets.nyse, markets.nyseState)}</span>
            </div>
            <div className="topbar-right">
              {/* Data-freshness status — moved here, right-aligned adjacent to the AI toggle. */}
              <span className="topbar-status"><span className={pulseCls} /><span className="status-txt">{status.msg}</span></span>
              <button className={'hdr-toggle ai-toggle' + (insightsOn ? ' on' : '')} onClick={toggleInsights} aria-pressed={insightsOn}
                title={insightsOn ? 'AI analysis ON — click to hide the cards' : 'AI analysis OFF — click to show the cards'}>AI</button>
              <button className="cur-knob" data-cur={currency === 'inr' ? 'inr' : 'usd'} onClick={toggleCurrency} aria-pressed={currency === 'inr'}
                title={currency === 'inr' ? 'US figures in ₹ (converted at live USD/INR) — click for $' : 'US figures in $ (native) — click for ₹'}>
                <span className="ck-ghost l" aria-hidden="true">₹</span>
                <span className="ck-ghost r" aria-hidden="true">$</span>
                <span className="ck-knob" aria-hidden="true">{currency === 'inr' ? '₹' : '$'}</span>
              </button>
              <button className="hdr-toggle" onClick={cycleTheme} title={`Theme: ${themeMode} (follows sunrise/sunset)`}>{themeMode === 'auto' ? '🌗' : themeMode === 'day' ? '☀️' : '🌙'}</button>
            </div>
          </div>

          <div className="hdr-grid">
            {/* Live net worth — clicking it opens Overview. Assets/Liabilities are figures only. */}
            <button ref={heroBtnRef} className={'hdr-hero' + (tab === 0 ? ' active' : '')} onClick={() => selectTab(0)} title="Open Overview">
              <div key={heroKey} ref={heroValRef} className={'hdr-val' + (heroKey > 0 ? ' hdr-val-enter' : '') + (ath ? ' ath-moment' : '')}>
                {liveMarked
                  ? <AnimatedNumber value={ov.nw} render={(n) => <InrC n={n} />} />
                  : bookMark
                    ? <InrC n={nwBook} />
                    : <Skel w={150} h={36} />}
              </div>
              <div className="page-header-sub" ref={heroSubRef}>
                {bookMark ? (
                  /* live quotes unavailable → net worth marked from the durable EOD close */
                  <div><span style={{ opacity: 0.7 }}>at close · {bookDate}</span>{' · live prices unavailable'}</div>
                ) : (<>
                {/* line 1 — assets (with the CMPF flag, since it has no own card) */}
                <div>
                  Assets <strong>{liveMarked ? <AnimatedNumber value={ov.totalAssets} render={(n) => <InrC n={n} />} /> : '—'}</strong>
                  {liveMarked && (
                    <span style={{ whiteSpace: 'nowrap' }}
                      title={`Indian ${inrFull(Math.round(indianEq.val))} (incl. swing) + US ${inrFull(Math.round(ov.usInr))} + FD ${inrFull(Math.round(ov.fdValue))} + MF ${inrFull(Math.round(mf.totVal))} + CMPF ${inrFull(Math.round(ov.pfValue))}`}>
                      {' '}(incl. <InrC n={ov.pfValue} /> CMPF)
                    </span>
                  )}
                </div>
                {/* line 2 — the off-NW trading book leads (accent-bright); liabilities
                    trail DIMMED as a passing note, so the dim/bright contrast keeps the
                    two from reading alike */}
                <div>
                  {ov.tradingEquity ? (
                    <span style={{ whiteSpace: 'nowrap' }}
                      title={`Trading business equity ${inrFull(ov.tradingEquity)} = account value + open MTM (Dhan ledger-reconciled + Upstox sync-trusted; 100% owner). Book-valued at close — ${inrFull(Math.round(ov.personalNw))} personal sleeves + this = net worth ${inrFull(Math.round(ov.nw))}.`}>
                      Trading <strong style={{ color: 'var(--acc)' }}><InrC n={ov.tradingEquity} /></strong>
                    </span>
                  ) : 'excl. trading'}
                  {' · '}
                  <span style={{ whiteSpace: 'nowrap', opacity: 0.5 }}>Liabilities <strong style={{ color: 'var(--red)' }}><InrC n={ov.loan} /></strong></span>
                </div>
                </>)}
              </div>
            </button>

            {/* Asset-class cards — primary navigation (single-row scroll strip; the
                wrapper carries the state-driven edge-fade affordance — RSP-001). */}
            <div className={'hdr-cards-wrap' + (hdrEdge.l ? ' edge-l' : '') + (hdrEdge.r ? ' edge-r' : '')}>
            {hdrEdge.l && <button type="button" className="hdr-scroll l" aria-label="Scroll cards left" onClick={() => scrollHdr(-1)}>‹</button>}
            {hdrEdge.r && <button type="button" className="hdr-scroll r" aria-label="Scroll cards right" onClick={() => scrollHdr(1)}>›</button>}
            <div className="hdr-cards" ref={hdrCardsRef} onScroll={updHdrEdge}>
              {headerCards.map((c) => (
                <button key={c.label} className={'hdr-card' + (tab === c.tab ? ' active' : '') + (c.cls ? ' ' + c.cls : '')} onClick={() => selectTab(c.tab)} title={c.tip || `Open ${c.label}`}>
                  <div className="lbl">{c.label}{'live' in c ? <span className={'live-dot' + (c.live ? ' on' : '')} /> : null}</div>
                  <div className="vmd">{c.val}</div>
                  <div className="sub">{c.sub}</div>
                </button>
              ))}
            </div>
            </div>
          </div>
        </div>

        {/* TAB CONTENT — key forces a remount on tab switch so tabEnter plays */}
        <AiContext.Provider value={{ ts: insightsTs, refresh: refreshAll }}>
        <div className="tab-content" key={tab}>
          {tab === 0 && (
            <OverviewTab ov={ov} fx={fxRate}
              insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              FY={FY} snapshots={chartSnapshots} histSeries={hist?.series || null}
              projSleeves={projSleeves} projInvested0={projInvested0} baseYear={now.getFullYear()}
              payslips={PAYSLIPS} dataReady={!!(indian.valued && usData.val > 0 && usdInr)} mfAlloc={mf.alloc}
              dayGain={daySleeveGain} sleeveBasis={sleeveBasis}
              cmpsPension={ov.cmpsPension} cmpsService={ov.cmpsService} cmpsRetirement={CMPS_RETIREMENT_DATE}
              cmpsVested={ov.cmpsVested} cmpsVestYear={ov.cmpsVestYear} />
          )}
          {tab === 1 && (
            <IndianTab indian={indian} indianDayPl={indianDay.dayPl} indianDayPct={indianDay.dayPct}
              inStats={eqStats} indianRisk={indianRisk} inSorted={inSorted} inSort={inSort} sortIn={sortIn}
              flash={flash} markets={markets} lastUpdate={lastUpdate} insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              INDIAN={INDIAN} INDIAN_REALIZED={INDIAN_REALIZED} CORPORATE_ACTIONS={CORPORATE_ACTIONS} FY={FY}
              indianRec={indianRec}
              swing={swing} swingSorted={swingSorted} swSort={swSort} sortSw={sortSw} swingRec={SWING_R} />
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
            <AlgoTab ytdTotal={ytdAccountTotal} ytdRealised={ytdRealised}
              cfEntering={cfEntering} cfAfterRealised={cfAfterRealised}
              insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              ALGO={ALGO} FY={FY} fnoRealized={APP.fnoRealized} />
          )}
          {tab === 6 && (
            <MacroTab model={macroModel} macro={macro} macroBoard={macroBoard} portfolioNews={portfolioNews} marketNews={marketNews} premarket={premarket} usSentiment={usSentiment} indiaSentiment={indiaSentiment} nifty50={nifty50} nifty50Loading={nifty50Loading} nasdaq={nasdaq} nasdaqLoading={nasdaqLoading} niftyDaily={niftyDaily} dividends={dividends} marketWrap={MARKET_WRAP} fiidiiTrail={fiidiiTrail} fxRate={fxRate} regime={regime} markets={markets}
              reg={{ usNdx: regUsNdx, usDur: regUsDur, india: regIndia }}
              insights={insights} insightsOn={insightsOn} insightsFirstLoad={insightsFirstLoad}
              insightsLoading={insightsLoading} insightsTs={insightsTs}
              onRefresh={refreshInsights} aiReady={!!(indian.valued && usData.val && usdInr)} />
          )}
        </div>
        </AiContext.Provider>
      </main>
    </div>
    </CurrencyProvider>
  );
}
