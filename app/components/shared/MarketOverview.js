'use client';

// Reusable market-overview card — how each index did this session (close, day
// change, range) + an optional movers list. Drives both columns of the Wrap tab:
// India (Nifty/Sensex close + Nifty-50 movers) and US (S&P/Nasdaq close, no movers).
// The sector heatmap is a sibling card (see SectorHeatmap). All live or honestly blank.

const n0 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const pctTxt = (p) => (p == null || !isFinite(p) ? '—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '·'} ${Math.abs(p).toFixed(2)}%`);
const pctCls = (p) => (p == null ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');

// Aggregate index constituents (e.g. Nifty 50) into sector tiles for SectorHeatmap:
// average % move + member count, strongest sector first; tiles flex-size by count.
export function aggregateSectors(stocks) {
  const by = {};
  (stocks || []).forEach((s) => {
    if (s.pct == null || !isFinite(s.pct)) return;
    (by[s.sector] ||= { sum: 0, n: 0 }).sum += s.pct;
    by[s.sector].n += 1;
  });
  return Object.entries(by)
    .map(([sector, g]) => ({ name: sector, pct: g.sum / g.n, meta: `${g.n} stocks`, weight: g.n }))
    .sort((a, b) => b.pct - a.pct);
}

// Today's performance for one index — close, day change %, points, and day range.
function SessionStat({ s, label }) {
  if (!s || s.stale) {
    return (
      <div className="no-pivot">
        <div className="no-pivot-head">{label}</div>
        <div className="mac-stale">Session data unavailable{s?.error ? ` — ${s.error}` : ''}</div>
      </div>
    );
  }
  const pts = s.change == null || !isFinite(s.change)
    ? null
    : (s.change > 0 ? '+' : s.change < 0 ? '−' : '') + n0(Math.abs(s.change));
  return (
    <div className="no-pivot">
      <div className="no-pivot-head">
        {label}
        <span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>at close · {s.asOf}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 7 }}>
        <span className="mono" style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, letterSpacing: '-.5px' }}>{n0(s.close)}</span>
        <span className={'mono ' + pctCls(s.pct)} style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{pctTxt(s.pct)}</span>
      </div>
      <div className="sub" style={{ marginTop: 5 }}>
        {pts != null && <span className={pctCls(s.pct)} style={{ fontWeight: 600 }}>{pts} pts</span>}
        {pts != null && <span className="mut"> · </span>}
        <span className="mut">day range </span>
        <span className="mono">{n0(s.low)}–{n0(s.high)}</span>
      </div>
    </div>
  );
}

function MoverList({ title, rows, accent }) {
  return (
    <div className="no-movers">
      <div className="pm-group-lbl" style={{ color: accent }}>{title}</div>
      {rows && rows.length ? rows.map((s) => (
        <div className="no-mover" key={s.sym}>
          <span className="no-mover-name">{s.name}</span>
          <span className={'no-mover-pct mono ' + pctCls(s.pct)}>{pctTxt(s.pct)}</span>
        </div>
      )) : <div className="sub">n/a</div>}
    </div>
  );
}

export default function MarketOverview({ title, sub, sessions = [], movers, note }) {
  return (
    <div className="card sec">
      <div className="ctitle" style={{ marginBottom: 12 }}>
        {title}
        {sub ? <span className="sub" style={{ textTransform: 'none' }}> {sub}</span> : null}
      </div>
      <div className="no-pivots">
        {sessions.map((p) => <SessionStat key={p.label} s={p.s} label={p.label} />)}
      </div>
      {movers && (
        <div className="no-movers-wrap">
          <MoverList title="Most profitable" rows={movers.gainers} accent="var(--grn)" />
          <MoverList title="Most unprofitable" rows={movers.losers} accent="var(--red)" />
        </div>
      )}
      {note ? <div className="sub" style={{ marginTop: 12, lineHeight: 1.6 }}>{note}</div> : null}
    </div>
  );
}
