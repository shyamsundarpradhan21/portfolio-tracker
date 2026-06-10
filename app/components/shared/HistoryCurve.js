'use client';

import { useState, useMemo } from 'react';
import { InrC } from '../../lib/fmt';

const W = 640, H = 160;
const RANGES = [
  { key: 'D',  label: 'D',   days: 1   },
  { key: 'W',  label: 'W',   days: 7   },
  { key: 'M',  label: 'M',   days: 30  },
  { key: 'Y',  label: 'Y',   days: 365 },
  { key: '5Y', label: '5Y',  days: 1825 },
  { key: 'Max',label: 'Max', days: null },
];

function subDays(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function HistoryCurve({ snapshots }) {
  const [range, setRange] = useState('Max');

  const all = (snapshots || []).filter((s) => s && s.d && Number.isFinite(s.nw));

  const pts = useMemo(() => {
    if (!all.length) return [];
    const r = RANGES.find((r) => r.key === range);
    if (!r || r.days == null) return all;
    const cutoff = subDays(all[all.length - 1].d, r.days);
    const filtered = all.filter((s) => s.d >= cutoff);
    return filtered.length >= 2 ? filtered : all.slice(-2);
  }, [all, range]);

  const n = pts.length;

  if (all.length < 2) {
    return (
      <div className="card sec">
        <div className="lbl">Portfolio growth</div>
        <div className="sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Building your history — <strong>{all.length}</strong> day{all.length === 1 ? '' : 's'} recorded so far.
          A snapshot of net worth, total assets and invested capital is saved each day you open the
          dashboard; the curve appears once a few days are logged.
        </div>
      </div>
    );
  }

  const assets   = pts.map((s) => s.assets ?? s.nw ?? 0);
  const inv      = pts.map((s) => s.invested ?? 0);
  const loan     = pts.map((s) => (s.assets ?? s.nw ?? 0) - (s.nw ?? 0)); // liabilities = assets - nw
  const hasLoan  = loan.some((v) => v > 0);

  const mx = Math.max(1, ...assets);
  const X  = (i) => (i / (n - 1)) * W;
  const Y  = (v) => H - (v / mx) * H;
  const at = (i, v) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`;

  const invArea  = `M0,${H} ` + inv.map((v, i) => `L${at(i, v)}`).join(' ') + ` L${W},${H} Z`;
  const top      = assets.map((v, i) => at(i, v));
  const bot      = inv.map((v, i) => at(i, v)).reverse();
  const growArea = `M${top.join(' L')} L${bot.join(' L')} Z`;
  const valLine  = `M${assets.map((v, i) => at(i, v)).join(' L')}`;
  const loanLine = hasLoan ? `M${loan.map((v, i) => at(i, v)).join(' L')}` : null;

  const first  = pts[0], last = pts[n - 1];
  const change = (last.nw ?? 0) - (first.nw ?? 0);
  const up     = change >= 0;
  const lastLoan = loan[n - 1];

  return (
    <div className="card sec">
      <div className="fxc" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="fxc" style={{ margin: 0 }}>
            <div className="lbl" style={{ margin: 0 }}>Portfolio growth</div>
            <div className="sub" style={{ margin: 0 }}>{first.d} → {last.d} · {n} pts{pts.some((s) => s.synth) ? ' · ledger-reconstructed' : ''}</div>
          </div>
          <div className="pj-big" style={{ color: up ? 'var(--grn)' : 'var(--red)', marginTop: 4 }}>
            {up ? '+' : '−'}<InrC n={Math.abs(change)} />
          </div>
          <div className="sub">net worth change · {pts[0].synth ? 'first deployment' : 'first snapshot'}</div>
        </div>
        {/* Range selector */}
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)} style={{
              padding: '3px 7px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: '0.7rem',
              background: range === r.key ? 'var(--acc)' : 'var(--bg3)',
              color: range === r.key ? 'var(--bg)' : 'var(--txt2)',
              fontWeight: range === r.key ? 700 : 400,
            }}>{r.label}</button>
          ))}
        </div>
      </div>

      <svg className="svgchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ width: '100%', height: 168, marginTop: 12 }}>
        <path d={invArea} fill="var(--txt3)" opacity="0.18" />
        <path d={growArea} fill="var(--grn)" opacity="0.16" />
        <path d={valLine} fill="none" stroke="var(--grn)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {loanLine && (
          <path d={loanLine} fill="none" stroke="var(--red)" strokeWidth="1.5"
            strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        )}
      </svg>

      <div className="fxc sub" style={{ marginTop: 6 }}>
        <span><span style={{ color: 'var(--txt3)' }}>▇</span> invested</span>
        <span><span style={{ color: 'var(--grn)' }}>▇</span> total assets</span>
        {hasLoan && (
          <span>
            <span style={{ color: 'var(--red)' }}>╌</span> liabilities
            {lastLoan > 0 && <span style={{ marginLeft: 4 }}>(<InrC n={lastLoan} />)</span>}
          </span>
        )}
      </div>
    </div>
  );
}
