'use client';
import { inrCd, Pct } from '../../lib/fmt';

export default function Donut({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 180, thick = 26, r = (size - thick) / 2, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, flex: 1, justifyContent: 'center' }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: 220, height: 'auto', flexShrink: 0 }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--sur2)" strokeWidth={thick} />
        <g transform={`rotate(-90 ${size/2} ${size/2})`}>
          {segments.map((seg) => {
            const frac = total ? seg.value / total : 0;
            const dash = frac * C;
            const el = (
              <circle key={seg.label} cx={size/2} cy={size/2} r={r} fill="none"
                stroke={seg.color} strokeWidth={thick}
                strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc}>
                <title>{`${seg.label}: ₹${(seg.value/1e5).toFixed(2)}L (${(frac*100).toFixed(1)}%)`}</title>
              </circle>
            );
            acc += dash;
            return el;
          })}
        </g>
        <text x={size/2} y={size/2 - 6} textAnchor="middle" fill="var(--txt3)"
          fontSize="10" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>assets</text>
        <text x={size/2} y={size/2 + 16} textAnchor="middle" fill="var(--txt)"
          fontSize="19" fontWeight="700" fontFamily="var(--mono)"><tspan fontSize="14">₹</tspan>{inrCd(total)}</text>
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', width: '100%' }}>
        {segments.map((seg) => (
          <div key={seg.label} className="fxc" style={{ gap: 6 }} title={`₹${(seg.value/1e5).toFixed(2)}L`}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--txt2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {seg.label}
              </span>
            </span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--txt)' }}>
              <Pct n={total ? (seg.value / total) * 100 : 0} d={1} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
