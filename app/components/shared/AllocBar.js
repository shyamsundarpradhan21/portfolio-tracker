'use client';
import { useState } from 'react';

// Live allocation as a horizontal stacked bar + dot legend, in the header of the
// Net worth · growth card (replaces the old sunburst donut). CMPF (the pension `pf`
// sleeve) always sits LAST / right-most in its grey/black hatch — it's the pension
// pool, segregated from the investable book. Hovering a segment brightens it and
// dims the rest (like the old sunburst). Drifts with the projection scrubber via
// `drift`. Everything is computed from props; nothing is typed in.
export default function AllocBar({ sleeves, mfAlloc, drift = null }) {
  const [hov, setHov] = useState(null);
  const live = sleeves;
  const view = drift ? sleeves.map((s) => ({ ...s, value: drift.out[s.key] || 0 })) : sleeves;
  const total = view.reduce((s, x) => s + (x.value || 0), 0);

  // CMPF (pf) forced last so it reads right-most in both the bar and the legend.
  const sectors = view
    .filter((s) => (s.value || 0) > 0)
    .map((s) => ({ key: s.key, label: s.label, pct: total ? (s.value / total) * 100 : 0, color: s.color }))
    .sort((a, b) => (a.key === 'pf') - (b.key === 'pf'));

  // Class partition (same split the old sunburst inner ring used): hedged =
  // arbitrage MF, debt = FD + CMPF, equity = the rest. Under drift the arbitrage
  // share scales with the MF sleeve.
  const byKey = Object.fromEntries(view.map((s) => [s.key, s.value || 0]));
  const liveMf = live.find((s) => s.key === 'mf')?.value || 0;
  const arbShare = liveMf > 0 ? Math.min(1, (mfAlloc?.arbitrage || 0) / liveMf) : 0;
  const hedged = (byKey.mf || 0) * arbShare;
  const debt = (byKey.fd || 0) + (byKey.pf || 0);
  const trading = byKey.trading || 0;   // F&O business equity — its OWN class; personal Equity/Debt stay pure
  const equity = Math.max(0, total - debt - hedged - trading);
  const cls = [
    { label: 'Equity', val: equity }, { label: 'Hedged', val: hedged }, { label: 'Debt', val: debt }, { label: 'Trading', val: trading },
  ].filter((c) => c.val > 0).map((c) => `${c.label} ${total ? Math.round((c.val / total) * 100) : 0}%`);

  return (
    <div className="alloc-bar">
      <div className="alloc-bar-lbl">{drift ? `Allocation → ${drift.year}` : 'Allocation · live'}</div>
      <div className="alloc-bar-track" onMouseLeave={() => setHov(null)}>
        {sectors.map((s) => (
          <div key={s.key} style={{ flex: s.pct, background: s.color, opacity: hov && hov !== s.key ? 0.35 : 1, transition: 'opacity .15s', cursor: 'pointer' }} title={`${s.label} ${s.pct.toFixed(0)}%`} onMouseEnter={() => setHov(s.key)} />
        ))}
      </div>
      <div className="alloc-bar-leg" onMouseLeave={() => setHov(null)}>
        {sectors.map((s) => (
          <span key={s.key} style={{ opacity: hov && hov !== s.key ? 0.35 : 1, transition: 'opacity .15s', cursor: 'pointer' }} onMouseEnter={() => setHov(s.key)}><i style={{ background: s.color }} />{s.label} {s.pct.toFixed(0)}%</span>
        ))}
      </div>
      {cls.length > 0 && <div className="alloc-bar-cls">Class · {cls.join(' · ')}</div>}
    </div>
  );
}
