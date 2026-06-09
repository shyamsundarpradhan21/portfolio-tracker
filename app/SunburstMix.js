'use client';

import { useState } from 'react';

// Dual-ring sunburst for the Sector & Cap Mix card. Outer ring = sectors,
// inner ring = cap mix, both proportional by live value. The centre shows total
// deployed and swaps to the hovered slice's name · weight · value; siblings dim.
// Hand-rolled SVG arcs (no D3) so it stays dependency-free and on-theme.

const fmtFor = (currency) => (n) => {
  if (n == null) return '—';
  if (currency === 'usd') return n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : '$' + Math.round(n);
  return n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + 'L' : '₹' + (n / 1e3).toFixed(1) + 'K';
};

// Arc wedge between two radii; angles in radians, 0 at top, clockwise.
function arc(cx, cy, rIn, rOut, a0, a1) {
  const pt = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [xo0, yo0] = pt(rOut, a0), [xo1, yo1] = pt(rOut, a1);
  const [xi1, yi1] = pt(rIn, a1), [xi0, yi0] = pt(rIn, a0);
  return `M${xo0},${yo0}A${rOut},${rOut} 0 ${large} 1 ${xo1},${yo1}` +
         `L${xi1},${yi1}A${rIn},${rIn} 0 ${large} 0 ${xi0},${yi0}Z`;
}

// Lay items out around the circle by value fraction, with a small gap (pad).
function ring(items, total, pad) {
  const span = Math.PI * 2;
  let a = 0;
  return items.map((it) => {
    const frac = total ? it.val / total : 0;
    const seg = { ...it, a0: a + pad / 2, a1: a + frac * span - pad / 2, mid: a + (frac * span) / 2 };
    if (seg.a1 < seg.a0) seg.a1 = seg.a0; // guard razor-thin slices
    a += frac * span;
    return seg;
  });
}

export default function SunburstMix({ sectors, caps, total, secColors, capColor, currency = 'inr', othersColor = 'var(--txt3)' }) {
  const [hov, setHov] = useState(null);
  const W = 260, cx = 130, cy = 130;
  const fmtAmt = fmtFor(currency);

  const secVal = sectors.reduce((s, x) => s + (x.val || 0), 0);
  const T = total || secVal;
  const secArcs = ring(sectors.map((s, i) => ({ ...s, color: s.other ? othersColor : secColors[i % secColors.length] })), T, 0.02);
  const capList = caps.filter((c) => c.val > 0);
  const capTot = capList.reduce((s, c) => s + c.val, 0);
  const capArcs = ring(capList.map((c) => ({ ...c, color: capColor[c.label] || 'var(--txt2)' })), capTot, 0.03);

  const op = (key, base) => (hov && hov.key !== key ? 0.16 : base);
  const lp = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg viewBox={`0 0 ${W} ${W}`} style={{ width: '100%', maxWidth: 300, height: 'auto', overflow: 'visible' }}>
        {/* outer ring — sectors */}
        {secArcs.map((s) => {
          const key = 's:' + s.label;
          return (
            <path key={key} d={arc(cx, cy, 86, 120, s.a0, s.a1)} fill={s.color} fillOpacity={op(key, 0.92)}
              style={{ transition: 'fill-opacity .15s', cursor: 'pointer' }}
              onMouseEnter={() => setHov({ key, label: s.label, val: s.val, pct: s.pct, color: s.color })}
              onMouseLeave={() => setHov(null)} />
          );
        })}
        {/* inner ring — cap mix */}
        {capArcs.map((c) => {
          const key = 'c:' + c.label;
          const [lx, ly] = lp(64, c.mid);
          return (
            <g key={key}>
              <path d={arc(cx, cy, 50, 78, c.a0, c.a1)} fill={c.color} fillOpacity={op(key, 0.7)}
                style={{ transition: 'fill-opacity .15s', cursor: 'pointer' }}
                onMouseEnter={() => setHov({ key, label: c.label + ' cap', val: c.val, pct: c.pct, color: c.color })}
                onMouseLeave={() => setHov(null)} />
              {c.pct >= 9 && (!hov || hov.key === key) ? (
                <text x={lx} y={ly + 3.5} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0A0C10" style={{ pointerEvents: 'none' }}>{c.label[0]}</text>
              ) : null}
            </g>
          );
        })}
        {/* centre readout */}
        <text x={cx} y={cy - 3} textAnchor="middle" style={{ fontFamily: 'var(--title)', fontSize: 23, fill: 'var(--txt)' }}>
          {fmtAmt(hov ? hov.val : T)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle"
          style={{ fontSize: 9, letterSpacing: '0.8px', textTransform: 'uppercase', fill: hov ? hov.color : 'var(--txt3)', fontWeight: 700 }}>
          {hov ? `${hov.label} · ${hov.pct.toFixed(0)}%` : 'Deployed'}
        </text>
      </svg>

      {/* sector legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px', justifyContent: 'center', marginTop: 13 }}>
        {secArcs.map((s) => (
          <span key={s.label}
            onMouseEnter={() => setHov({ key: 's:' + s.label, label: s.label, val: s.val, pct: s.pct, color: s.color })}
            onMouseLeave={() => setHov(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--txt2)', cursor: 'default', opacity: hov && hov.key !== 's:' + s.label ? 0.4 : 1, transition: 'opacity .15s' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flex: '0 0 auto' }} />{s.label} {s.pct.toFixed(0)}%
          </span>
        ))}
      </div>
      {/* cap-mix line */}
      <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 8, letterSpacing: '0.3px' }}>
        Cap&nbsp;&nbsp;{capList.map((c) => `${c.label} ${c.pct.toFixed(0)}%`).join('  ·  ')}
      </div>
    </div>
  );
}
