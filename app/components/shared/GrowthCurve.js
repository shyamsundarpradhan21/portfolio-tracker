// Wealth-growth curve in the net-worth-card (ProjectionTab/.pjx) style: a filled AREA
// chart of the cumulative accrual with y-gridlines, a smooth accent line and an
// endpoint "now · ₹X" marker — so the growth card reads like the net-worth growth card.
// Pure SVG render (no hooks); mirrors ProjectionTab's helpers (niceScale/smoothPath/RsSvg).

// gridline-friendly rounding (mirrors ProjectionTab.niceNum/niceScale)
const niceNum = (x, round) => {
  if (!(x > 0)) return 1;
  const e = Math.floor(Math.log10(x)); const f = x / 10 ** e;
  const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** e;
};
const niceScale = (lo, hi, ticks = 4) => {
  if (!(hi > lo)) hi = lo + Math.max(1, Math.abs(lo) * 0.02);
  const step = niceNum((hi - lo) / Math.max(1, ticks - 1), true);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
};
const axLabel = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + +(a / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) { const l = a / 1e5; return '₹' + (Number.isInteger(l) ? l : +l.toFixed(1)) + 'L'; }
  if (a >= 1e3) return '₹' + Math.round(a / 1e3) + 'k';
  return '₹' + Math.round(a);
};
const cr = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (a / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return '₹' + (a / 1e5).toFixed(2) + 'L';
  return '₹' + Math.round(a).toLocaleString('en-IN');
};
// Catmull-Rom → cubic Bézier: a smooth line through every point (mirrors ProjectionTab).
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return 'M' + pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L');
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}
// ₹ in an SVG <text>: the rupee glyph lives in the body font, not the mono face.
const RsSvg = ({ x, y, children, ...rest }) => {
  const parts = String(children).split('₹');
  return <text x={x} y={y} {...rest}>{parts.map((p, i) => <tspan key={i}>{i > 0 && <tspan fontFamily="var(--body)" fontSize="1.05em">₹</tspan>}{p}</tspan>)}</text>;
};

export default function GrowthCurve({ tape, total }) {
  const data = (tape || []).filter((p) => p && Number.isFinite(+p.net));
  if (data.length < 2) return null;
  const W = 1000, H = 300, PADL = 8, PADR = 10, PADT = 26, PADB = 22;
  const vals = data.map((p) => +p.net);
  const { lo, hi, step } = niceScale(Math.min(0, ...vals), Math.max(...vals, 1), 4);
  const Y = (v) => PADT + (hi - v) / (hi - lo) * (H - PADT - PADB);
  const X = (i) => PADL + (i / (data.length - 1)) * (W - PADL - PADR);
  const pts = data.map((p, i) => ({ x: X(i), y: Y(+p.net) }));
  const line = smoothPath(pts);
  const baseY = Y(Math.max(lo, 0));   // fill down to the zero baseline (or the axis floor)
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${baseY.toFixed(1)} L${pts[0].x.toFixed(1)},${baseY.toFixed(1)} Z`;
  const grid = []; for (let v = lo; v <= hi + step / 2; v += step) grid.push(v);
  const last = pts[pts.length - 1];
  const labelY = Math.max(PADT - 4, Math.min(H - PADB - 6, last.y - 14));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', marginTop: 6 }} role="img" aria-label="Wealth growth curve">
      <defs>
        <linearGradient id="gc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--acc)" stopOpacity=".22" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* y grid + ₹ labels */}
      {grid.map((v) => (
        <g key={v}>
          <line x1={PADL} y1={Y(v)} x2={W - PADR} y2={Y(v)} stroke="var(--brd2)" strokeWidth=".5" />
          <RsSvg x={4} y={Y(v) + 3} fontSize="15" fill="var(--txt3)" fontFamily="var(--mono)">{axLabel(v)}</RsSvg>
        </g>
      ))}
      {/* area + line */}
      <path d={area} fill="url(#gc-fill)" />
      <path d={line} fill="none" stroke="var(--acc)" strokeWidth="2.2" strokeLinejoin="round" />
      {/* endpoint marker + "now · ₹X" */}
      <circle cx={last.x} cy={last.y} r="9" fill="none" stroke="var(--acc)" strokeOpacity=".35" strokeWidth="2" />
      <circle cx={last.x} cy={last.y} r="4.5" fill="var(--acc)" />
      <RsSvg x={last.x - 8} y={labelY} fontSize="14.5" fill="var(--acc)" fontWeight="700" fontFamily="var(--mono)" textAnchor="end">{`now · ${cr(total)}`}</RsSvg>
      {/* x-axis endpoints */}
      <text x={PADL} y={H - 5} fontSize="13" fill="var(--txt3)" fontFamily="var(--mono)">{data[0].t}</text>
      <text x={W - PADR} y={H - 5} fontSize="13" fill="var(--txt3)" fontFamily="var(--mono)" textAnchor="end">{data[data.length - 1].t}</text>
    </svg>
  );
}
