'use client';
// Shared intraday P&L chart. The bold line is the aggregate net P&L, green above 0 /
// red below. Each per-component leg (Dhan/Upstox/Fyers brokers, or the Overview's
// eq/us/fno sleeves) is overlaid as a DASHED coloured line. A faint NIFTY 50 line sits
// behind as a market-direction watermark. The current net + each leg's current value
// are labelled at the RIGHT edge, anchored to their line's last point so the figures
// ride the curve. Hovering anywhere drops a cursor and a tooltip with the full
// breakdown (net + every leg) at that minute. Axis labels derive from the scaled pts.
//
// NB: legs are per-BROKER (the capture tape carries dhan/upstox/fyers), not per-trade —
// per-position hover would need the daemon to capture each leg's P&L over time.
import { useState } from 'react';
import { scaleLines, scaleCandles } from '../../lib/pnlDaily';

// Default overlay = the three F&O brokers. The Overview live curve passes its own
// (F&O / equity / US sleeves). Each entry: { key, c (colour), label }.
const BROKER = [
  { key: 'dhan', c: '#7C9CF0', label: 'Dhan' },
  { key: 'upstox', c: '#C99BE8', label: 'Upstox' },
  { key: 'fyers', c: '#5FC9B5', label: 'Fyers' },
];

// Compact ₹ for in-chart labels (no +/- glyph — direction is by COLOUR).
const f = (v) => {
  const a = Math.abs(Math.round(v));
  return a >= 1e5 ? '₹' + (a / 1e5).toFixed(2) + 'L' : a >= 1e3 ? '₹' + (a / 1e3).toFixed(1) + 'K' : '₹' + a;
};
const dirColor = (v) => (v >= 0 ? 'var(--grn)' : 'var(--red)');

export default function IntradayChart({ tape, candles = null, pending = false, overlays = BROKER, ariaLabel = 'Intraday P&L' }) {
  const LABEL_W = 54, W = 660, PLOT_W = W - LABEL_W, H = 200; // tight right strip, values right-justified
  const [hov, setHov] = useState(null);   // hovered point index

  const pts = (tape || []).filter((p) => p && p.t != null && Number.isFinite(+p.net));
  const present = overlays.filter((o) => pts.some((p) => p && p[o.key] != null));
  const overlay = present.length > 1;     // only split out legs when there's more than one
  const g = scaleLines(pts, ['net', ...(overlay ? present.map((o) => o.key) : [])], PLOT_W, H);
  if (!g || !g.byKey.net) return null;
  const nifty = scaleCandles(candles, PLOT_W, H);
  const path = (a) => (a || []).filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');

  const net = g.byKey.net;
  const n = net.length;
  const lastNet = net[n - 1];
  const netVal = +pts[n - 1].net;
  const curColor = dirColor(netVal);
  const uid = `iq-${n}-${Math.round(g.zeroY)}`;

  // map a viewBox-x onto the nearest tape index (over the plot area only)
  const idxAt = (xvb) => {
    const frac = Math.max(0, Math.min(1, (xvb - 8) / (PLOT_W - 16)));
    return Math.round(frac * (n - 1));
  };
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHov(idxAt(((e.clientX - r.left) / r.width) * W));
  };
  const hp = hov != null && hov >= 0 && hov < n ? net[hov] : null;
  const ht = hp ? pts[hov] : null;

  // right-edge value labels at each line's last y. Net = bold sign-colour; each leg =
  // DIMMED sign-colour (the global +/- codes, NOT the line colour — direction must read
  // at a glance and stay subordinate to the net). Which leg is which reads off its line.
  const labels = [{ y: lastNet.y, v: netVal, c: curColor, bold: true, dim: false }];
  if (overlay) for (const o of present) {
    const arr = g.byKey[o.key];
    if (arr && arr[arr.length - 1]) {
      const v = +pts[n - 1][o.key];
      labels.push({ y: arr[arr.length - 1].y, v, c: dirColor(v), bold: false, dim: true });
    }
  }
  // tooltip rows for the hovered minute — values by sign (the label names the leg)
  const tipRows = ht ? [{ label: 'Net', v: +ht.net, c: dirColor(+ht.net) }, ...(overlay ? present
    .filter((o) => Number.isFinite(+ht[o.key]))
    .map((o) => ({ label: o.label, v: +ht[o.key], c: dirColor(+ht[o.key]) })) : [])] : [];
  const tipW = 96, tipH = 16 + tipRows.length * 15;
  const tipX = hp ? Math.max(2, Math.min(PLOT_W - tipW - 2, hp.x + 8)) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H + 34}`} width="100%" height="auto" style={{ marginTop: 12, display: 'block' }}
      role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHov(null)}>
      <clipPath id={`up-${uid}`}><rect x="0" y="0" width={PLOT_W} height={g.zeroY} /></clipPath>
      <clipPath id={`dn-${uid}`}><rect x="0" y={g.zeroY} width={PLOT_W} height={H - g.zeroY} /></clipPath>

      {/* NIFTY 50 watermark — faint OHLC candles behind everything */}
      {nifty && (
        <g opacity=".22">
          {nifty.bars.map((c, i) => {
            const colr = c.up ? 'var(--grn)' : 'var(--red)';
            const top = Math.min(c.openY, c.closeY), hh = Math.max(1, Math.abs(c.closeY - c.openY));
            return (
              <g key={i}>
                <line x1={c.x} y1={c.highY} x2={c.x} y2={c.lowY} stroke={colr} strokeWidth=".6" />
                <rect x={c.x - nifty.bw / 2} y={top} width={nifty.bw} height={hh} fill={colr} />
              </g>
            );
          })}
        </g>
      )}

      <line x1="0" y1={g.zeroY} x2={PLOT_W} y2={g.zeroY} stroke="var(--txt3)" strokeWidth=".5" strokeDasharray="2 3" />

      {/* per-leg overlay — DASHED, coloured */}
      {overlay && present.map((o) => g.byKey[o.key]
        ? <path key={o.key} d={path(g.byKey[o.key])} fill="none" stroke={o.c} strokeWidth="1.3" strokeDasharray="4 3" opacity=".85" />
        : null)}

      {/* aggregate net — bold, green/red split */}
      <path d={path(net)} fill="none" stroke="var(--grn)" strokeWidth="2" clipPath={`url(#up-${uid})`} />
      <path d={path(net)} fill="none" stroke="var(--red)" strokeWidth="2" clipPath={`url(#dn-${uid})`} />
      <line x1="0" y1={lastNet.y} x2={PLOT_W} y2={lastNet.y} stroke={curColor} strokeWidth=".7" strokeDasharray="4 3" opacity=".5" />
      <circle cx={lastNet.x} cy={lastNet.y} r="3.5" fill={curColor} />
      {pending ? <line x1="0" y1={g.zeroY - 0.1} x2={PLOT_W} y2={g.zeroY - 0.1} stroke="var(--acc)" strokeWidth=".7" strokeDasharray="6 4" opacity=".5" /> : null}

      {/* right-edge value labels, riding each line's last point */}
      {labels.map((l, i) => (
        <text key={i} x={W - 3} textAnchor="end" y={Math.max(9, Math.min(H - 2, l.y + 3))} fill={l.c}
          opacity={l.dim ? 0.6 : 1} style={{ fontSize: l.bold ? 13 : 11, fontWeight: l.bold ? 700 : 600 }}>{f(l.v)}</text>
      ))}

      {/* hover cursor + tooltip */}
      {hp && (
        <g>
          <line x1={hp.x} y1="0" x2={hp.x} y2={H} stroke="var(--txt3)" strokeWidth=".7" opacity=".6" />
          <circle cx={hp.x} cy={hp.y} r="3" fill={curColor} />
          <g transform={`translate(${tipX} 4)`}>
            <rect width={tipW} height={tipH} rx="4" fill="var(--bg2, #1b1f2a)" stroke="var(--brd)" strokeWidth=".5" opacity=".96" />
            <text x="7" y="13" className="pnl-axt" style={{ fontWeight: 600 }}>{ht.t}</text>
            {tipRows.map((row, i) => (
              <g key={i} transform={`translate(7 ${27 + i * 15})`}>
                <text x="0" y="0" fill="var(--txt2)" style={{ fontSize: 10 }}>{row.label}</text>
                <text x={tipW - 14} y="0" textAnchor="end" fill={row.c} style={{ fontSize: 10, fontWeight: 600 }}>{f(row.v)}</text>
              </g>
            ))}
          </g>
        </g>
      )}

      <text x="2" y={H + 16} className="pnl-axt">{net[0].t}</text>
      <text x={PLOT_W / 2} y={H + 16} className="pnl-axt" textAnchor="middle">{net[Math.floor(n / 2)].t}</text>
      <text x={PLOT_W} y={H + 16} className="pnl-axt" textAnchor="end">{lastNet.t}{pending ? ' · pending order' : ''}</text>

      {/* legend (only when overlaying or watermark present) */}
      {(overlay || nifty) && (
        <g transform={`translate(2 ${H + 30})`} className="pnl-axt">
          {overlay && present.map((o, i) => (
            <g key={o.key} transform={`translate(${i * 70} 0)`}>
              <line x1="0" y1="-4" x2="9" y2="-4" stroke={o.c} strokeWidth="1.6" strokeDasharray="3 2" />
              <text x="13" y="0">{o.label}</text>
            </g>
          ))}
          {nifty && (
            <g transform={`translate(${overlay ? present.length * 70 : 0} 0)`}>
              <rect x="0" y="-7" width="9" height="3" rx="1" fill="var(--txt2)" opacity=".4" />
              <text x="13" y="0">NIFTY 50</text>
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
