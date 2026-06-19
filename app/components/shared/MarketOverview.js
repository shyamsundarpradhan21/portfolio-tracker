'use client';

// Reusable market-overview card — support/resistance pivots for a market's indices
// + an optional movers list. Drives both columns of the Pre-Market tab: India
// (Nifty/Sensex pivots + Nifty-50 movers) and US (S&P/Nasdaq pivots, no movers).
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

// Pivot ladder for one index — resistances above, pivot, supports below.
function PivotLadder({ lv, label }) {
  if (!lv || lv.stale) {
    return (
      <div className="no-pivot">
        <div className="no-pivot-head">{label}</div>
        <div className="mac-stale">Levels unavailable{lv?.error ? ` — ${lv.error}` : ''}</div>
      </div>
    );
  }
  const rows = [
    { k: 'R3', v: lv.r3, t: 'res' }, { k: 'R2', v: lv.r2, t: 'res' }, { k: 'R1', v: lv.r1, t: 'res' },
    { k: 'PP', v: lv.pp, t: 'pp' },
    { k: 'S1', v: lv.s1, t: 'sup' }, { k: 'S2', v: lv.s2, t: 'sup' }, { k: 'S3', v: lv.s3, t: 'sup' },
  ];
  return (
    <div className="no-pivot">
      <div className="no-pivot-head">
        {label}
        <span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>prev close {n0(lv.prevClose)} · {lv.asOf}</span>
      </div>
      <div className="no-ladder">
        {rows.map((r) => (
          <div className={'no-rung no-' + r.t} key={r.k}>
            <span className="no-rung-k">{r.k}</span>
            <span className="no-rung-v mono">{n0(r.v)}</span>
          </div>
        ))}
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

export default function MarketOverview({ title, sub, pivots = [], movers, note }) {
  return (
    <div className="card sec">
      <div className="ctitle" style={{ marginBottom: 12 }}>
        {title}
        {sub ? <span className="sub" style={{ textTransform: 'none' }}> {sub}</span> : null}
      </div>
      <div className="no-pivots">
        {pivots.map((p) => <PivotLadder key={p.label} lv={p.lv} label={p.label} />)}
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
