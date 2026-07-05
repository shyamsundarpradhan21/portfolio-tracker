'use client';
// FD maturity ladder (shell-6region Phase 4 widget) — FD has no native second visual, so
// this synthesises one: each active FD is a bar on a SHARED time axis (earliest open →
// latest maturity), positioned by its open→maturity dates and filled by elapsed progress,
// with a "today" rule across all rows. That shared axis is the point — it shows the
// quarterly LADDERING (staggered maturities) a per-row progress bar can't. All dates/values
// derive from the FD rows (no hardcoded dates); colours are theme tokens (FD accent = gold).
import { InrC, fmtNavDate } from '../../lib/fmt';

export default function FdMaturity({ fds, now = new Date() }) {
  const rows = [...(fds?.rows || [])]
    .filter((f) => f.open && f.matures)
    .sort((a, b) => new Date(a.matures) - new Date(b.matures));
  if (!rows.length) return null;

  const nowT = now.getTime();
  const opens = rows.map((f) => new Date(f.open).getTime());
  const mats = rows.map((f) => new Date(f.matures).getTime());
  const t0 = Math.min(nowT, ...opens);
  const t1 = Math.max(...mats);
  const span = Math.max(1, t1 - t0);
  const pos = (t) => ((t - t0) / span) * 100;

  // Calendar-year gridlines derived from the window (not hardcoded).
  const ticks = [];
  for (let y = new Date(t0).getFullYear() + 1; y <= new Date(t1).getFullYear(); y++) {
    const tt = Date.UTC(y, 0, 1);
    if (tt > t0 && tt < t1) ticks.push({ y, pct: pos(tt) });
  }

  return (
    <div className="card fdmat">
      <div className="ctitle" style={{ marginBottom: 14 }}>Maturity Ladder</div>
      <div className="fdmat-track">
        {ticks.map((tk) => (
          <span key={tk.y} className="fdmat-grid" style={{ left: tk.pct + '%' }}><i>{tk.y}</i></span>
        ))}
        <span className="fdmat-now" style={{ left: pos(nowT) + '%' }}><i>today</i></span>
        {rows.map((f) => {
          const L = pos(new Date(f.open).getTime());
          const W = Math.max(1.5, pos(new Date(f.matures).getTime()) - L);
          return (
            <div className="fdmat-row" key={f.bank + f.label}>
              <div className="fdmat-head">
                <span className="fdmat-name">{f.bank} · {f.label}</span>
                <span className="fdmat-when">{fmtNavDate(f.matures)} · <InrC n={f.maturityValue} /></span>
              </div>
              <div className="fdmat-lane">
                <span className="fdmat-bar" style={{ left: L + '%', width: W + '%' }}>
                  <span className="fdmat-fill" style={{ width: Math.min(100, Math.max(0, f.progress || 0)) + '%' }} />
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sub" style={{ marginTop: 12, lineHeight: 1.6 }}>
        Each bar spans open → maturity; the fill is elapsed term. The vertical rule is today —
        maturities are laddered quarterly so reinvestment risk stays spread.
      </div>
    </div>
  );
}
