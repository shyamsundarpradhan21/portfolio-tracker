'use client';
import PreMarketBriefing from '../shared/PreMarketBriefing';
import SwotCard from '../shared/SwotCard';
import MarketOverview, { aggregateSectors } from '../shared/MarketOverview';
import SectorHeatmap from '../shared/SectorHeatmap';

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

export default function MacroTab({ premarket, nifty50, nifty50Loading, fiidiiTrail, regime, insights, insightsFirstLoad, insightsLoading, insightsTs, onRefresh, aiReady }) {
  // Whole-book macro synthesis (NOT the per-sleeve reads each tab already shows).
  const pulse = insights?.pulse;
  const hasPulse = !insightsFirstLoad && pulse && (pulse.read || pulse.drivers || pulse.drags);

  const lv = premarket?.levels;
  const inSectors = aggregateSectors(nifty50?.stocks);
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

      {/* Row 2 — overnight cues (India: indices + bullion + FII/DII | US & global) */}
      <div className="g2 sec pm-row">
        <PreMarketBriefing
          premarket={premarket} fiidiiTrail={fiidiiTrail} regime={regime}
          insightsLoading={insightsLoading} onRefresh={onRefresh} aiReady={aiReady}
          aiAgo={insightsTs ? agoStr(insightsTs) : null}
          groups={['india', 'commodity']} showFlows showHeader
        />
        <PreMarketBriefing
          premarket={premarket} regime={regime}
          groups={['world', 'fx']} showFlows={false} showHeader={false}
          title="US & global overnight"
        />
      </div>

      {/* Row 3 — index overview / support–resistance (Nifty/Sensex | S&P/Nasdaq) */}
      <div className="g2 sec pm-row">
        <MarketOverview
          title="Nifty & Sensex overview"
          sub="— support / resistance & the day’s movers"
          pivots={[{ lv: lv?.nifty, label: 'Nifty 50' }, { lv: lv?.sensex, label: 'Sensex' }]}
          movers={nifty50?.movers}
          note={<>Classic pivot levels from the prior session’s high/low/close — deterministic, not a forecast. F&amp;O insights (OI, PCR, max-pain) aren’t wired — no reliable free options-chain feed.</>}
        />
        <MarketOverview
          title="S&P 500 & Nasdaq overview"
          sub="— prior-session support / resistance"
          pivots={[{ lv: lv?.sp500, label: 'S&P 500' }, { lv: lv?.nasdaq, label: 'Nasdaq' }]}
          note={<>Pivot levels from the prior US session’s high/low/close — deterministic, not a forecast. Constituent movers aren’t shown — no free US constituent feed.</>}
        />
      </div>

      {/* Row 4 — sector heatmap (Nifty 50 sectors | SPDR sector ETFs) */}
      <div className="g2 sec pm-row">
        <SectorHeatmap title="Nifty sector heatmap" sub="average move by Nifty 50 sector" sectors={inSectors} loading={nifty50Loading} />
        <SectorHeatmap title="US sector heatmap" sub="SPDR sector ETFs — today’s move" sectors={usSectors} />
      </div>
    </div>
  );
}
