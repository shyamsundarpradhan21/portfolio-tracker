'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { INDIAN, US, FDS, STATIC, RETIREMENT, CAT_COLORS } from './portfolio';

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

export default function Page() {
  const [tab, setTab] = useState(0);
  const [prices, setPrices] = useState({});
  const [usdInr, setUsdInr] = useState(null);
  const [status, setStatus] = useState({ msg: 'Connecting to markets…', type: '' });
  const [lastUpdate, setLastUpdate] = useState('—');
  const [markets, setMarkets] = useState({ nse: null, nyse: null });
  const [loading, setLoading] = useState(false);
  const [usSort, setUsSort] = useState({ col: 'liveVal', dir: -1 });
  const timer = useRef(null);

  const fxRate = usdInr || 88; // fallback only for display before first load

  // ─── fetch ───
  const fetchBatch = async (symbols) => {
    const url = '/api/quotes?symbols=' + encodeURIComponent(symbols.join(','));
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('API ' + res.status);
    const data = await res.json();
    return data.quotes || {};
  };

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
    } catch (e) {
      setStatus({ msg: 'Error: ' + (e.message || 'fetch failed'), type: 'err' });
    } finally {
      setLoading(false);
    }
  }, [usdInr]);

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
        {['Overview', 'Indian Stocks', 'Fixed Deposits', 'US Stocks', 'Algo', 'Retirement'].map(
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
          <div className="g3 sec">
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
          <div className="g3 sec">
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
              <div className="lbl">algo + FDs + MF</div>
              <div className="vmd">{inrC(STATIC.fdDeployed + STATIC.algo + STATIC.jioMf + STATIC.elss)}</div>
              <div className="sub">static · update manually</div>
            </div>
          </div>
          <div className="card sec">
            <div className="lbl" style={{ marginBottom: 10 }}>asset allocation</div>
            <table className="tbl">
              <tbody>
                <AllocRow label="Indian equities (NSE)" val={indian.val} total={ov.totalAssets} color="var(--grn)" loading={!indian.valued} />
                <AllocRow label="US equities (Vested)" val={ov.usInr} total={ov.totalAssets} color="var(--blu)" loading={!usdInr} />
                <AllocRow label="Fixed deposits" val={STATIC.fdDeployed} total={ov.totalAssets} color="var(--acc)" />
                <AllocRow label="Algo capital" val={STATIC.algo} total={ov.totalAssets} color="var(--pur)" />
                <AllocRow label="JioBlackRock MF" val={STATIC.jioMf} total={ov.totalAssets} color="var(--cyn)" />
                <AllocRow label="ELSS" val={STATIC.elss} total={ov.totalAssets} color="var(--pnk)" />
                <tr className="tot">
                  <td>Total tracked assets</td>
                  <td className="ra">{usdInr ? inrC(ov.totalAssets) : '…'}</td>
                  <td className="ra">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* INDIAN STOCKS */}
      {tab === 1 && (
        <div>
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
          <div className="card">
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
        </div>
      )}

      {/* US STOCKS */}
      {tab === 3 && (
        <div>
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
      {tab === 4 && (
        <div>
          <div className="g2 sec">
            <div className="csm">
              <div className="lbl">capital deployed</div>
              <div className="vmd" style={{ color: 'var(--acc)' }}>{inrC(STATIC.algo)}</div>
              <div className="sub">active trading · manual updates</div>
            </div>
            <div className="csm">
              <div className="lbl">share of tracked assets</div>
              <div className="vmd">{usdInr ? ((STATIC.algo / ov.totalAssets) * 100).toFixed(1) + '%' : '…'}</div>
              <div className="sub">of total portfolio</div>
            </div>
          </div>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Algo Capitals</div>
              <span className="badge ba">active</span>
            </div>
            <div className="sub" style={{ lineHeight: 1.8 }}>
              ₹6.04L of own capital deployed across active algorithmic trading strategies.
              This balance is updated manually — it is not driven by live market data here, and
              is included in the net worth and asset-allocation totals on the Overview tab.
            </div>
          </div>
        </div>
      )}

      {/* RETIREMENT */}
      {tab === 5 && (
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

function AllocRow({ label, val, total, color, loading }) {
  const pct = total ? (val / total) * 100 : 0;
  return (
    <tr>
      <td style={{ color: 'var(--txt2)', width: '40%' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 8 }} />
        {label}
      </td>
      <td className="ra mono" style={{ color: 'var(--txt)' }}>{loading ? '…' : inrC(val)}</td>
      <td className="ra mono mut">{loading || !total ? '…' : pct.toFixed(1) + '%'}</td>
    </tr>
  );
}
