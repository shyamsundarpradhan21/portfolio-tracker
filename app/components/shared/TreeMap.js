'use client';

import { useState } from 'react';
import { InrC, Pct } from '../../lib/fmt';

// Squarified treemap (Bruls–Huizing–van Wijk) — hand-rolled, dependency-free.
// Tiles are %-positioned divs (not SVG) so text stays crisp and CSS theme
// variables apply directly. Tile fills are translucent tints of the segment
// color with a colored border, so the same markup works in day and night.

const worstRatio = (row, side) => {
  const s = row.reduce((a, b) => a + b, 0);
  let w = 0;
  for (const a of row) w = Math.max(w, Math.max((side * side * a) / (s * s), (s * s) / (side * side * a)));
  return w;
};

// areas must sum to w*h and arrive sorted descending.
function squarify(areas, x, y, w, h) {
  const rects = [];
  let i = 0;
  while (i < areas.length) {
    const horiz = w < h; // lay the strip along the shorter side
    const side = horiz ? w : h;
    let row = [areas[i]];
    let j = i + 1;
    while (j < areas.length) {
      const cand = [...row, areas[j]];
      if (worstRatio(cand, side) <= worstRatio(row, side)) { row = cand; j++; }
      else break;
    }
    const s = row.reduce((a, b) => a + b, 0);
    const thick = s / side;
    let off = 0;
    for (const a of row) {
      const len = a / thick;
      rects.push(horiz
        ? { x: x + off, y, w: len, h: thick }
        : { x, y: y + off, w: thick, h: len });
      off += len;
    }
    if (horiz) { y += thick; h -= thick; } else { x += thick; w -= thick; }
    i = j;
  }
  return rects;
}

// items: [{ label, val, color }] — color may be a CSS variable.
export default function TreeMap({ items, height = 228, aspect = 1.5 }) {
  const [hov, setHov] = useState(null);
  const live = items.filter((s) => s.val > 0).sort((a, b) => b.val - a.val);
  const total = live.reduce((s, x) => s + x.val, 0);
  if (!total) return <div className="sub">No data yet.</div>;

  const W = 100 * aspect, H = 100;
  const rects = squarify(live.map((s) => (s.val / total) * W * H), 0, 0, W, H);

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      {live.map((s, i) => {
        const r = rects[i];
        const frac = s.val / total;
        const pc = frac * 100;
        const dim = hov != null && hov !== s.label;
        return (
          <div key={s.label}
            style={{
              position: 'absolute', boxSizing: 'border-box', padding: 2,
              left: (r.x / W) * 100 + '%', top: (r.y / H) * 100 + '%',
              width: (r.w / W) * 100 + '%', height: (r.h / H) * 100 + '%',
            }}>
            <div
              title={`${s.label} · ${pc.toFixed(1)}% of book`}
              onMouseEnter={() => setHov(s.label)} onMouseLeave={() => setHov(null)}
              style={{
                width: '100%', height: '100%', borderRadius: 9, overflow: 'hidden',
                padding: '8px 10px', cursor: 'default',
                background: `color-mix(in srgb, ${s.color} ${hov === s.label ? 27 : 16}%, transparent)`,
                border: `.5px solid color-mix(in srgb, ${s.color} 45%, var(--brd))`,
                opacity: dim ? 0.45 : 1,
                transition: 'background .15s, opacity .15s',
              }}>
              {frac >= 0.05 && (
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: s.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.label}
                </div>
              )}
              {frac >= 0.14 && (
                <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)', marginTop: 4, whiteSpace: 'nowrap' }}>
                  <InrC n={s.val} />
                </div>
              )}
              {frac >= 0.05 && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--txt2)', marginTop: 2, whiteSpace: 'nowrap' }}>
                  <Pct n={pc} d={1} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
