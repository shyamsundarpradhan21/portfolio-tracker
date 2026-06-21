'use client';
import { useState, useEffect } from 'react';
import PreMarketBriefing from '../shared/PreMarketBriefing';
import SwotCard from '../shared/SwotCard';
import MarketOverview, { aggregateSectors } from '../shared/MarketOverview';
import SectorHeatmap from '../shared/SectorHeatmap';

// compact ▲/▼ pct for the breadth/VIX strip (the sector tiles use SectorHeatmap's own)
const wpct = (p) => (p == null || !isFinite(p) ? '—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '·'}${Math.abs(p).toFixed(2)}%`);
const wcls = (p) => (p == null ? 'mut' : p > 0 ? 'grn' : p < 0 ? 'red' : 'mut');

// relative age of the shown analysis (kept local — small + render-cheap)
function agoStr(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24; if (d < 7) return `${Math.round(d)}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// Regime tone → theme token (knob colour). Respects per-metric direction already
// resolved server-side (boardCell), so a high reading is red for VIX but green for
// the yield curve.
const TONE_VAR = { calm: 'var(--grn)', warn: 'var(--sc-opt)', stress: 'var(--red)' };

// Market-headline ticker (/api/news) — a slow, pause-on-hover marquee; the
// leading dot carries sentiment (green/red/neutral). The list is duplicated once
// for a seamless −50% loop (the copy is aria-hidden). Static + scrollable under
// prefers-reduced-motion. Renders nothing until headlines are available.
function NewsTicker({ news }) {
  const items = (news?.items || []).filter((it) => it && it.title);
  if (!items.length) return null;
  const loop = items.concat(items);
  return (
    <div className="tk sec" aria-label="Market headlines">
      <div className="tk-track">
        {loop.map((it, i) => (
          <a key={i} className="tk-item" href={it.link || undefined} target="_blank" rel="noopener noreferrer" aria-hidden={i >= items.length}>
            <span className={`tk-dot ${it.sentiment > 0 ? 'pos' : it.sentiment < 0 ? 'neg' : ''}`} />
            {it.source && <span className="tk-src">{it.source}</span>}
            <span className="tk-ttl">{it.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// Percentile-slider board (/api/macro-board): one neutral rail per metric with a
// tone-coloured knob at its position in the trailing ~1-yr range, lo/hi endpoints,
// the live value, and the rank percentile (p##). Renders only live series; returns
// null when none are live so the caller can fall back to the plain cells.
function MacroSliderBoard({ board }) {
  const cells = (board?.groups || []).flatMap((g) => g.series || []);
  const live = cells.filter((c) => c && !c.stale && c.value != null);
  if (!live.length) return null;
  const asOf = live.map((c) => c.asOf).filter(Boolean).sort().pop();
  const asOfStr = asOf ? new Date(asOf).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
  const staleN = cells.length - live.length;
  return (
    <div className="card sec">
      <div className="ctitle" style={{ marginBottom: 12 }}>
        Global macro backdrop
        <span className="sub" style={{ textTransform: 'none' }}> — where each gauge sits in its 1-yr range{asOfStr ? ` · as of ${asOfStr}` : ''}</span>
      </div>
      {board.groups.map((g) => {
        const rows = (g.series || []).filter((c) => c && !c.stale && c.value != null);
        if (!rows.length) return null;
        return (
          <div key={g.group} className="mb-grp">
            <div className="mb-glbl sub">{g.group}</div>
            {rows.map((c) => {
              const d = c.d ?? 2;
              return (
                <div key={c.key} className="mb-row">
                  <span className="mb-lbl">{c.label}</span>
                  <span className="mb-end mb-lo mono">{c.lo != null ? c.lo.toFixed(d) : ''}</span>
                  <span className="mb-rail">
                    <span className="mb-knob" style={{ left: `${c.pos}%`, background: TONE_VAR[c.tone] || 'var(--grn)' }} />
                  </span>
                  <span className="mb-end mb-hi mono">{c.hi != null ? c.hi.toFixed(d) : ''}</span>
                  <span className="mb-val mono">{c.value.toFixed(d)}{c.unit}</span>
                  <span className="mb-pct mono">{c.pctile != null ? `p${c.pctile}` : ''}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {staleN > 0 && (
        <div className="sub" style={{ marginTop: 10 }}>
          {live.length}/{cells.length} series live — the rest populate once a FRED API key is set.
        </div>
      )}
    </div>
  );
}

// Sentiment-shaded headline cards for the held names (/api/portfolio-news). The
// tint (green/red/neutral) carries tone — no +/- glyphs. Each card links to the
// source article. Renders nothing until at least one headline is available.
function PortfolioNews({ news }) {
  const items = (news?.items || []).filter((it) => it && it.title);
  if (!items.length) return null;
  return (
    <div className="card sec">
      <div className="ctitle" style={{ marginBottom: 12 }}>
        Portfolio in the news
        <span className="sub" style={{ textTransform: 'none' }}> — recent headlines on your holdings, shaded by tone</span>
      </div>
      <div className="nw-grid">
        {items.map((it, i) => (
          <a
            key={`${it.ticker}-${i}`}
            className={`nw-item ${it.sentiment > 0 ? 'nw-pos' : it.sentiment < 0 ? 'nw-neg' : 'nw-neu'}`}
            href={it.link || undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="nw-top">
              <span className="nw-tkr">{it.ticker}</span>
              {it.ago && <span className="nw-ago mono">{it.ago}</span>}
            </div>
            <div className="nw-hl">{it.title}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

// Market breadth (India) as a red→green needle gauge from constituent
// advances/declines — true participation, not the index's own % move. Headline is
// Nifty 500 % advancing; per-cap tiers below; India VIX. Here a red→green gradient
// IS meaningful (more advancing = broader = healthier). Falls back to the index-%
// breadth cells when NSE omits A/D (e.g. the Yahoo-fallback path / EOD snapshot).
function BreadthBoard({ wrap, wrapWhen }) {
  const ad = wrap?.breadthAD;
  const vix = wrap?.vix;
  const when = wrapWhen ? ` · ${wrapWhen}` : '';
  if (!ad && !wrap?.breadth?.length && !vix) return null;
  return (
    <div className="card sec">
      <div className="ctitle" style={{ marginBottom: 12 }}>
        Breadth &amp; volatility
        <span className="sub" style={{ textTransform: 'none' }}> — {ad ? 'constituent advances vs declines' : 'large-cap vs broad market'}{when}</span>
      </div>
      {ad ? (
        <>
          {ad.pctUp != null && (
            <>
              <div className="bg-head">
                <span className="bg-lbl">Nifty 500</span>
                <span className="bg-rail"><span className="bg-needle" style={{ left: `${ad.pctUp}%` }} /></span>
                <span className="bg-val mono">{ad.pctUp}<span className="bg-u">% adv</span></span>
              </div>
              <div className="bg-meta">
                {ad.ratio != null && <>A/D <span className="mono">{ad.ratio.toFixed(2)}</span> · </>}
                <span className="grn mono">{ad.adv?.toLocaleString('en-IN')}</span> adv · <span className="red mono">{ad.dec?.toLocaleString('en-IN')}</span> dec
                {ad.unch ? <> · <span className="mono">{ad.unch.toLocaleString('en-IN')}</span> flat</> : null}
              </div>
            </>
          )}
          {ad.caps?.length > 0 && (
            <div className="bg-tiers">
              {ad.caps.map((c) => (
                <div key={c.name} className="bg-tier">
                  <span className="bg-tlbl sub">{c.name}</span>
                  <span className="bg-rail bg-rail-sm"><span className="bg-needle" style={{ left: `${c.pctUp}%` }} /></span>
                  <span className="bg-tval mono">{c.pctUp}%</span>
                </div>
              ))}
            </div>
          )}
          {vix && (
            <div className="bg-vix">
              <span className="sub" style={{ margin: 0 }}>India VIX</span>
              <span className="vsm mono">{vix.last != null ? vix.last.toFixed(2) : '—'}<span className={wcls(vix.change)} style={{ fontSize: 'var(--fs-2xs)', marginLeft: 6 }}>{wpct(vix.pct)}</span></span>
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(wrap.breadth || []).map((b) => (
            <div key={b.name} className="csm" style={{ flex: '1 1 90px', minWidth: 88 }}>
              <div className="sub" style={{ margin: 0 }}>{b.name}</div>
              <div className={'vsm mono ' + wcls(b.pct)} style={{ marginTop: 3 }}>{wpct(b.pct)}</div>
            </div>
          ))}
          {vix && (
            <div className="csm" style={{ flex: '1 1 90px', minWidth: 88, borderColor: 'var(--warn-brd)' }}>
              <div className="sub" style={{ margin: 0 }}>India VIX</div>
              <div className="vsm mono" style={{ marginTop: 3 }}>{vix.last != null ? vix.last.toFixed(2) : '—'}<span className={wcls(vix.change)} style={{ fontSize: 'var(--fs-2xs)', marginLeft: 6 }}>{wpct(vix.pct)}</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MacroTab({ premarket, macro, macroBoard, portfolioNews, marketNews, nifty50, nifty50Loading, marketWrap, fiidiiTrail, regime, markets, insights, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
  // Whole-book macro synthesis (NOT the per-sleeve reads each tab already shows).
  const pulse = insights?.pulse;
  const hasPulse = !insightsFirstLoad && pulse && (pulse.read || pulse.drivers || pulse.drags);

  const sx = premarket?.sessions;
  const inSectors = aggregateSectors(nifty50?.stocks);
  // Authoritative NSE sector + breadth + India VIX. Prefer the LIVE feed
  // (/api/premarket → NSE allIndices, with a Yahoo fallback); when it's
  // unavailable, use the committed Kite EOD snapshot (data/market-wrap.json). Same
  // shape either way, so the cards render identically — the live feed just drops the
  // manual /sync dependency and gives breadth + India VIX a live source for the
  // first time. Both beat inSectors, which only averages the 50 Nifty constituents.
  const liveWrap = premarket?.indices && !premarket.indices.stale ? premarket.indices : null;
  const wrap = liveWrap || marketWrap;
  const wrapLive = !!liveWrap;
  const wrapSectors = (wrap?.sectors || []).map((s) => ({ name: s.name, pct: s.pct, weight: 1 }));
  const wrapDate = wrap?.asOf ? new Date(wrap.asOf).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
  // Data-driven freshness label (no hardcoded "Kite"/date): live vs snapshot + as-of.
  const wrapWhen = wrapLive ? (wrapDate ? `live · ${wrapDate}` : 'live') : (wrapDate ? `close ${wrapDate}` : 'snapshot');

  // Global macro backdrop — the FRED/Yahoo series the app already fetches
  // (/api/macro) but the Wrap never rendered. Level in mono; the delta vs the prior
  // observation carries the colour + ▲/▼ (consistent with the breadth/VIX strip).
  const ml = macro?.live || {};
  const wdelta = (c, d = 2) => (c == null || !isFinite(c) ? '' : `${c > 0 ? '▲' : c < 0 ? '▼' : '·'}${Math.abs(c).toFixed(d)}`);
  const macroCells = [
    { key: 'us10y', label: 'US 10Y', unit: '%', d: 2 },
    { key: 'spread2s10s', label: '2s10s', unit: ' pp', d: 2 },
    { key: 'hyOas', label: 'HY OAS', unit: '%', d: 2 },
    { key: 'nfci', label: 'NFCI', unit: '', d: 2 },
    { key: 'dxy', label: 'DXY', unit: '', d: 1 },
    { key: 'vix', label: 'US VIX', unit: '', d: 2 },
  ].map((m) => {
    const o = ml[m.key];
    const live = o && !o.stale && o.value != null && isFinite(o.value);
    return {
      label: m.label,
      live,
      change: live ? o.change : null,
      valueStr: live ? `${o.value.toFixed(m.d)}${m.unit}` : '—',
      deltaStr: live ? wdelta(o.change, m.d) : '',
    };
  });
  const macroAsOfRaw = (ml.us10y || ml.dxy || ml.vix || {}).asOf;
  const macroAsOf = macroAsOfRaw ? new Date(macroAsOfRaw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
  // US sector heatmap tiles from the SPDR sector ETFs (equal-weight tiles).
  const usSectors = (premarket?.usSectors || [])
    .map((s) => ({ name: s.label, pct: s.pct, meta: s.sym, weight: 1 }))
    .sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));

  // Prefer the percentile-slider board when it has at least one live series;
  // otherwise the plain level+delta cells below stand in.
  const boardHasLive = (macroBoard?.groups || []).some((g) => (g.series || []).some((c) => c && !c.stale && c.value != null));

  // India / Global / All view filter (persisted). Each market-data row below is an
  // India | US pair; the toggle shows one side full-width or both as a g2 pair.
  const [region, setRegion] = useState('all');
  useEffect(() => {
    try { const r = localStorage.getItem('nwTracker.wrapRegion'); if (r === 'india' || r === 'global' || r === 'all') setRegion(r); } catch {}
  }, []);
  const pickRegion = (r) => { setRegion(r); try { localStorage.setItem('nwTracker.wrapRegion', r); } catch {} };
  const showIN = region !== 'global';
  const showUS = region !== 'india';
  const pairCls = showIN && showUS ? 'g2 sec pm-row' : 'sec pm-row';

  return (
    <div>
      {/* Region filter — India / Global / All (filters the market-data rows below). */}
      <div className="rgn-bar">
        <div className="rgn-seg" role="tablist" aria-label="Region filter">
          {[['all', 'All'], ['india', 'India'], ['global', 'Global']].map(([k, lbl]) => (
            <button key={k} type="button" role="tab" aria-selected={region === k} className={region === k ? 'on' : ''} onClick={() => pickRegion(k)}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Market-headline ticker — top of the Wrap (/api/news). */}
      <NewsTicker news={marketNews} />

      {/* ── PORTFOLIO OVERVIEW — ONE whole-book AI read (full width) ───────── */}
      {hasPulse && (
        <div className="card sec ai-card">
          <div className="ai-head">
            <span className="ai-spark">✦</span> Portfolio overview
            <span className="sub" style={{ textTransform: 'none' }}>— the whole book vs today’s macro</span>
            <span className="ins-ai">AI</span>
          </div>
          {pulse.read && <div className="pulse-ov-read">{pulse.read}</div>}
          {(pulse.drivers || pulse.drags) && (
            <div className="pulse-ov-grid">
              {pulse.drivers && (
                <div className="pulse-ov-col">
                  <div className="pulse-ov-lbl grn">Tailwinds</div>
                  <div className="pulse-ov-txt">{pulse.drivers}</div>
                </div>
              )}
              {pulse.drags && (
                <div className="pulse-ov-col">
                  <div className="pulse-ov-lbl red">Drags</div>
                  <div className="pulse-ov-txt">{pulse.drags}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Row 1 — SWOT (India | US) */}
      <div className={pairCls}>
        {showIN && <SwotCard swot={insights?.indian_swot} title="India — SWOT" loading={insightsLoading} accent="var(--blu)" />}
        {showUS && <SwotCard swot={insights?.us_swot} title="US — SWOT" loading={insightsLoading} accent="var(--cyn)" />}
      </div>

      {/* Row 2 — today's close cues (India: indices + bullion + FII/DII | US & global) */}
      <div className={pairCls}>
        {showIN && <PreMarketBriefing
          premarket={premarket} fiidiiTrail={fiidiiTrail} regime={regime}
          nseOpen={markets?.nse} nseState={markets?.nseState}
          insightsLoading={insightsLoading} onRefresh={onRefresh} aiReady={aiReady}
          aiAgo={insightsTs ? agoStr(insightsTs) : null}
          groups={['india', 'commodity']} showFlows showHeader
        />}
        {showUS && <PreMarketBriefing
          premarket={premarket} regime={regime}
          groups={['world', 'fx']} showFlows={false} showHeader={!showIN}
          title="US & global · at the close"
        />}
      </div>

      {/* Row 3 — how the session went (Nifty/Sensex | S&P/Nasdaq): close, day change, range */}
      <div className={pairCls}>
        {showIN && <MarketOverview
          title="Nifty & Sensex"
          sub="— today’s close & the day’s movers"
          sessions={[{ s: sx?.nifty, label: 'Nifty 50' }, { s: sx?.sensex, label: 'Sensex' }]}
          movers={nifty50?.movers}
          note={<>Close, day change and range from the session’s candles. F&amp;O insights (OI, PCR, max-pain) aren’t wired — no reliable free options-chain feed.</>}
        />}
        {showUS && <MarketOverview
          title="S&P 500 & Nasdaq"
          sub="— today’s close"
          sessions={[{ s: sx?.sp500, label: 'S&P 500' }, { s: sx?.nasdaq, label: 'Nasdaq' }]}
          note={<>Close, day change and range from the session’s candles. Constituent movers aren’t shown — no free US constituent feed.</>}
        />}
      </div>

      {/* Row 4 — sector performance today (NSE sectoral indices | SPDR sector ETFs) */}
      <div className={pairCls}>
        {showIN && <SectorHeatmap
          title="NSE sector heatmap"
          sub={wrapSectors.length ? `NSE sectoral indices · ${wrapWhen}` : 'today’s average move by Nifty 50 sector'}
          sectors={wrapSectors.length ? wrapSectors : inSectors}
          loading={nifty50Loading} />}
        {showUS && <SectorHeatmap title="US sector heatmap" sub="SPDR sector ETFs — today’s move" sectors={usSectors} />}
      </div>

      {/* Row 5 — market breadth & volatility (India): red→green A/D needle from
          constituent advances/declines, per-cap participation, India VIX. Falls
          back to index-% breadth cells when NSE omits A/D (Yahoo / snapshot). */}
      {showIN && <BreadthBoard wrap={wrap} wrapWhen={wrapWhen} />}

      {/* Row 6 — global macro backdrop. Prefer the percentile-slider board
          (/api/macro-board: where each gauge sits in its trailing 1-yr range, knob
          coloured by regime tone); fall back to the plain level+delta cells
          (/api/macro) when the board has no live series yet (e.g. before
          FRED_API_KEY is set and Yahoo is unreachable). */}
      {showUS && (boardHasLive ? (
        <MacroSliderBoard board={macroBoard} />
      ) : (macroCells.some((c) => c.live) && (
        <div className="card sec">
          <div className="ctitle" style={{ marginBottom: 12 }}>
            Global macro backdrop
            <span className="sub" style={{ textTransform: 'none' }}> — rates, curve, credit &amp; the dollar{macroAsOf ? ` · as of ${macroAsOf}` : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {macroCells.map((c) => (
              <div key={c.label} className="csm" style={{ flex: '1 1 90px', minWidth: 88 }}>
                <div className="sub" style={{ margin: 0 }}>{c.label}</div>
                <div className="vsm mono" style={{ marginTop: 3 }}>
                  {c.valueStr}
                  {c.live && c.deltaStr && (
                    <span className={wcls(c.change)} style={{ fontSize: 'var(--fs-2xs)', marginLeft: 6 }}>{c.deltaStr}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )))}

      {/* Row 7 — portfolio in the news: recent per-holding headlines, shaded by
          sentiment (/api/portfolio-news, keyless RSS). */}
      <PortfolioNews news={portfolioNews} />
    </div>
  );
}
