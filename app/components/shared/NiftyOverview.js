'use client';

// Nifty 50 Overview — the compact detail panel that sits ALONGSIDE the Nifty 50
// heatmap on the India Wrap view (heatmap wide, this panel narrow, ~4:1). A
// TradingView-style right rail re-flowed for a ~1/5-width column:
//   • hero: level + day change + intraday sparkline
//   • last 5 sessions: the week's session-by-session moves
//   • options analysis: PCR / ATM IV / max pain / expiry (2-col)
//   • support & resistance: a VERTICAL pivot ladder (R3→S3) with the live LTP row
//     dropped into its slot
//   • trend: 1W / 1M / 3M / 6M / 1Y (2-col)
// Every block is live or honestly hidden — nothing fabricated. Direction is carried
// by COLOUR + a ▲/▼ arrow, never a +/− glyph (house rule).

import { smoothPath } from '../../lib/smoothPath';

const cls = (p) => (p == null || !isFinite(p) ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');
const arr = (p) => (p == null || !isFinite(p) ? '·' : p > 0 ? '▲' : p < 0 ? '▼' : '·');
const apct = (p) => (p == null || !isFinite(p) ? '—' : `${arr(p)}${Math.abs(p).toFixed(2)}%`);
const n2 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const n0 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const dayLbl = (d) => { const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

// Hero sparkline: intraday close path, coloured by the day's direction.
function Spark({ points, up }) {
  const ys = (points || []).map((p) => p?.c).filter((c) => c != null && isFinite(c));
  if (ys.length < 3) return null;
  const W = 200, H = 34, PAD = 3;
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const x = (i) => (i / (ys.length - 1)) * W;
  const y = (c) => PAD + (1 - (c - lo) / span) * (H - PAD * 2);
  const line = smoothPath(ys.map((c, i) => ({ x: x(i), y: y(c) })));
  const col = up ? 'var(--grn)' : 'var(--red)';
  return (
    <svg className="nov-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="novSpark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity=".26" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill="url(#novSpark)" />
      <path d={line} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Vertical pivot ladder (R3 → S3), with the live LTP row inserted at the slot where
// the level currently sits. Deterministic pivots, not a call.
function Ladder({ lv, last }) {
  if (!lv || lv.stale) {
    return <div className="mac-stale nov-sr-stale">Levels unavailable{lv?.error ? ` — ${lv.error}` : ''} — Yahoo feed not reachable this run.</div>;
  }
  const base = [
    { k: 'R3', v: lv.r3, t: 'res' }, { k: 'R2', v: lv.r2, t: 'res' }, { k: 'R1', v: lv.r1, t: 'res' },
    { k: 'Pivot', v: lv.pp, t: 'pp' },
    { k: 'S1', v: lv.s1, t: 'sup' }, { k: 'S2', v: lv.s2, t: 'sup' }, { k: 'S3', v: lv.s3, t: 'sup' },
  ];
  // Drop the LTP row into the descending ladder: before the first rung whose level
  // is at/below the live price (i.e. where the price actually sits).
  const rows = [];
  let placed = last == null || !isFinite(last);
  for (const r of base) {
    if (!placed && last >= r.v) { rows.push({ k: 'LTP', v: last, t: 'ltp' }); placed = true; }
    rows.push(r);
  }
  if (!placed) rows.push({ k: 'LTP', v: last, t: 'ltp' });
  return (
    <div className="nov-lad">
      {rows.map((r, i) => (
        <div className={'nov-rung nov-' + r.t} key={r.k + i}>
          <span className="nov-rung-k">{r.t === 'ltp' ? '◆ LTP' : r.k}</span>
          <span className="nov-rung-v mono">{n2(r.v)}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ label, hint, children }) {
  return (
    <>
      <div className="nov-hr" />
      <div className="nov-sech">{label}{hint ? <span className="nov-asof">{hint}</span> : null}</div>
      {children}
    </>
  );
}

export default function NiftyOverview({ quote, spark, returns, trend, options, levels }) {
  const last = quote?.last;
  const pct = quote?.pct;
  const change = quote?.change;
  const rets = (returns || []).filter((r) => r && isFinite(r.pct));
  const trendRows = trend ? [['1W', trend['1W']], ['1M', trend['1M']], ['3M', trend['3M']], ['6M', trend['6M']], ['YTD', trend['YTD']], ['1Y', trend['1Y']]].filter(([, v]) => v != null) : [];
  const o = options && (options.pcr != null || options.atmIV != null || options.maxPain != null) ? options : null;
  const optAsOf = o?.asOf ? `${o.snapshot ? '' : ''}${String(o.asOf).replace(/:\d{2}$/, '')}` : null;

  return (
    <div className="card sec nov-panel">
      {/* hero */}
      <div className="nov-lbl">Nifty 50</div>
      <div className="nov-val">{n2(last)}</div>
      <div className={'nov-chg ' + cls(pct)}>
        {arr(pct)} {change != null && isFinite(change) ? Math.abs(change).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
        <span className="mut"> · </span>{pct != null && isFinite(pct) ? Math.abs(pct).toFixed(2) + '%' : '—'}
      </div>
      <Spark points={spark} up={pct == null || pct >= 0} />

      {/* last 5 sessions */}
      {rets.length > 0 && (
        <Section label="Last 5 sessions">
          <div className="nov-dret">
            {rets.map((r) => (
              <div className="nov-d" key={r.date}>
                <div className="nov-dk">{dayLbl(r.date)}</div>
                <div className={'nov-dv ' + cls(r.pct)}>{apct(r.pct)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* options analysis */}
      {o && (
        <Section label="Options" hint={optAsOf}>
          <div className="nov-opts2">
            <div className="nov-o"><div className="nov-ok">PCR</div><div className="nov-ov">{o.pcr != null ? o.pcr.toFixed(2) : '—'}</div></div>
            <div className="nov-o"><div className="nov-ok">ATM IV</div><div className="nov-ov">{o.atmIV != null ? o.atmIV.toFixed(2) : '—'}<small>%</small></div></div>
            <div className="nov-o"><div className="nov-ok">Max pain</div><div className="nov-ov">{n0(o.maxPain)}</div></div>
            <div className="nov-o"><div className="nov-ok">Expiry in</div><div className="nov-ov">{o.expiryInDays != null ? o.expiryInDays : '—'}<small>{o.expiryInDays === 1 ? 'day' : 'days'}</small></div></div>
          </div>
        </Section>
      )}

      {/* support & resistance */}
      <Section label="Support / resistance" hint={levels?.asOf && !levels.stale ? dayLbl(levels.asOf) : null}>
        <Ladder lv={levels} last={last} />
      </Section>

      {/* trend */}
      {trendRows.length > 0 && (
        <Section label="Trend">
          <div className="nov-trend2">
            {trendRows.map(([k, v]) => (
              <div className="nov-tw" key={k}>
                <span className="nov-tk">{k}</span>
                <span className={'nov-tv ' + cls(v)}>{apct(v)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
