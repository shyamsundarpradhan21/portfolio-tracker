'use client';
// Shared intraday P&L line: green above 0 / red below, with a dashed reference
// line + dot at the CURRENT value. Used by the Trading tab's F&O Day view and the
// Indian tab's equity day-change curve. Axis labels derive from the SAME scaled
// points the line uses (single source — no raw/filtered desync). `pending` draws a
// faint marker only when the F&O API flagged an open order (equity passes false).
import { scaleIntraday } from '../../lib/pnlDaily';

export default function IntradayChart({ tape, pending = false, ariaLabel = 'Intraday P&L' }) {
  const W = 660, H = 200;
  const g = scaleIntraday(tape, W, H);
  if (!g) return null;
  const d = g.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const uid = `iq-${g.pts.length}-${Math.round(g.curY)}`;
  const curColor = g.ud ? 'var(--grn)' : 'var(--red)';
  const last = g.pts[g.pts.length - 1];
  const mid = g.pts[Math.floor(g.pts.length / 2)];
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" height="auto" style={{ marginTop: 12, display: 'block' }} role="img" aria-label={ariaLabel}>
      <clipPath id={`up-${uid}`}><rect x="0" y="0" width={W} height={g.zeroY} /></clipPath>
      <clipPath id={`dn-${uid}`}><rect x="0" y={g.zeroY} width={W} height={H - g.zeroY} /></clipPath>
      <line x1="0" y1={g.zeroY} x2={W} y2={g.zeroY} stroke="var(--txt3)" strokeWidth=".5" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke="var(--grn)" strokeWidth="2" clipPath={`url(#up-${uid})`} />
      <path d={d} fill="none" stroke="var(--red)" strokeWidth="2" clipPath={`url(#dn-${uid})`} />
      <line x1="0" y1={g.curY} x2={W} y2={g.curY} stroke={curColor} strokeWidth=".7" strokeDasharray="4 3" opacity=".55" />
      <circle cx={last.x} cy={g.curY} r="3.5" fill={curColor} />
      {pending ? <line x1="0" y1={g.zeroY - 0.1} x2={W} y2={g.zeroY - 0.1} stroke="var(--acc)" strokeWidth=".7" strokeDasharray="6 4" opacity=".5" /> : null}
      <text x="2" y={H + 16} className="pnl-axt">{g.pts[0].t}</text>
      <text x={W / 2} y={H + 16} className="pnl-axt" textAnchor="middle">{mid.t}</text>
      <text x={W - 2} y={H + 16} className="pnl-axt" textAnchor="end">{last.t}{pending ? ' · pending order' : ''}</text>
    </svg>
  );
}
