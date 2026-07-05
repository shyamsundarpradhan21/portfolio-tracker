'use client';
// Shared market ticker rails — 3 scrolling marquees (Indices · Commod·FX · News).
// Lifted out of MacroTab into the global header (shell-6region). Data is derived from
// the live premarket/macro/marketNews feeds; region defaults to India (the Wrap tab
// keeps its own interactive India/US toggle for its body). Presentational only — no
// hooks, no fetches — safe to render high in the tree.

const cls  = (p) => (p == null || !isFinite(p) ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');
const apct = (p) => (p == null || !isFinite(p) ? '·—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '·'}${Math.abs(p).toFixed(2)}%`);
const fmt  = (n) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const sdot = (s) => (s > 0 ? 'g' : s < 0 ? 'r' : 'n');

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
            <span className="tki" key={i} aria-hidden={i >= half.length}>
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

export default function TickerRails({ premarket, macro, marketNews, region = 'india' }) {
  const showIN = region !== 'us';
  const showUS = region === 'us';
  const c = premarket?.cues || {};
  const ind = premarket?.indices || {};
  const ivix = ind.vix;
  const dxy = macro?.live?.dxy && !macro.live.dxy.stale ? macro.live.dxy : null;

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
  if (region === 'india') { const f = newsRaw.filter((it) => it.region !== 'global'); if (f.length) newsRaw = f; }
  else if (region === 'us') { const f = newsRaw.filter((it) => it.region !== 'india'); if (f.length) newsRaw = f; }
  const news = newsRaw.slice(0, 12).map((it) => ({ dot: sdot(it.sentiment), text: it.title, cls: it.sentiment > 0 ? 'grn' : it.sentiment < 0 ? 'red' : '' }));

  if (!idx.length && !fx.length && !news.length) return null;
  return (
    <div className="hdr-rails">
      <TickerLine label="Indices" items={idx} anim="run" />
      <TickerLine label="Commod · FX" kind="cmd" items={fx} anim="run rev" />
      <TickerLine label="News" kind="nw" items={news} anim="run slow" />
    </div>
  );
}
