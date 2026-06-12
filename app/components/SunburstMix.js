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

export default function SunburstMix({ sectors, caps, total, secColors, capColor, currency = 'inr', othersColor = 'var(--txt3)', innerTitle = 'Cap', innerSuffix = ' cap' }) {
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

  // Split long labels near midpoint on a space
  const splitLabel = (s) => {
    if (s.length <= 18) return [s];
    const mid = Math.floor(s.length / 2);
    let sp = s.lastIndexOf(' ', mid);
    if (sp < 4) sp = s.indexOf(' ', mid);
    return sp > 0 ? [s.slice(0, sp), s.slice(sp + 1)] : [s];
  };

  // Separate currency symbol: it renders in the body font (the mono face has
  // no ₹ glyph) scaled 1.1× to match the mono digits' cap height — same
  // treatment as the global .rs class.
  // Centre is EMPTY at rest — a resting total would read as "deployed" when
  // the ring values are live present values; it only speaks on hover.
  const amtStr = hov ? fmtAmt(hov.val) : '';
  const cm = /^([₹$])(.*)$/.exec(amtStr);
  const symC = cm ? cm[1] : '';
  const numC = cm ? cm[2] : amtStr;

  const lines = hov ? splitLabel(hov.label) : null;
  const twoLine = lines && lines.length === 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg viewBox={`0 0 ${W} ${W}`} style={{ width: '100%', maxWidth: 500, height: 'auto', overflow: 'visible' }}>
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
          return (
            <path key={key} d={arc(cx, cy, 50, 78, c.a0, c.a1)} fill={c.color} fillOpacity={op(key, 0.7)}
              style={{ transition: 'fill-opacity .15s', cursor: 'pointer' }}
              onMouseEnter={() => setHov({ key, label: c.label + innerSuffix, val: c.val, pct: c.pct, color: c.color })}
              onMouseLeave={() => setHov(null)} />
          );
        })}
        {/* centre readout — hover only */}
        {hov && (
          <>
            <text x={cx} y={twoLine ? cy - 14 : cy - 3} textAnchor="middle" style={{ fill: 'var(--txt)' }}>
              {symC ? <tspan fontFamily="var(--body)" fontSize="25">{symC}</tspan> : null}
              <tspan fontFamily="var(--mono)" fontSize="23">{numC}</tspan>
            </text>
            <text x={cx} y={twoLine ? cy + 4 : cy + 14} textAnchor="middle"
              style={{ fontSize: 9, letterSpacing: '0.8px', textTransform: 'uppercase', fill: hov.color, fontWeight: 700 }}>
              {lines[0]}
            </text>
            {twoLine && (
              <text x={cx} y={cy + 14} textAnchor="middle"
                style={{ fontSize: 9, letterSpacing: '0.8px', textTransform: 'uppercase', fill: hov.color, fontWeight: 700 }}>
                {lines[1]}
              </text>
            )}
            <text x={cx} y={twoLine ? cy + 25 : cy + 24} textAnchor="middle"
              style={{ fontSize: 9, letterSpacing: '0.8px', fill: hov.color, fontWeight: 700, fontFamily: 'var(--mono)' }}>
              {hov.pct.toFixed(0)}%
            </text>
          </>
        )}
      </svg>

      {/* sector legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', marginTop: 14 }}>
        {secArcs.map((s) => (
          <span key={s.label}
            onMouseEnter={() => setHov({ key: 's:' + s.label, label: s.label, val: s.val, pct: s.pct, color: s.color })}
            onMouseLeave={() => setHov(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--txt2)', cursor: 'default', opacity: hov && hov.key !== 's:' + s.label ? 0.4 : 1, transition: 'opacity .15s' }}>
            <span style={{ width: '0.6em', height: '0.6em', borderRadius: 2, background: s.color, flex: '0 0 auto' }} />{s.label} {s.pct.toFixed(0)}%
          </span>
        ))}
      </div>
      {/* cap-mix line */}
      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', marginTop: 9, letterSpacing: '0.3px' }}>
        {innerTitle}&nbsp;&nbsp;{capList.map((c) => `${c.label} ${c.pct.toFixed(0)}%`).join('  ·  ')}
      </div>
    </div>
  );
}
