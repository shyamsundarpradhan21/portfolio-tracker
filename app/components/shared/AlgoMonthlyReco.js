'use client';
// The month's ALGO DECISION for the Trading → Review sub-tab. Renders the precomputed
// monthly artifact (KV `algo-monthly:latest` via /api/algo-monthly); the per-regime
// breakdown (formerly the standalone Algo Performance / AlgoScreenReview card) is folded
// into each funded pick as a collapsible. Typing a different capital re-runs the
// LIGHT client allocator (app/lib/algoAllocate.mjs) on the artifact's precomputed
// candidates and relabels KEEP/EXIT/ADD — the heavy screen never runs at render.
//
// Direction = colour only (cl(): grn/red, glyph-free via pctS). Figures derive from the
// payload; sizes via tier classes; ₹ next to mono via .rs. Both themes via tokens.
import { useState, useMemo } from 'react';
import { cl, pctS, SInrC } from '../../lib/fmt';
import { allocateConviction, labelBook } from '../../lib/algoAllocate.mjs';

const RS = () => <span className="rs">₹</span>;
const Rup = ({ v }) => (v == null ? <span className="mut">·</span> : <SInrC n={v} />);
const PC = ({ v }) => (v == null ? <span className="mut">·</span> : <span className={cl(v)}>{pctS(v)}</span>);
const N2 = ({ v }) => (v == null ? <span className="mut">·</span> : <span>{Number(v).toFixed(2)}</span>);
const shortLive = (c) => !!c && c.confidence && c.confidence !== 'ok'; // liveDays ≤ 180
const VOL_LABEL = { short: 'short-vol', long: 'long-vol', neutral: 'neutral-vol' };

// ── folded in from the retired Algo-Performance (AlgoScreenReview) card ──────────
// signed value → colour-only 2-decimal magnitude (no +/- glyph)
const R2 = ({ v }) => (v == null ? <span className="mut">·</span> : <span className={cl(v)}>{Math.abs(v).toFixed(2)}</span>);
const TESTED = {
  ok: { label: 'ok', style: { color: 'var(--txt3)' } },
  thin: { label: 'thin', style: { color: 'var(--acc)', fontWeight: 600 } },
  empty: { label: 'EMPTY', style: { color: 'var(--red)', fontWeight: 700 } },
};

// Per-regime live-day breakdown for one pick — the caveats ARE the product: thin (<25d) and
// empty regime buckets render VISIBLY, not buried. Direction = colour (R2/PC), magnitudes unsigned.
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

function Chips({ c }) {
  return (
    <span className="fxc" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span className="badge ba" style={{ fontSize: 'var(--fs-2xs)' }}>{VOL_LABEL[c.volSide] || c.volSide}</span>
      <span className="badge ba" style={{ fontSize: 'var(--fs-2xs)' }}>{c.structure}</span>
      <span className="badge ba" style={{ fontSize: 'var(--fs-2xs)' }}>{c.liveDays}d live</span>
      {shortLive(c) && <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>short-live · annualized</span>}
      {c.downSortino != null && c.downSortino < 0 && <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>weak in down-trends</span>}
    </span>
  );
}

// One funded pick — KEEP (held) / ADD (new). Left-border + badge colour carry the verdict.
function PickCard({ pick, cand, held }) {
  const c = cand || pick;
  const verdict = held ? 'keep' : 'add';
  const accent = held ? 'var(--grn)' : 'var(--acc)';
  return (
    <div className="mini amr-pick" style={{ marginTop: 8, padding: '11px 13px', borderLeft: `3px solid ${accent}` }}>
      <div className="fxc" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fxc" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
            <span style={{ fontWeight: 600, color: 'var(--txt)' }}>{c.algo}</span>
            <span className={`badge ${held ? 'bg' : 'ba'}`}>{verdict.toUpperCase()}</span>
          </div>
          <Chips c={c} />
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="vt2"><Rup v={pick.rupees} /></div>
          <div className="sub" style={{ margin: 0 }}>{Math.round(pick.weight * 100)}% of capital</div>
        </div>
      </div>
      <div className="sub" style={{ marginTop: 8, paddingTop: 8, borderTop: '.5px dashed var(--warn-brd)', lineHeight: 1.55 }}>
        {held ? 'Already held' : 'New add'} — persistence rank #{c.persist2 ?? '—'}, live Sortino <N2 v={c.sortino} />,
        live drawdown <PC v={c.liveMaxDD} />{c.downSortino != null && <> , down-regime Sortino <N2 v={c.downSortino} /></>}. Sized <Rup v={pick.rupees} /> — {pick.bindingReason}.
      </div>

      {/* Folded from the retired Algo-Performance card — collapsible, closed by default so the
          card reads the same until opened. Shown only when the pick carries a regime breakdown. */}
      {c.regimeBreakdown?.length > 0 && (
        <details className="mac-details" style={{ marginTop: 8, borderTop: '.5px dashed var(--warn-brd)' }}>
          <summary style={{ padding: '8px 0' }}>
            <span className="sub" style={{ margin: 0, fontWeight: 600, color: 'var(--txt2)' }}>Regime breakdown &amp; live-day risk</span>
          </summary>
          {c.worstDay != null && (
            <div className="sub" style={{ margin: '2px 0 0' }}>Worst live day <PC v={c.worstDay} /></div>
          )}
          {c.structureOutlier && (
            <div className="sub" style={{ margin: '6px 0 0', color: 'var(--red)', fontWeight: 600, lineHeight: 1.5 }}>
              within-structure drawdown outlier — deeper than its {c.structure} peers
            </div>
          )}
          {held && c.parkReason && (
            <div className="sub" style={{ margin: '6px 0 0', padding: '8px 10px', border: '.5px solid var(--warn-brd)', borderRadius: 8, lineHeight: 1.55 }}>
              Held — but would <b>not clear the screen&apos;s gate today</b>: {c.parkReason.join('; ')}{c.revisitTier ? ` · revisit at ${c.revisitTier} tier` : ''}
            </div>
          )}
          <RegimeTable rows={c.regimeBreakdown} matched={c.regimeMatched} />
        </details>
      )}
    </div>
  );
}

function ReviewBlock({ review }) {
  if (!review) {
    return <div className="sub" style={{ margin: 0, lineHeight: 1.6 }}>No review yet — the first runs next month-start, once a month of forward data exists.</div>;
  }
  const c = review.calibration || {};
  const cf = review.counterfactual || {};
  return (
    <div>
      {review.lowConfidence && (
        <div className="sub" style={{ margin: '0 0 10px', padding: '8px 11px', borderRadius: 8, background: 'color-mix(in srgb, var(--acc) 12%, transparent)', border: '1px solid var(--warn-brd)', color: 'var(--txt)', fontWeight: 600, lineHeight: 1.5 }}>
          ⚠ Low-confidence window ({review.window?.tradingDays} forward trading days) — provisional, not a verdict.
        </div>
      )}
      <div className="statgrid">
        <div className="csm"><div className="lbl">Rank → forward</div><div className="vt3"><N2 v={c.rankSpearman} /></div></div>
        <div className="csm"><div className="lbl">Hit rate</div><div className="vt3">{c.hitRate == null ? '—' : Math.round(c.hitRate * 100) + '%'}</div></div>
        <div className="csm"><div className="lbl">DD breaches</div><div className="vt3">{c.ddBreaches ?? '—'}</div></div>
        <div className="csm"><div className="lbl">KEEP/EXIT add</div><div className="vt3"><PC v={cf.keepExitValueAdd} /></div></div>
      </div>
      <div className="sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
        Funded book forward <PC v={cf.fundedAvg} /> vs EXITed <PC v={cf.exitedAvg} /> · top-unfunded <PC v={cf.unfundedAvg} />.
        {c.stressedForward?.length ? <> {c.stressedForward.length} pick(s) hit a stressed regime.</> : null}
      </div>
    </div>
  );
}

export default function AlgoMonthlyReco({ data, loading, error }) {
  const reco = data?.reco || null;
  const review = data?.review || null;
  const [capOverride, setCapOverride] = useState(null); // ₹; null → the artifact's capital

  const capital = capOverride ?? reco?.capital ?? null;
  const book = useMemo(() => (reco && capital ? allocateConviction(reco.candidates, { capital }) : null), [reco, capital]);
  const labels = useMemo(() => (book && reco ? labelBook(book, reco.candidates) : null), [book, reco]);

  if (loading) return <div className="card sec"><div className="ins-skel" /><div className="ins-skel" style={{ marginTop: 8 }} /></div>;
  if (error || !reco) {
    return (
      <div className="card sec">
        <div className="sub" style={{ lineHeight: 1.6 }}>Monthly decision unavailable — build it with <code>node scripts/build-monthly-reco.mjs --capital &lt;₹&gt;</code>.</div>
      </div>
    );
  }

  const candByName = new Map(reco.candidates.map((c) => [c.algo, c]));
  const heldSet = new Set(reco.candidates.filter((c) => c.held).map((c) => c.algo));
  const exitCands = (labels?.exit || []).map((n) => candByName.get(n)).filter(Boolean);
  const capL = capital / 1e5;

  return (
    <div className="card sec algo-monthly-reco">
      <div className="ctitle" style={{ marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        Monthly algo picks
        <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>conviction · {reco.month}</span>
      </div>
      <div className="sub" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
        Max-out by conviction to each algo&apos;s own capacity; drawdown is the per-pick risk you accept, shown on every card. Type a capital to re-allocate.
      </div>

      {/* capital picker — re-runs the client allocator live */}
      <div className="fxc" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', background: 'var(--acc-bg)', borderRadius: 10 }}>
        <span className="sub" style={{ margin: 0 }}>Capital <RS /></span>
        <input
          className="algo-cap-in" type="number" min="0.5" step="0.5"
          value={Number.isFinite(capL) ? +capL.toFixed(2) : ''}
          onChange={(e) => { const v = parseFloat(e.target.value); setCapOverride(Number.isFinite(v) && v > 0 ? Math.round(v * 1e5) : null); }}
          aria-label="Capital in lakh"
        />
        <span className="sub" style={{ margin: 0 }}>Lakh</span>
        <span className="badge ba" style={{ fontSize: 'var(--fs-2xs)' }}>{reco.params?.tier} tier</span>
      </div>

      {/* book summary */}
      <div className="sub" style={{ margin: '0 0 6px', color: 'var(--txt2)' }}>
        <b style={{ color: 'var(--txt)' }}>{book.picks.length} picks</b> · <Rup v={book.deployed} /> deployed ({Math.round(book.deployed / capital * 100)}%)
        {' '}· short-vol {Math.round(book.shortVolShare * 100)}% · long-vol hedge {Math.round(book.longVolShare * 100)}% · idle <Rup v={book.idle} />
      </div>

      {/* regime caveat */}
      {reco.justification?.regimeCaveat && (
        <div className="sub" style={{ margin: '8px 0 12px', padding: '9px 12px', borderRadius: 10, lineHeight: 1.55, color: 'var(--txt2)', background: 'color-mix(in srgb, var(--red) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)' }}>
          <b style={{ color: 'var(--red)' }}>Regime risk:</b> {reco.justification.regimeCaveat}
        </div>
      )}

      {/* funded picks */}
      {book.picks.map((p) => <PickCard key={p.algo} pick={p} cand={candByName.get(p.algo)} held={heldSet.has(p.algo)} />)}

      {/* EXIT — held, no longer a top pick */}
      {exitCands.length > 0 && (
        <div className="mini" style={{ marginTop: 8, padding: '10px 13px', borderLeft: '3px solid var(--red)' }}>
          <div className="fxc" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="badge br">EXIT</span>
            <span style={{ color: 'var(--txt)', fontWeight: 600 }}>{exitCands.map((c) => c.algo).join(', ')}</span>
          </div>
          <div className="sub" style={{ marginTop: 6, lineHeight: 1.5 }}>Held, but slipped out of the top book at this capital — {exitCands.map((c) => `rank #${c.persist2 ?? '—'}`).join(', ')}. Consider trimming.</div>
        </div>
      )}

      {book.warnings?.length > 0 && (
        <div className="sub" style={{ marginTop: 8, color: 'var(--red)', lineHeight: 1.5 }}>{book.warnings.join(' · ')}</div>
      )}

      {/* last month's review */}
      <div className="lbl" style={{ marginTop: 18, marginBottom: 6 }}>Last month&apos;s review — did the calls pay off?</div>
      <ReviewBlock review={review} />

      {/* all candidates (background) */}
      <details className="mac-details" style={{ marginTop: 14 }}>
        <summary><span className="mac-details-title">All {reco.candidates.length} candidates (background) — ranked pool</span></summary>
        <div className="ovx" style={{ padding: '0 4px 8px' }}>
          <table className="tbl">
            <thead><tr>
              <th>Algo</th><th>Vol</th><th className="ra">Rank</th><th className="ra">Sortino</th>
              <th className="ra">CAGR</th><th className="ra">DD live</th><th className="ra">Live d</th>
            </tr></thead>
            <tbody>
              {reco.candidates.map((c) => {
                const funded = book.picks.some((p) => p.algo === c.algo);
                return (
                  <tr key={c.algo} style={funded ? undefined : { opacity: 0.55 }}>
                    <td style={{ color: 'var(--txt)' }}>{funded ? '★ ' : ''}{c.algo}</td>
                    <td className="sub" style={{ margin: 0 }}>{c.volSide}</td>
                    <td className="ra mono">{c.persist2 ?? '—'}</td>
                    <td className="ra mono"><N2 v={c.sortino} /></td>
                    <td className="ra mono"><PC v={c.cagr} /></td>
                    <td className="ra mono"><PC v={c.liveMaxDD} /></td>
                    <td className="ra mono">{c.liveDays}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
