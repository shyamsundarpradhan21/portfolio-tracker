'use client';
import { useState, useEffect } from 'react';
import SwotCard from '../shared/SwotCard';

// ── tiny formatters (mockup style: ▲/▼ glyph + grn/red/mut colour) ───────────
const cls = (p) => (p == null || !isFinite(p) ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');
const apct = (p) => (p == null || !isFinite(p) ? '·—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '·'}${Math.abs(p).toFixed(2)}%`);
const fmt = (n) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const sdot = (s) => (s > 0 ? 'g' : s < 0 ? 'r' : 'n');
const TONE = { calm: 'calm', warn: 'warn', stress: 'stress' };
const heat = (p) => {
  if (p == null || !isFinite(p)) return 'var(--sur2)';
  const o = Math.min(58, Math.round(Math.abs(p) * 13 + 10));
  return `color-mix(in srgb, ${p >= 0 ? 'var(--grn)' : 'var(--red)'} ${o}%, transparent)`;
};
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
                ? <><i className={`tdot ${it.dot}`} />{it.text}</>
                : <><b>{it.name}</b> {it.val} <em className={it.cls}>{it.pct}</em></>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── FII/DII net-flow bars (15-session, hover a day) ──────────────────────────
function FiiDiiChart({ trail }) {
  const pts = (trail || []).filter((p) => p && (isFinite(p.fii) || isFinite(p.dii)));
  const [hi, setHi] = useState(-1);
  if (pts.length < 2) return <div className="na">FII/DII flow trail builds forward — needs a few more sessions.</div>;

  const W = 560, H = 150, zero = 80, half = 52, n = pts.length;
  const colW = (W - 16) / n;
  const bw = Math.min(13, colW * 0.3);
  const maxAbs = Math.max(1, ...pts.flatMap((p) => [Math.abs(p.fii || 0), Math.abs(p.dii || 0)]));
  const sc = half / maxAbs;
  const bar = (v, x) => { const h = Math.abs(v || 0) * sc; return { x, y: v >= 0 ? zero - h : zero, h }; };
  const d3 = (v) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(Math.round(v)).toLocaleString('en-IN'));

  const tot = pts.reduce((a, p) => ({ fii: a.fii + (p.fii || 0), dii: a.dii + (p.dii || 0) }), { fii: 0, dii: 0 });
  const up = pts.filter((p) => (p.fii || 0) + (p.dii || 0) >= 0).length;
  const cur = hi >= 0 ? pts[hi] : null;

  return (
    <>
      <svg className="fdg" width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHi(-1)}>
        <line x1="8" y1={zero} x2={W - 8} y2={zero} stroke="var(--brd)" />
        <text x="10" y="26" className="fdax">buy ▲</text>
        <text x="10" y={H - 6} className="fdax">sell ▼</text>
        {pts.map((p, i) => {
          const cx = 8 + colW * i + colW / 2;
          const f = bar(p.fii, cx - bw - 1), d = bar(p.dii, cx + 1);
          const dim = hi >= 0 && hi !== i ? 0.26 : 1;
          return (
            <g key={i} opacity={dim} onMouseEnter={() => setHi(i)}>
              <rect className="fd-fii" x={f.x} y={f.y} width={bw} height={f.h} />
              <rect className="fd-dii" x={d.x} y={d.y} width={bw} height={d.h} />
              <rect x={8 + colW * i} y="18" width={colW} height={H - 30} fill="transparent" />
              {(n <= 11 || i % 2 === 0) && <text x={cx} y={H - 4} textAnchor="middle" className="fdax">{String(p.d).replace(/-\d{4}$/, '').replace('-', '')}</text>}
            </g>
          );
        })}
      </svg>
      <div className="tlatest">
        {cur
          ? <>{String(cur.d).replace(/-\d{4}$/, '')} · FII <b className={cls(cur.fii)}>{d3(cur.fii)}</b> · DII <b className={cls(cur.dii)}>{d3(cur.dii)}</b> · net <b className={cls((cur.fii || 0) + (cur.dii || 0))}>{d3((cur.fii || 0) + (cur.dii || 0))}</b> cr</>
          : <>Last {n} sessions · FII <b className={cls(tot.fii)}>{d3(tot.fii)}</b> · DII <b className={cls(tot.dii)}>{d3(tot.dii)}</b> · net <b className={cls(tot.fii + tot.dii)}>{d3(tot.fii + tot.dii)}</b> cr · {up} up / {n - up} down</>}
      </div>
    </>
  );
}

// ── Breadth: gradient needle on a bearish→bullish scale (per breadthfinal) ───
function BreadthNeedle({ ad }) {
  if (!ad) return null;
  const row = (label, pctUp, big) => (
    <div className="grrow" key={label}>
      <span className="grcl">{label}</span>
      <div className={`grtrack${big ? ' grbig' : ''}`}><div className={`grneedle${big ? ' big' : ''}`} style={{ left: `${pctUp}%` }} /></div>
      <b className={pctUp >= 50 ? 'grn' : 'red'}>{pctUp}%</b>
    </div>
  );
  return (
    <>
      <div className="rlabel">Breadth · % advancing
        {ad.adv != null && <span className="adr">A/D <b className={cls((ad.ratio ?? 1) - 1)}>{ad.ratio?.toFixed(2)}</b> · <span className="grn">{ad.adv}▲</span> / <span className="red">{ad.dec}▼</span></span>}
      </div>
      {ad.pctUp != null && <>
        {row('Nifty 500', ad.pctUp, true)}
        <div className="grsc"><span>bearish</span><span>50</span><span>bullish</span></div>
      </>}
      {(ad.caps || []).map((c) => row(c.name, c.pctUp, false))}
    </>
  );
}

// ── Portfolio news feed (sentiment-shaded cards, scrollable) ─────────────────
function NewsFeed({ news }) {
  const items = (news?.items || []).filter((it) => it && it.title);
  return (
    <div className="card feedcard">
      <div className="wlabel">Portfolio news · your holdings <span className="hint">tag + sentiment · scroll</span></div>
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
      <div className="wlabel">Macro · rates · inflation · growth · labour <span className="hint">knob = 1-yr percentile</span></div>
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
                    <div className="sld-sc"><span>{c.lo != null ? c.lo.toFixed(d) : ''}</span><span className="pl">1Y %ile</span><span>{c.hi != null ? c.hi.toFixed(d) : ''}</span></div>
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

export default function MacroTab({ premarket, macro, macroBoard, portfolioNews, marketNews, fiidiiTrail, regime, markets, insights, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
  // India / Global / All filter (persisted).
  const [region, setRegion] = useState('all');
  const [openSwot, setOpenSwot] = useState(null);
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
  const news = newsRaw.slice(0, 12).map((it) => ({ dot: sdot(it.sentiment), text: it.title }));

  const pulse = insights?.pulse;
  const hasPulse = !insightsFirstLoad && pulse && (pulse.read || pulse.drivers || pulse.drags);
  const usSectors = (premarket?.usSectors || []).map((s) => ({ name: s.label, pct: s.pct })).sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
  const nseSectors = (ind.sectors || []).slice().sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
  const sectors = showIN ? nseSectors : usSectors;
  const sectorLabel = showIN ? 'NSE sectors' : 'US sectors (SPDR)';

  return (
    <div className="wrapx">
      {/* Overview banner — one-line whole-book read; SWOT chips expand the cards */}
      {hasPulse && (
        <div className="kept">
          <span className="ktag">✦ Portfolio overview</span>
          <span className="ktxt">{pulse.read || 'Whole-book read across today’s macro.'}</span>
          <div className="kept-r">
            {insights?.indian_swot && <button type="button" className={`swc blu ${openSwot === 'india' ? 'on' : ''}`} onClick={() => setOpenSwot(openSwot === 'india' ? null : 'india')}>India SWOT</button>}
            {insights?.us_swot && <button type="button" className={`swc cyn ${openSwot === 'us' ? 'on' : ''}`} onClick={() => setOpenSwot(openSwot === 'us' ? null : 'us')}>US SWOT</button>}
            {insightsTs && <span className="kdiv">AI · {agoStr(insightsTs)}</span>}
          </div>
        </div>
      )}
      {openSwot === 'india' && insights?.indian_swot && <div className="sec"><SwotCard swot={insights.indian_swot} title="India — SWOT" loading={insightsLoading} accent="var(--blu)" /></div>}
      {openSwot === 'us' && insights?.us_swot && <div className="sec"><SwotCard swot={insights.us_swot} title="US — SWOT" loading={insightsLoading} accent="var(--cyn)" /></div>}

      {/* Region filter + as-of */}
      <div className="hdr">
        <div className="seg" role="tablist" aria-label="Region filter">
          {[['india', 'India'], ['global', 'Global'], ['all', 'All']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={region === k} className={region === k ? 'on' : ''} onClick={() => pickRegion(k)}>{l}</button>
          ))}
        </div>
        <span className="asof">{asOf ? `NSE · ${asOf}` : 'market wrap'} · ticker scrolls; hover the FII/DII bars</span>
      </div>

      {/* 3-line ticker */}
      <TickerLine label="Indices" items={idx} anim="run" />
      <TickerLine label="Commod · FX" kind="cmd" items={fx} anim="run rev" />
      <TickerLine label="News" kind="nw" items={news} anim="run slow" />

      {/* Left: market internals · Right: portfolio news */}
      <div className="two">
        <div className="card">
          <div className="wlabel">{sectorLabel} <span className="hint">{asOf ? `live · ${asOf}` : 'today'}</span></div>
          {sectors.length
            ? <div className="heat" style={{ gridTemplateColumns: `repeat(${Math.min(5, sectors.length)}, 1fr)` }}>
              {sectors.map((s) => <div className="hc" key={s.name} style={{ background: heat(s.pct) }}><span>{s.name}</span><b className={cls(s.pct)}>{apct(s.pct)}</b></div>)}
            </div>
            : <div className="na">Sector board unavailable.</div>}
          {showIN && <BreadthNeedle ad={ind.breadthAD} />}
          {showIN && (ind.breadthAD || (fiidiiTrail || []).length >= 2) && <div className="rlabel">FII / DII · net flow <span className="hint">hover a day</span></div>}
          {showIN && <FiiDiiChart trail={fiidiiTrail} />}
        </div>
        <NewsFeed news={portfolioNews} />
      </div>

      {/* Macro percentile sliders */}
      <SliderBoard board={macroBoard} />
    </div>
  );
}
