'use client';
// COMPUTED data-review for the Trading → Review sub-tab — renders the precomputed
// unbiased-screen payload (KV `algo-screen:v1` via /api/algo-screen). Distinct from the
// AI prose card: every figure here comes from the screen CALC (scripts/lib/algoScreen.mjs),
// never the LLM. The caveats ARE the product — thin/empty regime buckets, the held
// park-reason, and within-structure DD outliers render VISIBLY, not buried.
//
// Direction = colour only (cl(): grn/red, glyph-free); magnitudes shown unsigned.
import { cl, pctS } from '../../lib/fmt';

const FLAG_LABEL = { provisional: 'provisional', noOverfitCheck: 'no overfit check', noCorrelation: 'no correlation' };
const TESTED = {
  ok: { label: 'ok', style: { color: 'var(--txt3)' } },
  thin: { label: 'thin', style: { color: 'var(--acc)', fontWeight: 600 } },
  empty: { label: 'EMPTY', style: { color: 'var(--red)', fontWeight: 700 } },
};
const inr = (n) => (n == null ? '—' : '₹' + Math.round(n).toLocaleString('en-IN'));

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
    <div className="mini" style={{ marginTop: 10, padding: '12px 14px' }}>
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

  const { capitalTier: ct, thresholds: th, counts: c, held, confront, survivorsByStyle, parked, flaggedOutTally } = data;
  const styles = Object.entries(survivorsByStyle);
  const tally = Object.entries(flaggedOutTally);

  return (
    <div className="card sec algo-screen-review">
      <div className="ctitle" style={{ marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        Unbiased algo screen
        <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>computed · data review</span>
      </div>
      <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
        <span className="sub" style={{ margin: 0 }}>Descriptive — eliminate &amp; confront, not a ranking{data.asOf ? ` · as of ${String(data.asOf).slice(0, 10)}` : ''}</span>
        <span className="sub" style={{ margin: 0, color: 'var(--txt3)' }}>universe {c.universe} · held {c.held} · survivors {c.survivors} · parked {c.parked} · out {c.out}</span>
      </div>

      {/* 1 — HELD set: live metrics + per-regime breakdown, caveats visible */}
      <div className="lbl">Held set — judged on live evidence only</div>
      {held.map((h) => <HeldCard key={h.algo} h={h} />)}

      {/* 2 — CONFRONT, with the regime caveat beside any "better" number */}
      <div className="lbl" style={{ marginTop: 16, marginBottom: 6 }}>Confront my picks</div>
      {confront.dominatedBy.length === 0
        ? <div className="sub" style={{ margin: 0, lineHeight: 1.6 }}>None — no candidate beats a held algo on live sortino <b>and</b> adds diversification.</div>
        : confront.dominatedBy.map((d, i) => (
          <div key={i} className="sub" style={{ margin: '0 0 6px', lineHeight: 1.6 }}>
            Held <b>{d.held}</b> (sortino {d.heldSortino}) dominated by <b>{d.challenger}</b> (sortino {d.sortino}{d.corrToBasket != null ? `, corr-to-basket ${d.corrToBasket} vs ${d.heldCorrToBasket}` : ''}) <span style={{ color: 'var(--txt3)' }}>[{d.confidence}, {d.liveDays}d]</span>
            {d.regimeCaveat && <span style={{ color: 'var(--red)' }}> · regimes untested: {d.regimeCaveat}</span>}
          </div>
        ))}
      {confront.supplementary.length > 0 && (
        <details className="mac-details" style={{ marginTop: 8 }}>
          <summary><span className="mac-details-title">Supplementary — higher sortino, not more diversifying ({confront.supplementary.length})</span></summary>
          <div style={{ padding: '4px 18px 14px' }}>
            {confront.supplementary.map((s, i) => (
              <div key={i} className="sub" style={{ margin: '0 0 6px', lineHeight: 1.6 }}>
                <b>{s.challenger}</b> (sortino {s.sortino}) &gt; held <b>{s.held}</b> ({s.heldSortino}) — {s.moreDiversifying ? 'more' : 'not more'} diversifying
                {s.regimeCaveat && <span style={{ color: 'var(--red)' }}> · untested: {s.regimeCaveat}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 3 — capital tier + thresholds */}
      <div className="sub" style={{ marginTop: 16, padding: '10px 12px', background: 'var(--acc-bg)', borderRadius: 10, lineHeight: 1.7 }}>
        Capital <b>{inr(ct.capital)}</b> → <b>{ct.name}</b> tier · admits {ct.admit.join(' / ')} · DD tolerance defined {ct.dd.defined}% · undefined {ct.dd.undefined}% · equity {ct.dd.equity}%
        <br />Thresholds: overfit ≥ {th.overfitMin} · live days ≥ {th.minLiveDays} · redundant corr &gt; {th.redundantCorr} · structure-outlier &gt; {th.structureOutlierMAD}·MAD · thin &lt; {th.thinDays}d
      </div>

      {/* 4 — survivors by style, collapsible */}
      <div className="lbl" style={{ marginTop: 16, marginBottom: 6 }}>Surviving candidates by style ({c.survivors})</div>
      {styles.map(([style, rows]) => (
        <details key={style} className="mac-details">
          <summary><span className="mac-details-title">{style} ({rows.length})</span></summary>
          <div className="ovx" style={{ padding: '0 4px 8px' }}>
            <table className="tbl">
              <thead><tr>
                <th>Algo</th><th className="ra">Live d</th><th className="ra">Sortino</th>
                <th className="ra">CAGR</th><th className="ra">Max DD</th><th className="ra">Corr→held</th><th>Flags</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.algo} style={r.structureOutlier ? { background: 'color-mix(in srgb, var(--red) 7%, transparent)' } : undefined}>
                    <td style={{ color: 'var(--txt)' }}>{r.algo}{r.structureOutlier ? ' ⚠' : ''}</td>
                    <td className="ra mono">{r.liveDays}</td>
                    <td className="ra mono"><R2 v={r.liveMetrics?.sortino} /></td>
                    <td className="ra mono"><PC v={r.liveMetrics?.cagr} /></td>
                    <td className="ra mono"><PC v={r.liveMetrics?.maxDD} /></td>
                    <td className="ra mono">{r.corrToBasket == null ? <span className="mut">·</span> : r.corrToBasket}</td>
                    <td><Flags flags={r.flags} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {/* 5 — parked watchlist + flagged-out tally + legend, collapsible footer */}
      <details className="mac-details" style={{ marginTop: 10 }}>
        <summary><span className="mac-details-title">Parked watchlist ({parked.length}) · flagged out ({c.out}) · legend</span></summary>
        <div style={{ padding: '4px 18px 16px' }}>
          <div className="sub" style={{ margin: '0 0 8px', color: 'var(--txt3)', lineHeight: 1.6 }}>
            Parked = eliminated only for drawdown or structure-not-admitted at this tier — pre-screened higher-octane algos to revisit as capital scales (distinct from genuinely OUT: overfit / no-live / thin).
          </div>
          <div className="ovx">
            <table className="tbl">
              <thead><tr><th>Algo</th><th>Structure</th><th className="ra">Max DD</th><th>Why parked</th><th className="ra">Revisit</th></tr></thead>
              <tbody>
                {parked.map((r) => (
                  <tr key={r.algo}>
                    <td style={{ color: 'var(--txt)' }}>{r.algo}</td>
                    <td className="sub" style={{ margin: 0 }}>{r.structure}</td>
                    <td className="ra mono"><PC v={r.liveMetrics?.maxDD} /></td>
                    <td className="sub" style={{ margin: 0, lineHeight: 1.5 }}>{r.parkReason?.join('; ')}</td>
                    <td className="ra">{r.revisitTier || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lbl" style={{ marginTop: 14, marginBottom: 6 }}>Flagged out ({c.out}) — reason tally</div>
          <div className="sub" style={{ margin: 0 }}>{tally.length ? tally.map(([k, v]) => `${k} ${v}`).join(' · ') : 'none'}</div>
          <div className="lbl" style={{ marginTop: 14, marginBottom: 6 }}>Legend</div>
          <div className="sub" style={{ margin: 0, lineHeight: 1.7, color: 'var(--txt3)' }}>
            <b>Regimes</b> (3y Nifty trend × VIX vol): up / down / chop (low directional efficiency) × calm / stressed.
            {' '}<b>Tested</b>: ok (≥{th.thinDays}d) · thin (&lt;{th.thinDays}d, untested) · EMPTY (no live day in that regime — the finding, not a gap).
            {' '}<b>Structure</b>: defined (spreads / hedged) vs undefined (naked) — drawdown read relative to same-structure peers.
            {' '}<b>Direction by colour</b>: green gain · red loss (magnitudes unsigned).
          </div>
        </div>
      </details>
    </div>
  );
}
