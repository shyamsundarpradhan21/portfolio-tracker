'use client';
// Trading Journal → Analytics. Window-scoped (1M/3M/6M/Max) performance analytics for the
// two algo strategies (S01 = Dhan+Zerodha, S02 = Upstox+Fyers) and combined, vs NIFTY 50.
// Reads the OVERLAID realised-F&O ledger (APP.fnoLedger.rows — real contract-note charges
// already applied server-side) and the constant own+client deployed-capital base (ALGO).
// All ratios are TIME-WEIGHTED on that base (see app/lib/pnlDaily.js). Benchmark = daily
// ^NSEI closes from /api/nifty-daily, aligned to the exact trading days for alpha/beta.
// Direction is colour-only; sizes via --fs-* tokens; holds in both themes.
import { useState, useEffect, useMemo } from 'react';
import { APP } from '../../lib/appData';
import { cl, pct1, inrC } from '../../lib/fmt';
import {
  seriesByStrategy, summaryStats, returnsPct, cagr, volatility, sharpe, sortino,
  drawdown, drawdownEpisodes, calmar, beta, alpha, bestWorstWindows, riskReward,
  freqOfTrade, riskOMeterBand,
} from '../../lib/pnlDaily';

const PERIODS = [['1M', 30], ['3M', 90], ['6M', 180], ['Max', null]];
const STRATS = [['all', 'Overall'], ['S01', 'S01'], ['S02', 'S02']];
const COLOR = { S01: 'var(--grn)', S02: 'var(--cyn)', all: 'var(--acc)', nifty: 'var(--txt3)' };
const r2 = (n) => Math.round(n * 100) / 100;
const ms = (d) => Date.parse(d);
// compact ₹ for chart labels (no +/- glyph — colour encodes direction)
const cmpRs = (v) => { const a = Math.abs(Math.round(v)); return a >= 1e5 ? (a / 1e5).toFixed(2) + 'L' : a >= 1e3 ? Math.round(a / 1e3) + 'K' : '' + a; };
// Signed % — ONLY for the multi-line chart labels, where colour = series identity (not
// gain/loss), so the sign is the direction cue. cl-coloured cards/tables use uPct (no glyph).
const sPct = (n) => (n == null ? '—' : (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1) + '%');
const uPct = (n) => (n == null ? '—' : Math.abs(n).toFixed(1) + '%');
const sNum = (n, d = 2) => (n == null ? '—' : n.toFixed(d));

// cumulative TWR % path over a day series on a constant base, keyed by date-ms.
function cumPath(series, cap) {
  let f = 1; return series.map((d) => { f *= 1 + d.net / cap; return { t: ms(d.date), v: r2((f - 1) * 100) }; });
}
// cumulative % path for the benchmark over the window dates (rebased to 0 at window start).
function benchPath(niftyRet, startMs) {
  let f = 1; const out = [];
  for (const [date, ret] of niftyRet) { const t = ms(date); if (t < startMs) continue; f *= 1 + ret; out.push({ t, v: r2((f - 1) * 100) }); }
  return out;
}

// Shared-axis multi-line SVG (x = date, y = %). lines: [{pts:[{t,v}], color, dash, bold}].
function MultiLine({ lines, w = 660, h = 220 }) {
  const pts = lines.flatMap((l) => l.pts);
  if (pts.length < 2) return <div className="sub" style={{ padding: '20px 2px' }}>Not enough data in this window.</div>;
  const padL = 6, padR = 48, padY = 16, axH = 18;
  let lo = 0, hi = 0, t0 = Infinity, t1 = -Infinity;
  for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t; }
  const sp = hi - lo || 1, tspan = t1 - t0 || 1;
  const X = (t) => padL + ((t - t0) / tspan) * (w - padL - padR);
  const Y = (v) => h - axH - padY - ((v - lo) / sp) * (h - axH - 2 * padY);
  const zeroY = Y(0);
  const d = (a) => a.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="an-svg" preserveAspectRatio="xMidYMid meet">
      <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="var(--brd)" strokeWidth="1" strokeDasharray="2 3" />
      {lines.map((l, i) => l.pts.length >= 2 ? (
        <g key={i}>
          <path d={d(l.pts)} fill="none" stroke={l.color} strokeWidth={l.bold ? 2.6 : 1.7} strokeDasharray={l.dash ? '5 4' : undefined} opacity={l.dim ? 0.75 : 1} strokeLinejoin="round" />
          <text x={w - padR + 4} y={Y(l.pts[l.pts.length - 1].v) + 3} fill={l.color} opacity={l.dim ? 0.85 : 1} style={{ fontSize: 11, fontWeight: l.bold ? 700 : 600 }}>{sPct(l.pts[l.pts.length - 1].v)}</text>
        </g>
      ) : null)}
    </svg>
  );
}

// Underwater area (drawdown %, ≤ 0).
function Underwater({ curve, w = 520, h = 200 }) {
  if (!curve || curve.length < 2) return <div className="sub" style={{ padding: '20px 2px' }}>Not enough data.</div>;
  const pad = 14, n = curve.length, lo = Math.min(...curve.map((d) => d.dd), 0), sp = (0 - lo) || 1;
  const X = (i) => pad + (i / (n - 1)) * (w - 2 * pad), Y = (v) => pad + ((0 - v) / sp) * (h - 2 * pad - 16), z = Y(0);
  const d = curve.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.dd).toFixed(1)).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="an-svg" preserveAspectRatio="xMidYMid meet">
      <line x1={pad} y1={z} x2={w - pad} y2={z} stroke="var(--brd)" strokeWidth="1" />
      <path d={`${d} L${(w - pad).toFixed(1)} ${z.toFixed(1)} L${pad} ${z.toFixed(1)} Z`} fill="var(--red-bg)" />
      <path d={d} fill="none" stroke="var(--red)" strokeWidth="2" />
    </svg>
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

  // cumulative curve lines (S01/S02/Overall + Nifty), rebased to 0 over the window
  const startMs = cur.series.length ? ms(cur.series[0].date) : cutMs;
  const lines = strat === 'all'
    ? [
      { pts: cumPath(win(S.S01), base.S01), color: COLOR.S01 },
      { pts: cumPath(win(S.S02), base.S02), color: COLOR.S02 },
      { pts: cumPath(win(S.all), base.all), color: COLOR.all, bold: true },
      { pts: benchPath(niftyRet, startMs), color: COLOR.nifty, dash: true, dim: true },
    ]
    : [
      { pts: cumPath(cur.series, cur.cap), color: COLOR[strat], bold: true },
      { pts: benchPath(niftyRet, startMs), color: COLOR.nifty, dash: true, dim: true },
    ];

  // best vs worst rolling sub-window (1/3 of the selected window, min 5 days) cumulative paths
  const subWin = Math.max(5, Math.round((cur.series.length || 0) / 3));
  const bw = bestWorstWindows(cur.series, subWin);
  const bwLines = [];
  if (bw.best && bw.worst) {
    const slice = (rec) => cur.series.filter((d) => d.date >= rec.startDate && d.date <= rec.endDate);
    bwLines.push({ pts: cumPath(slice(bw.best), cur.cap), color: 'var(--grn)', bold: true });
    bwLines.push({ pts: cumPath(slice(bw.worst), cur.cap), color: 'var(--red)', bold: true });
  }

  const COLS = [['S01', M.S01], ['S02', M.S02], ['Overall', M.all]];
  const cell = (key, v, c) => <td key={key} className={'an-num ' + (c || '')}>{v}</td>;
  const sCellPct = (m, k) => cell(m.key, uPct(m[k]), m[k] == null ? '' : cl(m[k]));

  return (
    <div>
      <div className="an-controls">
        <Seg items={PERIODS.map(([k]) => [k, k])} val={period} set={setPeriod} label="Period" />
        <Seg items={STRATS} val={strat} set={setStrat} label="Strategy" />
      </div>

      {/* Cumulative performance curve */}
      <div className="card sec">
        <div className="an-head">
          <div className="ctitle" style={{ margin: 0 }}>Cumulative Performance <span className="badge bb">vs NIFTY 50</span></div>
          <div className="an-legend">
            {strat === 'all' && <><span><i style={{ background: COLOR.S01 }} />S01</span><span><i style={{ background: COLOR.S02 }} />S02</span><span><i style={{ background: COLOR.all }} />Overall</span></>}
            {strat !== 'all' && <span><i style={{ background: COLOR[strat] }} />{strat}</span>}
            <span><i style={{ background: COLOR.nifty }} />NIFTY 50</span>
            {!closes && <span className="an-hint">loading benchmark…</span>}
          </div>
        </div>
        <MultiLine lines={lines} />
      </div>

      {/* Performance — cumulative return + CAGR (TWR) */}
      <div className="an-sub">Performance</div>
      <div className="an-2 sec">
        <div className="csm"><div className="lbl">Cumulative Return (TWR)</div><div className={'vmd ' + (cur.ret == null ? '' : cl(cur.ret))}>{uPct(cur.ret)}</div>
          <div className="sub split"><span className={cl(M.S01.ret || 0)}>S01 {uPct(M.S01.ret)}</span><span className={cl(M.S02.ret || 0)}>S02 {uPct(M.S02.ret)}</span></div></div>
        <div className="csm"><div className="lbl">CAGR (TWR)</div><div className={'vmd ' + (cur.cagr == null ? '' : cl(cur.cagr))}>{uPct(cur.cagr)}</div>
          <div className="sub split"><span className={cl(M.S01.cagr || 0)}>S01 {uPct(M.S01.cagr)}</span><span className={cl(M.S02.cagr || 0)}>S02 {uPct(M.S02.cagr)}</span></div></div>
      </div>

      {/* Best vs Worst duration */}
      <div className="card sec">
        <div className="an-head"><div className="ctitle" style={{ margin: 0 }}>Best Vs Worst Duration Periods</div>
          <div className="an-legend"><span><i style={{ background: 'var(--grn)' }} />best run</span><span><i style={{ background: 'var(--red)' }} />worst run</span></div></div>
        <MultiLine lines={bwLines} h={200} />
      </div>

      {/* Key metrics table */}
      <div className="card sec">
        <div className="ctitle">Key Metrics</div>
        <div className="an-tblwrap"><table className="tbl an-tbl">
          <thead><tr><th>Metric</th><th className="an-num">S01</th><th className="an-num">S02</th><th className="an-num">Overall</th></tr></thead>
          <tbody>
            <tr><td>Net P&amp;L (overlaid)</td>{COLS.map(([n, m]) => cell(n, <span><span className="rs">₹</span>{inrC(m.net)}</span>, cl(m.net)))}</tr>
            <tr><td>Profit Factor</td>{COLS.map(([n, m]) => cell(n, sNum(m.pf)))}</tr>
            <tr><td>Win / Loss days</td>{COLS.map(([n, m]) => cell(n, `${m.win}/${m.loss}`))}</tr>
            <tr><td>Success Ratio</td>{COLS.map(([n, m]) => cell(n, (m.st.winPct || 0) + '%', 'grn'))}</tr>
            <tr><td>Risk-o-meter</td>{COLS.map(([n, m]) => <td key={n} className="an-num"><span className="badge" style={riskChip(m.risk)}>{m.risk}</span></td>)}</tr>
            <tr><td>Avg Profit / Trade-day</td>{COLS.map(([n, m]) => cell(n, m.win ? <span><span className="rs">₹</span>{inrC(m.st.winSum / m.win)}</span> : '—', 'grn'))}</tr>
            <tr><td>Avg Loss / Trade-day</td>{COLS.map(([n, m]) => cell(n, m.loss ? <span>−<span className="rs">₹</span>{inrC(Math.abs(m.st.lossSum / m.loss))}</span> : '—', 'red'))}</tr>
            <tr><td>Max Drawdown</td>{COLS.map(([n, m]) => sCellPct(m, 'maxDD'))}</tr>
            <tr><td>Avg Drawdown</td>{COLS.map(([n, m]) => sCellPct(m, 'avgDD'))}</tr>
            <tr><td>Volatility (ann.)</td>{COLS.map(([n, m]) => cell(n, pct1(m.vol)))}</tr>
            <tr><td>Risk : Reward</td>{COLS.map(([n, m]) => cell(n, m.rr == null ? '—' : '1 : ' + sNum(m.rr)))}</tr>
            <tr><td>Freq / day (synced)</td>{COLS.map(([n, m]) => cell(n, m.freq == null ? '—' : sNum(m.freq)))}</tr>
          </tbody>
        </table></div>
      </div>

      {/* Efficiency ratios table */}
      <div className="card sec">
        <div className="ctitle">Efficiency Ratios <span className="badge bb">vs NIFTY 50 · annualised</span></div>
        <div className="an-tblwrap"><table className="tbl an-tbl">
          <thead><tr><th>Ratio</th><th className="an-num">S01</th><th className="an-num">S02</th><th className="an-num">Overall</th><th>Definition</th></tr></thead>
          <tbody>
            <tr><td>Sharpe</td>{COLS.map(([n, m]) => cell(n, sNum(m.sharpe), m.sharpe == null ? '' : cl(m.sharpe)))}<td className="an-def">return / total risk</td></tr>
            <tr><td>Sortino</td>{COLS.map(([n, m]) => cell(n, sNum(m.sortino), m.sortino == null ? '' : cl(m.sortino)))}<td className="an-def">return / downside risk</td></tr>
            <tr><td>Calmar</td>{COLS.map(([n, m]) => cell(n, sNum(m.calmar), m.calmar == null ? '' : cl(m.calmar)))}<td className="an-def">CAGR / max drawdown</td></tr>
            <tr><td>Alpha (ann.)</td>{COLS.map(([n, m]) => sCellPct(m, 'alpha'))}<td className="an-def">excess return vs NIFTY</td></tr>
            <tr><td>Beta</td>{COLS.map(([n, m]) => cell(n, sNum(m.beta)))}<td className="an-def">sensitivity to NIFTY</td></tr>
          </tbody>
        </table></div>
        {!closes && <div className="an-hint" style={{ marginTop: 8 }}>α/β load with the benchmark…</div>}
      </div>

      {/* Worst 5 drawdowns + underwater */}
      <div className="an-2 sec">
        <div className="card">
          <div className="ctitle">Worst 5 Drawdowns <span className="an-hint">{STRATS.find(([k]) => k === strat)[1]}</span></div>
          <div className="an-tblwrap"><table className="tbl an-tbl">
            <thead><tr><th>#</th><th className="an-num">Depth</th><th>Peak → Trough</th><th className="an-num">Recovery</th></tr></thead>
            <tbody>
              {cur.episodes.slice(0, 5).map((e, i) => (
                <tr key={i}><td>{i + 1}</td>{cell('d' + i, pct1(e.depth), 'red')}
                  <td>{fmtD(e.peakDate)} → {fmtD(e.troughDate)}</td>
                  {cell('r' + i, e.ongoing ? 'ongoing' : (e.recoveryDays + 'd'))}</tr>
              ))}
              {cur.episodes.length === 0 && <tr><td colSpan={4} className="sub">No drawdowns in this window.</td></tr>}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <div className="ctitle">Underwater Plot <span className="an-hint">{STRATS.find(([k]) => k === strat)[1]}</span></div>
          <Underwater curve={cur.dd.curve} h={220} />
        </div>
      </div>

      <div className="an-foot">CAGR · Sharpe/Sortino/Calmar · Alpha/Beta · drawdowns are TIME-WEIGHTED on the constant own+client deployed base, vs NIFTY 50 over the selected window. Net is after real contract-note charges.</div>
    </div>
  );
}

const fmtD = (iso) => iso ? `${+iso.slice(8)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+iso.slice(5, 7) - 1]} '${iso.slice(2, 4)}` : '—';
const riskChip = (band) => band === 'Low' ? { background: 'var(--grn-bg)', color: 'var(--grn)' }
  : band === 'High' ? { background: 'var(--red-bg)', color: 'var(--red)' }
  : { background: 'color-mix(in srgb, var(--gld) 16%, transparent)', color: 'var(--gld)' };
