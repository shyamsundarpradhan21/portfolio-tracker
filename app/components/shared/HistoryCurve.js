'use client';

// Portfolio trajectory: ledger-reconstructed + real snapshot history flowing
// through today's LIVE net worth into the projection fan (the same shared
// model the Projected Outlook card runs — lib/projection). Time-proportional
// x-axis so daily, weekly and monthly points share one honest timeline.
//
//   past   — invested area, total-assets line, net-worth line, liabilities
//   future — conservative→optimistic fan around the dashed base case,
//            invested continuing with planned contributions, and the loan
//            EMI rundown projected by loanOutstanding()
//
// Past window: D / W / M / Y / 5Y / Max · Future horizon: off / 1Y / 5Y / 10Y / 30Y

import { useState, useMemo } from 'react';
import { InrC } from '../../lib/fmt';
import { PROJECTION, loanOutstanding } from '../../portfolio';
import { simMonthly } from '../../lib/projection';

const W = 640, H = 160;
const RANGES = [
  { key: 'D',   days: 1 },
  { key: 'W',   days: 7 },
  { key: 'M',   days: 30 },
  { key: 'Y',   days: 365 },
  { key: '5Y',  days: 1825 },
  { key: 'Max', days: null },
];
const FUTURES = [
  { key: 'off', y: 0 },
  { key: '+1Y', y: 1 },
  { key: '+5Y', y: 5 },
  { key: '+10Y', y: 10 },
  { key: '+30Y', y: 30 },
];

const isoOf = (d) => d.toISOString().slice(0, 10);
function subDays(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - days);
  return isoOf(d);
}
function addMonths(isoDate, m) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + m);
  return isoOf(d);
}

export default function HistoryCurve({ snapshots, nw, invested0 }) {
  const [range, setRange] = useState('Max');
  const [futSel, setFutSel] = useState(5);

  const all = (snapshots || []).filter((s) => s && s.d && Number.isFinite(s.nw));

  const pts = useMemo(() => {
    if (!all.length) return [];
    const r = RANGES.find((r) => r.key === range);
    if (!r || r.days == null) return all;
    const cutoff = subDays(all[all.length - 1].d, r.days);
    const filtered = all.filter((s) => s.d >= cutoff);
    return filtered.length >= 2 ? filtered : all.slice(-2);
  }, [all, range]);

  // Future fan: shared model from today's live net worth + cost basis.
  // Liabilities ride loanOutstanding's EMI simulation until the loan closes.
  const fut = useMemo(() => {
    if (!futSel || nw == null) return null;
    const today = all.length ? all[all.length - 1].d : isoOf(new Date());
    const months = futSel * 12;
    const sims = {};
    for (const s of PROJECTION.scenarios) sims[s.key] = simMonthly(s.rate, nw, invested0 ?? nw, months);
    const rows = [];
    for (let m = 0; m <= months; m++) {
      const d = addMonths(today, m);
      rows.push({
        d,
        cons: sims.cons.corpus[m],
        base: sims.base.corpus[m],
        opt: sims.opt.corpus[m],
        invested: sims.base.invested[m],
        loan: loanOutstanding(d),
      });
    }
    return rows;
  }, [futSel, nw, invested0, all]);

  const n = pts.length;

  if (all.length < 2) {
    return (
      <div className="card sec">
        <div className="lbl">Portfolio trajectory</div>
        <div className="sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Building your history — <strong>{all.length}</strong> day{all.length === 1 ? '' : 's'} recorded so far.
          A snapshot of net worth, total assets and invested capital is saved each day you open the
          dashboard; the curve appears once a few days are logged.
        </div>
      </div>
    );
  }

  // ── one time-proportional x-axis across past + future ────────────────────
  const ms = (iso) => new Date(iso + 'T00:00:00Z').getTime();
  const t0 = ms(pts[0].d);
  const tToday = ms(pts[n - 1].d);
  const t1 = fut ? ms(fut[fut.length - 1].d) : tToday;
  const span = Math.max(1, t1 - t0);
  const X = (iso) => ((ms(iso) - t0) / span) * W;

  const assets = pts.map((s) => s.assets ?? s.nw ?? 0);
  const loanPast = pts.map((s) => (s.assets ?? s.nw ?? 0) - (s.nw ?? 0));
  const hasLoan = loanPast.some((v) => v > 0) || (fut ? fut.some((r) => r.loan > 0) : false);

  const mx = Math.max(1, ...assets, ...(fut ? fut.map((r) => r.opt) : []));
  const Y = (v) => H - (Math.max(0, v) / mx) * H;
  const at = (iso, v) => `${X(iso).toFixed(1)},${Y(v).toFixed(1)}`;
  const line = (rows, get) => `M${rows.map((r) => at(r.d, get(r))).join(' L')}`;

  // past: invested area + growth band + assets & nw lines
  const invPts = pts.map((s) => at(s.d, s.invested ?? 0));
  const futInvPts = fut ? fut.map((r) => at(r.d, r.invested)) : [];
  const invArea = `M${X(pts[0].d).toFixed(1)},${H} L` + [...invPts, ...futInvPts].join(' L') +
    ` L${(fut ? X(fut[fut.length - 1].d) : X(pts[n - 1].d)).toFixed(1)},${H} Z`;
  const growArea = `M${pts.map((s) => at(s.d, s.assets ?? s.nw ?? 0)).join(' L')} L` +
    pts.map((s) => at(s.d, s.invested ?? 0)).reverse().join(' L') + ' Z';
  const assetLine = line(pts, (s) => s.assets ?? s.nw ?? 0);
  const nwLine = line(pts, (s) => s.nw ?? 0);

  // future: cons→opt fan + dashed base case
  const fanArea = fut
    ? `M${fut.map((r) => at(r.d, r.opt)).join(' L')} L` + fut.map((r) => at(r.d, r.cons)).reverse().join(' L') + ' Z'
    : null;
  const baseLine = fut ? line(fut, (r) => r.base) : null;
  const consLine = fut ? line(fut, (r) => r.cons) : null;
  const optLine = fut ? line(fut, (r) => r.opt) : null;

  // liabilities: one dashed path across past + future
  const loanRows = [
    ...pts.map((s, i) => ({ d: s.d, v: loanPast[i] })),
    ...(fut ? fut.slice(1).map((r) => ({ d: r.d, v: r.loan })) : []),
  ];
  const loanLine = hasLoan ? line(loanRows, (r) => r.v) : null;

  const first = pts[0], last = pts[n - 1];
  const change = (last.nw ?? 0) - (first.nw ?? 0);
  const up = change >= 0;
  const liveLoan = loanPast[n - 1];
  const xToday = X(last.d);
  const todayPct = (xToday / W) * 100;
  const endYear = fut ? fut[fut.length - 1].d.slice(0, 4) : null;
  const baseEnd = fut ? fut[fut.length - 1].base : null;

  const pill = (on) => ({
    padding: '3px 7px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: '0.7rem',
    background: on ? 'var(--acc)' : 'var(--bg3)',
    color: on ? 'var(--bg)' : 'var(--txt2)',
    fontWeight: on ? 700 : 400,
  });

  return (
    <div className="card sec">
      <div className="fxc" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="fxc" style={{ margin: 0 }}>
            <div className="lbl" style={{ margin: 0 }}>Portfolio trajectory</div>
            <div className="sub" style={{ margin: 0 }}>{first.d} → {last.d} · {n} pts{pts.some((s) => s.synth) ? ' · ledger-reconstructed' : ''}</div>
          </div>
          <div className="pj-big" style={{ color: up ? 'var(--grn)' : 'var(--red)', marginTop: 4 }}>
            {up ? '+' : '−'}<InrC n={Math.abs(change)} />
          </div>
          <div className="sub">net worth change · {pts[0].synth ? 'first deployment' : 'first snapshot'}</div>
          {fut && nw > 0 && (
            <div className="sub" style={{ color: 'var(--sc-base)' }}>
              base case <InrC n={baseEnd} /> by {endYear} · ×{(baseEnd / nw).toFixed(1)}
            </div>
          )}
        </div>
        {/* past window · future horizon */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)} style={pill(range === r.key)}>{r.key}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {FUTURES.map((f) => (
              <button key={f.key} onClick={() => setFutSel(f.y)} style={pill(futSel === f.y)}>{f.key}</button>
            ))}
          </div>
        </div>
      </div>

      <svg className="svgchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ width: '100%', height: 168, marginTop: 12 }}>
        <path d={invArea} fill="var(--txt3)" opacity="0.14" />
        <path d={growArea} fill="var(--grn)" opacity="0.16" />
        <path d={assetLine} fill="none" stroke="var(--grn)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={nwLine} fill="none" stroke="var(--acc)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {fut && (
          <>
            <path d={fanArea} fill="var(--sc-base)" opacity="0.10" />
            <path d={consLine} fill="none" stroke="var(--sc-cons)" strokeWidth="1" opacity="0.55" vectorEffect="non-scaling-stroke" />
            <path d={optLine} fill="none" stroke="var(--sc-opt)" strokeWidth="1" opacity="0.55" vectorEffect="non-scaling-stroke" />
            <path d={baseLine} fill="none" stroke="var(--sc-base)" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </>
        )}
        {loanLine && (
          <path d={loanLine} fill="none" stroke="var(--red)" strokeWidth="1.5"
            strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        )}
        {fut && (
          <path d={`M${xToday.toFixed(1)},0 L${xToday.toFixed(1)},${H}`} stroke="var(--txt3)"
            strokeWidth="1" strokeDasharray="2 4" opacity="0.5" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {/* timeline strip: start · today · horizon end */}
      <div style={{ position: 'relative', height: 14, marginTop: 2 }} className="sub">
        <span style={{ position: 'absolute', left: 0 }}>{first.d.slice(0, 7)}</span>
        {fut ? (
          <>
            <span style={{ position: 'absolute', left: `${todayPct}%`, transform: 'translateX(-50%)', color: 'var(--acc)' }}>today</span>
            <span style={{ position: 'absolute', right: 0 }}>{endYear}</span>
          </>
        ) : (
          <span style={{ position: 'absolute', right: 0 }}>today</span>
        )}
      </div>

      <div className="fxc sub" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
        <span><span style={{ color: 'var(--txt3)' }}>▇</span> invested</span>
        <span><span style={{ color: 'var(--grn)' }}>▇</span> total assets</span>
        <span><span style={{ color: 'var(--acc)' }}>—</span> net worth</span>
        {fut && <span><span style={{ color: 'var(--sc-base)' }}>╌</span> projected {PROJECTION.scenarios.map((s) => (s.rate * 100).toFixed(0)).join('/')}%</span>}
        {hasLoan && (
          <span>
            <span style={{ color: 'var(--red)' }}>╌</span> liabilities
            {liveLoan > 0 && <span style={{ marginLeft: 4 }}>(<InrC n={liveLoan} />)</span>}
          </span>
        )}
      </div>
      <div className="sub" style={{ marginTop: 10, color: 'var(--txt3)', lineHeight: 1.6 }}>
        A snapshot is saved each day you open the dashboard; earlier points are reconstructed from the ledgers. The gap between total assets and net worth is the loan — watch it close as liabilities amortise.
      </div>
    </div>
  );
}
