'use client';
import { useState, useEffect } from 'react';
import SwotCard from '../shared/SwotCard';

// ── tiny formatters (mockup style: ▲/▼ glyph + grn/red/mut colour) ───────────
const cls = (p) => (p == null || !isFinite(p) ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');
const apct = (p) => (p == null || !isFinite(p) ? '·—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '·'}${Math.abs(p).toFixed(2)}%`);
const fmt = (n) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const sdot = (s) => (s > 0 ? 'g' : s < 0 ? 'r' : 'n');
const TONE = { calm: 'calm', warn: 'warn', stress: 'stress' };
// Solid-ish diverging tile colour for the sector squares (theme text on top).
const sheat = (p) => (p == null || !isFinite(p)) ? 'var(--sur2)'
  : `color-mix(in srgb, ${p >= 0 ? 'var(--grn)' : 'var(--red)'} ${Math.round(22 + Math.min(1, Math.abs(p) / 3) * 58)}%, var(--sur2))`;
const shortSec = (n) => String(n || '').replace(/^Nifty\s*/i, '');
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const agoStr = (ts) => {
  if (!ts) return '';
  const m = Math.max(0, (Date.now() - ts) / 60000);
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60; return h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};

// ── 3-line ticker ────────────────────────────────────────────────────────────
function TickerLine({ label, kind, items, anim }) {
  if (!items || !items.length) return null;
  const loop = items.concat(items); // 2× for a seamless −50% loop
  return (
    <div className="tkw">
      <span className={`tklab ${kind || ''}`}>{label}</span>
      <div className="tkv">
        <div className={`tkrow ${anim}`}>
          {loop.map((it, i) => (
            <span className="tki" key={i} aria-hidden={i >= items.length}>
              {it.dot
                ? <><i className={`tdot ${it.dot}`} /><span className={it.cls}>{it.text}</span></>
                : <><b>{it.name}</b> {it.val} <em className={it.cls}>{it.pct}</em></>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── FII/DII net-flow: FII + DII composition with a net tick (fiidiinetbars mock,
// "Net composition" variant). Overlapping translucent FII (cyan) + DII (violet)
// from the zero line, white tick = net (FII+DII); up = bought, down = sold.
// Hover a day to spotlight it (dims the rest) and read FII/DII/net + the net label.
function FiiDiiChart({ trail }) {
  const pts = (trail || []).filter((p) => p && (isFinite(p.fii) || isFinite(p.dii)));
  const [hi, setHi] = useState(-1);
  if (pts.length < 2) return <div className="na">FII/DII flow trail builds forward — needs a few more sessions.</div>;

  const W = 560, H = 158, PAD_L = 30, PAD_R = 10, zero = 78, half = 54, n = pts.length;
  const colW = (W - PAD_L - PAD_R) / n;
  const bw = Math.min(20, colW * 0.56);
  const net = (p) => (p.fii || 0) + (p.dii || 0);
  const maxAbs = Math.max(1, ...pts.flatMap((p) => [Math.abs(p.fii || 0), Math.abs(p.dii || 0), Math.abs(net(p))]));
  const sc = half / maxAbs;
  const seg = (v) => { const h = Math.abs(v || 0) * sc; return { y: v >= 0 ? zero - h : zero, h }; };
  const d3 = (v) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(Math.round(v)).toLocaleString('en-IN'));
  const cur = hi >= 0 ? pts[hi] : pts[pts.length - 1];

  return (
    <>
      <svg className="fdg" width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHi(-1)}>
        <line x1={PAD_L - 6} y1={zero} x2={W - PAD_R} y2={zero} stroke="var(--brd)" />
        <text x="2" y="13" className="fdax">buy ▲</text>
        <text x="2" y={H - 15} className="fdax">sell ▼</text>
        {pts.map((p, i) => {
          const cx = PAD_L + colW * i + colW / 2, x = cx - bw / 2;
          const f = seg(p.fii), d = seg(p.dii), nv = net(p), ny = zero - nv * sc;
          const dim = hi >= 0 && hi !== i ? 0.28 : 1;
          return (
            <g key={i} opacity={dim} onMouseEnter={() => setHi(i)}>
              <rect className="fd-fii" x={x} y={f.y} width={bw} height={f.h} rx="2" />
              <rect className="fd-dii" x={x} y={d.y} width={bw} height={d.h} rx="2" />
              <line className="fd-net" x1={x - 1} y1={ny} x2={x + bw + 1} y2={ny} />
              <rect x={PAD_L + colW * i} y="4" width={colW} height={H - 16} fill="transparent" />
              {hi === i && <text x={cx} y={ny + (nv >= 0 ? -5 : 12)} textAnchor="middle" className={`fdval ${nv >= 0 ? 'grn' : 'red'}`}>{d3(nv)}</text>}
              {(n <= 12 || i % 2 === 0) && <text x={cx} y={H - 3} textAnchor="middle" className="fdax">{String(p.d).replace(/-\d{4}$/, '').replace('-', '')}</text>}
            </g>
          );
        })}
      </svg>
      <div className="tlatest">
        {cur && <>{String(cur.d).replace(/-\d{4}$/, '')} · FII <b className={cls(cur.fii)}>{d3(cur.fii)}</b> · DII <b className={cls(cur.dii)}>{d3(cur.dii)}</b> · net <b className={cls(net(cur))}>{d3(net(cur))}</b> cr</>}
      </div>
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
function SentimentGauge({ breadthPct, vix, net, niftyPct }) {
  const fg = fearGreed(breadthPct, vix, net, niftyPct);
  if (!fg) return <div className="na">—</div>;
  const col = fg.score < 45 ? 'var(--red)' : fg.score < 56 ? 'var(--sc-opt)' : 'var(--grn)';
  const snet = (v) => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v)).toLocaleString('en-IN');
  const facts = [
    breadthPct != null && isFinite(breadthPct) ? `breadth ${Math.round(breadthPct)}%` : null,
    vix != null && isFinite(vix) ? `VIX ${vix.toFixed(1)}` : null,
    net != null && isFinite(net) ? `FII/DII ${snet(net)}` : null,
    niftyPct != null && isFinite(niftyPct) ? `Nifty ${apct(niftyPct)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="sentwrap">
      <div className="sentval" style={{ color: col }}>{fg.score}</div>
      <div className="sentlab" style={{ color: col }}>{fg.label}</div>
      <div className="gbar"><div className="gneedle" style={{ left: `${fg.score}%` }} /></div>
      <div className="gsc"><span>fear</span><span>greed</span></div>
      <div className="sfac">{facts}</div>
    </div>
  );
}

// ── Day movers: top-5 gainers / draggers from the Nifty 50 constituent feed. ──
function Movers({ list }) {
  const rows = (list || []).filter((m) => m && m.sym && m.pct != null).slice(0, 5);
  if (!rows.length) return <div className="na">—</div>;
  return (
    <div className="mvlist">
      {rows.map((m) => (
        <div className="mv" key={m.sym}><span className="s">{m.sym}</span><span className={`p ${cls(m.pct)}`}>{apct(m.pct)}</span></div>
      ))}
    </div>
  );
}

// ── Portfolio news feed (sentiment-shaded cards, scrollable) ─────────────────
function NewsFeed({ news, region }) {
  let items = (news?.items || []).filter((it) => it && it.title);
  // Region-aware: India hides US-holding news, Global hides India's (untagged
  // items from a stale cache stay visible until the route's region tag lands).
  if (region === 'india') items = items.filter((it) => it.region !== 'us');
  else if (region === 'global') items = items.filter((it) => it.region !== 'in');
  return (
    <div className="card feedcard">
      <div className="wlabel">Portfolio news · your holdings</div>
      {items.length
        ? <div className="feed">{items.map((it, i) => (
          <a className={`ncard ${it.sentiment > 0 ? 'pos' : it.sentiment < 0 ? 'neg' : 'neu'}`} key={i} href={it.link || undefined} target="_blank" rel="noopener noreferrer">
            <span className="tag">{it.ticker}</span>
            <div className="nh">{it.title}</div>
            <div className="nm">{it.source || 'Yahoo'} · {it.ago}</div>
          </a>))}</div>
        : <div className="na">Headlines load when the tab opens…</div>}
    </div>
  );
}

// ── Macro percentile sliders: tone zone + white knob + 1-yr-%ile scale ───────
function SliderBoard({ board }) {
  const groups = (board?.groups || []).map((g) => ({ group: g.group, rows: (g.series || []).filter((c) => c && !c.stale && c.value != null) })).filter((g) => g.rows.length);
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

export default function MacroTab({ premarket, macro, macroBoard, nifty50, portfolioNews, marketNews, fiidiiTrail, regime, markets, insights, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
  // India / Global / All filter (persisted).
  const [region, setRegion] = useState('all');
  useEffect(() => { try { const r = localStorage.getItem('nwTracker.wrapRegion'); if (r === 'india' || r === 'global' || r === 'all') setRegion(r); } catch {} }, []);
  const pickRegion = (r) => { setRegion(r); try { localStorage.setItem('nwTracker.wrapRegion', r); } catch {} };
  const showIN = region !== 'global';
  const showUS = region !== 'india';

  const c = premarket?.cues || {};
  const ind = premarket?.indices || {};
  const ivix = ind.vix;
  const dxy = macro?.live?.dxy && !macro.live.dxy.stale ? macro.live.dxy : null;
  const asOf = ind.asOf ? new Date(ind.asOf).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';

  // Ticker rows, region-aware (filtered from live data — never fabricated).
  const q = (x, name) => (x && x.price != null ? { name: name || x.label, val: fmt(x.price), pct: apct(x.pct), cls: cls(x.pct) } : null);
  const idx = [
    ...(showIN ? [q(c.nifty), q(c.sensex), ivix?.last != null ? { name: 'India VIX', val: fmt(ivix.last), pct: apct(ivix.pct), cls: cls(ivix.pct) } : null] : []),
    ...(showUS ? [q(c.sp500), q(c.nasdaq), q(c.dow), q(c.nikkei), q(c.hangseng)] : []),
  ].filter(Boolean);
  const fx = [
    q(c.gold), q(c.silver), q(c.brent), q(c.usdinr), q(c.us10y),
    dxy ? { name: 'DXY', val: fmt(dxy.value), pct: apct(dxy.prev ? (dxy.change / dxy.prev) * 100 : null), cls: cls(dxy.change) } : null,
  ].filter(Boolean);
  let newsRaw = (marketNews?.items || []).filter((it) => it && it.title);
  if (region === 'india') { const f = newsRaw.filter((it) => /ET|Money|Mint|Business|BS\b/i.test(it.source || '')); if (f.length) newsRaw = f; }
  else if (region === 'global') { const f = newsRaw.filter((it) => /CNBC|Reuters|Bloomberg/i.test(it.source || '')); if (f.length) newsRaw = f; }
  const news = newsRaw.slice(0, 12).map((it) => ({ dot: sdot(it.sentiment), text: it.title, cls: it.sentiment > 0 ? 'grn' : it.sentiment < 0 ? 'red' : '' }));

  const pulse = insights?.pulse;
  const hasPulse = !insightsFirstLoad && pulse && (pulse.read || pulse.drivers || pulse.drags);
  const usSectors = (premarket?.usSectors || []).map((s) => ({ name: s.label, pct: s.pct })).sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
  const nseSectors = (ind.sectors || []).slice().sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
  const sectors = showIN ? nseSectors : usSectors;
  const sectorLabel = showIN ? 'NSE sectors' : 'US sectors (SPDR)';
  // Hot picks = the most-moved sectors; sentiment factors + day movers (India).
  const hotSectors = [...sectors].filter((s) => s.pct != null).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 6);
  const niftyPct = c.nifty?.pct;
  const breadthPct = ind.breadthAD?.pctUp;
  const fdLast = (fiidiiTrail || []).filter((p) => p && (isFinite(p.fii) || isFinite(p.dii))).slice(-1)[0];
  const fiiNet = fdLast ? (fdLast.fii || 0) + (fdLast.dii || 0) : null;

  return (
    <div className="wrapx">
      {/* Overview banner — one-line whole-book read of today's macro */}
      {hasPulse && (
        <div className="kept">
          <span className="ktag">✦ Portfolio overview</span>
          <span className="ktxt">{pulse.read || 'Whole-book read across today’s macro.'}</span>
          {insightsTs && <span className="kept-r"><span className="kdiv">AI · {agoStr(insightsTs)}</span></span>}
        </div>
      )}

      {/* Region filter + as-of — the single toggle that drives the whole tab */}
      <div className="hdr">
        <div className="seg" role="tablist" aria-label="Region filter">
          {[['india', 'India'], ['global', 'Global'], ['all', 'All']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={region === k} className={region === k ? 'on' : ''} onClick={() => pickRegion(k)}>{l}</button>
          ))}
        </div>
        <span className="asof">{asOf ? `NSE · ${asOf}` : 'market wrap'}</span>
      </div>

      {/* SWOT — straightforward AI read; the region toggle above picks which side(s) show */}
      {((showIN && insights?.indian_swot) || (showUS && insights?.us_swot)) && (
        <div className={`swotrow${showIN && showUS && insights?.indian_swot && insights?.us_swot ? ' two-up' : ''}`}>
          {showIN && insights?.indian_swot && <SwotCard swot={insights.indian_swot} title="India — SWOT" loading={insightsLoading} accent="var(--blu)" />}
          {showUS && insights?.us_swot && <SwotCard swot={insights.us_swot} title="US — SWOT" loading={insightsLoading} accent="var(--cyn)" />}
        </div>
      )}

      {/* 3-line ticker */}
      <TickerLine label="Indices" items={idx} anim="run" />
      <TickerLine label="Commod · FX" kind="cmd" items={fx} anim="run rev" />
      <TickerLine label="News" kind="nw" items={news} anim="run slow" />

      {/* Left: market internals · Right: portfolio news */}
      <div className="two">
        {showIN ? (
          <div className="card">
            <div className="wlabel">Market internals <span className="hint">{asOf ? `NSE · ${asOf}` : 'today'}</span></div>
            <div className="wquad">
              <div className="qc">
                <div className="qh">Hot sectors<span className="hlg">{[5, 3, 1.5, -1.5, -3, -5].map((x, i) => <i key={i} style={{ background: sheat(x) }} />)}</span></div>
                {hotSectors.length
                  ? <div className="sgrid">{hotSectors.map((s) => <div className="st" key={s.name} style={{ background: sheat(s.pct) }}><span>{shortSec(s.name)}</span><b>{s.pct.toFixed(2)}</b></div>)}</div>
                  : <div className="na">—</div>}
              </div>
              <div className="qc"><div className="qh">Market sentiment</div><SentimentGauge breadthPct={breadthPct} vix={ivix?.last} net={fiiNet} niftyPct={niftyPct} /></div>
              <div className="qc"><div className="qh">Top gainers · day</div><Movers list={nifty50?.movers?.gainers} /></div>
              <div className="qc"><div className="qh">Top draggers · day</div><Movers list={nifty50?.movers?.losers} /></div>
            </div>
            {(ind.breadthAD || (fiidiiTrail || []).length >= 2) && <>
              <div className="rlabel fdr">FII / DII · net flow <span className="fdleg"><i className="lf" />FII<i className="ld" />DII<i className="ln" />net</span></div>
              <FiiDiiChart trail={fiidiiTrail} />
            </>}
          </div>
        ) : (
          <div className="card">
            <div className="wlabel">{sectorLabel} <span className="hint">{asOf ? 'live' : 'today'}</span></div>
            {hotSectors.length
              ? <div className="sgrid">{hotSectors.map((s) => <div className="st" key={s.name} style={{ background: sheat(s.pct) }}><span>{shortSec(s.name)}</span><b>{s.pct.toFixed(2)}</b></div>)}</div>
              : <div className="na">Sector board unavailable.</div>}
          </div>
        )}
        <NewsFeed news={portfolioNews} region={region} />
      </div>

      {/* Macro percentile sliders */}
      <SliderBoard board={macroBoard} />
    </div>
  );
}
