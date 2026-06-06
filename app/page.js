'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  INDIAN, US, FDS, FD_PIPELINE, MF, ALGO, STATIC, RETIREMENT,
  CAT_COLORS, ALLOC_COLORS,
} from './portfolio';

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

const FETCH_TS_KEY = 'nwTracker.cache';
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
function buildInsightPayload(prices, fx) {
  const rate = fx || 88;
  const r2 = (n) => (n == null ? null : +n.toFixed(2));

  let inInv = 0, inVal = 0;
  const indian = INDIAN.map((s) => {
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

  let usInv = 0, usVal = 0;
  const us = US.map((s) => {
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
    };
  });

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
    us,
    usdInr: r2(rate),
    mutualFunds: `JioBLK ₹${MF.jio.current.toLocaleString('en-IN')} (+${MF.jio.ret}%), ELSS ₹${MF.elss.current} (+${MF.elss.ret}%)`,
    algo: 'S01 pool -₹26,293 (in recovery), S02 +₹30,998 realized',
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
        if (data.insights) setInsights(data.insights);
      }
    } catch {
      // leave any prior insights in place
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  const doRefresh = useCallback(async () => {
    setLoading(true);
    setStatus({ msg: 'Fetching live prices…', type: '' });
    try {
      const inSyms = INDIAN.map((s) => s.ns).concat(['INR=X']);
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

      // Refresh AI insights from the new prices (fire-and-forget).
      fetchInsights(merged, fx || usdInr);
    } catch (e) {
      setStatus({ msg: 'Error: ' + (e.message || 'fetch failed'), type: 'err' });
    } finally {
      setLoading(false);
    }
  }, [usdInr, fetchInsights]);

  // ─── boot: hydrate from cache, then refresh + interval ───
  useEffect(() => {
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
        // Generate insights from the cached snapshot too.
        fetchInsights(c.prices || {}, c.usdInr);
      }
    } catch {}
    if (!hydrated) doRefresh();
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
          className={'refresh-btn' + (loading ? ' loading' : '')}
          onClick={doRefresh}
        >
          ↻ {loading ? 'Updating…' : 'Refresh'}
        </button>
      </div>

      {/* HEADER */}
      <div className="hdr">
        <div>
          <div className="hdr-lbl">Net worth — live</div>
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
          <InsightBanner text={insights?.overview} loading={insightsFirstLoad} />
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
              <div className={'vmd ' + cl(indian.pl)}>
                {indian.valued ? sg(indian.pl) + inrC(Math.abs(indian.pl)) : <Skel w={70} h={15} />}
              </div>
              <div className="sub">
                {indian.valued
                  ? `${pctS(indian.pct)} · ${inrC(indian.inv)} → ${inrC(indian.val)}`
                  : `${INDIAN.length} stocks`}
              </div>
            </div>
            <div className="csm">
              <div className="lbl">US portfolio live P&amp;L</div>
              <div className={'vmd ' + cl(usData.pl)}>
                {usData.val ? sg(usData.pl) + '$' + Math.abs(usData.pl).toFixed(2) : <Skel w={70} h={15} />}
              </div>
              <div className="sub">
                {usData.val
                  ? `${pctS(usData.pct)} · ${inrC(ov.usInr)} @₹${fxRate.toFixed(0)}`
                  : `${US.length} holdings in USD`}
              </div>
            </div>
            <div className="csm">
              <div className="lbl">monthly SIP</div>
              <div className="vmd" style={{ color: 'var(--acc)' }}>{MF.sip.total}</div>
              <div className="sub">
                {MF.sip.items.map((s) => `${s.label} ${s.val.replace(/\s*\(.*\)/, '')}`).join(' · ')}
              </div>
            </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* INDIAN STOCKS */}
      {tab === 1 && (
        <div>
          <InsightBanner text={insights?.indian_stocks} loading={insightsFirstLoad} />
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
        </div>
      )}

      {/* FIXED DEPOSITS */}
      {tab === 2 && (
        <div>
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
          <InsightBanner text={insights?.mutual_funds} loading={insightsFirstLoad} />
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
        </div>
      )}

      {/* US STOCKS */}
      {tab === 4 && (
        <div>
          <InsightBanner text={insights?.us_stocks} loading={insightsFirstLoad} />
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
        </div>
      )}

      {/* ALGO */}
      {tab === 5 && (
        <div>
          <InsightBanner text={insights?.algo} loading={insightsFirstLoad} />
          <div className="g3 sec">
            <div className="csm">
              <div className="lbl">own capital deployed</div>
              <div className="vmd" style={{ color: 'var(--acc)' }}>{ALGO.summary.deployed}</div>
              <div className="sub">{ALGO.summary.deployedNote}</div>
            </div>
            <div className="csm">
              <div className="lbl">FY25-26 user take</div>
              <div className="vmd grn">{ALGO.summary.fy2526Take}</div>
              <div className="sub">realised income</div>
            </div>
            <div className="csm">
              <div className="lbl">FY26-27 YTD</div>
              <div className="vmd" style={{ color: 'var(--acc)' }}>{ALGO.summary.fy2627Ytd}</div>
              <div className="sub">S01 in recovery (−₹26,293 pool)</div>
            </div>
          </div>

          <div className="g2 sec">
            {/* S01 */}
            <div className="card card-accent" style={{ borderLeftColor: 'var(--acc)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{ALGO.s01.title}</div>
                <span className="badge ba">{ALGO.s01.badge}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>pool</div>
                  <div className="sub" style={{ margin: 0 }}>{ALGO.s01.pool}</div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>FY2025-26</div>
                  <div className="fxc"><span style={{ color: 'var(--txt2)' }}>Net pool P&amp;L</span><span className="grn mono">{ALGO.s01.fy2526.pl}</span></div>
                  <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>User take</span><span className="grn mono">{ALGO.s01.fy2526.take}</span></div>
                </div>
                <div className="mini danger">
                  <div className="lbl" style={{ marginBottom: 4 }}>FY2026-27 YTD</div>
                  <div className="fxc"><span style={{ color: 'var(--txt2)' }}>Pool P&amp;L</span><span className="red mono">{ALGO.s01.fy2627.pl}</span></div>
                  <div className="sub" style={{ marginTop: 3 }}>{ALGO.s01.fy2627.note}</div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>June scaling</div>
                  <div className="fxc">
                    <span style={{ color: 'var(--txt2)' }}>Own capital</span>
                    <span className="mono" style={{ color: 'var(--acc)' }}>{ALGO.s01.scaling.from} → {ALGO.s01.scaling.to}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* S02 */}
            <div className="card card-accent" style={{ borderLeftColor: 'var(--grn)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{ALGO.s02.title}</div>
                <span className="badge bg">{ALGO.s02.badge}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>capital</div>
                  <div className="sub" style={{ margin: 0 }}>{ALGO.s02.capital}</div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>FY2025-26</div>
                  <div className="fxc"><span style={{ color: 'var(--txt2)' }}>Active P&amp;L</span><span className="grn mono">{ALGO.s02.fy2526.pl}</span></div>
                  <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>User take (70%)</span><span className="grn mono">{ALGO.s02.fy2526.take}</span></div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>FY2026-27 YTD</div>
                  <div className="fxc"><span style={{ color: 'var(--txt2)' }}>Realised</span><span className="grn mono">{ALGO.s02.fy2627.realised}</span></div>
                  <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>Unrealised swing</span><span className="grn mono">{ALGO.s02.fy2627.unrealised}</span></div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 6 }}>swing positions</div>
                  <div style={{ marginLeft: -2 }}>
                    {ALGO.s02.swing.map((p) => <span className="chip" key={p}>{p}</span>)}
                  </div>
                </div>
                <div className="mini">
                  <div className="lbl" style={{ marginBottom: 4 }}>June scaling</div>
                  <div className="fxc">
                    <span style={{ color: 'var(--txt2)' }}>Own capital</span>
                    <span className="mono" style={{ color: 'var(--acc)' }}>{ALGO.s02.scaling.from} → {ALGO.s02.scaling.to}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="fxc" style={{ marginBottom: 8 }}>
              <span style={{ color: 'var(--txt2)' }}>{ALGO.poolNote}</span>
            </div>
            <div className="sub" style={{ margin: 0, paddingTop: 8, borderTop: '.5px solid var(--brd)' }}>
              {ALGO.carryforward}
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
