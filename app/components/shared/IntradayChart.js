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
// "NIFTY-Jun2026-24150-PE" → "24150 PE", "ANGELONE26JUL300PE" → "300 PE",
// "ANGELONE26AUGFUT" → "ANGELONE FUT"; falls back to a trimmed symbol.
const legShort = (sym) => {
  const s = String(sym ?? '');
  const opt = s.match(/(\d{3,6})[-\s]?(PE|CE|PUT|CALL)\b/i);
  if (opt) return `${opt[1]} ${/^p/i.test(opt[2]) ? 'PE' : 'CE'}`;
  if (/FUT\b/i.test(s)) { const u = s.match(/^([A-Za-z&]+)/); return `${u ? u[1] : s.slice(0, 8)} FUT`; }
  return s.replace(/^[A-Z]+[-:]/i, '').slice(0, 14);
};

export default function IntradayChart({ tape, candles = null, pending = false, fills = [], overlays = BROKER, ariaLabel = 'Intraday P&L' }) {
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

  // Buy/sell fills → markers, anchored to the nearest tape point by time (midnight-aware).
  const tRank = (t) => { const [h, m] = String(t).split(':').map(Number); const x = h * 60 + m; return x < 360 ? x + 1440 : x; };
  const nearestIdx = (t) => { const fr = tRank(t); let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(tRank(pts[i].t) - fr); if (d < bd) { bd = d; best = i; } } return best; };
  const marks = (fills || []).filter((fl) => fl && fl.t).map((fl) => { const i = nearestIdx(fl.t); return { ...fl, x: net[i].x, y: net[i].y, idx: i }; });
  const fillsByIdx = {};
  for (const m of marks) (fillsByIdx[m.idx] = fillsByIdx[m.idx] || []).push(m);
  const hoverFills = ht ? (fillsByIdx[hov] || []) : [];
  // Per-order P&L at the hovered minute — ONLY this point's own captured legs (never a
  // far-search/carry across time). The broker's positions feed drops a leg once it's
  // squared off, so an order stops appearing past its exit ("it doesn't exist any more");
  // and minutes before the first legs snapshot show no per-order rows rather than
  // back-filling orders that weren't open yet.
  const legsHere = ht && Array.isArray(ht.legs) ? ht.legs : [];

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
  // tooltip rows — Net, then a per-BROKER split (each in its curve colour) with that
  // broker's currently-open ORDERS nested beneath it (also curve-coloured), so a row's
  // colour ties it to its line. Direction (gain/loss) stays sign-coloured on the value.
  // Legs-less points (e.g. before the first capture) fall back to per-broker subtotals.
  const colorOf = (k) => (overlays.find((o) => o.key === k) || {}).c || 'var(--txt2)';
  const labelOf = (k) => (overlays.find((o) => o.key === k) || {}).label || k;
  const tipRows = [];
  if (ht) {
    tipRows.push({ kind: 'net', label: 'Net', v: +ht.net, vc: dirColor(+ht.net) });
    const byBroker = {};
    for (const l of legsHere) (byBroker[l.broker] = byBroker[l.broker] || []).push(l);
    // curve order first (stable colours), then any leg-only brokers
    const haveLegs = legsHere.length > 0;
    const order = [...overlays.map((o) => o.key), ...Object.keys(byBroker)].filter((k, i, a) => a.indexOf(k) === i);
    for (const k of order) {
      const blegs = byBroker[k] || [];
      const raw = ht[k];
      const hasVal = raw != null && Number.isFinite(+raw);   // +null === 0 is finite — guard the null leg
      const bval = hasVal ? +raw : null;
      // With per-order data show only brokers holding OPEN orders; without legs (pre-capture
      // minutes) fall back to per-broker subtotals so the split still reads.
      if (haveLegs ? blegs.length === 0 : !(overlay && hasVal)) continue;
      tipRows.push({ kind: 'broker', label: labelOf(k), v: bval, vc: hasVal ? dirColor(bval) : null, lc: colorOf(k) });
      for (const l of blegs) tipRows.push({ kind: 'order', label: legShort(l.sym), v: +l.pnl, vc: dirColor(+l.pnl), lc: colorOf(k) });
    }
  }
  const tipW = hoverFills.length ? 178 : (legsHere.length ? 156 : 110);
  const tipH = 16 + tipRows.length * 15 + (hoverFills.length ? hoverFills.length * 14 + 5 : 0);
  const tipX = hp ? Math.max(2, Math.min(PLOT_W - tipW - 2, hp.x + 8)) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H + 34}`} width="100%" style={{ marginTop: 12, display: 'block', height: 'auto' }}
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

      {/* hover cursor + tooltip */}
      {hp && (
        <g>
          <line x1={hp.x} y1="0" x2={hp.x} y2={H} stroke="var(--txt3)" strokeWidth=".7" opacity=".6" />
          <circle cx={hp.x} cy={hp.y} r="3" fill={curColor} />
          <g transform={`translate(${tipX} 4)`}>
            <rect width={tipW} height={tipH} rx="4" fill="var(--bg2, #1b1f2a)" stroke="var(--brd)" strokeWidth=".5" opacity=".96" />
            <text x="7" y="13" className="pnl-axt" style={{ fontWeight: 600 }}>{ht.t}</text>
            {tipRows.map((row, i) => {
              const indent = row.kind === 'order' ? 16 : 7;                        // orders nest under their broker
              const labelFill = row.kind === 'net' ? 'var(--txt)' : (row.lc || 'var(--txt2)'); // broker/order labels in curve colour
              const fs = row.kind === 'order' ? 9.5 : 10;
              return (
                <g key={i} transform={`translate(0 ${27 + i * 15})`}>
                  <text x={indent} y="0" fill={labelFill} style={{ fontSize: fs, fontWeight: row.kind === 'order' ? 500 : 600 }}>{row.label}</text>
                  {row.v != null ? <text x={tipW - 14} y="0" textAnchor="end" fill={row.vc} style={{ fontSize: fs, fontWeight: 600 }}>{f(row.v)}</text> : null}
                </g>
              );
            })}
            {hoverFills.map((fl, i) => (
              <text key={'f' + i} x="7" y={27 + tipRows.length * 15 + 6 + i * 14}
                fill={fl.side === 'BUY' ? 'var(--blu)' : 'var(--acc)'} style={{ fontSize: 9, fontWeight: 600 }}>
                {fl.side} {fl.sym} · {fl.qty}@{fl.price}
              </text>
            ))}
          </g>
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
  );
}
