'use client';
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

export default function MacroTab({ premarket, macro, macroBoard, nifty50, nifty50Loading, marketWrap, fiidiiTrail, regime, markets, insights, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
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

  // Each row is an India | US pair so every card sits adjacent to its replica and
  // the rows can't drift out of sync (a stretched g2 row matches the pair's height).
  return (
    <div>
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
      <div className="g2 sec pm-row">
        <SwotCard swot={insights?.indian_swot} title="India — SWOT" loading={insightsLoading} accent="var(--blu)" />
        <SwotCard swot={insights?.us_swot} title="US — SWOT" loading={insightsLoading} accent="var(--cyn)" />
      </div>

      {/* Row 2 — today's close cues (India: indices + bullion + FII/DII | US & global) */}
      <div className="g2 sec pm-row">
        <PreMarketBriefing
          premarket={premarket} fiidiiTrail={fiidiiTrail} regime={regime}
          nseOpen={markets?.nse} nseState={markets?.nseState}
          insightsLoading={insightsLoading} onRefresh={onRefresh} aiReady={aiReady}
          aiAgo={insightsTs ? agoStr(insightsTs) : null}
          groups={['india', 'commodity']} showFlows showHeader
        />
        <PreMarketBriefing
          premarket={premarket} regime={regime}
          groups={['world', 'fx']} showFlows={false} showHeader={false}
          title="US & global · at the close"
        />
      </div>

      {/* Row 3 — how the session went (Nifty/Sensex | S&P/Nasdaq): close, day change, range */}
      <div className="g2 sec pm-row">
        <MarketOverview
          title="Nifty & Sensex"
          sub="— today’s close & the day’s movers"
          sessions={[{ s: sx?.nifty, label: 'Nifty 50' }, { s: sx?.sensex, label: 'Sensex' }]}
          movers={nifty50?.movers}
          note={<>Close, day change and range from the session’s candles. F&amp;O insights (OI, PCR, max-pain) aren’t wired — no reliable free options-chain feed.</>}
        />
        <MarketOverview
          title="S&P 500 & Nasdaq"
          sub="— today’s close"
          sessions={[{ s: sx?.sp500, label: 'S&P 500' }, { s: sx?.nasdaq, label: 'Nasdaq' }]}
          note={<>Close, day change and range from the session’s candles. Constituent movers aren’t shown — no free US constituent feed.</>}
        />
      </div>

      {/* Row 4 — sector performance today (NSE sectoral indices | SPDR sector ETFs) */}
      <div className="g2 sec pm-row">
        <SectorHeatmap
          title="NSE sector heatmap"
          sub={wrapSectors.length ? `NSE sectoral indices · ${wrapWhen}` : 'today’s average move by Nifty 50 sector'}
          sectors={wrapSectors.length ? wrapSectors : inSectors}
          loading={nifty50Loading} />
        <SectorHeatmap title="US sector heatmap" sub="SPDR sector ETFs — today’s move" sectors={usSectors} />
      </div>

      {/* Row 5 — market breadth & volatility (large-cap vs broad, India VIX) */}
      {(wrap?.breadth?.length || wrap?.vix) && (
        <div className="card sec">
          <div className="ctitle" style={{ marginBottom: 12 }}>
            Breadth &amp; volatility
            <span className="sub" style={{ textTransform: 'none' }}> — large-cap vs broad market{wrapDate ? ` · ${wrapWhen}` : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(wrap.breadth || []).map((b) => (
              <div key={b.name} className="csm" style={{ flex: '1 1 90px', minWidth: 88 }}>
                <div className="sub" style={{ margin: 0 }}>{b.name}</div>
                <div className={'vsm mono ' + wcls(b.pct)} style={{ marginTop: 3 }}>{wpct(b.pct)}</div>
              </div>
            ))}
            {wrap.vix && (
              <div className="csm" style={{ flex: '1 1 90px', minWidth: 88, borderColor: 'var(--warn-brd)' }}>
                <div className="sub" style={{ margin: 0 }}>India VIX</div>
                <div className="vsm mono" style={{ marginTop: 3 }}>
                  {wrap.vix.last != null ? wrap.vix.last.toFixed(2) : '—'}
                  <span className={wcls(wrap.vix.change)} style={{ fontSize: 'var(--fs-2xs)', marginLeft: 6 }}>{wpct(wrap.vix.pct)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row 6 — global macro backdrop. Prefer the percentile-slider board
          (/api/macro-board: where each gauge sits in its trailing 1-yr range, knob
          coloured by regime tone); fall back to the plain level+delta cells
          (/api/macro) when the board has no live series yet (e.g. before
          FRED_API_KEY is set and Yahoo is unreachable). */}
      {boardHasLive ? (
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
      ))}
    </div>
  );
}
