'use client';
// COMPUTED data-review for the Trading → Review sub-tab — renders the precomputed
// unbiased-screen payload (KV `algo-screen:v1` via /api/algo-screen). Distinct from the
// AI prose card: every figure here comes from the screen CALC (scripts/lib/algoScreen.mjs),
// never the LLM. The caveats ARE the product — thin/empty regime buckets, the held
// park-reason, and within-structure DD outliers render VISIBLY, not buried.
//
// Direction = colour only (cl(): grn/red, glyph-free); magnitudes shown unsigned.
import { cl, pctS } from '../../lib/fmt';

const FLAG_LABEL = { provisional: 'provisional', shortLive: 'short-live · annualized', noOverfitCheck: 'no overfit check', noCorrelation: 'no correlation' };
const TESTED = {
  ok: { label: 'ok', style: { color: 'var(--txt3)' } },
  thin: { label: 'thin', style: { color: 'var(--acc)', fontWeight: 600 } },
  empty: { label: 'EMPTY', style: { color: 'var(--red)', fontWeight: 700 } },
};
// signed value → colour-only direction (no +/- glyph), magnitude shown
const R2 = ({ v }) => (v == null ? <span className="mut">·</span> : <span className={cl(v)}>{Math.abs(v).toFixed(2)}</span>);
const PC = ({ v }) => (v == null ? <span className="mut">·</span> : <span className={cl(v)}>{pctS(v)}</span>);

function Flags({ flags }) {
  if (!flags?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {flags.map((f) => <span key={f} className="badge ba" style={{ fontSize: 'var(--fs-2xs)' }}>{FLAG_LABEL[f] || f}</span>)}
    </span>
  );
}

function RegimeTable({ rows, matched }) {
  return (
    <div className="ovx" style={{ marginTop: 8 }}>
      <table className="tbl">
        <thead><tr>
          <th>Regime</th><th className="ra">Days</th><th className="ra">Sortino</th>
          <th className="ra">CAGR</th><th className="ra">Max DD</th><th className="ra">Tested</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const t = TESTED[r.tested];
            const tint = r.tested === 'empty' ? 'color-mix(in srgb, var(--red) 9%, transparent)'
              : r.tested === 'thin' ? 'var(--acc-bg)' : undefined;
            return (
              <tr key={r.regime} style={tint ? { background: tint } : undefined}>
                <td style={{ textTransform: 'capitalize', color: 'var(--txt)' }}>{r.regime}</td>
                <td className="ra mono">{r.days}</td>
                <td className="ra mono"><R2 v={r.sortino} /></td>
                <td className="ra mono"><PC v={r.cagr} /></td>
                <td className="ra mono"><PC v={r.maxDD} /></td>
                <td className="ra" style={t.style}>{t.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {matched && (
        <div className="sub" style={{ marginTop: 4, color: 'var(--txt3)' }}>
          matched {matched.matched}/{matched.matched + matched.unmatched} live days to the regime calendar
        </div>
      )}
    </div>
  );
}

function HeldCard({ h }) {
  const lv = h.liveMetrics || {};
  return (
    <div className="mini" style={{ padding: '12px 14px' }}>
      <div className="fxc" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, color: 'var(--txt)' }}>{h.algo}</span>
        <span className="sub" style={{ margin: 0 }}>{h.style} · {h.structure} risk · {h.liveDays}d live ({h.confidence})</span>
      </div>
      {h.structureOutlier && (
        <div className="sub" style={{ margin: '0 0 8px', color: 'var(--red)', fontWeight: 600, lineHeight: 1.5 }}>
          ⚠ within-structure drawdown outlier — deeper than its {h.structure} peers
        </div>
      )}
      <div className="statgrid">
        <div className="csm"><div className="lbl">Sortino</div><div className="vt3"><R2 v={lv.sortino} /></div></div>
        <div className="csm"><div className="lbl">CAGR</div><div className="vt3"><PC v={lv.cagr} /></div></div>
        <div className="csm"><div className="lbl">Max DD</div><div className="vt3"><PC v={lv.maxDD} /></div></div>
        <div className="csm"><div className="lbl">Worst day</div><div className="vt3"><PC v={lv.worstDay} /></div></div>
      </div>
      {h.flags?.length > 0 && <div style={{ marginTop: 8 }}><Flags flags={h.flags} /></div>}
      {h.parkReason && (
        <div className="sub" style={{ marginTop: 8, padding: '8px 10px', border: '.5px solid var(--warn-brd)', borderRadius: 8, lineHeight: 1.55 }}>
          Held — but would <b>not clear the screen&apos;s gate today</b>: {h.parkReason.join('; ')}{h.revisitTier ? ` · revisit at ${h.revisitTier} tier` : ''}
        </div>
      )}
      <RegimeTable rows={h.regimeBreakdown} matched={h.regimeMatched} />
    </div>
  );
}

export default function AlgoScreenReview({ data, loading, error }) {
  if (loading) {
    return (
      <div className="card sec">
        <div className="ins-skel" /><div className="ins-skel" style={{ marginTop: 8 }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="card sec">
        <div className="sub" style={{ lineHeight: 1.6 }}>
          Computed screen unavailable — publish it with <code>node scripts/build-algo-screen.mjs</code>.
        </div>
      </div>
    );
  }

  // #15 — only the LIVE (held) algos remain; the screen's candidate/confront/parked data
  // was redundant with the monthly algo-pick card, so it's dropped. #16 — the held cards
  // sit adjacent + symmetric per the house rule (≤3 → one row, 4 → 2×2, 5-6 → two rows of 3).
  const held = Array.isArray(data.held) ? data.held : [];
  const gcls = held.length === 3 || held.length >= 5 ? 'g3' : 'g2';

  return (
    <div className="card sec algo-screen-review">
      <div className="fxc" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="ctitle" style={{ margin: 0 }}>Algo Performance</div>
        <span className="sub" style={{ margin: 0, color: 'var(--txt3)' }}>
          live algos · judged on live evidence only{data.asOf ? ` · as of ${String(data.asOf).slice(0, 10)}` : ''}
        </span>
      </div>
      {held.length
        ? <div className={gcls}>{held.map((h) => <HeldCard key={h.algo} h={h} />)}</div>
        : <div className="sub" style={{ lineHeight: 1.6 }}>No live algos in the held basket yet.</div>}
    </div>
  );
}
