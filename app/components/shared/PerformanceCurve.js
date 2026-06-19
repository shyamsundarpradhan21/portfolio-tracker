'use client';
import { useMemo, useState } from 'react';

// Portfolio Performance Curve (Zerodha-style) — a time-weighted returns curve that
// moves ONLY with realised + unrealised P&L and excludes deposits/withdrawals, like
// a mutual-fund NAV, indexed to 100 at the window start. Any of several market
// benchmarks can be overlaid (rebased to the same 100) to answer "did my decisions
// beat the market?". All live or honestly blank.

const W = 1100, H = 252, PADL = 44, PADR = 14, PADT = 22, PADB = 22;
const ms = (iso) => new Date(iso + 'T00:00:00Z').getTime();
const monYr = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const RANGE_DAYS = { D: 1, W: 7, M: 30, Y: 365, Max: null };
const pctTxt = (p) => (p == null || !isFinite(p) ? '—' : `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`);

// Comparable market benchmarks — Yahoo weekly closes from /api/history. Foreign
// indices are local-currency price returns (noted in the footnote), not FX-adjusted.
const BENCHMARKS = [
  { key: 'nifty',   sym: '^NSEI',     label: 'Nifty 50', color: '#5B9BFF' },
  { key: 'nasdaq',  sym: '^IXIC',     label: 'Nasdaq',   color: '#22D3EE' },
  { key: 'china',   sym: '000300.SS', label: 'China',    color: '#F87171' },
  { key: 'germany', sym: '^GDAXI',    label: 'DAX',      color: '#FACC15' },
  { key: 'uk',      sym: '^FTSE',     label: 'FTSE',     color: '#C084FC' },
  { key: 'crypto',  sym: 'BTC-USD',   label: 'Bitcoin',  color: '#F7931A' },
  { key: 'gold',    sym: 'GC=F',      label: 'Gold',     color: '#D4AF37' },
];

const niceNum = (x, round) => {
  if (!(x > 0)) return 1;
  const exp = Math.floor(Math.log10(x)); const f = x / Math.pow(10, exp);
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * Math.pow(10, exp);
};
const niceScale = (lo, hi, ticks = 4) => {
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const step = niceNum((hi - lo) / Math.max(1, ticks - 1), true);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
};
// build an on-or-before lookup over a [{date,close}] series (weekly → carry forward)
const closeLookup = (closes) => {
  const cl = (closes || []).filter((c) => c && c.close > 0).map((c) => [ms(c.date), c.close]).sort((a, b) => a[0] - b[0]);
  return (iso) => { if (!cl.length) return null; const t = ms(iso); let v = null; for (const [cm, cc] of cl) { if (cm <= t) v = cc; else break; } return v; };
};

export default function PerformanceCurve({ hist = [], series, range = 'Max' }) {
  const [compare, setCompare] = useState(['nifty']);

  // Full-history TWRR NAV (deposits removed). The value basis is INVESTMENT sleeves
  // only — never raw net worth, which folds in provident-fund accrual + loan cash
  // that aren't investment performance. Per point: per-sleeve basis `sl` {v,i} (live
  // snapshots), else `invAssets`/`invested` (synthetic backfill), else nw fallback.
  const nav = useMemo(() => {
    if (!hist || hist.length < 2) return [];
    const vcOf = (s) => {
      if (s.sl && typeof s.sl === 'object') {
        let v = 0, c = 0;
        for (const k of Object.keys(s.sl)) { const e = s.sl[k]; if (e) { v += e.v || 0; c += e.i || 0; } }
        if (v > 0) return { v, c };
      }
      if (s.invAssets != null) return { v: s.invAssets, c: s.invested || 0 };
      return { v: s.nw || 0, c: s.invested || 0 };
    };
    const vc = hist.map(vcOf);
    const finalV = vc[vc.length - 1].v || 1;
    const floor = Math.max(1000, finalV * 0.005); // skip the near-zero inception base
    let s0 = vc.findIndex((x) => x.v >= floor);
    if (s0 < 0 || s0 >= hist.length - 1) s0 = 0;
    const out = [{ d: hist[s0].d, v: 100 }];
    let cur = 100;
    for (let i = s0 + 1; i < hist.length; i++) {
      const prev = vc[i - 1], now = vc[i];
      const dep = now.c - prev.c;
      let r = prev.v > 0 ? ((now.v - dep) - prev.v) / prev.v : 0;
      if (!isFinite(r)) r = 0;
      r = Math.max(-0.35, Math.min(0.35, r)); // clamp synthetic-backfill artifacts
      cur *= (1 + r);
      out.push({ d: hist[i].d, v: cur });
    }
    return out;
  }, [hist]);

  // benchmarks with data available in the history series
  const avail = useMemo(() => BENCHMARKS.filter((b) => series?.[b.sym]?.closes?.length), [series]);

  if (nav.length < 2) {
    return <div className="sub" style={{ padding: '28px 0', textAlign: 'center' }}>Performance curve builds as history accrues…</div>;
  }

  // window filter + rebase portfolio to 100 at the window's first point
  const days = RANGE_DAYS[range];
  const cutoff = days != null ? ms(nav[nav.length - 1].d) - days * 864e5 : -Infinity;
  let win = nav.filter((p) => ms(p.d) >= cutoff);
  if (win.length < 2) win = nav.slice(-2);
  const baseV = win[0].v || 100;
  const port = win.map((p) => ({ d: p.d, v: (p.v / baseV) * 100 }));

  // selected benchmarks, rebased to 100 at the same window start
  const benchLines = avail.filter((b) => compare.includes(b.key)).map((b) => {
    const at = closeLookup(series[b.sym].closes);
    const base = at(win[0].d);
    if (!base) return { ...b, pts: [], ret: null };
    const pts = win.map((p) => { const c = at(p.d); return { d: p.d, v: c ? (c / base) * 100 : null }; });
    const lastV = [...pts].reverse().find((x) => x.v != null);
    return { ...b, pts, ret: lastV ? lastV.v - 100 : null };
  });

  // scales — frame the visible window's index range (always include 100)
  const t0 = ms(win[0].d), t1 = ms(win[win.length - 1].d), span = Math.max(1, t1 - t0);
  const X = (iso) => PADL + ((ms(iso) - t0) / span) * (W - PADL - PADR);
  const vals = [...port.map((p) => p.v), ...benchLines.flatMap((b) => b.pts.map((p) => p.v)).filter((v) => v != null), 100];
  const sc = niceScale(Math.min(...vals), Math.max(...vals), 4);
  const Y = (v) => PADT + (1 - (Math.max(sc.lo, Math.min(sc.hi, v)) - sc.lo) / (sc.hi - sc.lo || 1)) * (H - PADT - PADB);
  const grid = []; for (let v = sc.lo; v <= sc.hi + sc.step * 0.5; v += sc.step) grid.push(+v.toFixed(4));
  // Catmull-Rom → cubic-Bézier: the curve passes THROUGH every data point (rounds
  // the corners only — doesn't invent returns between weekly vertices).
  const toXY = (arr) => arr.filter((p) => p.v != null).map((p) => ({ x: X(p.d), y: Y(p.v) }));
  const line = (arr) => {
    const p = toXY(arr);
    if (p.length < 2) return p.length ? `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}` : '';
    let d = `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  };
  const portXY = toXY(port);
  const portFill = line(port) + ` L${(portXY[portXY.length - 1]?.x ?? PADL).toFixed(1)},${(H - PADB).toFixed(1)} L${PADL},${(H - PADB).toFixed(1)} Z`;
  const portRet = port[port.length - 1].v - 100;
  const retCls = (r) => (r == null ? 'mut' : r >= 0 ? 'up' : 'dn');
  const toggle = (k) => setCompare((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  return (
    <div style={{ marginTop: 10 }}>
      {/* compare selector */}
      <div className="pjx-cmp">
        <span className="pjx-cmp-lbl">Compare</span>
        {avail.map((b) => (
          <button key={b.key} className={'pjx-cmp-chip' + (compare.includes(b.key) ? ' on' : '')}
            onClick={() => toggle(b.key)} style={{ '--bc': b.color }}>
            {b.label}
          </button>
        ))}
      </div>

      {/* legend with window returns */}
      <div className="pjx-perf-legend">
        <span><i className="pjx-perf-key port" /> Your book <b className={retCls(portRet)}>{pctTxt(portRet)}</b></span>
        {benchLines.map((b) => (
          <span key={b.key}><i className="pjx-perf-key" style={{ borderColor: b.color, borderTopStyle: 'dashed' }} /> {b.label} <b className={retCls(b.ret)}>{pctTxt(b.ret)}</b></span>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <linearGradient id="pjx-perffill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--acc)" stopOpacity=".18" />
            <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines + index labels; the 100 base is emphasised */}
        {grid.map((v) => (
          <g key={v}>
            <line x1={PADL} y1={Y(v)} x2={W - PADR} y2={Y(v)}
              stroke={v === 100 ? 'var(--txt3)' : 'var(--brd2)'} strokeWidth={v === 100 ? 1 : 0.5}
              strokeDasharray={v === 100 ? '4 4' : 'none'} strokeOpacity={v === 100 ? 0.6 : 1} />
            <text x={4} y={Y(v) + 4} fontSize="15" fill="var(--txt3)" fontFamily="var(--mono)">{v}</text>
          </g>
        ))}
        {/* portfolio area + line */}
        <path d={portFill} fill="url(#pjx-perffill)" />
        {benchLines.map((b) => (
          <path key={b.key} d={line(b.pts)} fill="none" stroke={b.color} strokeWidth="1.6" strokeDasharray="5 4" strokeOpacity=".85" strokeLinejoin="round" />
        ))}
        <path d={line(port)} fill="none" stroke="var(--acc)" strokeWidth="2.6" strokeLinejoin="round" />
        <circle cx={X(port[port.length - 1].d)} cy={Y(port[port.length - 1].v)} r="4" fill="var(--acc)" />
        {/* x-axis labels */}
        <text x={PADL} y={H - 5} fontSize="15" fill="var(--txt3)" fontFamily="var(--mono)">{monYr(win[0].d)}</text>
        <text x={W - PADR} y={H - 5} fontSize="15" fill="var(--acc)" fontWeight="700" textAnchor="end" fontFamily="var(--mono)">now</text>
      </svg>
    </div>
  );
}
