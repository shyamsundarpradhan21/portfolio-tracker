'use client';

// Pre-Market Insights — the morning companion that lands before NSE opens.
// A cohesive overnight read in one card: market mood (computed regime), the
// global cue board (world / India ref / commodities / FX), prior-session FII/DII
// flows, and a demoted AI nuance line. Every cell is live or honestly blank —
// a failed feed renders "n/a", never a stale or invented number (FEEDBACK rule).

const REGIME_WORD = { 'risk-on': 'Risk-on', neutral: 'Neutral', watch: 'Watch', 'risk-off': 'Risk-off' };
const LEAN_ARROW = { easing: '▼', stable: '→', tightening: '▲' };

// Cue value formatting by kind — index/commodity/fx/yield each read differently.
function fmtVal(d) {
  if (!d || d.stale || d.price == null) return null;
  const v = d.price;
  if (d.kind === 'fx') return v.toFixed(2);
  if (d.kind === 'yield') return v.toFixed(2) + '%';
  if (d.kind === 'commodity') return (d.unit === '$' ? '$' : '') + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Direction is carried by COLOUR + an arrow, never a +/- glyph (FEEDBACK rule).
function Pct({ d }) {
  if (!d || d.stale || d.pct == null) return null;
  const cls = d.pct > 0 ? 'grn' : d.pct < 0 ? 'red' : 'mut';
  const arrow = d.pct > 0 ? '▲' : d.pct < 0 ? '▼' : '·';
  return <span className={'pm-pct ' + cls}>{arrow} {Math.abs(d.pct).toFixed(2)}%</span>;
}

// One cue cell. Stale feeds render an explicit unavailable line, not a gap.
function Cue({ d }) {
  const val = fmtVal(d);
  return (
    <div className={'pm-cue' + (val == null ? ' pm-cue-stale' : '')}>
      <div className="pm-cue-lbl">{d.label}</div>
      {val == null ? (
        <div className="pm-cue-val mut">n/a</div>
      ) : (
        <div className="pm-cue-val mono">{val} <Pct d={d} /></div>
      )}
    </div>
  );
}

// FII/DII net in ₹ crore (NSE reports in crore) — colour for buy/sell, no glyph.
function flowFmt(net) {
  if (net == null || !isFinite(net)) return { txt: 'n/a', cls: 'mut' };
  const cls = net > 0 ? 'grn' : net < 0 ? 'red' : 'mut';
  const a = Math.abs(net);
  const txt = '₹' + (a >= 1000 ? (a / 1000).toFixed(2) + 'K' : a.toFixed(0)) + ' Cr';
  return { txt, cls };
}

const GROUPS = [
  { key: 'world',     label: 'World markets' },
  { key: 'india',     label: 'India reference' },
  { key: 'commodity', label: 'Commodities' },
  { key: 'fx',        label: 'Currency & rates' },
];

export default function PreMarketBriefing({ premarket, regime, aiLine, insightsLoading, onRefresh, aiReady, aiAgo }) {
  const win = premarket?.window;
  const cues = premarket?.cues || {};
  const fiidii = premarket?.fiidii;
  const cueList = Object.values(cues);

  // Window framing — the live morning companion (6:30–9:00 IST) vs context mode.
  const windowLabel =
    win?.open ? 'Pre-open window · live'
      : win?.label === 'weekend' ? 'Markets closed · weekend'
      : win?.label === 'before-window' ? 'Before the pre-open window'
      : win?.label === 'pre-open auction' ? 'Pre-open auction'
      : win?.label === 'market open' ? 'NSE open · session live'
      : 'Overnight & market context';
  const countdown = win?.opensInMin != null
    ? (win.opensInMin >= 60 ? `${Math.floor(win.opensInMin / 60)}h ${win.opensInMin % 60}m` : `${win.opensInMin}m`)
    : null;

  const latest = fiidii && !fiidii.stale ? fiidii.latest : null;
  const fii = flowFmt(latest?.fii?.net);
  const dii = flowFmt(latest?.dii?.net);

  return (
    <div className="card sec pulse-card pm-brief">
      {/* Line 1 — window status + market mood (computed regime) + AI meta */}
      <div className="pulse-regime">
        <span className="pm-window">{windowLabel}</span>
        {countdown && <span className="pm-countdown">NSE opens in {countdown}</span>}
        {regime && regime.state !== 'unavailable' && (
          <span className={'regime-badge regime-' + regime.state} title="Computed market mood from the live macro clock — conditions now, not a forecast">
            {REGIME_WORD[regime.state]}
            <span className={'regime-lean lean-' + regime.lean} style={{ marginLeft: 6 }}>{LEAN_ARROW[regime.lean]}</span>
          </span>
        )}
        <span className="pulse-ai-meta">
          {insightsLoading ? <span className="ai-status">analysing…</span> : aiAgo ? <span className="mut">AI {aiAgo}</span> : null}
          <button className="pulse-refresh" onClick={onRefresh} disabled={insightsLoading || !aiReady} title="Regenerate the AI read of the morning cues">↻</button>
        </span>
      </div>

      {/* Line 2 — the cue board, grouped */}
      <div className="pm-cues">
        {GROUPS.map((g) => {
          const items = cueList.filter((c) => c.group === g.key);
          if (!items.length) return null;
          return (
            <div className="pm-group" key={g.key}>
              <div className="pm-group-lbl">{g.label}</div>
              <div className="pm-cue-row">
                {items.map((c) => <Cue d={c} key={c.label} />)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Line 3 — institutional flows (prior session) */}
      <div className="pm-flows">
        <div className="pm-group-lbl">
          FII / DII flows
          <span className="sub" style={{ textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>
            {latest?.date ? `prior session · ${latest.date}` : 'cash market, net'}
          </span>
        </div>
        {latest ? (
          <div className="pm-flow-row">
            <div className="pm-flow">
              <span className="pm-flow-lbl">FII / FPI</span>
              <span className={'pm-flow-val mono ' + fii.cls}>{fii.txt}</span>
            </div>
            <div className="pm-flow">
              <span className="pm-flow-lbl">DII</span>
              <span className={'pm-flow-val mono ' + dii.cls}>{dii.txt}</span>
            </div>
          </div>
        ) : (
          <div className="pm-flow-row mac-stale">
            Flows unavailable{fiidii?.error ? ` — ${fiidii.error}` : ''} (NSE feed not reachable this run)
          </div>
        )}
      </div>

      {/* Line last — demoted AI nuance, only when present */}
      {aiLine && (
        <div className="pulse-nuance"><span className="ai-spark">✦</span> {aiLine}</div>
      )}
    </div>
  );
}
