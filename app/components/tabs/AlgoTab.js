'use client';
import { useState, useEffect } from 'react';
import { SInrF, RsText, displayCurrency, displayFx } from '../../lib/fmt';
import AnalysisCard from '../shared/AnalysisCard';
import AlgoMonthlyReco from '../shared/AlgoMonthlyReco';
import FreshnessTag from '../shared/FreshnessTag';
import FnoSummary, { FnoPositionsLive } from '../shared/FnoSummary';
import PnlDashboard from '../shared/PnlDashboard';
import AnalyticsTab from '../shared/AnalyticsTab';
import { fnoLive } from '../../lib/brokerState';

const SUBTABS = [['overview', 'Overview'], ['summary', 'Summary'], ['review', 'Review'], ['analytics', 'Analytics']];
const CADENCES = ['Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];

// Compact capital figure — ₹3.9L / ₹40K, or the $-equivalent when the app-wide toggle
// is in $-mode (₹ base ÷ live fx). RsText styles the ₹ glyph; a $ figure renders plain.
const cap = (n) => {
  if (displayCurrency() === 'usd') { const u = n / displayFx(); return u >= 1e3 ? '$' + (u / 1e3).toFixed(1) + 'K' : '$' + Math.round(u); }
  return n >= 1e5 ? '₹' + +(n / 1e5).toFixed(2) + 'L' : '₹' + Math.round(n / 1e3) + 'K';
};

// #34 — F&O Loss Carryforward, lifted ABOVE the sub-tab switch so it shows on every Algo
// sub-tab (the persistent tax-asset context, same treatment as the P&L summary card #11).
function LossCarryforward({ FY }) {
  return (
    <div className="card sec">
      <div className="ctitle" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        F&amp;O Loss Carryforward <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>{`ITR-verified · entering ${FY.labels.current}`}</span>
      </div>
      <div className="g4">
        {FY.carryforward.map((c) => (
          <div className="csm" key={c.label} style={c.accent ? { borderColor: 'var(--warn-brd)' } : {}}>
            <div className="sub" style={{ margin: 0 }}>{c.label}</div>
            <div className="vsm" style={{ marginTop: 4, color: c.consumed ? 'var(--grn)' : 'var(--red)' }}>
              {c.consumed ? <><span className="rs">₹</span>0</> : <SInrF n={c.val} />}
            </div>
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="sub" style={{ marginTop: 12, lineHeight: 1.6 }}>
        Non-speculative losses (Sec 72) carry 8 years and offset only non-speculative business income. Speculative / intraday losses (Sec 73) carry 4 years and offset only speculative income. Both reduce tax payable in the year they are absorbed — they are a real tax asset.
      </div>
    </div>
  );
}

export default function AlgoTab({
  insights, insightsOn, insightsFirstLoad,
  ALGO, FY,
}) {
  const [sub, setSub] = useState('overview');     // Trading Journal sub-tab
  const [cadence, setCadence] = useState('Monthly'); // Review cadence (placeholder selector)
  // Monthly decision + review — lazy-loaded ONLY when the Review sub-tab opens (off the hot
  // private payload). null=unfetched · 'loading' · object=loaded · 'error'.
  const [monthly, setMonthly] = useState(null); // monthly decision + review (KV algo-monthly:latest)
  useEffect(() => {
    try {
      const t = localStorage.getItem('nwTracker.algoSub'); if (SUBTABS.some(([k]) => k === t)) setSub(t);
    } catch {}
  }, []);
  useEffect(() => {
    if (sub !== 'review' || monthly !== null) return;
    setMonthly('loading');
    fetch('/api/algo-monthly', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => setMonthly(j))
      .catch(() => setMonthly('error'));
  }, [sub, monthly]);
  const pickSub = (s) => { setSub(s); try { localStorage.setItem('nwTracker.algoSub', s); } catch {} };
  // Live F&O positions (all brokers, open + closed) — one derivation feeds both the
  // panel below and the YTD open-MTM line in each strategy card, so they agree.
  const fno = fnoLive();
  // Live deployed capital per strategy from the broker funds reads (skip-not-zero: a
  // strategy with no captured margin is omitted, not shown as ₹0).
  const dep = (() => {
    const bs = fno.byStrategy;
    const used = [['S01', bs.S01.fundsUsed], ['S02', bs.S02.fundsUsed]].filter(([, v]) => v > 0);
    const free = bs.S01.fundsAvail + bs.S02.fundsAvail;
    const usedTotal = bs.S01.fundsUsed + bs.S02.fundsUsed;
    const total = usedTotal + free;   // live account capital (deployed + free)
    return { str: used.map(([k, v]) => `${k} ${cap(v)}`).join(' + '), free, used: usedTotal, total, any: used.length > 0 || free > 0 };
  })();
  // Headline capital: the LIVE trading-account total (deployed + free) from the broker funds
  // reads when present — dynamic, moves with the account — else the static own-capital config.
  const ownStatic = ALGO.s01.split.own + ALGO.s02.split.own;
  // Deployed own-capital base per strategy → per broker (sleeve map), for the Overview
  // Returns% card. Dhan → S01, Upstox/Fyers → S02; 'all' = combined.
  const s01Base = ALGO.s01.split.own;
  const s02Base = ALGO.s02.split.own;
  const deployed = { all: s01Base + s02Base, Dhan: s01Base, Upstox: s02Base, Fyers: s02Base };
  // Per-strategy LIVE capital (broker-state funds): total = utilised + available, i.e. the
  // account capital sitting in that strategy — utilised (deployed) vs available. Brokers are
  // the live ones actually mapped to the strategy (S01→Dhan, S02→Upstox·Fyers). Falls back to
  // the static own-capital config when no funds are captured yet. (Swing is EQUITY, not shown.)
  const stratCap = (key, fallback) => {
    const s = fno.byStrategy[key] || {};
    const used = s.fundsUsed || 0, avail = s.fundsAvail || 0, total = used + avail;
    const brokers = fno.brokers.filter((b) => b.sleeve === key).map((b) => b.name).join(' · ');
    return total > 0 ? { total, used, avail, live: true, brokers } : { total: fallback, used: 0, avail: 0, live: false, brokers };
  };
  const s01c = stratCap('S01', s01Base);
  const s02c = stratCap('S02', s02Base);
  // Review cadence → scoped insights (the feed is flat today: only the default cadence
  // carries data; other cadences show a placeholder until the AI run covers them).
  const cadenceData = insights?.trading?.[cadence.toLowerCase()] || (cadence === 'Monthly' ? insights?.trading : null);
  return (
    <div>
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <FreshnessTag mode="manual" date={`${FY.labels.current} F&O auto${FY._lastCapture ? ` · last ${FY._lastCapture}` : ' · from Mon'}${FY._chargesReal ? '' : ' · est. charges'} · ${FY.labels.verified} ITR-verified`} />
      </div>

      {/* #38 — F&O Positions at the TOP, persistent across every sub-tab: live open MTM /
          capital-in-use is the standing context for all the P&L below it. */}
      <FnoPositionsLive fno={fno} />

      {/* #45 — the standalone "Trading P&L" glance card was MERGED into the Trading Journal
          (below, Overview sub-tab), so there's one P&L card, not two. */}

      {/* Trading Journal sub-tabs */}
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <div className="seg" role="tablist" aria-label="Trading Journal">
          {SUBTABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => pickSub(k)}>{label}</button>
          ))}
        </div>
      </div>

      {/* Overview — Groww/Dhan-style realised-F&O journal (calendar + stat panel + day curve).
          (F&O Positions is now persistent at the top of the tab — #38, no longer here.) */}
      {sub === 'overview' && (
        <div className="sec">
          <PnlDashboard
            liveMtm={fno.netOpenMtm}
            deployed={deployed}
            capital={dep.any
              ? { label: 'trading capital · live', value: <RsText>{cap(dep.total)}</RsText>, foot: <><span>{cap(dep.used)} used</span><span>{cap(dep.free)} free</span></> }
              : { label: 'own capital', value: <RsText>{cap(ownStatic)}</RsText> }}
            /* per-strategy capital composition (S01 / S02) — rendered inside the journal card
               just below the capital line (was a standalone card on the Summary sub-tab). */
            composition={[[ALGO.s01.title, s01c], [ALGO.s02.title.replace(' + Swing', ''), s02c]].map(([title, c]) => (
              <div className="mini" key={title}>
                <div className="lbl" style={{ marginBottom: 4 }}>{title}{c.brokers ? ` · ${c.brokers}` : ''}</div>
                <div className="sub" style={{ margin: 0 }}><RsText>{`Capital ${cap(c.total)}`}</RsText></div>
                <div className="sub" style={{ marginTop: 4, color: 'var(--txt3)' }}>
                  {c.live ? <RsText>{`${cap(c.avail)} available · ${cap(c.used)} deployed`}</RsText> : 'live funds n/a · own-capital config'}
                </div>
              </div>
            ))}
          />
        </div>
      )}

      {sub === 'summary' && <FnoSummary />}

      {sub === 'review' && (<>
        {/* #13 — the cadence toggle now lives INSIDE the AI-review card (passed as its
            `controls`), instead of standing alone above it. */}
        {insightsOn && (
          <AnalysisCard data={cadenceData} on={insightsOn} loading={insightsFirstLoad} accent="var(--pnk)"
            title={`AI review · ${cadence}`}
            controls={(
              <div className="seg" role="tablist" aria-label="Review cadence">
                {CADENCES.map((c) => (
                  <button key={c} type="button" role="tab" aria-selected={cadence === c} className={cadence === c ? 'on' : ''} onClick={() => setCadence(c)}>{c}</button>
                ))}
              </div>
            )}
            emptyHint={`No ${cadence.toLowerCase()} review yet — generated reviews appear here once an AI run covers this cadence.`} />
        )}

        {/* The month's DECISION — the headline (KV algo-monthly:latest). The per-regime breakdown
            (formerly the standalone Algo Performance card) is now folded into each funded pick. */}
        <AlgoMonthlyReco data={typeof monthly === 'object' ? monthly : null} loading={monthly === 'loading'} error={monthly === 'error'} />
      </>)}

      {sub === 'analytics' && <AnalyticsTab ALGO={ALGO} />}

      {/* #34 — F&O Loss Carryforward: persistent across every sub-tab, anchored at the BOTTOM
          of the tab (the tax-asset context that frames all the P&L above it). */}
      <LossCarryforward FY={FY} />
    </div>
  );
}
