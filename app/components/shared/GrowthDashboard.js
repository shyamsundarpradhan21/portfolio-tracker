'use client';
// Wealth-growth dashboard (Overview). Fed by the daily growth:<date> snapshots — each
// holds every asset sleeve's day-change (eq/us/fd/mf/cmpf). We accumulate them into a
// cumulative gain curve (the wealth-building line, day by day) and a per-sleeve
// contribution breakdown. "Improvised fetching": it reads the resilient snapshot tier
// (/api/growth, KV + archive), NOT a live Yahoo poll — so it stands even on days no
// capture host ran. F&O is excluded (business income); CMPF renders LAST, in grey.
import { useState, useEffect } from 'react';
import GrowthCurve from './GrowthCurve';
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
// "2026-06-25" → "25 Jun"
const dayLabel = (d) => {
  const [, m, day] = d.split('-');
  const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${+day} ${MON[+m] || m}`;
};

export default function GrowthDashboard() {
  const [days, setDays] = useState(30);
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

  // Cumulative gain: running sum of each sleeve's day-change; net = sum of the sleeves.
  const cum = { eq: 0, us: 0, fd: 0, mf: 0, cmpf: 0 };
  const tape = dates.map((d) => {
    const rec = records[d];
    for (const s of SLEEVES) cum[s.key] = r2(cum[s.key] + (rec[s.key]?.net ?? 0));
    const net = r2(SLEEVES.reduce((a, s) => a + cum[s.key], 0));
    return { t: dayLabel(d), net };
  });
  const total = tape[tape.length - 1].net;
  // Per-sleeve final contribution (kept in house order — CMPF last).
  const breakdown = SLEEVES.map((s) => ({ ...s, val: cum[s.key] })).filter((s) => s.val !== 0);
  // ONE composite waffle: allocate N cells across the sleeves ∝ |contribution| (largest-remainder
  // so they sum to exactly N), coloured by sleeve in house order (CMPF hatched, last).
  const N = 50;
  const totalAbs = breakdown.reduce((a, s) => a + Math.abs(s.val), 0) || 1;
  const alloc = breakdown.map((s) => ({ ...s, raw: (Math.abs(s.val) / totalAbs) * N, n: 0 }));
  alloc.forEach((s) => { s.n = Math.floor(s.raw); });
  let used = alloc.reduce((a, s) => a + s.n, 0);
  alloc.map((s, i) => ({ i, frac: s.raw - Math.floor(s.raw) })).sort((a, b) => b.frac - a.frac)
    .forEach((r) => { if (used < N) { alloc[r.i].n += 1; used += 1; } });
  const cellColors = [];
  for (const s of alloc) for (let i = 0; i < s.n; i++) cellColors.push(s.key === 'cmpf' ? CMPF_HATCH : s.c);

  return (
    <div className="card">
      <div className="fxc" style={{ marginBottom: 8 }}>
        <div>
          <div className="ctitle">Wealth growth</div>
          <div className="sub" style={{ margin: '2px 0 0' }}>
            Cumulative daily accrual across sleeves · last {dates.length} day{dates.length > 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="lbl" style={{ margin: '0 0 2px' }}>cumulative</div>
          <div className={'vmd ' + cl(total)}><SInrF n={total} /></div>
        </div>
      </div>

      <div className="seg" role="tablist" aria-label="Window" style={{ marginBottom: 10 }}>
        {[['1D', 1], ['1W', 7], ['1M', 30], ['1Y', 365], ['Max', 'max']].map(([l, d]) => (
          <button key={d} type="button" role="tab" aria-selected={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{l}</button>
        ))}
      </div>

      {tape.length >= 2 ? (
        <GrowthCurve tape={tape} total={total} />
      ) : (
        <div className="sub" style={{ padding: '18px 0', textAlign: 'center', lineHeight: 1.6 }}>
          The growth curve draws once a few daily snapshots have accrued (one lands each
          night after the US close). Today's contribution is below.
        </div>
      )}

      {/* one composite waffle (sleeve mix ∝ contribution) + a colour-keyed legend with values */}
      <div style={{ marginTop: tape.length >= 2 ? 14 : 6, paddingTop: 12, borderTop: '.5px solid var(--brd2)',
        display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
