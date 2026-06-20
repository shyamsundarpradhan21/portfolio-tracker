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

export default function MacroTab({ premarket, nifty50, nifty50Loading, marketWrap, fiidiiTrail, regime, markets, insights, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
  // Whole-book macro synthesis (NOT the per-sleeve reads each tab already shows).
  const pulse = insights?.pulse;
  const hasPulse = !insightsFirstLoad && pulse && (pulse.read || pulse.drivers || pulse.drags);

  const sx = premarket?.sessions;
  const inSectors = aggregateSectors(nifty50?.stocks);
  // Authoritative NSE sector + breadth + India VIX from the Kite snapshot (captured
  // EOD during /sync). Preferred over inSectors, which only averages the 50 Nifty
  // constituents by sector — the real sectoral indices are properly weighted & broader.
  const wrapSectors = (marketWrap?.sectors || []).map((s) => ({ name: s.name, pct: s.pct, weight: 1 }));
  const wrapDate = marketWrap?.asOf ? new Date(marketWrap.asOf).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
  // US sector heatmap tiles from the SPDR sector ETFs (equal-weight tiles).
  const usSectors = (premarket?.usSectors || [])
    .map((s) => ({ name: s.label, pct: s.pct, meta: s.sym, weight: 1 }))
    .sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));

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
          sub={wrapSectors.length ? `NSE sectoral indices · close ${wrapDate}` : 'today’s average move by Nifty 50 sector'}
          sectors={wrapSectors.length ? wrapSectors : inSectors}
          loading={nifty50Loading} />
        <SectorHeatmap title="US sector heatmap" sub="SPDR sector ETFs — today’s move" sectors={usSectors} />
      </div>

      {/* Row 5 — market breadth & volatility (large-cap vs broad, India VIX) — Kite EOD */}
      {(marketWrap?.breadth?.length || marketWrap?.vix) && (
        <div className="card sec">
          <div className="ctitle" style={{ marginBottom: 12 }}>
            Breadth &amp; volatility
            <span className="sub" style={{ textTransform: 'none' }}> — large-cap vs broad market{wrapDate ? ` · close ${wrapDate}` : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(marketWrap.breadth || []).map((b) => (
              <div key={b.name} className="csm" style={{ flex: '1 1 90px', minWidth: 88 }}>
                <div className="sub" style={{ margin: 0 }}>{b.name}</div>
                <div className={'vsm mono ' + wcls(b.pct)} style={{ marginTop: 3 }}>{wpct(b.pct)}</div>
              </div>
            ))}
            {marketWrap.vix && (
              <div className="csm" style={{ flex: '1 1 90px', minWidth: 88, borderColor: 'var(--warn-brd)' }}>
                <div className="sub" style={{ margin: 0 }}>India VIX</div>
                <div className="vsm mono" style={{ marginTop: 3 }}>
                  {marketWrap.vix.last != null ? marketWrap.vix.last.toFixed(2) : '—'}
                  <span className={wcls(marketWrap.vix.change)} style={{ fontSize: 'var(--fs-2xs)', marginLeft: 6 }}>{wpct(marketWrap.vix.pct)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
