'use client';
import { useMemo, useState } from 'react';
import { SInrC, pctS } from '../../lib/fmt';
import { SCENARIOS, SLEEVES, ASSUME, LOW_RSQ, MIN_OBS_MONTHLY, evalScenario, volTier, pulseImpact } from '../../lib/scenarios';
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

const confLabel = { hard: 'measured', modelled: 'regression', indicative: 'indicative (too few obs)', assumed: 'stated assumption' };

// "Soft" = anything that must not read as a hard measured number.
const isSoft = (leg) => !!leg && (leg.conf === 'assumed' || leg.conf === 'indicative' || (leg.conf === 'modelled' && leg.weak));

// ── Pulse regime + bidirectional helpers ─────────────────────────────────────
const REGIME_WORD = { 'risk-on': 'Risk-on', neutral: 'Neutral', watch: 'Watch', 'risk-off': 'Risk-off' };
const LEAN_ARROW = { easing: '▼', stable: '→', tightening: '▲' };
const absPct = (p) => (p == null || !isFinite(p) ? '' : Math.abs(p).toFixed(1) + '%');
const bidirMax = (impact) => Math.max(0.5, ...impact.rows.flatMap((r) => [Math.abs(r.up.pct), Math.abs(r.down.pct)]));

// One sleeve's twin readout: market-up leg + market-down leg, side by side.
// Direction is by COLOUR (gain green / loss red) — no +/- glyph (FEEDBACK rule).
function TwinRow({ r, max }) {
  const cell = (leg) => {
    const w = max > 0 ? Math.min(100, (Math.abs(leg.pct) / max) * 100) : 0;
    return (
      <div className="ptwin-cell">
        <span className="ptwin-bar"><span className="ptwin-fil" style={{ width: w + '%', backgroundColor: leg.inr > 0 ? 'var(--grn)' : leg.inr < 0 ? 'var(--red)' : 'var(--txt3)', opacity: r.weak ? 0.55 : 1 }} /></span>
        <span className="ptwin-num"><span className={signCls(leg.inr)}><SInrC n={leg.inr} /></span> <span className="sub">{absPct(leg.pct)}</span></span>
      </div>
    );
  };
  return (
    <div className="ptwin">
      <div className="ptwin-lbl">
        <span className="mac-dot" style={{ background: r.color }} />{r.label}
        {r.weak ? <span className="mac-flag" title="weak fit — low R²">~</span> : null}
        {r.stable ? <span className="ptwin-anchor">anchor</span> : null}
      </div>
      {cell(r.up)}
      {cell(r.down)}
    </div>
  );
}
const isSoftConf = (c) => c === 'assumed' || c === 'indicative';

// plain string ₹ formatter for SVG <text> (SInrC renders a span, unusable in SVG)
const fmtInr = (n) => { const a = Math.abs(Math.round(n)); return a >= 1e5 ? '₹' + (a / 1e5).toFixed(2) + 'L' : a >= 1e3 ? '₹' + (a / 1e3).toFixed(1) + 'K' : '₹' + a; };
const redgrn = (v) => (v > 0 ? 'var(--grn)' : v < 0 ? 'var(--red)' : 'var(--txt3)');
// tiny in-cell confidence mark — weak ~, indicative ⁿ, assumed ≈ (kept distinct)
const cellMark = (leg) => (leg.conf === 'modelled' && leg.weak ? '~' : leg.conf === 'indicative' ? 'ⁿ' : leg.conf === 'assumed' ? '≈' : '');

// ── CHART 1 · Scenario heatmap (replaces the stress table) ───────────────────
function ScenarioHeatmap({ evals, sleeves, selId, setSelId }) {
  const W = 760, labelW = 150, padR = 74, padT = 24, cellH = 26;
  const colW = (W - labelW - padR) / sleeves.length;
  const H = padT + evals.length * cellH + 4;
  const allv = evals.flatMap((e) => e.legs.map((l) => l.inr));
  const maxLoss = Math.max(1, ...allv.map((v) => (v < 0 ? -v : 0)));
  const maxGain = Math.max(1, ...allv.map((v) => (v > 0 ? v : 0)));
  const legOf = (e, k) => e.legs.find((l) => l.key === k);
  return (
    <div className="ovx"><svg className="mac-hm" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ minWidth: 600 }}>
      {sleeves.map((s, j) => <text key={s.key} x={labelW + j * colW + colW / 2} y={padT - 9} textAnchor="middle" fontSize="10" fill={s.color} fontWeight="600">{s.label.replace(' (Vested)', '').replace(' — Stratzy', '')}</text>)}
      <text x={labelW + sleeves.length * colW + 6} y={padT - 9} fontSize="10" fill="var(--txt3)">Total</text>
      {evals.map((e, i) => {
        const y = padT + i * cellH, sel = e.id === selId;
        return (
          <g key={e.id} onClick={() => setSelId(e.id)} style={{ cursor: 'pointer' }}>
            {sel && <rect x="0" y={y} width={W} height={cellH} rx="3" fill="color-mix(in srgb, var(--acc) 13%, transparent)" />}
            <text x={labelW - 10} y={y + cellH / 2 + 3.5} textAnchor="end" fontSize="10.5" fill={sel || e.composite ? 'var(--acc2)' : 'var(--txt2)'} fontWeight={e.composite || sel ? 700 : 400}>{e.label}</text>
            {sleeves.map((s, j) => {
              const leg = legOf(e, s.key), v = leg ? leg.inr : 0, x = labelW + j * colW;
              const op = v < 0 ? 0.14 + 0.76 * Math.min(1, -v / maxLoss) : v > 0 ? 0.14 + 0.76 * Math.min(1, v / maxGain) : 1;
              return (
                <g key={s.key}>
                  <rect x={x + 2} y={y + 2} width={colW - 4} height={cellH - 4} rx="3" fill={v < 0 ? 'var(--red)' : v > 0 ? 'var(--grn)' : '#15151d'} opacity={op} stroke="var(--brd)" strokeWidth=".5" />
                  {v ? <text x={x + colW / 2} y={y + cellH / 2 + 3.5} textAnchor="middle" fontSize="8.5" fill="#0C0C12" fontWeight="700">{fmtInr(v).replace('₹', '')}{cellMark(leg)}</text>
                    : <text x={x + colW / 2} y={y + cellH / 2 + 3.5} textAnchor="middle" fontSize="10" fill="var(--txt3)">·</text>}
                </g>
              );
            })}
            <text x={labelW + sleeves.length * colW + 6} y={y + cellH / 2 + 3.5} fontSize="9.5" fontWeight="700" fill={redgrn(e.total.inr)}>{fmtInr(e.total.inr)}</text>
          </g>
        );
      })}
    </svg></div>
  );
}

// ── CHART 2 · Exposure bullets (what's at stake, per sleeve) ─────────────────
function ExposureBullets({ sleeves, model, worst }) {
  const rows = sleeves.map((s) => ({ ...s, cap: s.key === 'vol' ? model.sleeves.vol.cap : (model.sleeves[s.key]?.v || 0), ...(worst[s.key] || {}) }))
    .filter((r) => r.cap > 0).sort((a, b) => (a.worst || 0) - (b.worst || 0));
  const W = 760, labelW = 150, padR = 100, rowH = 40, padT = 6;
  const H = padT + rows.length * rowH + 4;
  const maxCap = Math.max(1, ...rows.map((r) => r.cap));
  const sc = (W - labelW - padR) / maxCap;
  return (
    <div className="ovx"><svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ minWidth: 540 }}>
      {rows.map((r, i) => {
        const y = padT + i * rowH, cw = r.cap * sc, lw = Math.abs(r.worst || 0) * sc, cy = y + rowH / 2;
        return (
          <g key={r.key}>
            <text x={labelW - 12} y={cy - 3} textAnchor="end" fontSize="11" fill="var(--txt)">{r.label.replace(' (Vested)', '').replace(' — Stratzy', '')}</text>
            <text x={labelW - 12} y={cy + 11} textAnchor="end" fontSize="9" fill="var(--txt3)">cap {fmtInr(r.cap)}</text>
            <rect x={labelW} y={y + 9} width={cw} height={rowH - 22} rx="3" fill={r.color} opacity=".16" stroke={r.color} strokeWidth=".5" strokeOpacity=".4" />
            {lw > 0 && <rect x={labelW} y={y + 9} width={Math.max(2, lw)} height={rowH - 22} rx="3" fill="var(--red)" opacity={isSoftConf(r.conf) ? 0.5 : 0.85} stroke={r.conf === 'assumed' ? 'var(--red)' : 'none'} strokeWidth="1" strokeDasharray={r.conf === 'assumed' ? '4 3' : '0'} />}
            <line x1={labelW + lw} y1={y + 5} x2={labelW + lw} y2={y + rowH - 9} stroke="var(--txt)" strokeWidth="1" />
            <text x={labelW + cw + 8} y={cy} fontSize="10.5" fill={r.worst ? 'var(--red)' : 'var(--txt3)'} dominantBaseline="middle">{r.worst ? fmtInr(r.worst) : '—'}{r.conf === 'assumed' ? ' ≈' : r.conf === 'indicative' ? ' n=' + r.n : ''}</text>
          </g>
        );
      })}
    </svg></div>
  );
}

// ── CHART 3 · Tier-aware sleeve breakdown (replaces the impact bars) ─────────
function TierBreakdown({ selected, sleeves }) {
  if (!selected) return null;
  const legs = sleeves.map((s) => ({ ...s, leg: selected.legs.find((l) => l.key === s.key) }));
  const W = 760, labelW = 158, padR = 158, rowH = 44, padT = 6;
  const H = padT + legs.length * rowH + 4;
  const max = Math.max(1, ...legs.map((s) => (s.leg ? Math.abs(s.leg.inr) : 0)));
  const x0 = labelW, sc = (W - labelW - padR) / max;
  return (
    <div className="ovx"><svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ minWidth: 560 }}>
      <line x1={x0} y1={padT} x2={x0} y2={H - 4} stroke="var(--brd)" strokeWidth="1" />
      {legs.map((s, i) => {
        const leg = s.leg, y = padT + i * rowH, cy = y + rowH / 2, v = leg ? leg.inr : 0, w = Math.abs(v) * sc, soft = leg && isSoft(leg);
        return (
          <g key={s.key}>
            <circle cx="20" cy={cy} r="5" fill={s.color} />
            <text x="34" y={cy - 3} fontSize="12" fill="var(--txt)" dominantBaseline="middle">{s.label.replace(' — Stratzy', '').replace(' (Vested)', '')}</text>
            <text x="34" y={cy + 12} fontSize="9.5" fill={!v ? 'var(--txt3)' : leg.conf === 'assumed' || leg.conf === 'indicative' ? 'var(--txt3)' : leg.weak ? 'var(--red)' : 'var(--grn)'} dominantBaseline="middle">{!v ? 'no effect' : confLabel[leg.conf] || leg.conf}</text>
            {!v ? <text x={x0 + 10} y={cy} fontSize="12" fill="var(--txt3)" dominantBaseline="middle">—</text> : (
              <>
                <rect x={x0} y={cy - 9} width={Math.max(2, w)} height="18" rx="3" fill={redgrn(v)} opacity={soft ? 0.5 : 0.9} stroke={leg.conf === 'assumed' ? 'var(--red)' : 'none'} strokeWidth="1" strokeDasharray={leg.conf === 'assumed' ? '4 3' : '0'} />
                <text x={x0 + w + 12} y={cy - 1} fontSize="12" fill={redgrn(v)} fontWeight="700" dominantBaseline="middle">{fmtInr(v)}</text>
                <text x={x0 + w + 12} y={cy + 13} fontSize="9.5" fill="var(--txt3)" dominantBaseline="middle">{leg.conf === 'assumed' ? 'assumed ≈' : leg.conf === 'indicative' ? 'n=' + leg.n : leg.rangeInr ? '± ' + fmtInr(leg.rangeInr[0]) + '…' + fmtInr(leg.rangeInr[1]) : leg.weak ? 'weak fit ~' : ''}</text>
              </>
            )}
          </g>
        );
      })}
    </svg></div>
  );
}

export default function MacroTab({ model, macro, regime, reg, insights, insightsOn, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
  const [selId, setSelId] = useState('riskoff');
  const pulse = insights?.pulse;

  const evals = useMemo(() => SCENARIOS.map((s) => evalScenario(s, model)), [model]);
  const selected = useMemo(() => evals.find((e) => e.id === selId) || evals[0], [evals, selId]);
  const live = macro?.live || {};
  const ready = !!(model?.sleeves?.us?.v || model?.sleeves?.india?.v);

  // bidirectional market-beta impact (twin up/down legs per sleeve) — Pulse centrepiece
  const impact = useMemo(() => pulseImpact(model), [model]);

  // active vol-sleeve tier (shared with shockVix) + the structural proxy
  const vt = useMemo(() => volTier(model), [model]);
  const proxy = model?.sleeves?.vol?.proxy || null;

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

  // worst single-scenario loss per sleeve (+ the tier that produced it) — feeds
  // the exposure bullets. Composites excluded (they're not a single shock).
  const worstBySleeve = useMemo(() => {
    const out = {};
    SLEEVES.forEach((sl) => {
      let worst = 0, conf = null, n = null;
      evals.filter((e) => !e.composite).forEach((e) => {
        const leg = e.legs.find((l) => l.key === sl.key);
        if (leg && leg.inr < worst) { worst = leg.inr; conf = leg.conf; n = leg.n ?? null; }
      });
      out[sl.key] = { worst, conf, n };
    });
    return out;
  }, [evals]);

  return (
    <div>
      {/* ── PULSE — deterministic regime + symmetric bidirectional impact ──── */}
      <div className="card sec pulse-card">
        {/* Line 1 — REGIME BADGE (the computed headline) + lean */}
        <div className="pulse-regime">
          {regime && regime.state !== 'unavailable' ? (
            <>
              <span className={'regime-badge regime-' + regime.state}>{REGIME_WORD[regime.state]}</span>
              <span className={'regime-lean lean-' + regime.lean}>{LEAN_ARROW[regime.lean]} {regime.lean}</span>
              <span className="pulse-card-sub">market regime · conditions now, not a forecast</span>
            </>
          ) : (
            <span className="mac-stale">Regime unavailable — live macro feed incomplete</span>
          )}
          <span className="pulse-ai-meta">
            {insightsLoading ? <span className="ai-status">analysing…</span> : insightsTs ? <span className="mut">AI {agoStr(insightsTs)}</span> : null}
            <button className="pulse-refresh" onClick={onRefresh} disabled={insightsLoading || !aiReady} title="Regenerate the demoted AI nuance line">↻</button>
          </span>
        </div>

        {/* Line 2 — WHAT MOVED: the drivers actually setting the state */}
        {regime && regime.drivers && regime.drivers.length > 0 && (
          <div className="regime-drivers">
            {regime.drivers.map((d) => (
              <span className={'rd rd-' + d.dir} key={d.key}>
                <span className="rd-lbl">{d.label}</span> <span className="rd-val">{d.valueStr}</span>
                {d.changeStr ? <span className="rd-chg">{d.changeDir > 0 ? '▲' : d.changeDir < 0 ? '▼' : '·'}{d.changeStr}</span> : null}
              </span>
            ))}
          </div>
        )}

        {/* Line 3+ — BIDIRECTIONAL IMPACT: twin up/down per market-beta sleeve */}
        {ready && (
          <div className="pulse-bidir">
            <div className="pulse-bidir-cap sub">If markets move ±{impact.move.equityPct}% <span className="mut">(equity β · gold on ±{impact.move.fxPct}% INR · FD floor) — IF → THEN, not a forecast</span></div>
            <div className="ptwin ptwin-head"><div /><div className="ptwin-cell grn">market up</div><div className="ptwin-cell red">market down</div></div>
            {impact.rows.map((r) => <TwinRow key={r.key} r={r} max={bidirMax(impact)} />)}
            <div className="ptwin ptwin-total">
              <div className="ptwin-lbl">Book total</div>
              <div className="ptwin-cell"><span className={signCls(impact.total.up.inr)}><SInrC n={impact.total.up.inr} /></span> <span className="sub">{absPct(impact.total.up.pct)}</span></div>
              <div className="ptwin-cell"><span className={signCls(impact.total.down.inr)}><SInrC n={impact.total.down.inr} /></span> <span className="sub">{absPct(impact.total.down.pct)}</span></div>
            </div>
            <div className="pulse-aside">Trading book set aside — under review, not market-beta.</div>
          </div>
        )}

        {/* Line last — thin AI nuance, demoted (only if it exists) */}
        {!insightsFirstLoad && pulse && pulse.read && (
          <div className="pulse-nuance"><span className="ai-spark">✦</span> {pulse.read}</div>
        )}
      </div>

      {/* ── WHAT'S AT STAKE — exposure bullets: capital track + worst-case ─ */}
      {ready && stakes && (
        <div className="card sec">
          <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div className="ctitle" style={{ margin: 0 }}>What’s at stake <span className="sub" style={{ textTransform: 'none' }}>— worst single-shock loss per sleeve</span></div>
            <div className="sub mono" style={{ margin: 0 }}>tail risk <span className="red" style={{ fontWeight: 700 }}><SInrC n={stakes.riskoff.total.inr} /></span> ({pctS(stakes.riskoff.total.pct)}) if risk-off hits · {f2(stakes.defensivePct, 0)}% FD+gold cushion</div>
          </div>
          <ExposureBullets sleeves={SLEEVES} model={model} worst={worstBySleeve} />
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

          {/* scenario heatmap — click a row to drive the breakdown */}
          <div className="fxc" style={{ marginBottom: 8 }}>
            <div className="ctitle" style={{ margin: 0 }}>Scenario heatmap</div>
            <div className="sub" style={{ margin: 0 }}>click a row → breakdown below · <span className="mac-flag-a">≈</span> assumed · <span className="mac-flag">~</span> weak · ⁿ few obs</div>
          </div>
          <ScenarioHeatmap evals={evals} sleeves={SLEEVES} selId={selId} setSelId={setSelId} />

          {/* selected-scenario tier-aware breakdown */}
          {selected && (
            <div className="sec" style={{ marginTop: 18 }}>
              <div className="fxc" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div className="ctitle" style={{ margin: 0 }}>Breakdown — {selected.label}{selected.composite ? <span className="badge ba" style={{ marginLeft: 8 }}>composite</span> : null}</div>
                <div className="mono" style={{ fontWeight: 700 }}>
                  <span className={signCls(selected.total.inr)}><SInrC n={selected.total.inr} /></span>
                  <span className="sub" style={{ marginLeft: 8 }}>{pctS(selected.total.pct)} of book</span>
                </div>
              </div>
              <TierBreakdown selected={selected} sleeves={SLEEVES} />
              <div className="sub mac-note" style={{ marginTop: 10, lineHeight: 1.6 }}>{selected.note}</div>
            </div>
          )}

          {/* sensitivity inputs */}
          <div className="ctitle" style={{ margin: '20px 0 10px' }}>Sensitivity inputs <span className="sub" style={{ textTransform: 'none' }}>— computed, with fit quality AND sample size</span></div>
          <div className="ovx">
            <table className="tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>Driver → sleeve</th><th className="ra">Sensitivity</th><th className="ra">R²</th><th className="ra">n</th><th className="ra">Lookback</th><th>Basis</th></tr></thead>
              <tbody>
                <SensRow label="Nasdaq → US-tech β" val={reg.usNdx?.beta != null ? '×' + f2(reg.usNdx.beta) : '—'} rsq={reg.usNdx?.rsq} n={reg.usNdx?.weeks} lookback={reg.usNdx?.weeks ? reg.usNdx.weeks + 'w' : null} conf={reg.usNdx?.rsq != null && reg.usNdx.rsq < LOW_RSQ ? 'weak' : 'measured'} basis="weekly regression" />
                <SensRow label="10Y → US-tech (duration)" val={reg.usDur?.perBp != null ? f2(reg.usDur.perBp * 100 * 100, 1) + '% / +100bp' : '—'} rsq={reg.usDur?.rsq} n={reg.usDur?.weeks} lookback={reg.usDur?.weeks ? reg.usDur.weeks + 'w' : null} conf={reg.usDur?.rsq != null && reg.usDur.rsq < LOW_RSQ ? 'weak' : 'measured'} basis="return vs Δ10Y, weekly" />
                <SensRow label="Nifty → India β" val={reg.india?.beta != null ? '×' + f2(reg.india.beta) : '—'} rsq={reg.india?.rsq} n={reg.india?.weeks} lookback={reg.india?.weeks ? reg.india.weeks + 'w' : null} conf={reg.india?.rsq != null && reg.india.rsq < LOW_RSQ ? 'weak' : 'measured'} basis="weekly regression" />

                {/* VIX → vol book — the live three-tier resolution */}
                {vt.conf === 'modelled' ? (
                  <SensRow label="VIX → vol book" val={f2(vt.perVixPt * 100, 2) + '% / +1 pt'} rsq={vt.rsq} n={vt.n} lookback={vt.n + 'mo'} conf={vt.rsq < LOW_RSQ ? 'weak' : 'measured'} basis="book P&L, monthly regression" />
                ) : vt.conf === 'indicative' ? (
                  <SensRow label="VIX → vol book" val={f2(vt.perVixPt * 100, 2) + '% / +1 pt avg'} rsq={null} n={vt.n} lookback={vt.n + 'mo'} conf="indicative" basis={`book P&L — descriptive, n<${MIN_OBS_MONTHLY} (not a fit)`} />
                ) : (
                  <SensRow label="VIX → vol book" val={f2(ASSUME.volPerVixPt * 100, 1) + '% / +1 pt'} rsq={null} n={null} lookback="—" conf="assumed" basis="stated — no book series yet" />
                )}

                {/* structural short-vol proxy — shown for contrast, never substituted */}
                {proxy && (
                  <SensRow label="VIX → short-vol proxy" val={f2(proxy.perVixPt * 100, 2) + '% / +1 pt'} rsq={proxy.rsq} n={proxy.n} lookback={proxy.n + 'mo'} conf="proxy" basis="SVXY −0.5x short-VIX, monthly — structural, NOT this book" />
                )}

                <SensRow label="HY OAS → vol book" val={f2(ASSUME.hyVolPer150 * 100, 0) + '% / +150bp'} rsq={null} n={null} lookback="—" conf="assumed" basis="stated — no book-vs-HY series yet" />
                <SensRow label="Brent → India equity" val={f2(ASSUME.crudeIndiaEq * 100, 0) + '% / +20%'} rsq={null} n={null} lookback="—" conf="assumed" basis="stated — inflation/CAD channel" />
              </tbody>
            </table>
          </div>
          <div className="sub" style={{ marginTop: 10, lineHeight: 1.7 }}>
            <span className="mac-flag">~</span> weak fit (R² below {LOW_RSQ.toFixed(2)} — a noisy slope). <span className="mac-flag-n">n=N</span> indicative — real book data but
            fewer than {MIN_OBS_MONTHLY} monthly points, shown as a descriptive average, <strong>not</strong> a fitted model (no R²/CI).
            <span className="mac-flag-a">≈</span> a stated assumption with no series. The <span className="mac-proxy-tag">proxy</span> row is a long
            structural short-vol fit shown for contrast — never substituted for the book's own read, so the gap stays visible.
          </div>
        </div>
      </details>
    </div>
  );
}

// conf: 'measured' | 'weak' | 'indicative' | 'assumed' | 'proxy'
function SensRow({ label, val, rsq, n, lookback, conf, basis }) {
  const flag = conf === 'weak' ? <span className="mac-flag">~</span>
    : conf === 'indicative' ? <span className="mac-flag-n">n={n}</span>
    : conf === 'assumed' ? <span className="mac-flag-a">≈</span>
    : null;
  const soft = conf === 'weak' || conf === 'indicative' || conf === 'assumed';
  return (
    <tr className={conf === 'proxy' ? 'mac-proxyrow' : undefined}>
      <td style={{ color: 'var(--txt)' }}>{label}{conf === 'proxy' ? <span className="mac-proxy-tag">proxy</span> : null}</td>
      <td className={'ra mono' + (soft ? ' mac-soft' : '')}>{val} {flag}</td>
      <td className="ra mono">{rsq != null ? <span className={rsq < LOW_RSQ ? 'red' : 'grn'}>{rsq.toFixed(2)}</span> : <span className="mut">n/a</span>}</td>
      <td className="ra mono mut">{n != null ? n : '—'}</td>
      <td className="ra mono mut">{lookback || '—'}</td>
      <td className="sub" style={{ color: conf === 'assumed' ? 'var(--acc)' : 'var(--txt3)' }}>{basis}</td>
    </tr>
  );
}
