'use client';

// Fyers-style market heatmap — a NESTED squarified treemap: sectors
// contain industries contain stocks. Tile SIZE = market-cap weight (data/
// nifty50-heatmap.js), tile COLOUR = 1D % (green up / red down, intensity by
// magnitude, capped at ±3% so the spread stays readable). Click a sector to
// drill into its stocks; the crumb walks back out.
//
// Data join: takes the /api/nifty50 `stocks` (sym + name + live pct) and joins
// the committed cap/sector/industry taxonomy by symbol. All live or honestly
// blank — a symbol the feed didn't return simply isn't drawn.
//
// Sits BESIDE the existing aggregate Sector-heatmap card (NiftyOverview), not in
// place of it — this is the drill-down instrument, that one is the glance.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HEATMAP_META as NIFTY_META, HEATMAP_FALLBACK as NIFTY_FALLBACK } from '../../../data/nifty50-heatmap';
import FUND from '../../../data/nifty50-fundamentals.json';

const CANVAS_H = 452;

// ── squarified treemap (Bruls–Huizing–van Wijk), same family as TreeMap.js ──
function worstRatio(row, side) {
  let s = 0; for (const r of row) s += r.area;
  let w = 0;
  for (const r of row) { const a = r.area; w = Math.max(w, Math.max((side * side * a) / (s * s), (s * s) / (side * side * a))); }
  return w;
}
// nodes: [{ node, value }] → returns [{ node, rect:{x,y,w,h} }] in ABSOLUTE coords.
function squarify(nodes, x, y, w, h) {
  let tot = 0; for (const n of nodes) tot += n.value;
  if (!(tot > 0) || w <= 1 || h <= 1) return [];
  const areas = nodes.map((n) => ({ node: n.node, area: (n.value / tot) * w * h }));
  const out = [];
  let X = x, Y = y, W = w, H = h, i = 0;
  while (i < areas.length) {
    const horiz = W < H, side = horiz ? W : H;
    if (side <= 0) break;
    let row = [areas[i]], j = i + 1;
    while (j < areas.length) {
      const cand = [...row, areas[j]];
      if (worstRatio(cand, side) <= worstRatio(row, side)) { row = cand; j++; } else break;
    }
    let s = 0; for (const r of row) s += r.area;
    const thick = s / side; let off = 0;
    for (const r of row) {
      const len = r.area / thick;
      out.push({ node: r.node, rect: horiz ? { x: X + off, y: Y, w: len, h: thick } : { x: X, y: Y + off, w: thick, h: len } });
      off += len;
    }
    if (horiz) { Y += thick; H -= thick; } else { X += thick; W -= thick; }
    i = j;
  }
  return out;
}

// tile fill — translucent green/red, opacity by |pct| capped at ±3% (Fyers-like).
function tileBg(pct) {
  if (pct == null || !isFinite(pct)) return 'color-mix(in srgb, var(--txt3) 22%, transparent)';
  const mag = Math.min(1, Math.abs(pct) / 3);
  const op = (14 + mag * 56).toFixed(0);
  const col = pct > 0 ? 'var(--grn)' : pct < 0 ? 'var(--red)' : 'var(--txt3)';
  return `color-mix(in srgb, ${col} ${op}%, transparent)`;
}
const pctTxt = (p) => (p == null || !isFinite(p) ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(2)}%`);

// ── hover/deep-dive helpers ──
const clr = (p) => (p == null || !isFinite(p) ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');
const money = (n) => (n == null || !isFinite(n) ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
// Live market cap (₹ from shares×price) → compact crore. Yahoo won't give mcap keyless,
// so shares-outstanding is committed (data/nifty50-fundamentals.json) and price is live.
const crTxt = (rupees) => {
  if (rupees == null || !isFinite(rupees)) return '—';
  const cr = rupees / 1e7; // ₹ → crore
  if (cr >= 1e5) return '₹' + (cr / 1e5).toFixed(2) + 'L Cr';
  if (cr >= 1e3) return '₹' + (cr / 1e3).toFixed(2) + 'K Cr';
  return '₹' + Math.round(cr).toLocaleString('en-IN') + ' Cr';
};
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const dmy = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${+d} ${MON3[+m - 1]} '${y.slice(2)}`; };
const fundOf = (sym) => FUND.stocks?.[sym];
const mcapOf = (s) => { const f = fundOf(s.sym); return f?.sharesOut && s.price ? f.sharesOut * s.price : null; };

// Ticker logo — committed SVG at /logos/<SYM>.svg when present, else a monogram badge.
function Logo({ sym, size = 30 }) {
  const [broken, setBroken] = useState(false);
  const r = Math.round(size * 0.27);
  if (broken) return <span className="nhx-logo-badge" style={{ width: size, height: size, borderRadius: r, fontSize: Math.round(size * 0.42) }}>{sym.slice(0, 1)}</span>;
  return <img src={`/logos/${sym}.svg`} alt="" width={size} height={size} onError={() => setBroken(true)}
    style={{ borderRadius: r, objectFit: 'contain', background: '#fff', flexShrink: 0, display: 'block' }} />;
}

// Build sector → industry → stock tree from enriched rows. Single-industry
// sectors are flattened (no redundant sub-header), matching the mock.
function buildTree(rows) {
  const secs = {};
  for (const r of rows) {
    const s = (secs[r.sector] ||= { name: r.sector, inds: {}, value: 0, n: 0 });
    const ind = (s.inds[r.industry] ||= { name: r.industry, stocks: [], value: 0 });
    ind.stocks.push(r); ind.value += r.cap; s.value += r.cap; s.n += 1;
  }
  return Object.values(secs).map((s) => {
    const inds = Object.values(s.inds)
      .map((i) => ({ ...i, stocks: i.stocks.slice().sort((a, b) => b.cap - a.cap) }))
      .sort((a, b) => b.value - a.value);
    return { name: s.name, n: s.n, value: s.value, industries: inds, flat: inds.length <= 1, stocks: inds.length <= 1 ? inds[0].stocks : null };
  }).sort((a, b) => b.value - a.value);
}

// Flatten the tree into absolute-positioned boxes (sector/industry chrome) +
// tiles (stocks), given the canvas size and whether we're drilled into one sector.
function layout(tree, drill, W, H) {
  const boxes = [], tiles = [];
  const sectors = drill ? tree.filter((s) => s.name === drill) : tree;
  const big = !!drill;

  const emitStocks = (stocks, x, y, w, h) => {
    for (const { node, rect } of squarify(stocks.map((d) => ({ node: d, value: d.cap })), x, y, w, h)) {
      tiles.push({ stock: node, rect, big });
    }
  };
  const emitIndustry = (ind, r) => {
    const headH = (r.h > 28 && r.w > 52) ? 12 : 0;
    boxes.push({ kind: 'ind', key: 'i:' + ind.name + ':' + r.x.toFixed(0) + ':' + r.y.toFixed(0), name: ind.name, n: ind.stocks.length, rect: r, headH });
    emitStocks(ind.stocks, r.x + 1, r.y + 1 + headH, r.w - 2, r.h - 2 - headH);
  };
  const emitSector = (sec, r) => {
    const headH = ((r.h > 34 && r.w > 58) || big) ? (big ? 18 : 14) : 0;
    boxes.push({ kind: 'sec', key: 's:' + sec.name, name: sec.name, n: sec.n, rect: r, headH });
    const bx = r.x + 2, by = r.y + 2 + headH, bw = r.w - 4, bh = r.h - 4 - headH;
    if (bw < 2 || bh < 2) return;
    if (sec.flat) emitStocks(sec.stocks, bx, by, bw, bh);
    else for (const { node, rect } of squarify(sec.industries.map((i) => ({ node: i, value: i.value })), bx, by, bw, bh)) emitIndustry(node, rect);
  };

  for (const { node, rect } of squarify(sectors.map((s) => ({ node: s, value: s.value })), 0, 0, W, H)) emitSector(node, rect);
  return { boxes, tiles };
}

const pxpc = (v, total) => (total > 0 ? (v / total) * 100 + '%' : '0%');

// Market-agnostic: `meta`/`fallback` = the {sym → {sector, industry, cap}} taxonomy
// (defaults to the Nifty-50 one for back-compat), `label` = the root-crumb name.
export default function MarketHeatmap({ stocks, loading, meta = NIFTY_META, fallback = NIFTY_FALLBACK, label = 'Nifty 50' }) {
  const [drill, setDrill] = useState(null);
  const [w, setW] = useState(0);
  const roRef = useRef(null);

  // Callback ref: measure (and observe) the canvas the moment it MOUNTS — not on a
  // one-shot mount effect, which fires while the component is still in its Loading
  // state (canvas absent → ref null → width never set → blank map). Re-fires when
  // the node attaches/detaches, so width is always live.
  const measure = useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (node) {
      setW(node.clientWidth || 0);
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => setW(node.clientWidth || 0));
        ro.observe(node);
        roRef.current = ro;
      }
    }
  }, []);

  const tree = useMemo(() => {
    const rows = (stocks || [])
      .filter((s) => s && s.sym && s.pct != null && isFinite(s.pct))
      .map((s) => { const m = meta[s.sym] || fallback; return { sym: s.sym, name: s.name || s.sym, pct: s.pct, price: s.price ?? null, ...m }; });
    return buildTree(rows);
  }, [stocks, meta, fallback]);

  // If a drilled sector vanishes from a later feed, fall back to the overview.
  useEffect(() => { if (drill && !tree.some((s) => s.name === drill)) setDrill(null); }, [drill, tree]);

  // Deep-dive detail (perf / 52-wk / dividends) — lazy, CDN-cached daily server-side.
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    let on = true;
    fetch('/api/nifty50-detail').then((r) => (r.ok ? r.json() : null)).then((j) => { if (on && j) setDetail(j.stocks || {}); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const [hov, setHov] = useState(null); // { s, x, y } — hovered tile + cursor (viewport coords)
  const [sel, setSel] = useState(null); // selected stock → deep-dive panel
  useEffect(() => { // Esc closes the deep-dive
    if (!sel) return;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const H = CANVAS_H;
  const { boxes, tiles } = useMemo(() => (w > 10 && tree.length ? layout(tree, drill, w, H) : { boxes: [], tiles: [] }), [tree, drill, w, H]);

  if (loading && !tree.length) return <div className="sub">Loading constituents…</div>;
  if (!tree.length) return <div className="mac-stale">Constituent quotes unavailable — Yahoo feed not reachable this run.</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="nhx-pill">Size <b>Market cap</b></span>
        <span className="nhx-pill">Colour <b>1D %</b></span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--txt3)', fontFamily: 'var(--mono)' }}>
          {drill
            ? <><span className="nhx-back" role="button" tabIndex={0} onClick={() => setDrill(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDrill(null); }}>‹ {label}</span> / {drill}</>
            : 'click a sector to dig in'}
        </span>
      </div>

      <div ref={measure} style={{ position: 'relative', width: '100%', height: H, borderRadius: 6, overflow: 'hidden' }}>
        {boxes.map((b) => {
          const r = b.rect;
          const isSec = b.kind === 'sec';
          const clickable = isSec && !drill;
          return (
            <div key={b.key}
              onClick={clickable ? () => setDrill(b.name) : undefined}
              style={{
                position: 'absolute', boxSizing: 'border-box',
                left: pxpc(r.x, w), top: pxpc(r.y, H), width: pxpc(r.w, w), height: pxpc(r.h, H),
                padding: isSec ? 2 : 1, pointerEvents: clickable ? 'auto' : 'none',
              }}>
              <div style={{
                width: '100%', height: '100%', borderRadius: isSec ? 4 : 3, overflow: 'hidden',
                border: `.5px solid ${isSec ? 'var(--brd)' : 'var(--brd2)'}`,
                background: isSec ? 'color-mix(in srgb, var(--txt3) 5%, transparent)' : 'transparent',
                cursor: clickable ? 'pointer' : 'default',
              }}>
                {b.headH > 0 && (
                  <div style={{
                    height: b.headH, lineHeight: b.headH + 'px', padding: '0 6px',
                    fontSize: isSec ? (drill ? 12 : 9.5) : 8.5,
                    fontWeight: isSec ? 800 : 700, letterSpacing: isSec ? '.07em' : '.03em',
                    textTransform: isSec ? 'uppercase' : 'none',
                    color: isSec ? 'var(--txt2)' : 'var(--txt3)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {b.name}<span style={{ color: 'var(--txt3)', fontWeight: 600, marginLeft: 4 }}>({b.n})</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {tiles.map((t) => {
          const r = t.rect, s = t.stock;
          const showTk = r.w > 26 && r.h > 16, showPc = r.h > 30 && r.w > 40;
          const tkSize = t.big ? Math.max(9, Math.min(15, r.w / 6.5)) : Math.max(8, Math.min(11.5, r.w / 4.5));
          return (
            <div key={'t:' + s.sym}
              onMouseEnter={(e) => setHov({ s, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setHov({ s, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHov((h) => (h && h.s.sym === s.sym ? null : h))}
              onClick={() => { setSel(s); setHov(null); }}
              style={{ position: 'absolute', boxSizing: 'border-box', left: pxpc(r.x, w), top: pxpc(r.y, H), width: pxpc(r.w, w), height: pxpc(r.h, H), padding: 1, cursor: 'pointer' }}>
              <div
                style={{
                  width: '100%', height: '100%', borderRadius: 2, overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                  textAlign: 'center', lineHeight: 1.05, background: tileBg(s.pct), color: 'var(--txt)',
                }}>
                {showTk && (
                  <div className="mono" style={{ fontSize: tkSize, fontWeight: 700, padding: '0 2px', maxWidth: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {t.big ? s.name : s.sym}
                  </div>
                )}
                {showPc && (
                  <div className="mono" style={{ fontSize: t.big ? 12 : 9, opacity: 0.9, marginTop: 1 }}>{pctTxt(s.pct)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hov && !sel && (() => {
        const s = hov.s;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        return (
          <div className="nhx-hov" style={{ left: Math.min(hov.x + 16, vw - 224), top: Math.min(hov.y + 16, vh - 118) }}>
            <div className="nhx-hov-top">
              <Logo sym={s.sym} size={26} />
              <b className="mono">{s.sym}</b>
              <div className="nhx-hov-px">
                <span className="mono">{money(s.price)}</span>
                <em className={'mono ' + clr(s.pct)}>{pctTxt(s.pct)}</em>
              </div>
            </div>
            <div className="nhx-hov-mc"><span>Mkt Cap</span><b className="mono">{crTxt(mcapOf(s))}</b></div>
            <div className="nhx-hov-hint">click for details</div>
          </div>
        );
      })()}

      {sel && (() => {
        const s = sel, d = detail?.[s.sym];
        const dy = d?.ttmDiv && s.price ? (d.ttmDiv / s.price) * 100 : null;
        const p = d?.perf || {};
        const P = [['1W', p.w1], ['1M', p.m1], ['3M', p.m3], ['6M', p.m6], ['YTD', p.ytd], ['1Y', p.y1]];
        return (
          <div className="nhx-dd-ov" onClick={() => setSel(null)}>
            <div className="nhx-dd" onClick={(e) => e.stopPropagation()}>
              <button className="nhx-dd-x" onClick={() => setSel(null)} aria-label="Close">×</button>
              <div className="nhx-dd-hd">
                <Logo sym={s.sym} size={40} />
                <div className="nhx-dd-id">
                  <div className="nhx-dd-tk mono">{s.sym}</div>
                  <div className="nhx-dd-nm">{fundOf(s.sym)?.name || s.name} · {s.sector} · {s.industry}</div>
                </div>
                <div className="nhx-dd-px">
                  <div className="nhx-dd-cmp mono">{money(s.price)}</div>
                  <div className={'nhx-dd-1d mono ' + clr(s.pct)}>{pctTxt(s.pct)}</div>
                </div>
              </div>
              <div className="nhx-dd-stats">
                <div><div className="nhx-k">Mkt Cap</div><div className="nhx-v mono">{crTxt(mcapOf(s))}</div></div>
                <div><div className="nhx-k">Div Yield</div><div className="nhx-v mono">{dy != null ? dy.toFixed(2) + '%' : '—'}</div></div>
                <div><div className="nhx-k">Last Div</div><div className="nhx-v mono">{d?.lastDivAmt != null ? money(d.lastDivAmt) + ' · ' + dmy(d.lastDivDate) : '—'}</div></div>
                <div><div className="nhx-k">52-wk High</div><div className="nhx-v mono">{money(d?.hi52)}</div></div>
                <div><div className="nhx-k">52-wk Low</div><div className="nhx-v mono">{money(d?.lo52)}</div></div>
                <div><div className="nhx-k">Idx Weight</div><div className="nhx-v mono">{s.cap != null ? s.cap.toFixed(1) + '%' : '—'}</div></div>
              </div>
              <div className="nhx-dd-perf">
                <div className="nhx-k" style={{ marginBottom: 8 }}>Performance{!detail && ' · loading…'}</div>
                <div className="nhx-perf-row">
                  {P.map(([k, v]) => (
                    <div key={k} className={'nhx-perf-cell ' + (v == null ? '' : v >= 0 ? 'up' : 'dn')}>
                      <div className="nhx-pk">{k}</div>
                      <div className={'nhx-pv mono ' + clr(v)}>{v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'}</div>
                      <div className="nhx-bar" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', flexWrap: 'wrap' }}>
        <span>size = market-cap weight</span>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <i style={{ width: 11, height: 11, borderRadius: 2, background: tileBg(-3) }} /> down
          <i style={{ width: 11, height: 11, borderRadius: 2, background: tileBg(0), marginLeft: 6 }} /> flat
          <i style={{ width: 11, height: 11, borderRadius: 2, background: tileBg(3), marginLeft: 6 }} /> up
        </span>
        <span style={{ marginLeft: 'auto' }}>weights approximate · colour = today’s move</span>
      </div>
    </div>
  );
}
