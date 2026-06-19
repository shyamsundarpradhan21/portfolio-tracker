'use client';

// Reusable sector heatmap — translucent green/red tiles whose intensity scales
// with |%| (capped at a 1.5% move so the spread stays readable). Tiles flex-size
// by `weight`. Powers the India side (Nifty-50 sectors, aggregated) and the US
// side (11 SPDR sector ETFs). All live or honestly blank.

const pctTxt = (p) => (p == null || !isFinite(p) ? '—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '·'} ${Math.abs(p).toFixed(2)}%`);
const pctCls = (p) => (p == null ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');
function tileBg(pct) {
  if (pct == null || !isFinite(pct)) return 'var(--sur2)';
  const mag = Math.min(1, Math.abs(pct) / 1.5);
  const op = (12 + mag * 50).toFixed(0);
  const col = pct > 0 ? 'var(--grn)' : pct < 0 ? 'var(--red)' : 'var(--txt3)';
  return `color-mix(in srgb, ${col} ${op}%, transparent)`;
}

export default function SectorHeatmap({ title = 'Sector heatmap', sub, sectors = [], loading }) {
  return (
    <div className="card sec">
      <div className="ctitle" style={{ marginBottom: 12 }}>
        {title}
        {sectors.length && sub ? <span className="sub" style={{ textTransform: 'none' }}> — {sub}</span> : null}
      </div>
      {loading && !sectors.length ? (
        <div className="sub">Loading sectors…</div>
      ) : sectors.length ? (
        <div className="no-sectors">
          {sectors.map((s) => (
            <div className="no-sector" key={s.name} style={{ background: tileBg(s.pct), flexGrow: s.weight || 1 }} title={`${s.name} · ${s.meta} · ${pctTxt(s.pct)}`}>
              <span className="no-sector-name">{s.name}</span>
              <span className={'no-sector-pct mono ' + pctCls(s.pct)}>{pctTxt(s.pct)}</span>
              <span className="no-sector-n">{s.meta}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mac-stale">Sector data unavailable — feed not reachable this run.</div>
      )}
    </div>
  );
}
