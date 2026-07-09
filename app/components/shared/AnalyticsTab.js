'use client';
// Trading Journal → Analytics. Window-scoped (1M/3M/6M/1Y/MAX) performance analytics for the
// two algo strategies (S01 = Dhan, S02 = Upstox+Fyers) and combined, vs NIFTY 50.
// Reads the OVERLAID realised-F&O ledger (APP.fnoLedger.rows — real contract-note charges
// already applied server-side) and the constant own+client deployed-capital base (ALGO).
// All ratios are TIME-WEIGHTED on that base (see app/lib/pnlDaily.js). Benchmark = daily
// ^NSEI closes from /api/nifty-daily, aligned to the exact trading days for alpha/beta.
// Direction is colour-only; sizes via --fs-* tokens; holds in both themes.
import { useState, useEffect, useMemo } from 'react';
import { APP } from '../../lib/appData';
import { cl, pct1, inrCd, MON } from '../../lib/fmt';
import { smoothPath } from '../../lib/smoothPath';
import {
  seriesByStrategy, summaryStats, returnsPct, cagr, volatility, sharpe, sortino,
  drawdown, drawdownEpisodes, calmar, beta, alpha, bestWorstWindows, riskReward,
  freqOfTrade, riskOMeterBand,
} from '../../lib/pnlDaily';

const PERIODS = [['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365], ['MAX', null]];
const STRATS = [['all', 'Overall'], ['S01', 'S01'], ['S02', 'S02']];
const COLOR = { S01: 'var(--grn)', S02: 'var(--cyn)', all: 'var(--acc)', nifty: 'var(--txt3)' };
const r2 = (n) => Math.round(n * 100) / 100;
const ms = (d) => Date.parse(d);
const uPct = (n) => (n == null ? '—' : Math.abs(n).toFixed(1) + '%');
const sNum = (n, d = 2) => (n == null ? '—' : n.toFixed(d));
// Magnitude-only ratio: direction is conveyed by COLOUR (grn/red via cl), never a −/+
// glyph — for the signed performance ratios (Sharpe/Sortino/Calmar). Beta keeps its sign:
// it's a neutral correlation coefficient (a negative beta = inverse to NIFTY), not a
// gain/loss figure, and it carries no direction colour, so there's no double-encoding.
const sNumG = (n, d = 2) => (n == null ? '—' : Math.abs(n).toFixed(d));

// cumulative TWR % path over a day series on a constant base, keyed by date-ms (Cards 1 & 3).
function cumPath(series, cap) {
  let f = 1; return series.map((d) => { f *= 1 + d.net / cap; return { t: ms(d.date), v: r2((f - 1) * 100) }; });
}

const NoData = ({ msg = 'Not enough data.' }) => <div className="sub" style={{ padding: '20px 2px' }}>{msg}</div>;

// ── Shared SVG axis (x = month labels from the date range, y = 3 %-ticks). Pure geometry
// in USER-SPACE units (plain numbers, not --fs tokens — SVG text scales with the viewBox,
// so a viewport-clamped token would double-scale). Y-ticks carry their sign: a cumulative-
// return axis crosses zero, so an unsigned scale reads non-monotonic (12/5/22) and unreadable.
// This is a chart SCALE marker, not a value/direction figure — the no-glyph rule is unaffected.
const AX = { fontSize: 11 };
function monthTicks(t0, t1) {
  if (!(t1 > t0)) return [];
  const out = [];
  const d = new Date(t0); d.setDate(1);
  if (d.getTime() < t0) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= t1) {
    out.push({ t: d.getTime(), label: `${MON[d.getMonth()]} ${String(d.getFullYear() % 100).padStart(2, '0')}` });
    d.setMonth(d.getMonth() + 1);
  }
  if (out.length > 6) { const step = Math.ceil(out.length / 6); return out.filter((_, i) => i % step === 0); }
  return out;
}
function axes({ x0, x1, yTop, yBot, lo, hi, t0, t1 }) {
  const X = (t) => x0 + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (x1 - x0);
  const Y = (v) => yTop + (hi === lo ? 0 : (hi - v) / (hi - lo)) * (yBot - yTop);
  return (
    <g>
      {[hi, (hi + lo) / 2, lo].map((v, i) => (
        <text key={`y${i}`} x={2} y={Y(v) + 3} fill="var(--txt3)" style={AX}>{Math.round(v)}%</text>
      ))}
      {monthTicks(t0, t1).map((m, i) => (
        <text key={`m${i}`} x={X(m.t).toFixed(1)} y={(yBot + 14).toFixed(1)} fill="var(--txt3)" textAnchor="middle" style={AX}>{m.label}</text>
      ))}
    </g>
  );
}

// Standalone-chart plot box shared with axes(): left gutter for %-ticks, bottom for months.
const PLOT = { w: 660, x0: 34, x1: 646, yTop: 12, botGutter: 22 };
function plotScales(h, lo, hi, t0, t1) {
  const yBot = h - PLOT.botGutter;
  const X = (t) => PLOT.x0 + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (PLOT.x1 - PLOT.x0);
  const Y = (v) => PLOT.yTop + (hi === lo ? 0 : (hi - v) / (hi - lo)) * (yBot - PLOT.yTop);
  return { X, Y, yBot };
}

// Resolve a live CSS colour token for SVG gradient <stop>s (var() is unreliable inside stop
// elements — same fix as ProjectionTab.useScHex); re-reads on day/night (data-time) + per-tab
// accent (data-tab) changes so the gradient follows the theme.
const GRN_FALLBACK = '#34D399';
function useGrnHex() {
  const [grn, setGrn] = useState(GRN_FALLBACK);
  useEffect(() => {
    const read = () => setGrn(getComputedStyle(document.documentElement).getPropertyValue('--grn').trim() || GRN_FALLBACK);
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-time', 'data-tab'] });
    return () => mo.disconnect();
  }, []);
  return grn;
}

// Card 1 — selected strategy's cumulative TWR curve with best/worst duration bands.
function DurationChart({ series, cap, subWin }) {
  const curve = cumPath(series, cap);
  if (curve.length < 2) return <NoData />;
  const h = 300;
  let lo = curve[0].v, hi = curve[0].v, t0 = curve[0].t, t1 = curve[0].t;
  for (const p of curve) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const { X, Y, yBot } = plotScales(h, lo, hi, t0, t1);
  const d = smoothPath(curve.map((p) => ({ x: X(p.t), y: Y(p.v) })));
  const bw = bestWorstWindows(series, subWin);
  const bandRect = (rec, fill, key) => {
    const bx0 = X(ms(rec.startDate)), bx1 = X(ms(rec.endDate));
    return <rect key={key} x={bx0.toFixed(1)} y={PLOT.yTop} width={Math.max(0.5, bx1 - bx0).toFixed(1)} height={(yBot - PLOT.yTop).toFixed(1)}
      fill={fill} stroke="var(--txt3)" strokeDasharray="3 4" strokeOpacity=".5" />;
  };
  return (
    <svg viewBox={`0 0 ${PLOT.w} ${h}`} className="an-svg" preserveAspectRatio="xMidYMid meet">
      {bw.worst && bandRect(bw.worst, 'var(--red-bg)', 'w')}
      {bw.best && bandRect(bw.best, 'var(--grn-bg)', 'b')}
      <path d={d} fill="none" stroke="var(--txt)" strokeWidth="2.4" strokeLinejoin="round" />
      {axes({ x0: PLOT.x0, x1: PLOT.x1, yTop: PLOT.yTop, yBot, lo, hi, t0, t1 })}
    </svg>
  );
}

// Card 2 — underwater drawdown area (gold), red rule at the average drawdown.
function Underwater({ curve, avgDD }) {
  if (!curve || curve.length < 2) return <NoData />;
  const h = 280;
  let lo = 0, t0 = ms(curve[0].date), t1 = t0;
  for (const p of curve) { const t = ms(p.date); if (p.dd < lo) lo = p.dd; if (t < t0) t0 = t; if (t > t1) t1 = t; }
  if (lo === 0) lo = -1;
  const hi = 0;
  const { X, Y, yBot } = plotScales(h, lo, hi, t0, t1);
  const d = smoothPath(curve.map((p) => ({ x: X(ms(p.date)), y: Y(p.dd) })));
  const z = Y(0);
  return (
    <svg viewBox={`0 0 ${PLOT.w} ${h}`} className="an-svg" preserveAspectRatio="xMidYMid meet">
      <path d={`${d} L${X(t1).toFixed(1)} ${z.toFixed(1)} L${X(t0).toFixed(1)} ${z.toFixed(1)} Z`} fill="var(--gld)" opacity=".22" />
      <path d={d} fill="none" stroke="var(--gld)" strokeWidth="2" />
      {avgDD < 0 && <line x1={PLOT.x0} x2={PLOT.x1} y1={Y(avgDD).toFixed(1)} y2={Y(avgDD).toFixed(1)} stroke="var(--red)" strokeWidth="1.6" />}
      {axes({ x0: PLOT.x0, x1: PLOT.x1, yTop: PLOT.yTop, yBot, lo, hi, t0, t1 })}
    </svg>
  );
}

// Card 3 — cumulative curve (green, gradient under-fill) with the worst-5 drawdown windows
// shaded; hover a band for depth · peak→trough · recovery (<title> is the always-safe fallback).
function DrawdownPeriods({ series, cap, episodes, grnHex }) {
  const [hover, setHover] = useState(null);
  const curve = cumPath(series, cap);
  if (curve.length < 2) return <NoData />;
  const h = 300;
  let lo = curve[0].v, hi = curve[0].v, t0 = curve[0].t, t1 = curve[0].t;
  for (const p of curve) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const { X, Y, yBot } = plotScales(h, lo, hi, t0, t1);
  const d = smoothPath(curve.map((p) => ({ x: X(p.t), y: Y(p.v) })));
  const lastT = curve[curve.length - 1].t;
  const bands = episodes.slice(0, 5).map((e, i) => {
    const bx0 = X(ms(e.peakDate));
    const endT = e.ongoing || !e.recoveryDate ? lastT : ms(e.recoveryDate);
    const bx1 = Math.max(bx0 + 1, X(endT));
    return { i, e, bx0, bx1, cx: (bx0 + bx1) / 2 };
  });
  const hb = hover != null ? bands[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${PLOT.w} ${h}`} className="an-svg" preserveAspectRatio="xMidYMid meet">
        <defs><linearGradient id="an-ddfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={grnHex} stopOpacity=".28" /><stop offset="1" stopColor={grnHex} stopOpacity="0" />
        </linearGradient></defs>
        {bands.map((b) => (
          <rect key={b.i} x={b.bx0.toFixed(1)} y={PLOT.yTop} width={(b.bx1 - b.bx0).toFixed(1)} height={(yBot - PLOT.yTop).toFixed(1)}
            fill="var(--red-bg)" style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(b.i)} onMouseLeave={() => setHover((v) => (v === b.i ? null : v))}>
            <title>{`${uPct(b.e.depth)} · ${fmtD(b.e.peakDate)} → ${fmtD(b.e.troughDate)} · ${b.e.ongoing ? 'ongoing' : b.e.recoveryDays + 'd recovery'}`}</title>
          </rect>
        ))}
        <path d={`${d} L${X(lastT).toFixed(1)} ${yBot.toFixed(1)} L${X(curve[0].t).toFixed(1)} ${yBot.toFixed(1)} Z`} fill="url(#an-ddfill)" />
        <path d={d} fill="none" stroke="var(--grn)" strokeWidth="2.2" strokeLinejoin="round" />
        {axes({ x0: PLOT.x0, x1: PLOT.x1, yTop: PLOT.yTop, yBot, lo, hi, t0, t1 })}
      </svg>
      {hb && (
        // Frosted .iq-tip overlay (the app's hover-card pattern): labels in the tab-accent
        // identity colour, depth in direction red; the peak→trough span is a muted caption so
        // the box stays narrow enough to flip-and-fit at every width.
        <div className="iq-tip" style={{ maxWidth: 240, left: `${(hb.cx / PLOT.w) * 100}%`, transform: hb.cx / PLOT.w > 0.5 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
          <div className="iq-r"><span className="iq-l" style={{ color: 'var(--acc)' }}>Depth</span><span className="iq-v" style={{ color: 'var(--red)' }}>{uPct(hb.e.depth)}</span></div>
          <div className="iq-r"><span className="iq-l" style={{ color: 'var(--acc)' }}>Recovery</span><span className="iq-v" style={{ color: 'var(--txt)' }}>{hb.e.ongoing ? 'ongoing' : `${hb.e.recoveryDays} days`}</span></div>
          <div style={{ color: 'var(--txt2)', fontSize: 'var(--fs-2xs)', whiteSpace: 'nowrap', marginTop: 3 }}>{fmtD(hb.e.peakDate)} → {fmtD(hb.e.troughDate)}</div>
        </div>
      )}
    </div>
  );
}

const Seg = ({ items, val, set, label }) => (
  <div className="seg" role="tablist" aria-label={label}>
    {items.map(([k, lbl]) => (
      <button key={k} role="tab" aria-selected={val === k} className={val === k ? 'on' : ''} onClick={() => set(k)}>{lbl}</button>
    ))}
  </div>
);

export default function AnalyticsTab({ ALGO }) {
  const [period, setPeriod] = useState('6M');
  const [strat, setStrat] = useState('all');
  const [closes, setCloses] = useState(null);
  const grnHex = useGrnHex();
  useEffect(() => {
    let on = true;
    fetch('/api/nifty-daily?range=5y', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (on && j) setCloses(j.closes || []); }).catch(() => {});
    return () => { on = false; };
  }, []);

  const rows = APP.fnoLedger?.rows || [];
  const base = useMemo(() => {
    const a = ALGO || {};
    const c1 = (a.s01?.split?.own || 0) + (a.s01?.split?.client || 0);
    const c2 = (a.s02?.split?.own || 0) + (a.s02?.split?.client || 0);
    return { S01: c1, S02: c2, all: c1 + c2 };
  }, [ALGO]);
  const S = useMemo(() => seriesByStrategy(rows), [rows]);
  const niftyRet = useMemo(() => {
    const m = new Map();
    const cs = closes || [];
    for (let i = 1; i < cs.length; i++) m.set(cs[i].date, cs[i].close / cs[i - 1].close - 1);
    return m;
  }, [closes]);

  // window cutoff anchored on the latest ledger day
  const anchor = S.all.length ? ms(S.all[S.all.length - 1].date) : Date.now();
  const days = PERIODS.find(([k]) => k === period)[1];
  const cutMs = days == null ? -Infinity : anchor - days * 86400000;
  const win = (series) => series.filter((d) => ms(d.date) >= cutMs);

  // per-strategy metrics over the window
  const metric = (key) => {
    const series = win(S[key]), cap = base[key];
    const st = summaryStats(series);
    const rets = series.map((d) => d.net / cap);
    const dd = drawdown(series, cap);
    // benchmark-aligned daily returns for alpha/beta
    const sr = [], br = [];
    for (const d of series) if (niftyRet.has(d.date)) { sr.push(d.net / cap); br.push(niftyRet.get(d.date)); }
    const cg = cagr(series, cap);
    return {
      key, cap, st, series, cap,
      net: st.net, gross: st.gross, charges: st.charges, pf: st.profitFactor,
      win: st.winDays, loss: st.lossDays,
      ret: returnsPct(series, cap), cagr: cg,
      vol: volatility(rets.map((r) => ({ r }))), sharpe: sharpe(rets.map((r) => ({ r }))), sortino: sortino(rets.map((r) => ({ r }))),
      sortinoRaw: null,
      maxDD: dd.maxDD, avgDD: dd.avgDD, dd,
      calmar: calmar(cg, dd.maxDD),
      beta: niftyRet.size ? beta(sr, br) : null, alpha: niftyRet.size ? alpha(sr, br) : null,
      rr: riskReward(st), freq: series.some((d) => d.orders > 0) ? r2(series.filter((d) => d.orders > 0).reduce((s, d) => s + d.orders, 0) / series.filter((d) => d.orders > 0).length) : null,
      risk: riskOMeterBand({ volatility: volatility(rets.map((r) => ({ r }))), maxDD: dd.maxDD }),
      episodes: drawdownEpisodes(series, cap),
    };
  };
  const M = { S01: metric('S01'), S02: metric('S02'), all: metric('all') };
  const cur = M[strat];

  // best/worst rolling sub-window (1/3 of the selected window, min 5 days) — Card 1's bands
  const subWin = Math.max(5, Math.round((cur.series.length || 0) / 3));

  // Returns table (under the curve): fixed-horizon % returns per row, anchored on the latest
  // ledger day REGARDLESS of the period pill — so 1M/3M/6M/1Y are all comparable at once.
  const HOR = [['1M', 30], ['3M', 90], ['6M', 180], ['1Y', 365]];
  const firstAllMs = S.all.length ? ms(S.all[0].date) : anchor;
  const winH = (series, d) => series.filter((r) => ms(r.date) >= anchor - d * 86400000);
  const coversH = (series, d) => series.length && ms(series[0].date) <= anchor - d * 86400000;
  const stratHor = (series, cap, d) => (coversH(series, d) ? returnsPct(winH(series, d), cap) : null);
  const niftyHor = (d) => {
    if (!niftyRet.size) return null;
    const c = anchor - d * 86400000; let f = 1, any = false;
    for (const [date, ret] of niftyRet) { const t = ms(date); if (t >= c && t <= anchor) { f *= 1 + ret; any = true; } }
    return any ? r2((f - 1) * 100) : null;
  };
  const niftyMaxDD = () => {
    const cs = (closes || []).filter((c) => { const t = ms(c.date); return t >= firstAllMs && t <= anchor; });
    if (cs.length < 2) return null;
    let pk = -Infinity, mdd = 0;
    for (const c of cs) { const v = +c.close; if (v > pk) pk = v; const dd = pk > 0 ? (v - pk) / pk * 100 : 0; if (dd < mdd) mdd = dd; }
    return r2(mdd);
  };
  const CMP = [['all', 'Overall', COLOR.all], ['S01', 'S01', COLOR.S01], ['S02', 'S02', COLOR.S02]];
  const swi = (color) => <span style={{ display: 'inline-block', width: 5, height: 16, borderRadius: 3, background: color, verticalAlign: 'middle', marginRight: 6 }} />;

  const COLS = [['S01', M.S01], ['S02', M.S02], ['Overall', M.all]];
  const cell = (key, v, c) => <td key={key} className={'an-num ' + (c || '')}>{v}</td>;
  const sCellPct = (m, k) => cell(m.key, uPct(m[k]), m[k] == null ? '' : cl(m[k]));

  return (
    <div>
      {/* Returns Comparison — fixed-horizon returns table (chart removed; the table tells the story) */}
      <div className="card sec">
        <div className="an-head">
          <div className="ctitle" style={{ margin: 0 }}>Returns Comparison <span className="badge bb">fixed-horizon · vs NIFTY 50</span></div>
          {!closes && <span className="an-hint">loading benchmark…</span>}
        </div>
        <div className="an-tblwrap"><table className="tbl an-tbl">
          <thead><tr><th />{HOR.map(([l]) => <th key={l} className="an-num">{l}</th>)}<th className="an-num">Max DD</th></tr></thead>
          <tbody>
            {CMP.map(([k, label, color]) => {
              const md = drawdown(S[k], base[k]).maxDD;
              return (
                <tr key={k}><td>{swi(color)}{label}</td>
                  {HOR.map(([l, d]) => { const v = stratHor(S[k], base[k], d); return <td key={l} className={'an-num ' + (v == null ? '' : cl(v))}>{uPct(v)}</td>; })}
                  <td className="an-num red">{S[k].length < 2 ? '—' : uPct(md)}</td>
                </tr>
              );
            })}
            <tr><td>{swi(COLOR.nifty)}NIFTY 50</td>
              {HOR.map(([l, d]) => { const v = niftyHor(d); return <td key={l} className={'an-num ' + (v == null ? '' : cl(v))}>{uPct(v)}</td>; })}
              {(() => { const md = niftyMaxDD(); return <td className="an-num red">{md == null ? '—' : uPct(md)}</td>; })()}
            </tr>
          </tbody>
        </table></div>
        <div className="an-hint" style={{ marginTop: 6 }}>Fixed-horizon returns, anchored on the latest ledger day — independent of the period/strategy controls below. Direction by colour; Max DD magnitude in red.</div>
      </div>

      {/* Period + Strategy controls — drive everything below (the returns table above is fixed-horizon) */}
      <div className="an-controls">
        <Seg items={PERIODS.map(([k]) => [k, k])} val={period} set={setPeriod} label="Period" />
        <Seg items={STRATS} val={strat} set={setStrat} label="Strategy" />
      </div>

      {/* Performance — cumulative return + CAGR (TWR) */}
      <div className="an-sub">Performance</div>
      <div className="an-2 sec">
        <div className="csm"><div className="lbl">Cumulative Return (TWR)</div><div className={'vmd ' + (cur.ret == null ? '' : cl(cur.ret))}>{uPct(cur.ret)}</div>
          <div className="sub split"><span className={cl(M.S01.ret || 0)}>S01 {uPct(M.S01.ret)}</span><span className={cl(M.S02.ret || 0)}>S02 {uPct(M.S02.ret)}</span></div></div>
        <div className="csm"><div className="lbl">CAGR (TWR)</div><div className={'vmd ' + (cur.cagr == null ? '' : cl(cur.cagr))}>{uPct(cur.cagr)}</div>
          <div className="sub split"><span className={cl(M.S01.cagr || 0)}>S01 {uPct(M.S01.cagr)}</span><span className={cl(M.S02.cagr || 0)}>S02 {uPct(M.S02.cagr)}</span></div></div>
      </div>

      {/* Metrics tables (LEFT) | performance-curve cards (RIGHT) */}
      <div className="an-2 an-cols sec">
        {/* LEFT — Key Metrics + Efficiency Ratios merged into ONE aligned 4-col table */}
        <div className="an-col">
          <div className="card">
            <div className="ctitle">Key Metrics <span className="badge bb">&amp; efficiency vs NIFTY 50</span></div>
            <div className="an-tblwrap"><table className="tbl an-tbl">
              <thead><tr><th>Metric</th><th className="an-num">S01</th><th className="an-num">S02</th><th className="an-num">Overall</th></tr></thead>
              <tbody>
                <tr><td>Net P&amp;L (overlaid)</td>{COLS.map(([n, m]) => cell(n, <span><span className="rs">₹</span>{inrCd(Math.abs(m.net))}</span>, cl(m.net)))}</tr>
                <tr><td>Profit Factor</td>{COLS.map(([n, m]) => cell(n, sNum(m.pf)))}</tr>
                <tr><td>Win / Loss days</td>{COLS.map(([n, m]) => cell(n, `${m.win}/${m.loss}`))}</tr>
                <tr><td>Success Ratio</td>{COLS.map(([n, m]) => cell(n, (m.st.winPct || 0) + '%', 'grn'))}</tr>
                <tr><td>Risk-o-meter</td>{COLS.map(([n, m]) => <td key={n} className="an-num"><span className="badge" style={riskChip(m.risk)}>{m.risk}</span></td>)}</tr>
                <tr><td>Avg Profit / Trade-day</td>{COLS.map(([n, m]) => cell(n, m.win ? <span><span className="rs">₹</span>{inrCd(m.st.winSum / m.win)}</span> : '—', 'grn'))}</tr>
                <tr><td>Avg Loss / Trade-day</td>{COLS.map(([n, m]) => cell(n, m.loss ? <span><span className="rs">₹</span>{inrCd(Math.abs(m.st.lossSum / m.loss))}</span> : '—', 'red'))}</tr>
                <tr><td>Max Drawdown</td>{COLS.map(([n, m]) => sCellPct(m, 'maxDD'))}</tr>
                <tr><td>Avg Drawdown</td>{COLS.map(([n, m]) => sCellPct(m, 'avgDD'))}</tr>
                <tr><td>Volatility (ann.)</td>{COLS.map(([n, m]) => cell(n, pct1(m.vol)))}</tr>
                <tr><td>Risk : Reward</td>{COLS.map(([n, m]) => cell(n, m.rr == null ? '—' : '1 : ' + sNum(m.rr)))}</tr>
              </tbody>
              <tbody>
                <tr className="an-sect"><td colSpan={4}>Efficiency Ratios · annualised</td></tr>
                <tr><td>Sharpe</td>{COLS.map(([n, m]) => cell(n, sNumG(m.sharpe), m.sharpe == null ? '' : cl(m.sharpe)))}</tr>
                <tr><td>Sortino</td>{COLS.map(([n, m]) => cell(n, sNumG(m.sortino), m.sortino == null ? '' : cl(m.sortino)))}</tr>
                <tr><td>Calmar</td>{COLS.map(([n, m]) => cell(n, sNumG(m.calmar), m.calmar == null ? '' : cl(m.calmar)))}</tr>
                <tr><td>Alpha (ann.)</td>{COLS.map(([n, m]) => sCellPct(m, 'alpha'))}</tr>
                <tr><td>Beta</td>{COLS.map(([n, m]) => cell(n, sNum(m.beta)))}</tr>
              </tbody>
            </table></div>
            {!closes && <div className="an-hint" style={{ marginTop: 8 }}>α/β load with the benchmark…</div>}
          </div>
        </div>

        {/* RIGHT — Best Vs Worst · Worst 5 Drawdown · Underwater */}
        <div className="an-col an-fill">
          <div className="card">
            <div className="an-head"><div className="ctitle" style={{ margin: 0 }}>Best Vs Worst Duration</div>
              <div className="an-legend">
                <span><i style={{ width: 14, height: 12, border: '1px dashed var(--txt3)', borderRadius: 2, background: 'var(--red-bg)' }} />worst duration</span>
                <span><i style={{ width: 14, height: 12, border: '1px dashed var(--txt3)', borderRadius: 2, background: 'var(--grn-bg)' }} />best duration</span>
              </div></div>
            <DurationChart series={cur.series} cap={cur.cap} subWin={subWin} />
          </div>
          <div className="card">
            <div className="an-head"><div className="ctitle" style={{ margin: 0 }}>Worst 5 Drawdown Periods <span className="an-hint">{STRATS.find(([k]) => k === strat)[1]}</span></div>
              <div className="an-legend">
                <span><i style={{ width: 14, height: 12, border: '1px dashed var(--txt3)', borderRadius: 2, background: 'var(--red-bg)' }} />drawdown window</span>
                <span><i style={{ background: 'var(--grn)' }} />cumulative return</span>
              </div></div>
            <DrawdownPeriods series={cur.series} cap={cur.cap} episodes={cur.episodes} grnHex={grnHex} />
            <div className="an-hint" style={{ marginTop: 4 }}>Hover a band → depth · peak → trough · recovery.</div>
          </div>
          <div className="card">
            <div className="an-head"><div className="ctitle" style={{ margin: 0 }}>Underwater Plot <span className="an-hint">{STRATS.find(([k]) => k === strat)[1]}</span></div>
              <div className="an-legend"><span><i style={{ background: 'var(--gld)' }} />drawdown</span><span><i style={{ background: 'var(--red)' }} />avg drawdown</span></div></div>
            <Underwater curve={cur.dd.curve} avgDD={cur.dd.avgDD} />
          </div>
        </div>
      </div>
    </div>
  );
}

const fmtD = (iso) => iso ? `${+iso.slice(8)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+iso.slice(5, 7) - 1]} '${iso.slice(2, 4)}` : '—';
const riskChip = (band) => band === 'Low' ? { background: 'var(--grn-bg)', color: 'var(--grn)' }
  : band === 'High' ? { background: 'var(--red-bg)', color: 'var(--red)' }
  : { background: 'color-mix(in srgb, var(--gld) 16%, transparent)', color: 'var(--gld)' };
