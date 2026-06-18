'use client';

// Nifty & Sensex overview + Nifty 50 heatmap for Pre-Market Insights.
//  - Support/resistance: classic pivot levels (computed server-side from the
//    prior session OHLC) laddered around the previous close.
//  - Movers: the most profitable / unprofitable Nifty 50 names.
//  - Heatmap: every constituent as a colour-coded tile (green up / red down,
//    intensity by magnitude) — Dhan's at-a-glance market snapshot.
// All live or honestly blank; nothing here is fabricated.

const n0 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const pctTxt = (p) => (p == null || !isFinite(p) ? '—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '·'} ${Math.abs(p).toFixed(2)}%`);
const pctCls = (p) => (p == null ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');

// Pivot ladder for one index — resistances above, pivot, supports below, with
// the prior close marked where it sits. Levels are deterministic, not a call.
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

// Tile fill: translucent green/red whose opacity scales with |pct| (capped at a
// 3% move so a single outlier doesn't wash out the board).
function tileBg(pct) {
  if (pct == null || !isFinite(pct)) return 'var(--sur2)';
  const mag = Math.min(1, Math.abs(pct) / 3);
  const op = (12 + mag * 46).toFixed(0);
  const col = pct > 0 ? 'var(--grn)' : pct < 0 ? 'var(--red)' : 'var(--txt3)';
  return `color-mix(in srgb, ${col} ${op}%, transparent)`;
}

export default function NiftyOverview({ premarket, nifty50, loading }) {
  const levels = premarket?.levels;
  const stocks = nifty50?.stocks || [];
  const movers = nifty50?.movers;
  // Heatmap reads top-to-bottom strongest gain → deepest loss.
  const sorted = [...stocks].sort((a, b) => (b.pct ?? -Infinity) - (a.pct ?? -Infinity));

  return (
    <>
      {/* ── Nifty & Sensex overview — pivots + movers + F&O note ─────────── */}
      <div className="card sec">
        <div className="ctitle" style={{ marginBottom: 12 }}>
          Nifty &amp; Sensex overview
          <span className="sub" style={{ textTransform: 'none' }}>— support / resistance &amp; the day’s movers</span>
        </div>
        <div className="no-pivots">
          <PivotLadder lv={levels?.nifty} label="Nifty 50" />
          <PivotLadder lv={levels?.sensex} label="Sensex" />
        </div>
        <div className="no-movers-wrap">
          <MoverList title="Most profitable" rows={movers?.gainers} accent="var(--grn)" />
          <MoverList title="Most unprofitable" rows={movers?.losers} accent="var(--red)" />
        </div>
        <div className="sub" style={{ marginTop: 12, lineHeight: 1.6 }}>
          Support/resistance are classic pivot levels computed from the prior session’s high/low/close — deterministic, not a forecast.
          F&amp;O insights (OI, PCR, max-pain) aren’t wired — no reliable <em>free</em> options-chain feed.
        </div>
      </div>

      {/* ── Nifty 50 heatmap ─────────────────────────────────────────────── */}
      <div className="card sec">
        <div className="ctitle" style={{ marginBottom: 12 }}>
          Nifty 50 heatmap
          <span className="sub" style={{ textTransform: 'none' }}>
            {nifty50?.count ? ` — ${nifty50.count} of 50 live` : ''}
          </span>
        </div>
        {loading && !sorted.length ? (
          <div className="sub">Loading constituents…</div>
        ) : sorted.length ? (
          <div className="no-heat">
            {sorted.map((s) => (
              <div className="no-tile" key={s.sym} style={{ background: tileBg(s.pct) }} title={`${s.name} · ${s.sector} · ${pctTxt(s.pct)}`}>
                <span className="no-tile-sym">{s.sym}</span>
                <span className={'no-tile-pct mono ' + pctCls(s.pct)}>{pctTxt(s.pct)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mac-stale">Constituent quotes unavailable — Yahoo feed not reachable this run.</div>
        )}
      </div>
    </>
  );
}
