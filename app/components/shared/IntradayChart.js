'use client';
// Shared intraday P&L chart. The bold line is the aggregate net P&L, green above
// 0 / red below, with a dashed reference line + dot at the CURRENT value. When the
// tape carries per-broker components (Dhan/Upstox/Fyers), each is overlaid as a
// muted coloured line. A faint NIFTY 50 line sits behind as a market-direction
// watermark (its own index scale — not the ₹ axis). Axis labels derive from the
// same scaled points. Equity tapes (net only) degrade to just the bold line.
import { scaleLines, scaleCandles } from '../../lib/pnlDaily';

const BROKER = { dhan: { c: '#7C9CF0', label: 'Dhan' }, upstox: { c: '#C99BE8', label: 'Upstox' }, fyers: { c: '#5FC9B5', label: 'Fyers' } };

export default function IntradayChart({ tape, candles = null, pending = false, ariaLabel = 'Intraday P&L' }) {
  const W = 660, H = 200;
  const brokerKeys = ['dhan', 'upstox', 'fyers'].filter((k) => (tape || []).some((p) => p && p[k] != null));
  const overlay = brokerKeys.length > 1;                  // only overlay when there's a split to show
  const g = scaleLines(tape, ['net', ...(overlay ? brokerKeys : [])], W, H);
  if (!g || !g.byKey.net) return null;
  const nifty = scaleCandles(candles, W, H);            // real 1-min OHLC watermark
  const path = (a) => (a || []).filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');

  const net = g.byKey.net;
  const dNet = path(net);
  const uid = `iq-${net.length}-${Math.round(g.zeroY)}`;
  const last = net[net.length - 1];
  const ud = (tape[tape.length - 1]?.net ?? 0) >= 0;
  const curColor = ud ? 'var(--grn)' : 'var(--red)';
  const mid = net[Math.floor(net.length / 2)];

  return (
    <svg viewBox={`0 0 ${W} ${H + 34}`} width="100%" height="auto" style={{ marginTop: 12, display: 'block' }} role="img" aria-label={ariaLabel}>
      <clipPath id={`up-${uid}`}><rect x="0" y="0" width={W} height={g.zeroY} /></clipPath>
      <clipPath id={`dn-${uid}`}><rect x="0" y={g.zeroY} width={W} height={H - g.zeroY} /></clipPath>

      {/* NIFTY 50 watermark — faint OHLC candlesticks behind everything */}
      {nifty && (
        <g opacity=".22">
          {nifty.bars.map((c, i) => {
            const col = c.up ? 'var(--grn)' : 'var(--red)';
            const top = Math.min(c.openY, c.closeY), h = Math.max(1, Math.abs(c.closeY - c.openY));
            return (
              <g key={i}>
                <line x1={c.x} y1={c.highY} x2={c.x} y2={c.lowY} stroke={col} strokeWidth=".6" />
                <rect x={c.x - nifty.bw / 2} y={top} width={nifty.bw} height={h} fill={col} />
              </g>
            );
          })}
        </g>
      )}

      <line x1="0" y1={g.zeroY} x2={W} y2={g.zeroY} stroke="var(--txt3)" strokeWidth=".5" strokeDasharray="2 3" />

      {/* per-broker overlay (muted) */}
      {overlay && brokerKeys.map((k) => g.byKey[k]
        ? <path key={k} d={path(g.byKey[k])} fill="none" stroke={BROKER[k].c} strokeWidth="1.2" opacity=".75" />
        : null)}

      {/* aggregate net — bold, green/red split */}
      <path d={dNet} fill="none" stroke="var(--grn)" strokeWidth="2" clipPath={`url(#up-${uid})`} />
      <path d={dNet} fill="none" stroke="var(--red)" strokeWidth="2" clipPath={`url(#dn-${uid})`} />
      <line x1="0" y1={last.y} x2={W} y2={last.y} stroke={curColor} strokeWidth=".7" strokeDasharray="4 3" opacity=".55" />
      <circle cx={last.x} cy={last.y} r="3.5" fill={curColor} />
      {pending ? <line x1="0" y1={g.zeroY - 0.1} x2={W} y2={g.zeroY - 0.1} stroke="var(--acc)" strokeWidth=".7" strokeDasharray="6 4" opacity=".5" /> : null}

      <text x="2" y={H + 16} className="pnl-axt">{net[0].t}</text>
      <text x={W / 2} y={H + 16} className="pnl-axt" textAnchor="middle">{mid.t}</text>
      <text x={W - 2} y={H + 16} className="pnl-axt" textAnchor="end">{last.t}{pending ? ' · pending order' : ''}</text>

      {/* legend (only when overlaying) */}
      {(overlay || nifty) && (
        <g transform={`translate(2 ${H + 30})`} className="pnl-axt">
          {overlay && brokerKeys.map((k, i) => (
            <g key={k} transform={`translate(${i * 70} 0)`}>
              <rect x="0" y="-7" width="9" height="3" rx="1" fill={BROKER[k].c} />
              <text x="13" y="0">{BROKER[k].label}</text>
            </g>
          ))}
          {nifty && (
            <g transform={`translate(${overlay ? brokerKeys.length * 70 : 0} 0)`}>
              <rect x="0" y="-7" width="9" height="3" rx="1" fill="var(--txt2)" opacity=".4" />
              <text x="13" y="0">NIFTY 50</text>
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
