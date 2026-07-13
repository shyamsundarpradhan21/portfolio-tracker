'use client';
import { useState, useEffect } from 'react';
import SwotCard from '../shared/SwotCard';
import AnimatedNumber from '../shared/AnimatedNumber';
import MarketHeatmap from '../shared/MarketHeatmap';
import NiftyOverview from '../shared/NiftyOverview';
import UpcomingDividends from '../shared/UpcomingDividends';
import { dailyReturns, trendWindows } from '../../lib/niftyTrend';
import { HEATMAP_META as NASDAQ_META, HEATMAP_FALLBACK as NASDAQ_FALLBACK } from '../../../data/nasdaq100-heatmap';
import { isNum, scoreLabel } from '../../lib/usSentiment';
import { Rs, agoShort } from '../../lib/fmt';
import { smoothPath } from '../../lib/smoothPath';

// ── tiny formatters (mockup style: ▲/▼ glyph + grn/red/mut colour) ───────────
const cls = (p) => (p == null || !isFinite(p) ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');
const apct = (p) => (p == null || !isFinite(p) ? '·—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '·'}${Math.abs(p).toFixed(2)}%`);
const fmt = (n) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const sdot = (s) => (s > 0 ? 'g' : s < 0 ? 'r' : 'n');
const TONE = { calm: 'calm', warn: 'warn', stress: 'stress' };
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── 3-line ticker ────────────────────────────────────────────────────────────
function TickerLine({ label, kind, items, anim }) {
  if (!items || !items.length) return null;
  // Pad each half past the rail width, then duplicate, so the −50% scroll is a
  // seamless continuous loop no matter how few items there are.
  const half = [];
  while (half.length < Math.max(items.length, 14)) half.push(...items);
  const loop = half.concat(half);
  return (
    <div className="tkw">
      <span className={`tklab ${kind || ''}`}>{label}</span>
      <div className="tkv">
        <div className={`tkrow ${anim}`}>
          {loop.map((it, i) => (
            it.div
              ? <span className="tkdiv" key={i} aria-hidden={i >= half.length}><span>{it.div}</span></span>
              : <span className="tki" key={i} aria-hidden={i >= half.length}>
                  {it.dot
                    ? <>{it.tag && <span className="tkpf">{it.tag}</span>}<i className={`tdot ${it.dot}`} /><span className={it.cls}>{it.text}</span></>
                    : <><b>{it.name}</b> {it.val} <em className={it.cls}>{it.pct}</em></>}
                </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── FII/DII net-flow: composition bars + net sparkline OVERLAY. Overlapping
// translucent FII (cyan) + DII (violet) columns from the zero line show who
// bought/sold; a dotted net line (net = FII+DII) with a green-above / red-below
// shaded area rides on top to read the net inflow/outflow trend at a glance. No
// buy/sell or date axis labels. Hover a session to spotlight it + read the net.
function FiiDiiChart({ trail, derivs }) {
  const pts = (trail || []).filter((p) => p && (isFinite(p.fii) || isFinite(p.dii)));
  const [hi, setHi] = useState(-1);

  // FII derivative positioning shares the SAME footer strip as the cash FII/DII/net
  // values (one strip), and — like the cash values — is read PER SESSION from the
  // trail (point.der), captured each session by recordFiiDii / persistTrail.
  // Contracts (lakhs); direction by colour + long/short word, no +/- glyph.
  const L = (v) => (v == null || !isFinite(v) ? '—' : `${(Math.abs(v) / 1e5).toFixed(2)}L`);
  const dword = (v) => (v > 0 ? 'long' : v < 0 ? 'short' : 'flat');
  const dc = (v) => (v > 0 ? 'grn' : v < 0 ? 'red' : 'mut'); // long = green, short = red
  const shortDate = (s) => { const m = /^(\d{2})-([A-Za-z]{3})/.exec(String(s || '')); return m ? `${m[1]} ${m[2]}` : null; };
  // Live positioning for the latest session, flattened to the SAME shape stored on
  // each trail point — so the strip reads identically from live feed or capture.
  const liveDer = derivs && !derivs.stale && derivs.fii
    ? { ...derivs.fii, stance: derivs.stance, divergence: derivs.divergence, rIdxFut: derivs.retail?.idxFut }
    : null;
  // Show the derivative half when the feed is live OR any session has been captured,
  // so the layout stays put while hovering across sessions (older, pre-capture
  // sessions simply dash their positioning columns).
  const featureOn = !!liveDer || pts.some((p) => p && p.der);
  const derCol = (label, v, cls2) => (
    <div className={`fdstat ${cls2}`}>
      <span className="k">{label}</span>
      {v != null && isFinite(v) ? <b className={dc(v)}>{L(v)} <span className="dw">{dword(v)}</span></b> : <b className="mut">—</b>}
    </div>
  );
  const derivCols = (dp) => (
    <>
      {derCol('Idx Fut', dp?.idxFut, 'sep fdcell-idx')}
      {derCol('Stk Fut', dp?.stkFut, 'fdcell-stk')}
    </>
  );
  const readLine = (dp, dstr) => {
    if (!dp) return null;
    const ds = shortDate(dstr);
    const opt = [
      dp.idxCall > 0 ? 'long calls' : dp.idxCall < 0 ? 'short calls' : null,
      dp.idxPut > 0 ? 'long puts' : dp.idxPut < 0 ? 'short puts' : null,
    ].filter(Boolean).join(' · ');
    const stanceCls = dp.stance === 'bearish' ? 'red' : dp.stance === 'bullish' ? 'grn' : 'mut';
    return (
      <div className="fdderiv-read">
        {ds && <><span className="mut">as of {ds}</span> · </>}
        {opt && <>{opt} → </>}<b className={stanceCls}>FII {dp.stance}</b>
        {dp.divergence && dp.rIdxFut != null && <> · <span className="mut">retail {dword(dp.rIdxFut)} index futures — divergence</span></>}
      </div>
    );
  };

  if (pts.length < 2) return (
    <>
      <div className="na">FII/DII flow trail builds forward — needs a few more sessions.</div>
      {featureOn && <div className="fdstats only-d"><div className="fdcap fdcap-r">FII open interest · contracts</div>{derivCols(liveDer)}</div>}
      {readLine(liveDer, derivs?.asOf)}
    </>
  );

  const W = 560, H = 120, PAD_L = 12, PAD_R = 12, zero = 62, half = 46, n = pts.length;
  const colW = (W - PAD_L - PAD_R) / n;
  const bw = Math.min(22, colW * 0.5);
  const net = (p) => (p.fii || 0) + (p.dii || 0);
  const maxAbs = Math.max(1, ...pts.flatMap((p) => [Math.abs(p.fii || 0), Math.abs(p.dii || 0), Math.abs(net(p))]));
  const sc = half / maxAbs;
  const seg = (v) => { const h = Math.abs(v || 0) * sc; return { y: v >= 0 ? zero - h : zero, h }; };
  const cxOf = (i) => PAD_L + colW * i + colW / 2;
  const nyOf = (p) => zero - net(p) * sc;
  const d3 = (v) => (v == null || !isFinite(v) ? '—' : <><Rs />{Math.abs(Math.round(v)).toLocaleString('en-IN')} Cr</>);
  const cur = hi >= 0 ? pts[hi] : pts[pts.length - 1];
  // Per-session positioning: the hovered point's captured der, falling back to the
  // live feed only for the latest session (before today's capture lands).
  const dp = cur?.der || (cur === pts[pts.length - 1] ? liveDer : null);

  // Net sparkline geometry: a dotted polyline through the net points, and a
  // closed area down to the zero line, clipped into a green (above) and red
  // (below) half so the fill reads inflow vs outflow.
  const linePath = smoothPath(pts.map((p, i) => ({ x: cxOf(i), y: nyOf(p) })));
  const areaPath = pts.length >= 2 ? `${linePath} L ${cxOf(n - 1).toFixed(1)} ${zero} L ${cxOf(0).toFixed(1)} ${zero} Z` : '';

  return (
    <>
      <svg className="fdg" width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHi(-1)}>
        <defs>
          <clipPath id="fdAbove"><rect x="0" y="0" width={W} height={zero} /></clipPath>
          <clipPath id="fdBelow"><rect x="0" y={zero} width={W} height={H - zero} /></clipPath>
        </defs>
        <line className="fd-zero" x1={PAD_L - 4} y1={zero} x2={W - PAD_R + 4} y2={zero} />
        {/* composition bars (FII + DII from zero) */}
        {pts.map((p, i) => {
          const cx = cxOf(i), x = cx - bw / 2;
          const f = seg(p.fii), d = seg(p.dii);
          const dim = hi >= 0 && hi !== i ? 0.3 : 1;
          return (
            <g key={i} opacity={dim} onMouseEnter={() => setHi(i)}>
              <rect className="fd-fii" x={x} y={f.y} width={bw} height={f.h} rx="2" />
              <rect className="fd-dii" x={x} y={d.y} width={bw} height={d.h} rx="2" />
              <rect x={PAD_L + colW * i} y="0" width={colW} height={H} fill="transparent" />
            </g>
          );
        })}
        {/* net sparkline overlay: shaded area + dotted line + per-session dots */}
        <path className="fd-pos" clipPath="url(#fdAbove)" d={areaPath} />
        <path className="fd-neg" clipPath="url(#fdBelow)" d={areaPath} />
        <path className="fd-spark" d={linePath} />
        {pts.map((p, i) => <circle key={i} className={`fd-dot ${net(p) >= 0 ? 'g' : 'r'}`} cx={cxOf(i)} cy={nyOf(p)} r="2.6" />)}
      </svg>
      <div className={`fdstats${featureOn ? ' has-d' : ''}`}>
        {featureOn && (
          <>
            <div className="fdcap fdcap-l">net flow · ₹ Cr</div>
            <div className="fdcap fdcap-r sep">FII open interest · contracts</div>
          </>
        )}
        {cur && [['FII', cur.fii], ['DII', cur.dii], ['net', net(cur)]].map(([k, v]) => (
          <div className={`fdstat fdcell-${k.toLowerCase()}`} key={k}><span className="k">{k}</span><b className={cls(v)}>{d3(v)}</b></div>
        ))}
        {featureOn && derivCols(dp)}
      </div>
      {readLine(dp, cur?.d)}
    </>
  );
}

// ── Market sentiment: a fear/greed score (0-100) from breadth + India VIX +
// FII/DII net flow + Nifty momentum, with a red→amber→green gauge (à la the
// Stratzy sentiment meter). Each factor degrades gracefully if absent.
function fearGreed(breadthPct, vix, net, niftyPct) {
  const parts = [];
  if (breadthPct != null && isFinite(breadthPct)) parts.push([0.35, clampN(breadthPct, 0, 100)]);
  if (vix != null && isFinite(vix)) parts.push([0.25, clampN((22 - vix) / 11 * 100, 0, 100)]);
  if (net != null && isFinite(net)) parts.push([0.20, clampN(50 + net / 200, 0, 100)]);
  if (niftyPct != null && isFinite(niftyPct)) parts.push([0.20, clampN(50 + niftyPct * 15, 0, 100)]);
  if (!parts.length) return null;
  const w = parts.reduce((a, [x]) => a + x, 0);
  const score = Math.round(parts.reduce((a, [x, v]) => a + x * v, 0) / w);
  return { score, label: score < 25 ? 'Extreme fear' : score < 45 ? 'Fear' : score < 56 ? 'Neutral' : score < 76 ? 'Greed' : 'Extreme greed' };
}
// Tint class for a 0-100 fear/greed score (red = fear, grey = neutral, grn = greed).
const sChip = (s) => (!isNum(s) ? 'mut' : s < 45 ? 'red' : s < 56 ? 'mut' : 'grn');
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// One signal row: label · mono value · descriptor — all rendered NEUTRAL. Colour is
// reserved for the group outlook labels + the headline + the gauge, so the rows read
// uniformly. `context` rows (e.g. DII alongside FII) render dimmer and don't count
// toward the group outlook. `title` carries the per-factor source + as-of.
function SigRow({ label, value, tag, title, context }) {
  return (
    <div className={`lsig${context ? ' context' : ''}`} title={title || undefined}>
      <span className="ll">{label}</span>
      <span className="lv">{value}</span>
      {tag != null && <span className="lt">{tag}</span>}
    </div>
  );
}

// Generic LEADING vs COINCIDENT detail: two SIDE-BY-SIDE columns fed by row arrays,
// each group label tinted by the mean of its (non-context) scores, with an optional
// divergence callout on top. Factors are always visible (the two columns fill the card
// so it matches the movers height — no void). The per-market row + divergence wiring
// lives in the build* helpers below, so US and India share this shell.
function SentimentDetail({ leading, coincident, divergence }) {
  const outlook = (rows) => { const xs = (rows || []).filter((r) => !r.context && isNum(r.score)).map((r) => r.score); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const Group = ({ title, sub, rows }) => (
    <div className="scol">
      <div className={`scol-h ${sChip(outlook(rows))}`}>{title} <span className="usdx">{sub}</span></div>
      {(rows || []).map((r, i) => <SigRow key={i} {...r} />)}
    </div>
  );
  return (
    <div className="usdet">
      {divergence && <div className="usdiv">{divergence}</div>}
      <div className="s2col">
        <Group title="Leading" sub="forward-looking" rows={leading} />
        <Group title="Coincident" sub="price-derived" rows={coincident} />
      </div>
    </div>
  );
}

// Per-factor source + as-of for a row's tooltip (the card blends vintages).
const sigTitle = (x) => { if (!x || x.stale) return undefined; const d = x.asOf ? String(x.asOf).slice(0, 10) : ''; return [x.source, d].filter(Boolean).join(' · '); };
const sc = (x) => (x && !x.stale && isNum(x.score) ? x.score : null);
const orDash = (ok, cfg) => (ok ? cfg : { label: cfg.label, value: '—' });

// US row + divergence config from /api/us-sentiment.
function buildUsDetail(us) {
  const L = us?.leading || {}, C = us?.coincident || {};
  const v = L.vixTs, h = L.hyOas, p = L.putCall, m = C.momentum, b = C.breadth, st = C.strength52w;
  // Credit tag: at the tight extreme it's complacency (paid least to underwrite default
  // risk), not comfort — so the word flips to "complacent" past the 76 band.
  const oasTag = (s) => !isNum(s) ? '—' : s >= 76 ? 'complacent' : s >= 56 ? 'tight' : s < 25 ? 'stressed' : s < 45 ? 'wide' : 'neutral';
  const sv = sc(v), sh = sc(h), spc = sc(p), mo = sc(m), br = sc(b), sst = sc(st);
  // Name WHICH leading signals are risk-on (data-driven) so the callout reads
  // "not all-clear" rather than as a vague divergence note.
  const risky = [];
  if (isNum(sv) && sv >= 56) risky.push('cheap vol');
  if (isNum(sh) && sh >= 76) risky.push('extreme-tight credit'); else if (isNum(sh) && sh >= 56) risky.push('tight credit');
  if (isNum(spc) && spc >= 56) risky.push('greedy positioning');
  const divergence = (risky.length >= 2 && isNum(br) && br <= 35)
    ? `Complacent leading — ${risky.join(' · ')} — into weak breadth (${Math.round(br)}): a narrow tape, not all-clear`
    : (isNum(mo) && isNum(br) && mo >= 58 && br <= 35) ? 'Narrow tape — index held up by a few names; breadth weak underneath'
    : (isNum(br) && isNum(mo) && br >= 58 && mo <= 35) ? 'Broad but heavy — wide participation, price lagging'
    : null;
  return {
    leading: [
      orDash(v && !v.stale && isNum(v.ratio), { label: 'VIX term · 9D/3M', value: isNum(v?.ratio) ? v.ratio.toFixed(2) : '—', tag: v?.signal, score: sv, title: sigTitle(v) }),
      orDash(h && !h.stale && isNum(h.value), { label: 'HY credit spread', value: isNum(h?.value) ? `${h.value.toFixed(2)}%` : '—', tag: oasTag(sh), score: sh, title: sigTitle(h) }),
      orDash(p && !p.stale && isNum(p.value), { label: 'Put / Call', value: isNum(p?.value) ? p.value.toFixed(2) : '—', tag: scoreLabel(spc), score: spc, title: sigTitle(p) }),
    ],
    coincident: [
      orDash(m && !m.stale && isNum(m.pct), { label: 'S&P vs 125D MA', value: isNum(m?.pct) ? `${Math.abs(m.pct).toFixed(1)}%` : '—', tag: scoreLabel(mo), score: mo, title: sigTitle(m) }),
      orDash(b && !b.stale && isNum(b.score), { label: 'Breadth', value: isNum(b?.score) ? Math.round(b.score) : '—', tag: b?.rating, score: br, title: sigTitle(b) }),
      orDash(st && !st.stale && isNum(st.score), { label: '52-wk hi / lo', value: isNum(st?.score) ? Math.round(st.score) : '—', tag: st?.rating, score: sst, title: sigTitle(st) }),
    ],
    divergence,
  };
}

// India row + divergence config from /api/india-sentiment (+ breadth from premarket).
// LEADING = India VIX · FII net (the canary, scored ALONE) · DII (context). COINCIDENT
// = Nifty-vs-125D-MA · breadth. The divergence is the FII/DII absorption the combined
// sum would hide — silent unless foreign flight is being soaked up by domestic buying.
function buildIndiaDetail(india, breadthPct) {
  const L = india?.leading || {}, C = india?.coincident || {};
  const vix = L.vix, fii = L.fii, mom = C.momentum;
  const cr = (n) => `${Math.round(Math.abs(n)).toLocaleString('en-IN')} cr`;
  const leading = [
    orDash(vix && !vix.stale && isNum(vix.value), { label: 'India VIX', value: isNum(vix?.value) ? vix.value.toFixed(2) : '—', tag: scoreLabel(sc(vix)), score: sc(vix), title: sigTitle(vix) }),
    (fii && !fii.stale && isNum(fii.net))
      ? { label: 'FII net flow', value: cr(fii.net), tag: fii.building ? 'building' : (fii.net >= 0 ? 'inflow' : 'outflow'), score: fii.building ? null : sc(fii), title: sigTitle(fii) }
      : { label: 'FII net flow', value: '—' },
  ];
  if (fii && !fii.stale && isNum(fii.dii)) leading.push({ label: 'DII net · context', value: cr(fii.dii), tag: fii.dii >= 0 ? 'inflow' : 'outflow', context: true });
  const coincident = [
    orDash(mom && !mom.stale && isNum(mom.pct), { label: 'Nifty vs 125D MA', value: isNum(mom?.pct) ? `${Math.abs(mom.pct).toFixed(1)}%` : '—', tag: mom?.pct >= 0 ? 'above' : 'below', score: mom?.score, title: sigTitle(mom) }),
    orDash(isNum(breadthPct), { label: 'Breadth', value: isNum(breadthPct) ? `${Math.round(breadthPct)}%` : '—', tag: scoreLabel(breadthPct), score: breadthPct, title: 'NSE advances / declines' }),
  ];
  // Banner parity with the US card: FII/DII absorption is India-specific; the
  // narrow-tape / broad-but-heavy split (momentum vs breadth) mirrors buildUsDetail.
  const mo = sc(mom), br = breadthPct;
  const divergence = india?.absorption
    ? `Foreign outflow ${cr(india.absorption.fii)} absorbed by domestic buying ${cr(india.absorption.dii)} — the combined flow masks it`
    : (isNum(mo) && isNum(br) && mo >= 58 && br <= 35) ? 'Narrow tape — Nifty held up by a few names; breadth weak underneath'
    : (isNum(br) && isNum(mo) && br >= 58 && mo <= 35) ? 'Broad but heavy — wide participation, Nifty lagging'
    : null;
  return { leading, coincident, divergence };
}

// Full sentiment cell: score + label in the header's top-right corner, the card tinted
// by the reading, gauge + the leading/coincident split below. `detail` (composite +
// tag + leading/coincident rows + divergence) is built per-market by build{Us,India}Detail;
// `fallback` feeds the gauge from the local fear/greed blend if the composite is absent.
function SentimentCell({ detail = null, fallback = {}, momLabel = 'Nifty' }) {
  const { breadthPct, vix, net, niftyPct } = fallback;
  const fg = fearGreed(breadthPct, vix, net, niftyPct);
  const comp = isNum(detail?.composite?.score) ? Math.round(detail.composite.score) : null;
  const score = comp != null ? comp : (fg ? fg.score : null);
  if (score == null) return <div className="qc sent"><div className="qh">Market sentiment</div><div className="na">—</div></div>;
  const label = comp != null ? capFirst(scoreLabel(score)) : fg.label;
  const tone = score < 45 ? 'fear' : score < 56 ? '' : 'greed';
  const col = score < 45 ? 'var(--red)' : score < 56 ? 'var(--sc-opt)' : 'var(--grn)';
  const hasDetail = !!(detail && (detail.leading || detail.coincident));
  const f = [];
  if (!hasDetail) {
    if (isNum(breadthPct)) f.push(<>breadth {Math.round(breadthPct)}%</>);
    if (isNum(vix)) f.push(<>VIX {vix.toFixed(1)}</>);
    if (isNum(net)) f.push(<>FII/DII <span className={cls(net)}>{Math.abs(Math.round(net)).toLocaleString('en-IN')}</span></>);
    if (isNum(niftyPct)) f.push(<>{momLabel} <span className={cls(niftyPct)}>{Math.abs(niftyPct).toFixed(2)}%</span></>);
  }
  return (
    <div className={`qc sent ${tone}`}>
      <div className="qh">Market sentiment{detail?.tag && <span className="srcp">{detail.tag}</span>}
        <span className="senthd"><b style={{ color: col }}><AnimatedNumber value={score} from={0} render={(n) => Math.round(n)} /></b><em style={{ color: col }}>{label}</em></span>
      </div>
      <div className="sentwrap">
        <div className="gbar"><div className="gneedle" style={{ left: `${score}%` }} /></div>
        <div className="gsc"><span>fear</span><span>greed</span></div>
        {hasDetail ? <SentimentDetail leading={detail.leading} coincident={detail.coincident} divergence={detail.divergence} /> : <div className="sfac">{f.map((x, i) => <span key={i}>{i ? ' · ' : ''}{x}</span>)}</div>}
      </div>
    </div>
  );
}

// ── Day movers: top-5 gainers (green tint) | draggers (red tint) — own card,
// lives in the wrap-mid RIGHT column beside Market insights. ───────────────────
function MoversSplit({ gainers, losers, note }) {
  return (
    <div className="card movers">
      <div className="wlabel">Top movers <span className="hint">{note || 'day'}</span></div>
      <div className="mvcols">
        <div><div className="qh">Gainers</div><Movers list={gainers} /></div>
        <div><div className="qh">Draggers</div><Movers list={losers} /></div>
      </div>
    </div>
  );
}
function Movers({ list }) {
  const rows = (list || []).filter((m) => m && m.sym && m.pct != null).slice(0, 5);
  if (!rows.length) return <div className="na">—</div>;
  return (
    <div className="mvlist">
      {rows.map((m) => (
        <div className="mv" key={m.sym}><span className="s">{m.sym}</span><span className={`p ${cls(m.pct)}`}>{Math.abs(m.pct).toFixed(2)}%</span></div>
      ))}
    </div>
  );
}

// ── Macro percentile sliders: tone zone + white knob + 1-yr-%ile scale ───────
function SliderBoard({ board, region = 'india' }) {
  // India view shows only india-tagged + shared (cross-asset) series; US view shows
  // everything except the india-tagged ones. `shared` = the cross-border channels
  // (Brent / DXY / USD-INR) that both regimes care about; US series are untagged
  // ('global'), so they fall to the US view and out of the India one.
  const hidden = (c) =>
    region === 'india' ? !(c.region === 'india' || c.region === 'shared')
    : region === 'us'  ? c.region === 'india'
    : false;
  const groups = (board?.groups || []).map((g) => ({ group: g.group, rows: (g.series || []).filter((c) => c && !c.stale && c.value != null && !hidden(c)) })).filter((g) => g.rows.length);
  if (!groups.length) return null;
  return (
    <div className="card">
      <div className="wlabel">Macro backdrop <span className="hint">knob = 1-yr percentile</span></div>
      <div className="grps">
        {groups.map((g) => (
          <div className="grp" key={g.group}>
            <div className="grp-h">{g.group}</div>
            <div className="sldgrid">
              {g.rows.map((c) => {
                const d = c.d ?? 2;
                return (
                  <div className="sld" key={c.key}>
                    <div className="sld-top"><span>{c.label}</span><b>{c.value.toFixed(d)}{c.unit}</b></div>
                    <div className="sld-track">
                      <div className={`sld-zone ${TONE[c.tone] || 'calm'}`} />
                      <div className="sld-knob" style={{ left: `${c.pos}%` }} />
                    </div>
                    <div className="sld-sc"><span>{c.lo != null ? c.lo.toFixed(d) : ''}</span><span className="pl">%ile</span><span>{c.hi != null ? c.hi.toFixed(d) : ''}</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MacroTab({ premarket, usSentiment, indiaSentiment, macro, macroBoard, nifty50, nifty50Loading, nasdaq, nasdaqLoading, niftyDaily, dividends, portfolioNews, marketNews, fiidiiTrail, regime, markets, insights, insightsOn, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
  // India / Global / All filter (persisted).
  const [region, setRegion] = useState('india');
  useEffect(() => { try { const r = localStorage.getItem('nwTracker.wrapRegion'); const m = r === 'global' ? 'us' : r === 'all' ? 'india' : r; if (m === 'india' || m === 'us') setRegion(m); } catch {} }, []);
  const pickRegion = (r) => { setRegion(r); try { localStorage.setItem('nwTracker.wrapRegion', r); } catch {} };
  const showIN = region === 'india';
  const showUS = region === 'us';

  const c = premarket?.cues || {};
  const ind = premarket?.indices || {};
  const ivix = ind.vix;
  const dxy = macro?.live?.dxy && !macro.live.dxy.stale ? macro.live.dxy : null;
  const asOf = ind.asOf ? new Date(ind.asOf).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';

  // Ticker rows, region-aware (filtered from live data — never fabricated).
  const q = (x, name) => (x && x.price != null ? { name: name || x.label, val: fmt(x.price), pct: apct(x.pct), cls: cls(x.pct) } : null);
  // Indices + Commod·FX rails are COMMON across regions (India + US shown together);
  // only the News rail below stays region-aware.
  // Region-grouped rail: a divider marker { div } leads each region, included ONLY when that
  // region has ≥1 live index (a dead feed drops the whole region — divider and all — never a
  // stranded label). Order: India · US · Europe · Asia.
  const railRegion = (div, ...items) => { const live = items.filter(Boolean); return live.length ? [{ div }, ...live] : []; };
  const idx = [
    ...railRegion('India', q(c.nifty), q(c.sensex),
      ivix?.last != null ? { name: 'India VIX', val: fmt(ivix.last), pct: apct(ivix.pct), cls: cls(ivix.pct) } : null),
    ...railRegion('US', q(c.sp500), q(c.nasdaq), q(c.dow)),
    ...railRegion('Europe', q(c.ftse), q(c.cac), q(c.dax)),
    ...railRegion('Asia', q(c.nikkei), q(c.hangseng), q(c.kospi)),
  ];
  const fx = [
    q(c.gold), q(c.silver), q(c.brent), q(c.natgas), q(c.usdinr), q(c.us10y),
    dxy ? { name: 'DXY', val: fmt(dxy.value), pct: apct(dxy.prev ? (dxy.change / dxy.prev) * 100 : null), cls: cls(dxy.change) } : null,
    q(c.btc), q(c.eth),
  ].filter(Boolean);
  // News rail = market headlines (/api/news) + per-holding portfolio headlines
  // (/api/portfolio-news) merged into ONE region-aware rail. Portfolio items carry the
  // holding ticker as an accent-tinted pill (it.tag); market items don't. Region tags
  // differ by source (market: india/global · portfolio: in/us) → normalise to india/us
  // so the toggle filters both; untagged (stale-cache) items stay visible. Deduped by
  // title, newest-first, capped so portfolio headlines don't swamp the market ones.
  const canonRegion = (r) => (r === 'india' || r === 'in') ? 'india' : (r === 'global' || r === 'us') ? 'us' : null;
  const mkNewsItem = (it, tag) => ({ title: it.title, sentiment: it.sentiment, date: it.date, reg: canonRegion(it.region), tag });
  let newsRaw = [
    ...(portfolioNews?.items || []).filter((it) => it && it.title).map((it) => mkNewsItem(it, it.ticker || null)),
    ...(marketNews?.items || []).filter((it) => it && it.title).map((it) => mkNewsItem(it, null)),
  ];
  const inReg = newsRaw.filter((it) => it.reg == null || it.reg === region);
  if (inReg.length) newsRaw = inReg;
  const seenNews = new Set();
  const news = newsRaw
    .filter((it) => it.title && !seenNews.has(it.title) && seenNews.add(it.title))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, 16)
    .map((it) => ({ dot: sdot(it.sentiment), text: it.title, tag: it.tag, cls: it.sentiment > 0 ? 'grn' : it.sentiment < 0 ? 'red' : '' }));

  const pulse = insights?.pulse;
  const hasPulse = insightsOn && !insightsFirstLoad && pulse && (pulse.read || pulse.drivers || pulse.drags);
  // US sector day-moves feed the US breadth fallback below (not a treemap anymore).
  const usSectors = (premarket?.usSectors || []).map((s) => ({ name: s.label, pct: s.pct })).sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
  const niftyPct = c.nifty?.pct;
  const breadthPct = ind.breadthAD?.pctUp;

  // Nifty 50 Overview inputs (India view): hero quote from the live cue; daily
  // returns, trend windows and the hero sparkline from the ^NSEI daily closes;
  // options + pivots from the premarket feed. Each sub-block hides when absent.
  const niftyCloses = niftyDaily?.closes || [];
  const niftyQuote = c.nifty?.price != null
    ? { last: c.nifty.price, pct: c.nifty.pct, change: c.nifty.change }
    : (niftyDaily?.latest != null ? { last: niftyDaily.latest, pct: null, change: null } : null);
  const niftyReturns = dailyReturns(niftyCloses, 5);
  const niftyTrendW = trendWindows(niftyCloses, niftyDaily?.latest, niftyDaily?.latestDate);
  const niftySpark = niftyCloses.slice(-32).map((p) => ({ c: p.close }));
  const fdTrail = (fiidiiTrail || []).filter((p) => p && (isFinite(p.fii) || isFinite(p.dii)));
  const fiiNet = fdTrail.length ? (fdTrail[fdTrail.length - 1].fii || 0) + (fdTrail[fdTrail.length - 1].dii || 0) : null;
  // FII/DII renders as its own full-width card below (India only); also shown
  // whenever FII derivative positioning is available.
  const fiiDerivs = premarket?.fiiDerivs;
  const showFii = showIN && (ind.breadthAD || fdTrail.length >= 2 || (fiiDerivs && !fiiDerivs.stale));
  // US-side sentiment inputs (Global view mirrors India minus FII/DII): sector
  // breadth (% of SPDR sectors green), US VIX, S&P 500 day move + day movers.
  const usSecLive = usSectors.filter((s) => s.pct != null);
  const usBreadthPct = usSecLive.length ? (usSecLive.filter((s) => s.pct > 0).length / usSecLive.length) * 100 : null;
  const usVix = premarket?.usVix;
  const spxPct = c.sp500?.pct;
  const usMovers = premarket?.usMovers;
  const usAsOf = premarket?.sessions?.sp500?.asOf
    ? new Date(premarket.sessions.sp500.asOf).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';

  return (
    <div className="wrapx">
      {/* 3-line ticker railines — pinned to the top of the tab */}
      <TickerLine label="Indices" items={idx} anim="run" />
      <TickerLine label="Commod · FX" kind="cmd" items={fx} anim="run rev" />
      <TickerLine label="News" kind="nw" items={news} anim="run slow" />

      {/* Region filter + as-of — the India/US toggle that drives the whole tab */}
      <div className="hdr">
        <div className="seg" role="tablist" aria-label="Region filter">
          {[['india', 'India'], ['us', 'US']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={region === k} className={region === k ? 'on' : ''} onClick={() => pickRegion(k)}>{l}</button>
          ))}
        </div>
        <span className="asof">{asOf ? `NSE · ${asOf}` : 'market wrap'}</span>
      </div>

      {/* Persistent portfolio review — whole-book AI read, shown for both India and US.
          AI tag doubles as the refresh control with the countdown beside it. */}
      {hasPulse && (
        <div className="kept">
          <span className="ktag">✦ Portfolio overview</span>
          <span className="ktxt">{pulse.read || 'Whole-book read across today’s macro.'}</span>
          {insightsTs && (
            <span className="kept-r" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="ai-ago">{agoShort(insightsTs)}</span>
              <button className="ins-ai" style={{ '--ai-tag': 'var(--acc)' }} onClick={onRefresh || undefined} disabled={!onRefresh} title="Click to regenerate this analysis" aria-label="Regenerate AI analysis">AI</button>
            </span>
          )}
        </div>
      )}

      {/* SWOT — AI read; the region toggle above picks which side(s) show */}
      {insightsOn && ((showIN && insights?.indian_swot) || (showUS && insights?.us_swot)) && (
        <div className={`swotrow${showIN && showUS && insights?.indian_swot && insights?.us_swot ? ' two-up' : ''}`}>
          {showIN && insights?.indian_swot && <SwotCard swot={insights.indian_swot} title="India — SWOT" loading={insightsLoading} accent="var(--blu)" />}
          {showUS && insights?.us_swot && <SwotCard swot={insights.us_swot} title="US — SWOT" loading={insightsLoading} accent="var(--cyn)" />}
        </div>
      )}

      {/* Nifty 50 Overview + your upcoming dividends — India view only (both are
          NSE-specific). Index level/returns/options/S&R/trend, then the personalised
          dividend calendar for held stocks. */}
      {showIN && (
        <div className="nov-block">
          <NiftyOverview
            quote={niftyQuote}
            spark={niftySpark}
            returns={niftyReturns}
            trend={niftyTrendW}
            options={premarket?.options}
            levels={premarket?.levels?.nifty}
          />
          <UpcomingDividends items={dividends?.items} loading={dividends == null} />
        </div>
      )}

      {/* Left: market insights (sentiment, leading/coincident expanded). Right: top
          movers (day gainers | draggers). Portfolio news now lives in the News rail
          above, tagged per-holding — no separate news card, no calendar here. */}
      <div className="wrap-mid">
        <div className="card">
          <div className="wlabel">Market insights <span className="hint">{showIN ? (asOf ? `NSE · ${asOf}` : 'today') : (usAsOf ? `US · ${usAsOf}` : 'US')}</span></div>
          <div className="wstack">
            <SentimentCell
              detail={showIN
                ? { composite: indiaSentiment?.composite, tag: isNum(indiaSentiment?.composite?.score) ? 'India · blend' : null, ...buildIndiaDetail(indiaSentiment, breadthPct) }
                : { composite: usSentiment?.composite, tag: isNum(usSentiment?.composite?.score) ? 'US · CNN' : null, ...buildUsDetail(usSentiment) }}
              fallback={{
                breadthPct: showIN ? breadthPct : usBreadthPct,
                vix: showIN ? ivix?.last : usVix,
                net: showIN ? fiiNet : null,
                niftyPct: showIN ? niftyPct : spxPct,
              }}
              momLabel={showIN ? 'Nifty' : 'S&P'}
            />
          </div>
        </div>
        <div className="wrap-mid-r">
          <MoversSplit
            gainers={showIN ? nifty50?.movers?.gainers : usMovers?.gainers}
            losers={showIN ? nifty50?.movers?.losers : usMovers?.losers}
            note={showIN ? (asOf ? `NSE · ${asOf}` : 'day') : (usAsOf ? `US · ${usAsOf}` : 'day')}
          />
        </div>
      </div>

      {/* FII/DII — its own full-width card below the internals + news row (India only) */}
      {showFii && (
        <div className="card fdcard">
          <div className="wlabel">FII / DII · net flow
            <span className="hint">{fdTrail.length >= 2 ? `NSE · last ${fdTrail.length} sessions` : 'NSE'}</span>
            <span className="fdleg"><i className="lf" />FII<i className="ld" />DII<i className="ln" />net</span>
          </div>
          <FiiDiiChart trail={fiidiiTrail} derivs={fiiDerivs} />
        </div>
      )}

      {/* Market heatmap — Fyers-style nested treemap (sector › industry › stock), sized
          by market cap, drill into a sector. Full-width so the treemap has room. Nifty-50
          on the India view, Nasdaq-100 on US. Same MarketHeatmap component, different
          taxonomy + feed. */}
      {showIN && (nifty50Loading || nifty50?.stocks?.length) ? (
        <div className="card fdcard">
          <div className="wlabel">Nifty 50 · heatmap
            <span className="hint">sized by market cap · click a sector to drill in</span>
          </div>
          <MarketHeatmap stocks={nifty50?.stocks} loading={nifty50Loading} />
        </div>
      ) : null}
      {showUS && (nasdaqLoading || nasdaq?.stocks?.length) ? (
        <div className="card fdcard">
          <div className="wlabel">Nasdaq 100 · heatmap
            <span className="hint">sized by market cap · click a sector to drill in</span>
          </div>
          <MarketHeatmap stocks={nasdaq?.stocks} loading={nasdaqLoading} meta={NASDAQ_META} fallback={NASDAQ_FALLBACK} label="Nasdaq 100" />
        </div>
      ) : null}

      {/* Macro percentile sliders */}
      <SliderBoard board={macroBoard} region={region} />
    </div>
  );
}
