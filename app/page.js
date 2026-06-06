'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  INDIAN, US, FDS, FD_PIPELINE, MF, ALGO, SWING, STATIC, RETIREMENT,
  CAT_COLORS, ALLOC_COLORS,
} from './portfolio';
import FY from '../data/fy2526_verified.json';

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
const usd = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const pctS = (n) => sg(n) + Math.abs(n).toFixed(2) + '%';
// Signed full-rupee with grouping, e.g. -₹12,619 / +₹1,06,376
const sFull = (n) => sg(n) + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
const numC = (n) => Math.round(n).toLocaleString('en-IN'); // plain grouped (charges)

const FETCH_TS_KEY = 'nwTracker.cache';
const INSIGHTS_KEY = 'nwTracker.insights';
const REFRESH_MS = 15 * 60 * 1000;

const US_COLS = [
  { key: 'sym', label: 'Ticker', num: false },
  { key: 'name', label: 'Name', num: false },
  { key: 'livePrice', label: 'Live $', num: true },
  { key: 'liveVal', label: 'Value $', num: true },
  { key: 'inv', label: 'Invested $', num: true },
  { key: 'livePl', label: 'P&L $', num: true },
  { key: 'livePct', label: 'P&L %', num: true },
  { key: 'dayPct', label: 'Day %', num: true },
];

// Distil live state into a compact payload for the /api/insights route.
// Only outlier holdings are sent to reduce prompt tokens by ~40%.
function buildInsightPayload(prices, fx) {
  const rate = fx || 88;
  const r2 = (n) => (n == null ? null : +n.toFixed(2));

  let inInv = 0, inVal = 0;
  const allIndian = INDIAN.map((s) => {
    const q = prices[s.ns];
    const lp = q && !q.error ? q.price : null;
    const v = lp != null ? s.qty * lp : null;
    const pl = v != null ? v - s.inv : null;
    inInv += s.inv;
    if (v != null) inVal += v;
    return {
      sym: s.sym, qty: s.qty, avgCost: s.cost, livePrice: r2(lp),
      plPct: pl != null ? r2((pl / s.inv) * 100) : null,
      dayPct: q && !q.error ? r2(q.pct) : null,
    };
  });
  // Send only positions with significant P&L or intraday moves
  const indian = allIndian.filter(
    (r) => (r.plPct != null && Math.abs(r.plPct) > 10) ||
            (r.dayPct != null && Math.abs(r.dayPct) > 2),
  );

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
  const totalAssets = inVal + usInr + STATIC.fdDeployed + STATIC.algo + STATIC.jioMf + STATIC.elss;
  const nw = totalAssets - STATIC.loan;

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
    us,
    usSummary: `${us.length}/${US.length} shown (top 3 by value + |P&L|>15% or |day|>3%)`,
    usdInr: r2(rate),
    mutualFunds: `JioBLK ₹${MF.jio.current.toLocaleString('en-IN')} (+${MF.jio.ret}%), ELSS ₹${MF.elss.current} (+${MF.elss.ret}%)`,
    fixedDeposits:
      `Active (${inrC(STATIC.fdDeployed)}, ~₹${FDS.reduce((s, f) => s + f.interest, 0).toLocaleString('en-IN')}/yr): ` +
      FDS.map((f) => `${f.bank} ${inrC(f.principal)} @${f.rate}% matures ${f.matures}`).join('; ') +
      `. Pipeline (${inrC(FD_PIPELINE.reduce((s, f) => s + f.amount, 0))}), next: ${FD_PIPELINE[0].bank} ${inrC(FD_PIPELINE[0].amount)} on ${FD_PIPELINE[0].deploy}` +
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

  // Ask Claude for tab-specific insights from the freshly-fetched data.
  const fetchInsights = useCallback(async (pricesArg, fxArg) => {
    const payload = buildInsightPayload(pricesArg, fxArg);
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
      const [inData, usData] = await Promise.all([
        fetchBatch(inSyms),
        fetchBatch(usSyms),
      ]);
      const merged = { ...inData, ...usData };
      setPrices(merged);

      const fx = inData['INR=X']?.price;
      if (fx) setUsdInr(fx);

      // market state from a representative quote of each exchange
      const nseQ = Object.entries(inData).find(
        ([k, v]) => k.endsWith('.NS') && v.state,
      )?.[1];
      const nyseQ = Object.values(usData).find((v) => v.state);
      setMarkets({
        nse: nseQ ? nseQ.state === 'REGULAR' : null,
        nyse: nyseQ ? nyseQ.state === 'REGULAR' : null,
      });

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
      // Also respects the per-session insights toggle.
      if (opts.insights && insightsOn) fetchInsights(merged, fx || usdInr);
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
        if (!haveInsights && insightsOn) fetchInsights(c.prices || {}, c.usdInr);
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
  const indian = useMemo(() => {
    let inv = 0, val = 0, valued = true;
    const rows = INDIAN.map((s) => {
      const q = prices[s.ns];
      const ltp = q && !q.error ? q.price : null;
      const v = ltp != null ? s.qty * ltp : null;
      const pl = v != null ? v - s.inv : null;
      const pct = pl != null ? (pl / s.inv) * 100 : null;
      inv += s.inv;
      if (v != null) val += v; else valued = false;
      return { ...s, ltp, val: v, pl, pct, day: q && !q.error ? q.pct : null };
    });
    const pl = val - inv;
    return { rows, inv, val, pl, pct: inv ? (pl / inv) * 100 : 0, valued };
  }, [prices]);

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

  // FY26-27 algo YTD = S01 net + S02 net + live swing unrealised
  const ytdRealised = FY.s01.fy2627.net + FY.s02.fy2627.net;
  const ytdTotal = swing.valued ? ytdRealised + swing.pl : null;

  // CF absorption: only realised F&O income eats into the non-spec *business*
  // loss carryforward. Equity swing P&L is capital gains (STCG) — it can never
  // offset the F&O business CF, so it is intentionally excluded here.
  const cfEntering = Math.abs(FY.carryforward.find((c) => c.accent).val); // 5,97,318
  const cfAfterRealised = cfEntering - ytdRealised;                       // 4,99,306

  // ─── derived: overview / net worth ───
  const ov = useMemo(() => {
    const usInr = usData.val * fxRate;
    const totalAssets =
      indian.val + usInr + STATIC.fdDeployed + STATIC.algo + STATIC.jioMf + STATIC.elss;
    const nw = totalAssets - STATIC.loan;
    return { usInr, totalAssets, nw };
  }, [indian.val, usData.val, fxRate]);

  const fdInterest = FDS.reduce((s, f) => s + f.interest, 0);
  const fdPipelineTotal = FD_PIPELINE.reduce((s, f) => s + f.amount, 0);

  // Allocation donut segments — live values where available, else snapshot.
  const donutSegs = [
    { label: 'Algo Capitals',  value: STATIC.algo,        color: ALLOC_COLORS.algo },
    { label: 'Fixed Deposits', value: STATIC.fdDeployed,  color: ALLOC_COLORS.fd },
    { label: 'Indian Stocks',  value: indian.val || 471000, color: ALLOC_COLORS.indian },
    { label: 'US Stocks',      value: ov.usInr || 443000, color: ALLOC_COLORS.us },
    { label: 'Mutual Funds',   value: STATIC.jioMf,       color: ALLOC_COLORS.mf },
    { label: 'ELSS',           value: STATIC.elss,        color: ALLOC_COLORS.elss },
  ];

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
          <div className="hdr-val">{indian.valued && usdInr ? inrC(ov.nw) : <Skel w={130} h={24} />}</div>
          <div className="hdr-sub">
            Tracked assets {inrC(ov.totalAssets)} · Loan ~₹7.50L · excl. savings
          </div>
        </div>
        <div className="hdr-date">
          <div>USD/INR: <strong>{usdInr ? '₹' + usdInr.toFixed(2) : '—'}</strong></div>
          <div style={{ marginTop: 3, fontSize: 10, color: 'var(--txt3)' }}>{lastUpdate}</div>
        </div>
      </div>

      {/* TABS */}
      <div className="tabs">
        {['Overview', 'Indian Stocks', 'Fixed Deposits', 'Mutual Funds', 'US Stocks', 'Algo', 'Retirement'].map(
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
                  <div className="vlg">{usdInr ? inrC(ov.nw) : <Skel />}</div>
                  <div className="sub">assets minus loan</div>
                </div>
                <div className="csm">
                  <div className="lbl">total tracked assets</div>
                  <div className="vlg">{usdInr ? inrC(ov.totalAssets) : <Skel />}</div>
                  <div className="sub">6 asset classes</div>
                </div>
                <div className="csm">
                  <div className="lbl">liabilities</div>
                  <div className="vlg" style={{ color: 'var(--red)' }}>~₹7.50L</div>
                  <div className="sub">personal loan, est. outstanding</div>
                </div>
              </div>
              <div className="g3">
                <div className="csm">
                  <div className="lbl">Indian equity live P&amp;L</div>
                  <div className={'vlg ' + cl(indian.pl)}>
                    {indian.valued ? sg(indian.pl) + inrC(Math.abs(indian.pl)) : <Skel w={70} h={20} />}
                  </div>
                  <div className="sub">
                    {indian.valued
                      ? `${pctS(indian.pct)} · ${inrC(indian.inv)} → ${inrC(indian.val)}`
                      : `${INDIAN.length} stocks`}
                  </div>
                </div>
                <div className="csm">
                  <div className="lbl">US portfolio live P&amp;L</div>
                  <div className={'vlg ' + cl(usData.pl)}>
                    {usData.val ? sg(usData.pl) + '$' + Math.abs(usData.pl).toFixed(2) : <Skel w={70} h={20} />}
                  </div>
                  <div className="sub">
                    {usData.val
                      ? `${pctS(usData.pct)} · ${inrC(ov.usInr)} @₹${fxRate.toFixed(0)}`
                      : `${US.length} holdings in USD`}
                  </div>
                </div>
                <div className="csm">
                  <div className="lbl">algo + FDs + MF</div>
                  <div className="vlg">{inrC(STATIC.fdDeployed + STATIC.algo + STATIC.jioMf + STATIC.elss)}</div>
                  <div className="sub">static · update manually</div>
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
              { label: 'Pool entering FY26-27', val: sFull(-FY.cf.poolEnteringFY2627), accent: true, sub: `−${inrFull(FY.cf.fy2627Realised)} realised absorbed → ${inrC(FY.cf.poolEnteringFY2627 - FY.cf.fy2627Realised)} remaining` },
            ]}
          />
        </div>
      )}

      {/* INDIAN STOCKS */}
      {tab === 1 && (
        <div>
          <InsightBanner text={insightsOn ? insights?.indian_stocks : null} loading={insightsOn && insightsFirstLoad} />
          <div className="csm sec" style={{ borderColor: 'var(--brd2)' }}>
            <div className="fxc">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                  Indian Equities — Live (NSE)
                </div>
                <div className="sub">{INDIAN.length} stocks · ~₹30K equal-weight</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={'vmd ' + cl(indian.pl)}>
                  {indian.valued ? sg(indian.pl) + inrC(Math.abs(indian.pl)) : <Skel w={70} h={15} />}
                </div>
                <div className="sub">
                  {indian.valued
                    ? `${pctS(indian.pct)} · ${inrC(indian.inv)} → ${inrC(indian.val)}`
                    : 'loading…'}
                </div>
              </div>
            </div>
          </div>
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Stock</th><th>Qty</th><th className="ra">Avg cost</th>
                  <th className="ra">LTP</th><th className="ra">Invested</th>
                  <th className="ra">Value</th><th className="ra">P&amp;L</th>
                  <th className="ra">Return %</th><th className="ra">Day %</th>
                </tr>
              </thead>
              <tbody>
                {indian.rows.map((s) => (
                  <tr key={s.sym}>
                    <td style={{ color: 'var(--txt)', fontWeight: 500 }}>
                      {s.sym}
                      {s.tag === 'RED' && <span className="badge br" style={{ fontSize: 9, marginLeft: 4 }}>▼</span>}
                    </td>
                    <td className="mut">{s.qty}</td>
                    <td className="ra mut mono">₹{s.cost.toLocaleString('en-IN')}</td>
                    <td className="ra mono">{s.ltp != null ? '₹' + s.ltp.toFixed(2) : <Skel w={48} h={11} />}</td>
                    <td className="ra mono">{inrC(s.inv)}</td>
                    <td className="ra mono">{s.val != null ? inrC(s.val) : '—'}</td>
                    <td className={'ra mono ' + (s.pl != null ? cl(s.pl) : 'mut')}>
                      {s.pl != null ? sg(s.pl) + inrFull(Math.abs(s.pl)) : '—'}
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
                  <td className="ra">{inrC(indian.inv)}</td>
                  <td className="ra">{indian.valued ? inrC(indian.val) : '…'}</td>
                  <td className={'ra ' + cl(indian.pl)}>{indian.valued ? sg(indian.pl) + inrC(Math.abs(indian.pl)) : '…'}</td>
                  <td className={'ra ' + cl(indian.pl)}>{indian.valued ? pctS(indian.pct) : '…'}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <CFMemo
            title="Equity Tax — FY25-26 Capital Gains"
            rows={[
              { label: 'FY25-26 domestic STCG', val: '+₹1,476', color: 'var(--grn)', sub: FY.cf.cg2526.indianStcgNote },
              { label: 'STCG loss carried into FY26-27', val: '₹0', color: 'var(--grn)', sub: FY.cf.stcgNote },
            ]}
          />
        </div>
      )}

      {/* FIXED DEPOSITS */}
      {tab === 2 && (
        <div>
          <InsightBanner text={insightsOn ? insights?.fixed_deposits : null} loading={insightsOn && insightsFirstLoad} />
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">active deployed</div>
              <div className="vmd">{inrC(STATIC.fdDeployed)}</div>
              <div className="sub">{FDS.length} FDs · Slice, ICICI, HDFC</div>
            </div>
            <div className="csm">
              <div className="lbl">annual interest</div>
              <div className="vmd grn">{inrFull(fdInterest)}</div>
              <div className="sub">simple interest estimate</div>
            </div>
            <div className="csm">
              <div className="lbl">blended rate</div>
              <div className="vmd">{((fdInterest / STATIC.fdDeployed) * 100).toFixed(2)}%</div>
              <div className="sub">weighted by principal</div>
            </div>
          </div>
          <div className="card sec">
            <div className="lbl" style={{ marginBottom: 10 }}>active FDs</div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bank</th><th>FD</th><th>Matures</th>
                  <th className="ra">Principal</th><th className="ra">Rate</th>
                  <th className="ra">Ann. interest</th>
                </tr>
              </thead>
              <tbody>
                {FDS.map((f) => (
                  <tr key={f.bank + f.label}>
                    <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.bank}</td>
                    <td className="mut">{f.label}</td>
                    <td className="mut">{f.matures}</td>
                    <td className="ra mono">{inrC(f.principal)}</td>
                    <td className="ra grn mono">{f.rate.toFixed(2)}%</td>
                    <td className="ra mono">{inrFull(f.interest)}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td colSpan={3}>Total deployed</td>
                  <td className="ra">{inrC(STATIC.fdDeployed)}</td>
                  <td />
                  <td className="ra">{inrFull(fdInterest)}/yr</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="fxc" style={{ marginBottom: 10 }}>
              <div className="lbl" style={{ margin: 0 }}>Pipeline — Not Yet Deployed</div>
              <div className="sub" style={{ margin: 0 }}>
                Pipeline {inrC(fdPipelineTotal)} · Grand total {inrC(STATIC.fdDeployed + fdPipelineTotal)}
              </div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Bank</th><th>FD</th><th>Deploy date</th><th>Maturity</th>
                  <th>Tenure</th><th className="ra">Amount</th><th />
                </tr>
              </thead>
              <tbody>
                {FD_PIPELINE.map((f) => (
                  <tr key={f.bank + f.label}>
                    <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.bank}</td>
                    <td className="mut">{f.label}</td>
                    <td className="mut">{f.deploy}</td>
                    <td className="mut">{f.maturity}</td>
                    <td className="mut">{f.tenure}</td>
                    <td className="ra mono">{inrC(f.amount)}</td>
                    <td>{f.badge && <span className="badge ba">{f.badge}</span>}</td>
                  </tr>
                ))}
                <tr className="tot">
                  <td colSpan={5}>Total pipeline</td>
                  <td className="ra">{inrC(fdPipelineTotal)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 10, paddingTop: 10, borderTop: '.5px solid var(--brd)' }}>
              Strategy: ~₹30-32K annual interest per bank · Slice &amp; HDFC: 18m+1d · ICICI &amp; SBI: 2y+1d
            </div>
          </div>
        </div>
      )}

      {/* MUTUAL FUNDS */}
      {tab === 3 && (
        <div>
          <InsightBanner text={insightsOn ? insights?.mutual_funds : null} loading={insightsOn && insightsFirstLoad} />
          <div className="g2 sec">
            <div className="csm">
              <div className="lbl">total invested</div>
              <div className="vmd">{inrFull(MF.jio.invested + MF.elss.invested)}</div>
              <div className="sub">JioBLK + ELSS</div>
            </div>
            <div className="csm">
              <div className="lbl">current value</div>
              <div className="vmd grn">{inrFull(MF.jio.current + MF.elss.current)}</div>
              <div className="sub">
                {(() => {
                  const inv = MF.jio.invested + MF.elss.invested;
                  const cur = MF.jio.current + MF.elss.current;
                  return `+${(((cur - inv) / inv) * 100).toFixed(2)}% blended`;
                })()}
              </div>
            </div>
          </div>

          {/* Section A — JioBLK */}
          <div className="card card-accent" style={{ borderLeftColor: 'var(--blu)', marginBottom: 22 }}>
            <div className="fxc" style={{ marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{MF.jio.name}</div>
                <div className="sub">{MF.jio.desc}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="vmd grn">+{MF.jio.ret.toFixed(2)}%</div>
                <div className="sub">{inrFull(MF.jio.invested)} → {inrFull(MF.jio.current)}</div>
              </div>
            </div>
            <div className="lbl" style={{ margin: '14px 0 10px' }}>lumpsum allocation (₹50K)</div>
            {(() => {
              const max = Math.max(...MF.jio.lumpsum.map((x) => x.amt));
              return MF.jio.lumpsum.map((a) => (
                <div className="bar-row" key={a.name}>
                  <span className="bar-lbl">{a.name}</span>
                  <span className="bar-trk">
                    <span className="bar-fil" style={{ width: (a.amt / max) * 100 + '%', background: '#8F7FE8' }} />
                  </span>
                  <span className="bar-val">{inrC(a.amt)}</span>
                  <span className="bar-cat">{a.cat}</span>
                </div>
              ));
            })()}
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 12, paddingTop: 10, borderTop: '.5px solid var(--brd)' }}>
              ₹20K/mo SIP flows into Growth ProFolio — Aladdin allocates proportionally
            </div>
          </div>

          {/* Section B — Zerodha ELSS */}
          <div className="card card-accent" style={{ borderLeftColor: 'var(--grn)' }}>
            <div className="fxc">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Zerodha ELSS</div>
                <div className="sub">{MF.elss.name} · {MF.elss.desc}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="vmd grn">+{MF.elss.ret.toFixed(2)}%</div>
                <div className="sub">{inrFull(MF.elss.invested)} → {inrFull(MF.elss.current)}</div>
              </div>
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
      )}

      {/* US STOCKS */}
      {tab === 4 && (
        <div>
          <InsightBanner text={insightsOn ? insights?.us_stocks : null} loading={insightsOn && insightsFirstLoad} />
          <div className="csm sec" style={{ borderColor: 'var(--brd2)' }}>
            <div className="fxc">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                  US Portfolio — Live (Vested)
                </div>
                <div className="sub">{US.length} holdings · fractional shares · USD + INR converted</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={'vmd ' + cl(usData.pl)}>
                  {usData.val ? sg(usData.pl) + '$' + Math.abs(usData.pl).toFixed(2) : <Skel w={80} h={15} />}
                </div>
                <div className="sub">
                  {usData.val ? `${pctS(usData.pct)} · $${usData.inv.toFixed(2)} → $${usData.val.toFixed(2)}` : 'loading…'}
                </div>
              </div>
            </div>
          </div>
          <div className="card sec">
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <Stat label="Cost basis (USD)" val={'$' + usData.inv.toFixed(2)} />
              <Stat label="Live value (USD)" val={usData.val ? '$' + usData.val.toFixed(2) : '…'} />
              <Stat label="Live value (INR)" val={usdInr ? inrC(ov.usInr) : '…'} />
              <Stat label="USD/INR live" val={usdInr ? '₹' + usdInr.toFixed(2) : '…'} />
            </div>
            <div className="scroll-tbl">
              <table className="tbl">
                <thead>
                  <tr>
                    {US_COLS.map((c) => (
                      <th
                        key={c.key}
                        className={c.num ? 'ra' : ''}
                        onClick={() => sortUs(c.key)}
                      >
                        {c.label} {usSort.col === c.key ? (usSort.dir < 0 ? '↓' : '↑') : '↕'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usSorted.map((s) => (
                    <tr key={s.sym}>
                      <td style={{ color: 'var(--txt)', fontWeight: 700 }} className="mono">
                        <span style={{
                          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                          background: CAT_COLORS[s.cat] || 'var(--txt3)', marginRight: 6,
                        }} />
                        {s.sym}
                      </td>
                      <td style={{ color: 'var(--txt2)', fontSize: 11 }}>{s.name}</td>
                      <td className="ra mono">{s.livePrice != null ? '$' + s.livePrice.toFixed(2) : <Skel w={40} h={11} />}</td>
                      <td className="ra mono">{s.liveVal != null ? usd(s.liveVal) : '—'}</td>
                      <td className="ra mono mut">${s.inv.toFixed(2)}</td>
                      <td className={'ra mono ' + (s.livePl != null ? cl(s.livePl) : 'mut')}>
                        {s.livePl != null ? (s.livePl >= 0 ? '+' : '') + usd(s.livePl) : '—'}
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
                    <td colSpan={2}>Total — {US.length} holdings</td>
                    <td />
                    <td className="ra">{usData.val ? '$' + usData.val.toFixed(2) : '…'}</td>
                    <td className="ra">${usData.inv.toFixed(2)}</td>
                    <td className={'ra ' + cl(usData.pl)}>{usData.val ? (usData.pl >= 0 ? '+' : '') + usd(usData.pl) : '…'}</td>
                    <td className={'ra ' + cl(usData.pl)}>{usData.val ? pctS(usData.pct) : '…'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 8 }}>
              Click headers to sort · Prices live from Yahoo Finance, converted at live USD/INR
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
      )}

      {/* ALGO */}
      {tab === 5 && (
        <div>
          <InsightBanner text={insightsOn ? insights?.algo : null} loading={insightsOn && insightsFirstLoad} />

          {/* SUMMARY */}
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">own capital</div>
              <div className="vmd" style={{ color: 'var(--acc)' }}>{ALGO.summary.deployed}</div>
              <div className="sub">{ALGO.summary.deployedNote}</div>
            </div>
            <div className="csm">
              <div className="lbl">FY 2025-26</div>
              <div className={'vmd ' + cl(FY.combined2526.net)}>{sFull(FY.combined2526.net)}</div>
              <div className="sub">realised value</div>
            </div>
            <div className="csm">
              <div className="lbl">FY26-27 YTD</div>
              <div className="vmd grn">{ytdTotal != null ? sFull(ytdTotal) : <Skel w={90} h={15} />}</div>
              <div className="sub">
                <span className="grn">S01 {sFull(FY.s01.fy2627.net)}</span> ·{' '}
                <span className="grn">S02 {sFull(FY.s02.fy2627.net)}</span> ·{' '}
                swing {swing.valued ? <span className={cl(swing.pl)}>{sFull(swing.pl)}</span> : '…'}
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
                  <div className="fxc" style={{ marginBottom: 4 }}>
                    <div className="lbl" style={{ margin: 0 }}>pool</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--acc)', fontFamily: 'var(--mono)' }}>{ALGO.s01.deployed}</div>
                  </div>
                  <div className="sub" style={{ margin: 0 }}>{ALGO.s01.pool}</div>
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
                    <span className="red mono">{sFull(-cfEntering)}</span>
                  </div>
                  <div className="fxc" style={{ marginTop: 8 }}>
                    <span style={{ color: 'var(--txt2)' }}>Realised F&amp;O YTD (S01 + S02)</span>
                    <span className="grn mono">{sFull(ytdRealised)}</span>
                  </div>
                  <div className="fxc" style={{ marginTop: 10, paddingTop: 8, borderTop: '.5px solid var(--brd)' }}>
                    <span style={{ color: 'var(--txt2)' }}>CF remaining</span>
                    <span className="red mono">{sFull(-cfAfterRealised)}</span>
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
                  <div className="fxc" style={{ marginBottom: 4 }}>
                    <div className="lbl" style={{ margin: 0 }}>capital</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--acc)', fontFamily: 'var(--mono)' }}>{ALGO.s02.deployed}</div>
                  </div>
                  <div className="sub" style={{ margin: 0 }}>{ALGO.s02.capital}</div>
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
                    Swing positions <span className="badge bg" style={{ fontSize: 9 }}>Live</span>
                  </div>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Symbol</th><th className="ra">Qty</th><th className="ra">Avg</th>
                        <th className="ra">LTP</th><th className="ra">P&amp;L</th><th className="ra">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {swing.rows.map((r) => (
                        <tr key={r.sym}>
                          <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{r.sym}</td>
                          <td className="ra mut">{r.qty}</td>
                          <td className="ra mut mono">{r.cost.toFixed(2)}</td>
                          <td className="ra mono">{r.ltp != null ? r.ltp.toFixed(2) : <Skel w={42} h={11} />}</td>
                          <td className={'ra mono ' + (r.pl != null ? cl(r.pl) : 'mut')}>
                            {r.pl != null ? sFull(r.pl) : '—'}
                          </td>
                          <td className={'ra mono ' + (r.pct != null ? cl(r.pct) : 'mut')}>
                            {r.pct != null ? pctS(r.pct) : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="tot">
                        <td>Total</td>
                        <td />
                        <td className="ra">{inrFull(swing.inv)}</td>
                        <td className="ra">{swing.valued ? inrFull(swing.val) : '…'}</td>
                        <td className={'ra ' + cl(swing.pl)}>{swing.valued ? sFull(swing.pl) : '…'}</td>
                        <td className={'ra ' + cl(swing.pl)}>{swing.valued ? pctS(swing.pct) : '…'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* BOTTOM STRIP */}
          <div className="csm sec">
            <span style={{ color: 'var(--txt2)' }}>
              Own capital: <strong style={{ color: 'var(--txt)' }}>{ALGO.summary.deployed}</strong> <span className="mut">({ALGO.summary.deployedNote})</span>
              {'  ·  '}
              FY25-26 combined — Gross: <span className="grn">{sFull(FY.combined2526.gross)}</span> ·
              Charges: <span className="red">−₹{numC(FY.combined2526.charges)}</span> ·
              Net F&amp;O (Sch BP): <span className="red">{sFull(FY.combined2526.net)}</span>
              {'  '}
              <span className="mut">(S01 {sFull(FY.s01.fy2526.total.net)} · S02 {sFull(FY.s02.fy2526.total.net)})</span>
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
                    {c.consumed ? '₹0' : sFull(c.val)}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* RETIREMENT */}
      {tab === 6 && (
        <div>
          <div className="csm sec" style={{ borderColor: 'var(--blu)', background: 'var(--blu-bg)' }}>
            <div style={{ fontSize: 12, color: 'var(--txt2)' }}>
              <strong style={{ color: 'var(--blu)' }}>2055 projections only</strong> — not included
              in net worth. Figures are nominal future rupees; divide by ~4.1× for today&apos;s
              purchasing power.
            </div>
          </div>
          <div className="g3 sec">
            {RETIREMENT.map((r) => (
              <div key={r.key} className="card" style={{ textAlign: 'center', ...(r.key === 'base case' ? { borderColor: 'var(--acc)' } : {}) }}>
                <div className="lbl" style={{ textAlign: 'center' }}>{r.key}</div>
                <div className="vlg" style={{ color: r.color }}>{r.corpus}</div>
                <div className="sub" style={{ textAlign: 'center' }}>Corpus</div>
                <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', color: r.color, marginTop: 8 }}>
                  {r.pension}
                </div>
                <div className="sub" style={{ textAlign: 'center' }}>pension</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="lbl" style={{ marginBottom: 10 }}>structure</div>
            <table className="tbl">
              <tbody>
                <tr><td style={{ color: 'var(--txt2)', width: 200 }}>Retirement year</td><td style={{ color: 'var(--txt)', fontWeight: 600 }}>2055</td></tr>
                <tr><td style={{ color: 'var(--txt2)' }}>Inflation deflator</td><td style={{ color: 'var(--txt)', fontWeight: 600 }}>~4.1× to convert 2055 nominal → today</td></tr>
                <tr><td style={{ color: 'var(--txt2)' }}>Pension</td><td style={{ color: 'var(--txt)', fontWeight: 600 }}>defined benefit · monthly · for life</td></tr>
              </tbody>
            </table>
          </div>
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
              <div className="vsm" style={{ marginTop: 4, color: r.color || 'var(--red)' }}>{r.val}</div>
              {r.sub && <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{r.sub}</div>}
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
            <td className={'ra mono ' + cl(r.gross)}>{sFull(r.gross)}</td>
            <td className="ra mono mut">{numC(r.charges)}</td>
            <td className={'ra mono ' + cl(r.net)}>{sFull(r.net)}</td>
          </tr>
        ))}
        <tr className="tot">
          <td>Total</td>
          <td className={'ra ' + cl(total.gross)}>{sFull(total.gross)}</td>
          <td className="ra mut">{numC(total.charges)}</td>
          <td className={'ra ' + cl(total.net)}>{sFull(total.net)}</td>
        </tr>
      </tbody>
    </table>
  );
}

// Current-year YTD realised F&O (Gross / Charges / Net) + optional extra row.
function YtdFno({ label, data, extra }) {
  return (
    <div className="mini">
      <div className="lbl" style={{ marginBottom: 6 }}>{label}</div>
      <div className="fxc"><span style={{ color: 'var(--txt2)' }}>Gross</span><span className={'mono ' + cl(data.gross)}>{sFull(data.gross)}</span></div>
      <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>Charges</span><span className="mono mut">{numC(data.charges)}</span></div>
      <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>Net realised</span><span className={'mono ' + cl(data.net)}>{sFull(data.net)}</span></div>
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
          fontSize="17" fontWeight="700" fontFamily="var(--mono)">{inrC(total)}</text>
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
