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
import { scaleLines, scaleCandles, niftyLevels } from '../../lib/pnlDaily';

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

export default function IntradayChart({ tape, candles = null, pending = false, fills = [], overlays = BROKER, ariaLabel = 'Intraday P&L' }) {
  const LABEL_W = 54, W = 660, PLOT_W = W - LABEL_W, H = 200; // tight right strip, values right-justified
  const [hov, setHov] = useState(null);   // hovered point index

  const pts = (tape || []).filter((p) => p && p.t != null && Number.isFinite(+p.net));
  const present = overlays.filter((o) => pts.some((p) => p && p[o.key] != null));
  const overlay = present.length > 1;     // only split out legs when there's more than one
  const g = scaleLines(pts, ['net', ...(overlay ? present.map((o) => o.key) : [])], PLOT_W, H);
  if (!g || !g.byKey.net) return null;
  const nifty = scaleCandles(candles, PLOT_W, H);
  // Intraday S/R levels (swing pivots) + volume band, both rendered as a faint watermark
  // behind the P&L (only when we actually have NIFTY candles).
  const levels = candles && candles.length ? niftyLevels(candles) : null;
  const srLines = levels ? [...levels.resistances.map((l) => ({ ...l, k: 'R' })), ...levels.supports.map((l) => ({ ...l, k: 'S' }))] : [];
  const VOL_BAND = H * 0.16;
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

  // Buy/sell fills → markers, anchored to the nearest tape point by time (midnight-aware).
  const tRank = (t) => { const [h, m] = String(t).split(':').map(Number); const x = h * 60 + m; return x < 360 ? x + 1440 : x; };
  const nearestIdx = (t) => { const fr = tRank(t); let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(tRank(pts[i].t) - fr); if (d < bd) { bd = d; best = i; } } return best; };
  const marks = (fills || []).filter((fl) => fl && fl.t).map((fl) => { const i = nearestIdx(fl.t); return { ...fl, x: net[i].x, y: net[i].y, idx: i }; });
  // (marks above feed the on-chart buy/sell triangles; the hover card no longer lists fills/orders)

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
  // Hover card rows — Net + per-BROKER net (no per-order rows, no timestamp). Labels are
  // back: "Net" + each broker's name (the broker label in its CURVE colour so it ties to
  // its line). The value keeps sign-colour for direction. Rendered as an HTML overlay
  // (below) so it can be a plain frosted-glass card.
  const tipRows = [];
  if (ht) {
    tipRows.push({ kind: 'net', label: 'Net', v: +ht.net, vc: dirColor(+ht.net), lc: 'var(--txt)' });
    if (overlay) for (const o of present) {
      const raw = ht[o.key];
      if (raw == null || !Number.isFinite(+raw)) continue;   // skip a broker with no value this minute
      tipRows.push({ kind: 'broker', label: o.label, v: +raw, vc: dirColor(+raw), lc: o.c });
    }
  }
  // Position the HTML card by % of the viewBox width; flip left of the cursor on the right half.
  const tipLeftPct = hp ? (hp.x / W) * 100 : 0;
  const tipFlip = hp ? hp.x > W * 0.5 : false;

  return (
    <div className="iq-wrap" style={{ position: 'relative', marginTop: 12 }}>
    <svg viewBox={`0 0 ${W} ${H + 34}`} width="100%" style={{ display: 'block', height: 'auto' }}
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

      {/* NIFTY volume histogram — faint bars in a bottom band, coloured by candle up/down */}
      {nifty && nifty.vmax > 0 && (
        <g opacity=".14">
          {nifty.bars.map((b, i) => {
            if (b.v == null) return null;
            const vh = (b.v / nifty.vmax) * VOL_BAND;
            return <rect key={i} x={b.x - nifty.bw / 2} y={H - vh} width={nifty.bw} height={vh} fill={b.up ? 'var(--grn)' : 'var(--red)'} />;
          })}
        </g>
      )}

      {/* support / resistance — faint dashed levels (swing pivots + day H/L), price-labelled left */}
      {nifty && srLines.map((l, i) => {
        const y = nifty.priceY(l.price);
        return (
          <g key={'sr' + i} opacity=".42">
            <line x1="0" y1={y} x2={PLOT_W} y2={y} stroke="var(--txt3)" strokeWidth=".6" strokeDasharray="5 4" />
            <text x="3" y={y - 2.5} style={{ fontSize: 8, fill: 'var(--txt3)', fontFamily: 'var(--mono)' }}>{l.k} {Math.round(l.price)}</text>
          </g>
        );
      })}

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

      {/* buy/sell fill markers — up triangle = BUY (below the line), down = SELL (above):
          side encoded by SHAPE; blue (buy) / accent (sell), kept apart from the P&L green/red */}
      {marks.map((m, i) => {
        const buy = m.side === 'BUY';
        const tri = buy
          ? `${m.x},${m.y + 4} ${m.x - 4},${m.y + 10} ${m.x + 4},${m.y + 10}`
          : `${m.x},${m.y - 4} ${m.x - 4},${m.y - 10} ${m.x + 4},${m.y - 10}`;
        return <polygon key={i} points={tri} fill={buy ? 'var(--blu)' : 'var(--acc)'} opacity=".9" />;
      })}

      {/* right-edge value labels, riding each line's last point */}
      {labels.map((l, i) => (
        <text key={i} x={W - 3} textAnchor="end" y={Math.max(9, Math.min(H - 2, l.y + 3))} fill={l.c}
          opacity={l.dim ? 0.6 : 1} style={{ fontSize: l.bold ? 13 : 11, fontWeight: l.bold ? 700 : 600 }}>{f(l.v)}</text>
      ))}

      {/* hover cursor — the value card itself is the frosted HTML overlay below the svg */}
      {hp && (
        <g>
          <line x1={hp.x} y1="0" x2={hp.x} y2={H} stroke="var(--txt3)" strokeWidth=".7" opacity=".6" />
          <circle cx={hp.x} cy={hp.y} r="3" fill={curColor} />
        </g>
      )}

      <text x="2" y={H + 16} className="pnl-axt">{net[0].t}</text>
      <text x={PLOT_W / 2} y={H + 16} className="pnl-axt" textAnchor="middle">{net[Math.floor(n / 2)].t}</text>
      <text x={PLOT_W} y={H + 16} className="pnl-axt" textAnchor="end">{lastNet.t}{pending ? ' · pending order' : ''}</text>

      {/* legend (when overlaying, watermark, or fills present) */}
      {(overlay || nifty || marks.length > 0) && (
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
          {marks.length > 0 && (
            <g transform={`translate(${(overlay ? present.length * 70 : 0) + (nifty ? 70 : 0)} 0)`}>
              <polygon points="2,-2 -1,3 5,3" fill="var(--blu)" />
              <text x="9" y="0">buy</text>
              <polygon points="25,3 22,-2 28,-2" fill="var(--acc)" />
              <text x="32" y="0">sell</text>
            </g>
          )}
        </g>
      )}
    </svg>

    {/* frosted hover card (untinted) — Net + per-broker net (colour = curve = legend) */}
    {hp && (
      <div className="iq-tip" style={{
        left: `${tipLeftPct}%`,
        transform: tipFlip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
      }}>
        {tipRows.map((row, i) => (
          <div key={i} className={'iq-r' + (row.kind === 'net' ? ' iq-net' : '')}>
            <span className="iq-l" style={{ color: row.lc, fontWeight: row.kind === 'net' ? 700 : 600 }}>{row.label}</span>
            <span className="iq-v" style={{ color: row.vc }}><span className="rs">₹</span>{f(row.v).slice(1)}</span>
          </div>
        ))}
      </div>
    )}
    </div>
  );
}
