'use client';
import { useMemo, useState } from 'react';
import { SInrC, pctS } from '../../lib/fmt';
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

// Scheduled releases we WOULD track — rendered as explicit "feed not connected"
// because no reliable free calendar+consensus source exists. Honest blank beats
// a fabricated date or number.
const RELEASES = {
  US: ['Core PCE', 'CPI', 'NFP / unemployment', 'ISM Services', 'ISM Manufacturing'],
  India: ['CPI (food component)', 'GDP', 'IIP', 'RBI repo / MPC'],
  Flows: ['Net FII equity flow', 'Net DII equity flow'],
};

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

      {/* When the header ✨ banners are OFF, the per-sleeve cards consolidate here. */}
      {!insightsOn && insights && (
        <div className="sec">
          <div className="mac-clocklbl">Sleeve analysis <span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>— consolidated here while tab banners are off (✨)</span></div>
          {SLEEVE_CARDS.map((c) => <AnalysisCard key={c.key} title={c.label} data={insights?.[c.key]} on loading={false} />)}
        </div>
      )}

      {/* honesty header — the one-line contract for the SCENARIO engine below */}
      <div className="card sec mac-contract">
        <strong>Scenarios: exposure, not a forecast.</strong> The stress table below quantifies how the book responds to defined
        macro shocks for risk-sizing — it does <em>not</em> call direction. Every scenario is conditional (IF → THEN). Numbers from
        a weak fit (low R²), stale data, or a stated assumption are flagged <span className="mac-flag">~</span> and must not be read as hard figures.
      </div>

      {!ready && <div className="card sec sub">Waiting for live prices to value the sleeves…</div>}

      {/* ── CLOCK 1 — live market (polled) ───────────────────────────────── */}
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
      {/* VIX term structure — derived regime flag */}
      <div className="sec mac-term">
        {live.vixTerm && !live.vixTerm.stale ? (
          <>Term structure: <strong className={live.vixTerm.state === 'backwardation' ? 'red' : 'grn'}>{live.vixTerm.state}</strong>
            <span className="sub" style={{ marginLeft: 8 }}>VIX/VIX3M {f2(live.vixTerm.ratio, 2)} · {live.vixTerm.state === 'backwardation' ? 'front-month stress (risk-off)' : 'normal / calm'}</span></>
        ) : <span className="mac-stale">Term structure unavailable — needs live VIX + VIX3M</span>}
      </div>

      {/* ── CLOCK 2 — scheduled releases (calendar, NOT realtime) ─────────── */}
      <div className="mac-clocklbl">Scheduled releases · surprise tracker <span className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>— calendar clock, separate from the live feed</span></div>
      <div className="card sec">
        <div className="sub" style={{ marginBottom: 10, lineHeight: 1.6 }}>
          Levels don’t move markets — <strong>surprises</strong> do, so a print would be shown as <em>actual vs consensus</em> with the sign of the
          surprise. No reliable <em>free</em> calendar + consensus feed exists (and FII/DII needs an NSDL/Trendlyne scrape), so these
          render as <strong>feed not connected</strong> rather than a fabricated date or number.
        </div>
        <div className="ovx">
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>Release</th><th>Next date</th><th className="ra">Last print</th><th className="ra">Consensus</th><th className="ra">Surprise</th></tr></thead>
            <tbody>
              {Object.entries(RELEASES).map(([grp, items]) => (
                <FragmentRows key={grp} grp={grp} items={items} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SCENARIO TABLE — the centrepiece ─────────────────────────────── */}
      <div className="card sec">
        <div className="fxc" style={{ marginBottom: 4 }}>
          <div className="ctitle" style={{ margin: 0 }}>Scenario stress table</div>
          <div className="sub" style={{ margin: 0 }}>click a row → per-sleeve breakdown below · <span className="mac-flag">~</span> = low confidence</div>
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
      </div>

      {/* ── PER-SLEEVE IMPACT BARS for the selected scenario ─────────────── */}
      {selected && (
        <div className="card sec">
          <div className="fxc" style={{ marginBottom: 12 }}>
            <div className="ctitle" style={{ margin: 0 }}>Impact — {selected.label}{selected.composite ? <span className="badge ba" style={{ marginLeft: 8 }}>composite</span> : null}</div>
            <div className="mono" style={{ fontWeight: 700 }}>
              <span className={signCls(selected.total.inr)}><SInrC n={selected.total.inr} /></span>
              <span className="sub" style={{ marginLeft: 8 }}>{pctS(selected.total.pct)} of book</span>
            </div>
          </div>
          {SLEEVES.map((s) => {
            const leg = legOf(selected, s.key);
            const pct = leg ? leg.pct : 0;
            const w = Math.min(100, Math.abs(pct) * 6); // 1% ≈ 6px of a 100-unit track; capped
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

      {/* ── SENSITIVITY INPUTS — the model's own honesty panel ───────────── */}
      <div className="card sec">
        <div className="ctitle" style={{ marginBottom: 10 }}>Sensitivity inputs <span className="sub" style={{ textTransform: 'none' }}>— computed, with fit quality</span></div>
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
          R² below {LOW_RSQ.toFixed(2)} is a <span className="mac-weak">weak fit<span className="mac-flag">~</span></span> — the beta is a noisy input, not a hard number.
          Assumption rows have no regressable series and are shown as stated sensitivities, never measured.
        </div>
      </div>
    </div>
  );
}

// scheduled-release rows — all explicitly unavailable (no free feed)
function FragmentRows({ grp, items }) {
  return (
    <>
      <tr className="mac-grouprow"><td colSpan={5}>{grp === 'Flows' ? 'FII / DII flows' : grp}</td></tr>
      {items.map((name) => (
        <tr key={name}>
          <td style={{ color: 'var(--txt2)' }}>{name}</td>
          <td><span className="mac-stale">feed not connected</span></td>
          <td className="ra mut">—</td>
          <td className="ra mut">—</td>
          <td className="ra mut">—</td>
        </tr>
      ))}
    </>
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
