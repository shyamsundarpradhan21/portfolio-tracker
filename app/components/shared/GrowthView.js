'use client';
// Growth view — ₹ money MADE vs a same-dated-rupees benchmark counterfactual, drawn in the
// net-worth card's chrome (this is the "Growth" half of the Net worth ↔ Growth toggle, in
// place of the old indexed-to-100 Return curve). Two+ ₹ lines, re-baselined to 0 at the
// window start: your investment book (solid, --acc) and each selected benchmark (dashed).
// Window 1D · 1M · 6M · 1Y · Max.
//
// All ₹ math is server-side (/api/growth?view=growth) — this owns NO private ledger. The one
// exception is the 1D own line: the server can't read live quotes, so it's the client's live
// accumulating intraday P&L, merged from the per-sleeve tapes (mergeLiveTapes — the same
// source the Live-P&L card uses); the 1D benchmark (Nifty intraday) still comes from the route.

import { useEffect, useState } from 'react';
import { mergeLiveTapes } from '../../lib/pnlDaily';
import { smoothPath } from '../../lib/smoothPath';

const W = 1100, H = 252, PADL = 46, PADR = 14, PADT = 22, PADB = 22;

// Benchmarks — colour + label keyed by the server's `available` / `bench` keys.
const BENCH = {
  nifty:   { label: 'Nifty 50', color: '#5B9BFF' },
  nasdaq:  { label: 'Nasdaq',   color: '#22D3EE' },
  china:   { label: 'China',    color: '#F87171' },
  germany: { label: 'DAX',      color: '#FACC15' },
  uk:      { label: 'FTSE',     color: '#C084FC' },
  crypto:  { label: 'Bitcoin',  color: '#F7931A' },
  gold:    { label: 'Gold',     color: '#D4AF37' },
};
const BENCH_ORDER = ['nifty', 'nasdaq', 'china', 'germany', 'uk', 'crypto', 'gold'];

// ₹ helpers (mirror ProjectionTab / GrowthCurve). Figures are UNSIGNED — direction is by
// colour (.up/.dn), never a +/- glyph. Axis tick labels keep a sign (it's a scale).
const crAbs = (n) => { const a = Math.abs(n); if (a >= 1e7) return '₹' + (a / 1e7).toFixed(2) + 'Cr'; if (a >= 1e5) return '₹' + (a / 1e5).toFixed(2) + 'L'; return '₹' + Math.round(a).toLocaleString('en-IN'); };
const axLabel = (n) => { const a = Math.abs(n), s = n < 0 ? '−' : ''; if (a >= 1e7) return s + '₹' + +(a / 1e7).toFixed(2) + 'Cr'; if (a >= 1e5) { const l = a / 1e5; return s + '₹' + (Number.isInteger(l) ? l : +l.toFixed(1)) + 'L'; } if (a >= 1e3) return s + '₹' + Math.round(a / 1e3) + 'k'; return s + '₹' + Math.round(a); };
const niceNum = (x, round) => { if (!(x > 0)) return 1; const e = Math.floor(Math.log10(x)); const f = x / 10 ** e; const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10); return nf * 10 ** e; };
const niceScale = (lo, hi, ticks = 4) => { if (!(hi > lo)) { lo -= 1; hi += 1; } const step = niceNum((hi - lo) / Math.max(1, ticks - 1), true); return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step }; };
// ₹ in an SVG <text> — the rupee glyph lives in the body font, not the mono face.
const RsSvg = ({ x, y, children, ...rest }) => { const parts = String(children).split('₹'); return <text x={x} y={y} {...rest}>{parts.map((p, i) => <tspan key={i}>{i > 0 && <tspan fontFamily="var(--body)" fontSize="1.05em">₹</tspan>}{p}</tspan>)}</text>; };
// ₹ in HTML — routes the glyph through the global .rs treatment (mono digits + body ₹).
const Rs = ({ of }) => { const s = String(of); const i = s.indexOf('₹'); return i === -1 ? <>{s}</> : <>{s.slice(0, i)}<span className="rs">₹</span>{s.slice(i + 1)}</>; };
const cls = (v) => (v == null || !isFinite(v) ? '' : v >= 0 ? 'up' : 'dn');
// The portfolio "day" — the US sleeve runs overnight, so before 06:00 IST the live session
// still belongs to the previous IST date (matches PortfolioLiveCurve / the capture buckets).
const sessionIstIso = () => { const d = new Date(Date.now() + 5.5 * 3600 * 1000); if (d.getUTCHours() < 6) d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const tRank = (t) => { const [h, m] = String(t).split(':').map(Number); const x = h * 60 + m; return x < 360 ? x + 1440 : x; };

// `range` is a controlled prop — the ONE shared window selector lives in ProjectionTab (the
// period tiles below the chart) and drives both Net worth and Growth, so Growth carries no
// window pills of its own. Falls back to 'max' if rendered standalone.
export default function GrowthView({ fx, range: rangeProp }) {
  const range = rangeProp ?? 'max';
  const [compare, setCompare] = useState(['nifty']);
  const [data, setData] = useState(null);      // { points, available }
  const [ownTape, setOwnTape] = useState([]);   // 1D only: merged intraday own P&L
  const [hovF, setHovF] = useState(null);       // hovered x-fraction → value readout per series

  // server data per range (own line for 1M+, bench counterfactuals for all)
  useEffect(() => {
    let on = true;
    setData(null);
    const fxq = fx ? `&fx=${fx}` : '';
    fetch(`/api/growth?view=growth&range=${range}${fxq}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (on && j) setData({ range, points: j.points || [], available: j.available || [] }); })
      .catch(() => {});
    return () => { on = false; };
  }, [range, fx]);

  // 1D own line — live accumulating intraday P&L (client-supplied). Poll the per-sleeve
  // tapes and merge, exactly like the Live-P&L card; the server supplies the Nifty bench.
  useEffect(() => {
    if (range !== '1D') { setOwnTape([]); return undefined; }
    let on = true;
    const date = sessionIstIso();
    const poll = async () => {
      try {
        const got = await Promise.all(['fno', 'eq', 'us'].map((k) =>
          fetch(`/api/intraday?kind=${k}&date=${date}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
        if (!on) return;
        const parts = {}; ['fno', 'eq', 'us'].forEach((k, i) => { parts[k] = Array.isArray(got[i]?.tape) ? got[i].tape : []; });
        setOwnTape(mergeLiveTapes(parts));
      } catch { /* keep last */ }
    };
    poll();
    const id = setInterval(poll, 12_000);
    return () => { on = false; clearInterval(id); };
  }, [range]);

  // Guard the range/data race: until the fetch for the CURRENT range resolves, `data` may
  // still hold the previous range's points (date-keyed vs time-keyed) — rendering the 1D
  // branch over stale date points yields NaN coords. Show Loading until they match.
  if (!data || data.range !== range) return <div className="sub" style={{ padding: '28px 0', textAlign: 'center' }}>Loading growth…</div>;

  const is1D = range === '1D';
  const available = is1D ? data.available.filter((k) => k === 'nifty') : data.available;

  // Unified series shape: { key, label, color, pts:[{x:0..1 fraction, v:₹}] } so the 1D
  // (time axis) and 1M+ (date axis) cases share one plotting path.
  const series = [];
  let xLabels = ['', 'now'];
  if (is1D) {
    const own = (ownTape || []).filter((p) => p && p.t != null && Number.isFinite(+p.net));
    const bench = (data.points || []).filter((p) => p && p.d != null && p.bench && Number.isFinite(+p.bench.nifty));
    const allT = [...new Set([...own.map((p) => p.t), ...bench.map((p) => p.d)])].sort((a, b) => tRank(a) - tRank(b));
    if (allT.length >= 2) {
      const x0 = tRank(allT[0]), span = Math.max(1, tRank(allT[allT.length - 1]) - x0);
      const fr = (t) => (tRank(t) - x0) / span;
      const ownBase = own.length ? own[0].net : 0;
      if (own.length >= 2) series.push({ key: 'own', label: 'Your book', color: 'var(--acc)', pts: own.map((p) => ({ x: fr(p.t), v: p.net - ownBase })) });
      if (compare.includes('nifty') && bench.length >= 2) series.push({ key: 'nifty', label: BENCH.nifty.label, color: BENCH.nifty.color, pts: bench.map((p) => ({ x: fr(p.d), v: p.bench.nifty })) });
      xLabels = [allT[0], 'now'];
    }
  } else {
    const pts = (data.points || []).filter((p) => p && p.d && Number.isFinite(+p.growth_inr));
    if (pts.length >= 2) {
      const span = Math.max(1, pts.length - 1);
      const fr = (i) => i / span;
      series.push({ key: 'own', label: 'Your book', color: 'var(--acc)', pts: pts.map((p, i) => ({ x: fr(i), v: p.growth_inr })) });
      for (const k of BENCH_ORDER) {
        if (!available.includes(k) || !compare.includes(k)) continue;
        const bp = pts.map((p, i) => (p.bench && Number.isFinite(+p.bench[k]) ? { x: fr(i), v: p.bench[k] } : null)).filter(Boolean);
        if (bp.length >= 2) series.push({ key: k, label: BENCH[k].label, color: BENCH[k].color, pts: bp });
      }
      const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const fmtD = (iso) => { const [, m, d] = iso.split('-'); return `${+d} ${MON[+m]}`; };
      xLabels = [fmtD(pts[0].d), 'now'];
    }
  }

  if (!series.length) {
    return <div className="sub" style={{ padding: '28px 0', textAlign: 'center', lineHeight: 1.6 }}>
      {is1D ? 'Today’s curve draws once the market opens and a few ticks land.' : 'The growth curve builds as daily snapshots accrue.'}
    </div>;
  }

  // ₹ scale across every series, always including the 0 baseline.
  const allV = series.flatMap((s) => s.pts.map((p) => p.v)).concat(0);
  const sc = niceScale(Math.min(...allV), Math.max(...allV), 4);
  const X = (f) => PADL + f * (W - PADL - PADR);
  const Y = (v) => PADT + (1 - (Math.max(sc.lo, Math.min(sc.hi, v)) - sc.lo) / (sc.hi - sc.lo || 1)) * (H - PADT - PADB);
  const grid = []; for (let v = sc.lo; v <= sc.hi + sc.step * 0.5; v += sc.step) grid.push(+v.toFixed(4));
  const toPath = (s) => smoothPath(s.pts.map((p) => ({ x: X(p.x), y: Y(p.v) })));
  const own = series.find((s) => s.key === 'own');
  const endVal = (s) => s.pts[s.pts.length - 1].v;
  const ownFill = own ? `${toPath(own)} L${X(own.pts[own.pts.length - 1].x).toFixed(1)},${Y(0).toFixed(1)} L${X(own.pts[0].x).toFixed(1)},${Y(0).toFixed(1)} Z` : '';

  // Hover: nearest point per series at the cursor fraction → vertical cursor + a value card
  // (each row in its series colour, value coloured by direction). Direction = colour, no glyph.
  const hovPts = hovF == null ? null : series.map((s) => {
    let best = s.pts[0];
    for (const p of s.pts) if (Math.abs(p.x - hovF) < Math.abs(best.x - hovF)) best = p;
    return { key: s.key, label: s.label, color: s.color, v: best.v, x: best.x };
  });
  const hovX = hovF == null ? 0 : X(hovF);
  const hovLeftPct = (hovX / W) * 100;
  const hovFlip = hovX > W * 0.5;
  const dirCol = (v) => (cls(v) === 'up' ? 'var(--grn)' : cls(v) === 'dn' ? 'var(--red)' : 'var(--txt)');

  return (
    <div style={{ marginTop: 10 }}>
      {/* benchmark compare chips — the WINDOW selector is the shared period tiles below the
          chart (ProjectionTab), so Growth no longer carries its own window pills. */}
      <div className="pjx-cmp">
        {!is1D && available.length > 0 && <span className="pjx-cmp-lbl">vs</span>}
        {!is1D && BENCH_ORDER.filter((k) => available.includes(k)).map((k) => (
          <button key={k} className={'pjx-cmp-chip' + (compare.includes(k) ? ' on' : '')} style={{ '--bc': BENCH[k].color }}
            onClick={() => setCompare((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))}>{BENCH[k].label}</button>
        ))}
      </div>

      {/* legend — ₹ deltas, direction by colour (no +/- glyph) */}
      <div className="pjx-perf-legend">
        {own && <span><i className="pjx-perf-key" style={{ borderColor: 'var(--acc)' }} /> Your book <b className={cls(endVal(own))}><Rs of={crAbs(endVal(own))} /></b></span>}
        {series.filter((s) => s.key !== 'own').map((s) => (
          <span key={s.key}><i className="pjx-perf-key" style={{ borderColor: s.color, borderTopStyle: 'dashed' }} /> {s.label} <b className={cls(endVal(s))}><Rs of={crAbs(endVal(s))} /></b></span>
        ))}
        <span className="pjx-perf-beat" style={{ color: 'var(--txt3)' }}>{is1D ? 'today · live' : 'money made vs the same rupees in the index'}</span>
      </div>

      <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHovF(Math.max(0, Math.min(1, (px - PADL) / (W - PADL - PADR)))); }}
        onMouseLeave={() => setHovF(null)}>
        <defs>
          <linearGradient id="gv-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--acc)" stopOpacity=".18" />
            <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines + ₹ labels — the 0 baseline emphasised (the money-made datum) */}
        {grid.map((v) => (
          <g key={v}>
            <line x1={PADL} y1={Y(v)} x2={W - PADR} y2={Y(v)} stroke={v === 0 ? 'var(--txt3)' : 'var(--brd2)'} strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? '4 4' : 'none'} strokeOpacity={v === 0 ? 0.6 : 1} />
            <RsSvg x={4} y={Y(v) + 4} fontSize="15" fill="var(--txt3)" fontFamily="var(--mono)">{axLabel(v)}</RsSvg>
          </g>
        ))}
        {ownFill && <path d={ownFill} fill="url(#gv-fill)" />}
        {series.filter((s) => s.key !== 'own').map((s) => (
          <path key={s.key} d={toPath(s)} fill="none" stroke={s.color} strokeWidth="1.6" strokeDasharray="5 4" strokeOpacity=".85" strokeLinejoin="round" />
        ))}
        {own && <path d={toPath(own)} fill="none" stroke="var(--acc)" strokeWidth="2.6" strokeLinejoin="round" />}
        {own && <circle cx={X(own.pts[own.pts.length - 1].x)} cy={Y(endVal(own))} r="4" fill="var(--acc)" />}
        {/* hover cursor + per-series dots (the value card is the HTML overlay below) */}
        {hovPts && (
          <g>
            <line x1={hovX} y1={PADT} x2={hovX} y2={H - PADB} stroke="var(--txt3)" strokeWidth=".7" opacity=".5" />
            {hovPts.map((h) => <circle key={h.key} cx={X(h.x)} cy={Y(h.v)} r="3.5" fill={h.color} />)}
          </g>
        )}
        <text x={PADL} y={H - 5} fontSize="15" fill="var(--txt3)" fontFamily="var(--mono)">{xLabels[0]}</text>
        <text x={W - PADR} y={H - 5} fontSize="15" fill="var(--acc)" fontWeight="700" textAnchor="end" fontFamily="var(--mono)">{xLabels[1]}</text>
      </svg>

      {hovPts && (
        <div className="iq-tip" style={{ left: `${hovLeftPct}%`, transform: hovFlip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
          {hovPts.map((h) => (
            <div key={h.key} className="iq-r">
              <span className="iq-l" style={{ color: h.color, fontWeight: 600 }}>{h.label}</span>
              <span className="iq-v" style={{ color: dirCol(h.v) }}><span className="rs">₹</span>{crAbs(h.v).slice(1)}</span>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
