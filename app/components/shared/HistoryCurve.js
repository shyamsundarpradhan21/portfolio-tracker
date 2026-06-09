'use client';

// Historical portfolio-growth curve, built from persisted daily snapshots.
// Bottom band = invested (cost basis); top band = total assets; the gap is
// accumulated growth. Until a few days of history exist it shows a friendly
// "building history" state instead of a misleading flat line.

import { InrC } from '../../lib/fmt';

const W = 640, H = 150;

export default function HistoryCurve({ snapshots }) {
  const pts = (snapshots || []).filter((s) => s && s.d && Number.isFinite(s.nw));
  const n = pts.length;

  if (n < 2) {
    return (
      <div className="card sec">
        <div className="lbl">Portfolio growth</div>
        <div className="sub" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Building your history — <strong>{n}</strong> day{n === 1 ? '' : 's'} recorded so far.
          A snapshot of net worth, total assets and invested capital is saved each day you open the
          dashboard; the curve appears once a few days are logged.
        </div>
      </div>
    );
  }

  const assets = pts.map((s) => s.assets ?? s.nw ?? 0);
  const inv = pts.map((s) => s.invested ?? 0);
  const mx = Math.max(1, ...assets);
  const X = (i) => (i / (n - 1)) * W;
  const Y = (v) => H - (v / mx) * H;
  const at = (i, v) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`;

  const invArea = `M0,${H} ` + inv.map((v, i) => `L${at(i, v)}`).join(' ') + ` L${W},${H} Z`;
  const top = assets.map((v, i) => at(i, v));
  const bot = inv.map((v, i) => at(i, v)).reverse();
  const growArea = `M${top.join(' L')} L${bot.join(' L')} Z`;
  const valLine = `M${assets.map((v, i) => at(i, v)).join(' L')}`;

  const first = pts[0], last = pts[n - 1];
  const change = (last.nw ?? 0) - (first.nw ?? 0);
  const up = change >= 0;

  return (
    <div className="card sec">
      <div className="fxc">
        <div className="lbl" style={{ margin: 0 }}>Portfolio growth</div>
        <div className="sub" style={{ margin: 0 }}>{first.d} → {last.d} · {n} snapshots</div>
      </div>
      <div className="pj-big" style={{ color: up ? 'var(--grn)' : 'var(--red)', marginTop: 6 }}>
        {up ? '+' : '−'}<InrC n={Math.abs(change)} />
      </div>
      <div className="sub">net worth change since first snapshot</div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ width: '100%', height: 168, marginTop: 14, display: 'block', overflow: 'visible' }}>
        <path d={invArea} fill="var(--txt3)" opacity="0.18" />
        <path d={growArea} fill="var(--grn)" opacity="0.16" />
        <path d={valLine} fill="none" stroke="var(--grn)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="fxc sub" style={{ marginTop: 6 }}>
        <span><span style={{ color: 'var(--txt3)' }}>▇</span> invested</span>
        <span><span style={{ color: 'var(--grn)' }}>▇</span> total assets</span>
      </div>
    </div>
  );
}
