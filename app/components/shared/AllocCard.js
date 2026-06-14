'use client';

import SunburstMix from '../SunburstMix';

// Live allocation sunburst — sits left of the Net worth · growth card.
// Outer ring: asset-wise sleeves (the same live values the net worth uses).
// Inner ring: class mix — Equity / Hedged (arbitrage MF) / Debt (FD + CMPF).
// When the projection is being scrubbed, `drift` carries the drifted sleeve
// values for that year and the card follows the timeline.
// Everything arrives computed from page.js; nothing here is typed in.
export default function AllocCard({ sleeves, mfAlloc, dataReady = true, drift = null }) {
  const live = sleeves;
  const view = drift
    ? sleeves.map((s) => ({ ...s, value: drift.out[s.key] || 0 }))
    : sleeves;
  const total = view.reduce((s, x) => s + (x.value || 0), 0);
  const sectors = view
    .filter((s) => (s.value || 0) > 0)
    .map((s) => ({ label: s.label, val: s.value, pct: total ? (s.value / total) * 100 : 0, color: s.color }));

  // Exhaustive class partition: hedged = arbitrage MF (market-neutral),
  // debt = FD ladder + CMPF (fixed-income-like), equity = everything else.
  // Under drift the arbitrage share scales with the MF sleeve.
  const byKey = Object.fromEntries(view.map((s) => [s.key, s.value || 0]));
  const liveMf = live.find((s) => s.key === 'mf')?.value || 0;
  const arbShare = liveMf > 0 ? Math.min(1, (mfAlloc?.arbitrage || 0) / liveMf) : 0;
  const hedged = (byKey.mf || 0) * arbShare;
  const debt = (byKey.fd || 0) + (byKey.pf || 0);
  const equity = Math.max(0, total - debt - hedged);
  const caps = [
    { label: 'Equity', val: equity },
    { label: 'Hedged', val: hedged },
    { label: 'Debt',   val: debt },
  ].map((c) => ({ ...c, pct: total ? (c.val / total) * 100 : 0 }));

  return (
    <div className="card sec" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="fxc" style={{ alignItems: 'baseline' }}>
        <div className="lbl" style={{ margin: 0 }}>{drift ? `Allocation → ${drift.year}` : 'Allocation · live'}</div>
        {!dataReady && (
          <span style={{ fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', color: 'var(--gld)' }}>
            ⚠ pricing incomplete
          </span>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', marginTop: 10 }}>
        <SunburstMix
          sectors={sectors}
          caps={caps}
          total={total}
          secColors={sectors.map((s) => s.color)}
          capColor={{ Equity: 'var(--blu)', Hedged: 'var(--pur)', Debt: 'var(--gld)' }}
          innerTitle="Class" innerSuffix=""
        />
      </div>
    </div>
  );
}
