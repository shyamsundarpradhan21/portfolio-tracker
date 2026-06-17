'use client';
import { useMemo, useState } from 'react';
import { InrC, SInrC, pctS } from '../../lib/fmt';
import { SCENARIOS, SLEEVES, ASSUME, LOW_RSQ, evalScenario } from '../../lib/scenarios';
import AnalysisCard from '../shared/AnalysisCard';

// Per-sleeve cards that consolidate here when the header ✨ banners are toggled off.
const SLEEVE_CARDS = [
  { key: 'overview', label: 'Whole book' },
  { key: 'indian', label: 'Indian equity' },
  { key: 'us', label: 'US equity' },
  { key: 'mf', label: 'Mutual funds' },
  { key: 'fd', label: 'Fixed deposits' },
  { key: 'trading', label: 'Trading / algo' },
];

// relative age of the shown analysis (kept local — small + render-cheap)
function agoStr(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24; if (d < 7) return `${Math.round(d)}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ── helpers ──────────────────────────────────────────────────────────────────
const f2 = (n, dp = 2) => (n == null || !isFinite(n) ? '—' : n.toFixed(dp));
const signCls = (n) => (n == null ? 'mut' : n > 0 ? 'grn' : n < 0 ? 'red' : 'mut');

// Macro level change — direction shown with a muted arrow, NOT green/red: a rise
// in a macro reading is not "good" or "bad", just a move.
function Chg({ v, dp = 2, unit = '' }) {
  if (v == null || !isFinite(v)) return null;
  const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '·';
  return <span style={{ color: 'var(--txt3)', fontSize: 'var(--fs-2xs)', marginLeft: 6 }}>{arrow} {Math.abs(v).toFixed(dp)}{unit}</span>;
}

// Source + as-of stamp, or an explicit unavailable line.
function Stamp({ d }) {
  if (!d || d.stale) return <div className="mac-src mac-stale">unavailable · {d?.source || 'no source'}{d?.error ? ` (${d.error})` : ''}</div>;
  return <div className="mac-src">{d.source}{d.asOf ? ` · ${String(d.asOf).slice(0, 10)}` : ''}</div>;
}

const CLOCK = [
  { key: 'us10y',       label: 'US 10Y',  unit: '%',  dp: 2, hint: 'rates / duration driver' },
  { key: 'spread2s10s', label: '2s10s',   unit: 'pp', dp: 2, hint: 'curve slope' },
  { key: 'hyOas',       label: 'HY OAS',  unit: '%',  dp: 2, hint: 'risk-off early warning' },
  { key: 'nfci',        label: 'NFCI',    unit: '',   dp: 2, hint: 'financial conditions (− = loose)' },
  { key: 'vix',         label: 'VIX',     unit: '',   dp: 1, hint: 'equity vol regime' },
  { key: 'dxy',         label: 'DXY',     unit: '',   dp: 2, hint: 'dollar / EM pressure' },
  { key: 'usdinr',      label: 'USD/INR', unit: '',   dp: 2, hint: 'Vested-book FX' },
  { key: 'brent',       label: 'Brent',   unit: '$',  dp: 2, hint: 'India CPI / CAD channel' },
];

const confLabel = { hard: 'measured', modelled: 'regression', assumed: 'assumption' };

export default function MacroTab({ model, macro, reg, insights, insightsOn, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
  const [selId, setSelId] = useState('riskoff');
  const pulse = insights?.pulse;

  const evals = useMemo(() => SCENARIOS.map((s) => evalScenario(s, model)), [model]);
  const selected = useMemo(() => evals.find((e) => e.id === selId) || evals[0], [evals, selId]);
  const live = macro?.live || {};
  const ready = !!(model?.sleeves?.us?.v || model?.sleeves?.india?.v);

  // group the scenario rows for sectioned rendering
  const groups = useMemo(() => {
    const g = [];
    for (const e of evals) {
      let row = g.find((x) => x.group === e.group);
      if (!row) { row = { group: e.group, rows: [] }; g.push(row); }
      row.rows.push(e);
    }
    return g;
  }, [evals]);

  const legOf = (ev, key) => ev.legs.find((l) => l.key === key);
  const sleeveBase = (key) => (key === 'vol' ? model.sleeves.vol.cap : (model.sleeves[key]?.v || 0));

  // "What's at stake" — the headline numbers, distilled from the scenario model.
  const stakes = useMemo(() => {
    if (!evals.length) return null;
    const base = SLEEVES.reduce((s, sl) => s + sleeveBase(sl.key), 0);
    const riskoff = evals.find((e) => e.id === 'riskoff');
    const worstSingle = evals.filter((e) => !e.composite)
      .reduce((a, b) => (b.total.inr < (a ? a.total.inr : Infinity) ? b : a), null);
    // Concentration that matters for MACRO risk is the largest directional
    // (market-beta) bet — not the market-neutral credit-spread book.
    const directional = SLEEVES.filter((sl) => sl.key === 'us' || sl.key === 'india').map((sl) => ({ ...sl, v: sleeveBase(sl.key) }));
    const biggest = directional.reduce((a, b) => (b.v > a.v ? b : a), directional[0]);
    const defensive = (model.sleeves.fd?.v || 0) + (model.sleeves.gold?.v || 0);
    return {
      base, riskoff, worstSingle, biggest,
      biggestPct: base ? (biggest.v / base) * 100 : 0,
      defensive, defensivePct: base ? (defensive / base) * 100 : 0,
    };
  }, [evals, model]);

  // a ₹ impact cell, sign-coloured, with a low-confidence flag
  const Cell = (leg) => {
    if (!leg || !leg.inr) return <span className="mut">—</span>;
    return (
      <span className={signCls(leg.inr) + (leg.weak ? ' mac-weak' : '')} title={confLabel[leg.conf] + (leg.weak ? ' · low confidence' : '')}>
        <SInrC n={leg.inr} />{leg.weak ? <span className="mac-flag">~</span> : null}
      </span>
    );
  };

  return (
    <div>
      {/* ── PULSE — the AI macro read of the book (this tab's reason to exist) ─ */}
      <div className="card sec pulse-ai">
        <div className="pulse-ai-head">
          <span className="pulse-ai-title"><span className="ai-spark">✦</span> Pulse — AI macro read of the book</span>
          <span className="pulse-ai-meta">
            {insightsLoading ? <span className="ai-status">analysing…</span>
              : insightsTs ? <span className="mut">analysed {agoStr(insightsTs)}</span>
              : <span className="mut">not generated yet</span>}
            <button className="pulse-refresh" onClick={onRefresh} disabled={insightsLoading || !aiReady} title="Regenerate the whole-app AI analysis">↻ refresh</button>
          </span>
        </div>
        {insightsFirstLoad ? (
          <div className="ai-body"><div className="ins-skel" /><div className="ins-skel" /></div>
        ) : pulse && (pulse.read || pulse.drivers || pulse.drags) ? (
          <>
            {pulse.read && <div className="pulse-read">{pulse.read}</div>}
            <div className="pulse-dd">
              {pulse.drivers && <div className="pulse-col"><div className="pulse-col-lbl up">Could drive it up</div><div className="ai-txt">{pulse.drivers}</div></div>}
              {pulse.drags && <div className="pulse-col"><div className="pulse-col-lbl down">Could pull it down</div><div className="ai-txt">{pulse.drags}</div></div>}
            </div>
          </>
        ) : (
          <div className="sub">No analysis yet — hit <strong>refresh</strong> to generate a forward macro read of the book (one whole-app AI call). Conditional, never a price call.</div>
        )}
      </div>

      {/* ── WHAT'S AT STAKE — the headline numbers, foregrounded ─────────── */}
      {ready && stakes && (
        <div className="g3 sec pulse-stakes">
          <div className="stake-tile down">
            <div className="lbl">Tail risk — risk-off</div>
            <div className="vmd mono"><span className="red"><SInrC n={stakes.riskoff.total.inr} /></span></div>
            <div className="sub">{pctS(stakes.riskoff.total.pct)} of book if Nasdaq −15 · VIX 35 · ₹88 · HY +150 hit together</div>
          </div>
          <div className="stake-tile">
            <div className="lbl">Largest directional bet</div>
            <div className="vmd mono" style={{ color: stakes.biggest.color }}>{stakes.biggest.label.replace(' (Vested)', '')}</div>
            <div className="sub">{f2(stakes.biggestPct, 0)}% of exposed capital · the main market-beta driver</div>
          </div>
          <div className="stake-tile up">
            <div className="lbl">Cushion that won’t flinch</div>
            <div className="vmd mono"><InrC n={stakes.defensive} /></div>
            <div className="sub">{f2(stakes.defensivePct, 0)}% in FD + gold · rupee assets, no equity/vol beta</div>
          </div>
        </div>
      )}

      {/* When the header ✨ banners are OFF, the six per-sleeve reads consolidate
          into ONE compact card here (label + read), not six stacked banners. */}
      {!insightsOn && insights && SLEEVE_CARDS.some((c) => { const d = insights?.[c.key]; return d && (d.performance || d.outlook); }) && (
        <div className="card sec ai-card">
          <div className="ai-head"><span className="ai-spark">✦</span> Sleeve reads<span className="ins-ai">AI</span></div>
          <div className="pulse-sleeves">
            {SLEEVE_CARDS.map((c) => {
              const d = insights?.[c.key];
              if (!d || (!d.performance && !d.outlook)) return null;
              return (
                <div className="pulse-sleeve" key={c.key}>
                  <div className="pulse-sleeve-lbl">{c.label}</div>
                  <div className="pulse-sleeve-txt">{d.performance}{d.outlook ? <span className="pulse-sleeve-out"> {d.outlook}</span> : null}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!ready && <div className="card sec sub">Waiting for live prices to value the sleeves…</div>}

      {/* ── THE MECHANICS — collapsed by default; the noise stays in back ── */}
      <details className="card sec mac-details">
        <summary>
          <span className="mac-details-title">Scenario engine, live macro &amp; sensitivities</span>
          <span className="sub">the numbers behind the read — open to stress-test</span>
        </summary>
        <div className="mac-details-body">
          <div className="mac-contract" style={{ borderLeft: '2px solid var(--acc)', paddingLeft: 12, marginBottom: 16 }}>
            <strong>Exposure, not a forecast.</strong> The stress table quantifies how the book responds to defined macro shocks —
            it does <em>not</em> call direction. Conditional (IF → THEN). Weak-fit / stale / assumed numbers are flagged <span className="mac-flag">~</span>.
          </div>

          {/* live market clock */}
          <div className="mac-clocklbl">Live market clock <span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>— polled with prices (FRED + Yahoo)</span></div>
          <div className="g4 sec mac-grid">
            {CLOCK.map((c) => {
              const d = live[c.key];
              const ok = d && !d.stale;
              return (
                <div className={'csm mac-cell' + (ok ? '' : ' mac-cell-stale')} key={c.key}>
                  <div className="lbl">{c.label}</div>
                  <div className="vsm mono">
                    {ok ? <>{c.unit === '$' ? '$' : ''}{f2(d.value, c.dp)}{c.unit && c.unit !== '$' ? <span className="mac-unit">{c.unit}</span> : ''}</> : <span className="mut">n/a</span>}
                    {ok && <Chg v={d.change} dp={c.dp} unit={c.unit === '$' ? '' : c.unit} />}
                  </div>
                  <div className="mac-hint">{c.hint}</div>
                  <Stamp d={d} />
                </div>
              );
            })}
          </div>
          <div className="sec mac-term">
            {live.vixTerm && !live.vixTerm.stale ? (
              <>Term structure: <strong className={live.vixTerm.state === 'backwardation' ? 'red' : 'grn'}>{live.vixTerm.state}</strong>
                <span className="sub" style={{ marginLeft: 8 }}>VIX/VIX3M {f2(live.vixTerm.ratio, 2)} · {live.vixTerm.state === 'backwardation' ? 'front-month stress' : 'normal / calm'}</span></>
            ) : <span className="mac-stale">Term structure unavailable</span>}
          </div>
          <div className="sub" style={{ margin: '6px 0 16px', lineHeight: 1.6 }}>
            Scheduled releases (Core PCE, CPI, NFP, India CPI/GDP/MPC) and FII/DII flows aren’t wired —
            no reliable <em>free</em> calendar + consensus + flow feed. The live clock above <strong>is</strong> connected.
          </div>

          {/* scenario stress table */}
          <div className="fxc" style={{ marginBottom: 4 }}>
            <div className="ctitle" style={{ margin: 0 }}>Scenario stress table</div>
            <div className="sub" style={{ margin: 0 }}>click a row → breakdown below · <span className="mac-flag">~</span> = low confidence</div>
          </div>
          <div className="ovx">
            <table className="tbl mac-scn" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th>Scenario</th>
                  {SLEEVES.map((s) => <th key={s.key} className="ra">{s.label}</th>)}
                  <th className="ra">Total ₹</th>
                  <th className="ra">% book</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Group key={g.group} g={g} SLEEVES={SLEEVES} Cell={Cell} legOf={legOf} selId={selId} setSelId={setSelId} />
                ))}
              </tbody>
            </table>
          </div>

          {/* selected-scenario impact bars */}
          {selected && (
            <div className="sec" style={{ marginTop: 18 }}>
              <div className="fxc" style={{ marginBottom: 12 }}>
                <div className="ctitle" style={{ margin: 0 }}>Impact — {selected.label}{selected.composite ? <span className="badge ba" style={{ marginLeft: 8 }}>composite</span> : null}</div>
                <div className="mono" style={{ fontWeight: 700 }}>
                  <span className={signCls(selected.total.inr)}><SInrC n={selected.total.inr} /></span>
                  <span className="sub" style={{ marginLeft: 8 }}>{pctS(selected.total.pct)} of book</span>
                </div>
              </div>
              {SLEEVES.map((s) => {
                const leg = legOf(selected, s.key);
                const w = Math.min(100, Math.abs(leg ? leg.pct : 0) * 6);
                return (
                  <div className="seg-row mac-bar" key={s.key}>
                    <div className="seg-lbl"><span className="mac-dot" style={{ background: s.color }} />{s.label}</div>
                    <div className="seg-trk">
                      <div className="seg-fil" style={{ width: w + '%', backgroundColor: leg && leg.inr < 0 ? 'var(--red)' : 'var(--grn)', opacity: leg?.weak ? 0.5 : 1, backgroundImage: leg?.weak ? 'repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(0,0,0,.25) 3px,rgba(0,0,0,.25) 6px)' : 'none' }} />
                    </div>
                    <div className="seg-val mono" style={{ minWidth: 150, textAlign: 'right' }}>
                      {leg && leg.inr ? <><span className={signCls(leg.inr)}><SInrC n={leg.inr} /></span> <span className="sub">{pctS(leg.pct)}</span>{leg.weak ? <span className="mac-flag">~</span> : null}</> : <span className="mut">no effect</span>}
                    </div>
                  </div>
                );
              })}
              <div className="sub mac-note" style={{ marginTop: 12, lineHeight: 1.6 }}>{selected.note}</div>
            </div>
          )}

          {/* sensitivity inputs */}
          <div className="ctitle" style={{ margin: '20px 0 10px' }}>Sensitivity inputs <span className="sub" style={{ textTransform: 'none' }}>— computed, with fit quality</span></div>
          <div className="ovx">
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead><tr><th>Driver → sleeve</th><th className="ra">Sensitivity</th><th className="ra">R²</th><th className="ra">Lookback</th><th>Basis</th></tr></thead>
              <tbody>
                <SensRow label="Nasdaq → US-tech β" val={reg.usNdx?.beta != null ? '×' + f2(reg.usNdx.beta) : '—'} rsq={reg.usNdx?.rsq} weeks={reg.usNdx?.weeks} basis="weekly regression" />
                <SensRow label="10Y → US-tech (duration)" val={reg.usDur?.perBp != null ? f2(reg.usDur.perBp * 100 * 100, 1) + '% / +100bp' : '—'} rsq={reg.usDur?.rsq} weeks={reg.usDur?.weeks} basis="return vs Δ10Y" />
                <SensRow label="Nifty → India β" val={reg.india?.beta != null ? '×' + f2(reg.india.beta) : '—'} rsq={reg.india?.rsq} weeks={reg.india?.weeks} basis="weekly regression" />
                <SensRow label="VIX → vol book" val={f2(ASSUME.volPerVixPt * 100, 1) + '% / +1 pt'} assumed basis="stated — no P&L series" />
                <SensRow label="HY OAS → vol book" val={f2(ASSUME.hyVolPer150 * 100, 0) + '% / +150bp'} assumed basis="stated — risk-off proxy" />
                <SensRow label="Brent → India equity" val={f2(ASSUME.crudeIndiaEq * 100, 0) + '% / +20%'} assumed basis="stated — inflation/CAD" />
              </tbody>
            </table>
          </div>
          <div className="sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
            R² below {LOW_RSQ.toFixed(2)} is a <span className="mac-weak">weak fit<span className="mac-flag">~</span></span> — a noisy input, not a hard number.
            Assumption rows have no regressable series and are stated, never measured.
          </div>
        </div>
      </details>
    </div>
  );
}

function Group({ g, SLEEVES, Cell, legOf, selId, setSelId }) {
  return (
    <>
      <tr className="mac-grouprow"><td colSpan={SLEEVES.length + 3}>{g.group}</td></tr>
      {g.rows.map((ev) => (
        <tr key={ev.id} className={'mac-scnrow' + (ev.id === selId ? ' sel' : '') + (ev.composite ? ' mac-comp' : '')} onClick={() => setSelId(ev.id)} style={{ cursor: 'pointer' }}>
          <td style={{ color: 'var(--txt)', fontWeight: 500, whiteSpace: 'nowrap' }}>{ev.label}</td>
          {SLEEVES.map((s) => <td key={s.key} className="ra mono">{Cell(legOf(ev, s.key))}</td>)}
          <td className="ra mono" style={{ fontWeight: 700 }}><span className={ev.total.inr > 0 ? 'grn' : ev.total.inr < 0 ? 'red' : 'mut'}><SInrC n={ev.total.inr} /></span></td>
          <td className="ra mono"><span className={ev.total.inr > 0 ? 'grn' : ev.total.inr < 0 ? 'red' : 'mut'}>{pctS(ev.total.pct)}</span></td>
        </tr>
      ))}
    </>
  );
}

function SensRow({ label, val, rsq, weeks, assumed, basis }) {
  const weak = assumed || rsq == null || rsq < LOW_RSQ;
  return (
    <tr>
      <td style={{ color: 'var(--txt)' }}>{label}</td>
      <td className={'ra mono' + (weak ? ' mac-weak' : '')}>{val}{weak ? <span className="mac-flag">~</span> : null}</td>
      <td className="ra mono">{assumed ? <span className="mut">n/a</span> : (rsq != null ? <span className={rsq < LOW_RSQ ? 'red' : 'grn'}>{rsq.toFixed(2)}</span> : '—')}</td>
      <td className="ra mono mut">{assumed ? '—' : (weeks ? weeks + 'w' : '—')}</td>
      <td className="sub" style={{ color: assumed ? 'var(--acc)' : 'var(--txt3)' }}>{assumed ? 'assumption' : basis}</td>
    </tr>
  );
}
