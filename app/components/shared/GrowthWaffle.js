'use client';
// Per-sleeve contribution waffle — folded into the projection card (was the bottom
// half of the standalone "Wealth growth" card). Reads the resilient daily growth:<date>
// snapshots (/api/growth, KV + archive), accumulates each investable sleeve's day-change
// over the window, and renders ONE composite waffle (N cells split ∝ |contribution| in
// house order, CMPF hatched + last) plus a colour-keyed legend. The growth CURVE and the
// cumulative headline it used to sit under were dropped in the consolidation — the
// projection card carries its own net-worth curve, so only the MIX moves here.
import { useState, useEffect } from 'react';
import { cl, SInrF } from '../../lib/fmt';
import { CMPF_HATCH } from '../../portfolio'; // CSS constant (not gated private data)

// Investable sleeves first, CMPF (pension) LAST in grey — house allocation rule.
const SLEEVES = [
  { key: 'eq', label: 'Indian Equity', c: '#7C9CF0' },
  { key: 'us', label: 'US Equity', c: '#5FC9B5' },
  { key: 'mf', label: 'Mutual Funds', c: '#C99BE8' },
  { key: 'fd', label: 'Fixed Deposits', c: '#E0A458' },
  { key: 'cmpf', label: 'CMPF (pension)', c: '#9AA0AA' },
];
const r2 = (n) => Math.round(n * 100) / 100;
const N = 50;

export default function GrowthWaffle({ days = 30 }) {
  const [records, setRecords] = useState(null);
  useEffect(() => {
    let on = true;
    fetch(`/api/growth?days=${days}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (on && j?.records) setRecords(j.records); })
      .catch(() => {});
    return () => { on = false; };
  }, [days]);

  if (!records) return null;
  const dates = Object.keys(records).sort();
  if (!dates.length) return null;

  // Cumulative contribution per sleeve over the window: running sum of each day-change.
  const cum = { eq: 0, us: 0, fd: 0, mf: 0, cmpf: 0 };
  for (const d of dates) { const rec = records[d]; for (const s of SLEEVES) cum[s.key] = r2(cum[s.key] + (rec[s.key]?.net ?? 0)); }
  // Per-sleeve final contribution (kept in house order — CMPF last), non-zero only.
  const breakdown = SLEEVES.map((s) => ({ ...s, val: cum[s.key] })).filter((s) => s.val !== 0);
  if (!breakdown.length) return null;
  // ONE composite waffle: allocate N cells across the sleeves ∝ |contribution| (largest-remainder
  // so they sum to exactly N), coloured by sleeve in house order (CMPF hatched, last).
  const totalAbs = breakdown.reduce((a, s) => a + Math.abs(s.val), 0) || 1;
  const alloc = breakdown.map((s) => ({ ...s, raw: (Math.abs(s.val) / totalAbs) * N, n: 0 }));
  alloc.forEach((s) => { s.n = Math.floor(s.raw); });
  let used = alloc.reduce((a, s) => a + s.n, 0);
  alloc.map((s, i) => ({ i, frac: s.raw - Math.floor(s.raw) })).sort((a, b) => b.frac - a.frac)
    .forEach((r) => { if (used < N) { alloc[r.i].n += 1; used += 1; } });
  const cellColors = [];
  for (const s of alloc) for (let i = 0; i < s.n; i++) cellColors.push(s.key === 'cmpf' ? CMPF_HATCH : s.c);

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '.5px solid var(--brd2)' }}>
      <div className="lbl" style={{ margin: '0 0 10px' }}>
        Contribution by sleeve · last {dates.length} day{dates.length > 1 ? 's' : ''}
      </div>
      {/* one composite waffle (sleeve mix ∝ contribution) + a colour-keyed legend with values */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, width: 168, flexShrink: 0 }} aria-hidden="true">
          {Array.from({ length: N }, (_, i) => (
            <span key={i} style={{ aspectRatio: '1', borderRadius: 2, background: cellColors[i] || 'var(--sur2)' }} />
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          {breakdown.map((s) => (
            <div key={s.key} className="fxc" style={{ padding: '5px 0' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--txt2)', fontSize: 'var(--fs-sm)' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.key === 'cmpf' ? CMPF_HATCH : s.c, flexShrink: 0 }} />
                {s.label}
              </span>
              <span className={'mono ' + cl(s.val)} style={{ fontWeight: 600 }}><SInrF n={s.val} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
