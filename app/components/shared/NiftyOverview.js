'use client';

// Nifty 50 Overview — a scannable index card stack for the India Wrap view:
//   • hero: level + day change + intraday sparkline
//   • daily returns: the week's session-by-session moves
//   • options analysis: PCR / ATM IV / max pain / expiry-in (NSE option chain,
//     laptop-captured with a live-NSE best-effort refresh; hidden when unavailable)
//   • support & resistance: classic pivots on a horizontal rail + the live LTP mark
//   • trend: 1W / 1M / 3M / 6M / 1Y
// Every block is live or honestly hidden — nothing fabricated. Direction is carried
// by COLOUR + a ▲/▼ arrow, never a +/− glyph (house rule), matching the Wrap ticker.

import { smoothPath } from '../../lib/smoothPath';

const cls = (p) => (p == null || !isFinite(p) ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');
const arr = (p) => (p == null || !isFinite(p) ? '·' : p > 0 ? '▲' : p < 0 ? '▼' : '·');
const apct = (p) => (p == null || !isFinite(p) ? '—' : `${arr(p)}${Math.abs(p).toFixed(2)}%`);
const n2 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const n0 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const dayLbl = (d) => { const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

// ── Hero sparkline: intraday close path, coloured by the day's direction ──────
function Spark({ points, up }) {
  const ys = (points || []).map((p) => p?.c).filter((c) => c != null && isFinite(c));
  if (ys.length < 3) return <div className="nov-spark nov-spark-empty" aria-hidden />;
  const W = 210, H = 66, PAD = 4;
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
      <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(ys.length - 1)} cy={y(ys[ys.length - 1])} r="3" fill={col} />
    </svg>
  );
}

// ── Support & resistance rail: 7 evenly-spaced rungs (S3..PP..R3), value labels
// above, and the LTP marker interpolated to where the live level sits between the
// two rungs that bracket it. Levels are deterministic pivots, not a call. ───────
function SRRail({ lv, last }) {
  if (!lv || lv.stale) {
    return <div className="mac-stale nov-sr-stale">Levels unavailable{lv?.error ? ` — ${lv.error}` : ''} — Yahoo feed not reachable this run.</div>;
  }
  // value-ascending rungs
  const rungs = [
    { k: 'S3', v: lv.s3, t: 'sup' }, { k: 'S2', v: lv.s2, t: 'sup' }, { k: 'S1', v: lv.s1, t: 'sup' },
    { k: 'Pivot', v: lv.pp, t: 'pp' },
    { k: 'R1', v: lv.r1, t: 'res' }, { k: 'R2', v: lv.r2, t: 'res' }, { k: 'R3', v: lv.r3, t: 'res' },
  ];
  const W = 700, H = 210, y0 = 130, x0 = 50, x1 = 650;
  const xs = rungs.map((_, i) => x0 + (i / (rungs.length - 1)) * (x1 - x0));
  const vals = rungs.map((r) => r.v);
  // LTP x: piecewise-linear between the bracketing rungs (rungs are evenly spaced,
  // values are not) — clamped to the rail ends when the level is beyond S3 / R3.
  let ltpX = null;
  if (last != null && isFinite(last) && vals.every((v) => v != null)) {
    if (last <= vals[0]) ltpX = xs[0];
    else if (last >= vals[vals.length - 1]) ltpX = xs[xs.length - 1];
    else for (let i = 0; i < vals.length - 1; i++) {
      if (last >= vals[i] && last <= vals[i + 1]) { ltpX = xs[i] + ((last - vals[i]) / (vals[i + 1] - vals[i])) * (xs[i + 1] - xs[i]); break; }
    }
  }
  const labY = (i) => (i % 2 === 0 ? 60 : 82); // stagger so adjacent labels don't collide
  return (
    <div className="nov-sr-wrap">
      <svg className="nov-sr" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Support and resistance pivots">
        {/* baseline: green support half, red resistance half */}
        <line x1={x0} y1={y0} x2={xs[3]} y2={y0} stroke="var(--grn)" strokeWidth="3" />
        <line x1={xs[3]} y1={y0} x2={x1} y2={y0} stroke="var(--red)" strokeWidth="3" />
        {rungs.map((r, i) => {
          const col = r.t === 'pp' ? 'var(--txt)' : r.t === 'sup' ? 'var(--grn)' : 'var(--red)';
          const lc = r.t === 'sup' ? 'var(--grn)' : r.t === 'res' ? 'var(--red)' : 'var(--txt2)';
          if (r.t === 'pp') {
            return (
              <g key={r.k}>
                <line x1={xs[i]} y1={y0} x2={xs[i]} y2={104} stroke="var(--txt3)" strokeWidth="1" strokeDasharray="3 3" />
                <rect className="nov-piv" x={xs[i] - 44} y={78} width="88" height="26" rx="6" />
                <text className="nov-piv-t" x={xs[i]} y={95} textAnchor="middle">{n2(r.v)}</text>
                <circle cx={xs[i]} cy={y0} r="7.5" fill="var(--bg)" stroke="var(--txt)" strokeWidth="2.5" />
                <text className="nov-sr-k" x={xs[i]} y={160} fill={lc} textAnchor="middle">{r.k}</text>
              </g>
            );
          }
          return (
            <g key={r.k}>
              <line x1={xs[i]} y1={y0} x2={xs[i]} y2={labY(i) + 10} stroke={col} strokeWidth="1" strokeDasharray="3 3" opacity=".55" />
              <text className="nov-sr-v" x={xs[i]} y={labY(i)} fill={col} textAnchor="middle">{n2(r.v)}</text>
              <circle cx={xs[i]} cy={y0} r="6.5" fill={col} stroke="var(--bg)" strokeWidth="2" />
              <text className="nov-sr-k" x={xs[i]} y={160} fill={lc} textAnchor="middle">{r.k}</text>
            </g>
          );
        })}
        {ltpX != null && (
          <g>
            <line x1={ltpX} y1={135} x2={ltpX} y2={176} stroke="var(--sc-opt)" strokeWidth="1.5" strokeDasharray="2 2" />
            <circle cx={ltpX} cy={y0} r="5" fill="var(--sc-opt)" />
            <rect x={ltpX - 27} y={176} width="54" height="22" rx="6" fill="var(--sc-opt)" />
            <text className="nov-ltp-t" x={ltpX} y={191} textAnchor="middle">LTP</text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function NiftyOverview({ quote, spark, returns, trend, options, levels }) {
  const last = quote?.last;
  const pct = quote?.pct;
  const change = quote?.change;
  const rets = (returns || []).filter((r) => r && isFinite(r.pct));
  const trendRows = trend ? [['1W', trend['1W']], ['1M', trend['1M']], ['3M', trend['3M']], ['6M', trend['6M']], ['1Y', trend['1Y']]].filter(([, v]) => v != null) : [];
  const o = options && (options.pcr != null || options.atmIV != null || options.maxPain != null) ? options : null;

  return (
    <div className="nov">
      {/* ── hero + daily returns ─────────────────────────────────────────── */}
      <div className="card sec nov-card">
        <div className="nov-hero">
          <div>
            <div className="nov-lbl">Nifty 50</div>
            <div className="nov-val">{n2(last)}</div>
            <div className={'nov-chg ' + cls(pct)}>
              {arr(pct)} {change != null && isFinite(change) ? Math.abs(change).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
              <span className="mut"> · </span>{pct != null && isFinite(pct) ? Math.abs(pct).toFixed(2) + '%' : '—'}
            </div>
          </div>
          <Spark points={spark} up={pct == null || pct >= 0} />
        </div>
        {rets.length > 0 && (
          <>
            <div className="nov-divide" />
            <div className="nov-dret">
              {rets.map((r) => (
                <div className="nov-d" key={r.date}>
                  <div className="nov-dk">{dayLbl(r.date)}</div>
                  <div className={'nov-dv ' + cls(r.pct)}>{apct(r.pct)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── options analysis (hidden when the chain is unavailable) ───────── */}
      {o && (
        <div className="card sec nov-card">
          <div className="wlabel">Options analysis
            <span className="hint">NSE option chain{o.asOf ? ` · ${o.snapshot ? 'as of ' : ''}${String(o.asOf).replace(/:\d{2}$/, '')}` : ''}</span>
          </div>
          <div className="nov-opts">
            <div className="nov-o"><div className="nov-ok">PCR</div><div className="nov-ov">{o.pcr != null ? o.pcr.toFixed(2) : '—'}</div></div>
            <div className="nov-o"><div className="nov-ok">ATM IV</div><div className="nov-ov">{o.atmIV != null ? o.atmIV.toFixed(2) : '—'}<small>%</small></div></div>
            <div className="nov-o"><div className="nov-ok">Max pain</div><div className="nov-ov">{n0(o.maxPain)}</div></div>
            <div className="nov-o"><div className="nov-ok">Expiry in</div><div className="nov-ov">{o.expiryInDays != null ? o.expiryInDays : '—'}<small>{o.expiryInDays === 1 ? 'day' : 'days'}</small></div></div>
          </div>
        </div>
      )}

      {/* ── support & resistance ─────────────────────────────────────────── */}
      <div className="card sec nov-card">
        <div className="wlabel">Support &amp; resistance
          <span className="hint">classic pivots{levels?.asOf && !levels.stale ? ` · prior session ${dayLbl(levels.asOf)}` : ''}</span>
        </div>
        <SRRail lv={levels} last={last} />
      </div>

      {/* ── trend (hidden when no window resolved) ───────────────────────── */}
      {trendRows.length > 0 && (
        <div className="card sec nov-card">
          <div className="wlabel">Trend <span className="hint">close vs N ago</span></div>
          <div className="nov-trend">
            {trendRows.map(([k, v]) => (
              <div className="nov-t" key={k}>
                <div className="nov-tk">{k}</div>
                <div className={'nov-tv ' + cls(v)}>{apct(v)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
