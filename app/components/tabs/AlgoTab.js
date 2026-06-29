'use client';
import { useState, useEffect } from 'react';
import { SInrF, RsText } from '../../lib/fmt';
import AnalysisCard from '../shared/AnalysisCard';
import FreshnessTag from '../shared/FreshnessTag';
import FnoSummary from '../shared/FnoSummary';
import PnlDashboard from '../shared/PnlDashboard';
import AnalyticsTab from '../shared/AnalyticsTab';
import { fnoLive } from '../../lib/brokerState';

const SUBTABS = [['overview', 'Overview'], ['summary', 'Summary'], ['review', 'Review'], ['analytics', 'Analytics']];
const CADENCES = ['Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];

// Compact ₹ for capital figures: ₹3.9L / ₹40K — derived from ALGO splits.
const cap = (n) => n >= 1e5 ? '₹' + +(n / 1e5).toFixed(2) + 'L' : '₹' + Math.round(n / 1e3) + 'K';

export default function AlgoTab({
  insights, insightsOn, insightsFirstLoad,
  ALGO, FY,
}) {
  const [sub, setSub] = useState('overview');     // Trading Journal sub-tab
  const [cadence, setCadence] = useState('Monthly'); // Review cadence (placeholder selector)
  useEffect(() => {
    try {
      const t = localStorage.getItem('nwTracker.algoSub'); if (SUBTABS.some(([k]) => k === t)) setSub(t);
    } catch {}
  }, []);
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
  // Deployed (own+client) base per strategy → per broker (sleeve map), for the Overview
  // Returns% card. Dhan/Zerodha → S01, Upstox/Fyers → S02; 'all' = combined.
  const s01Base = ALGO.s01.split.own + ALGO.s01.split.client;
  const s02Base = ALGO.s02.split.own + ALGO.s02.split.client;
  const deployed = { all: s01Base + s02Base, Dhan: s01Base, Zerodha: s01Base, Upstox: s02Base, Fyers: s02Base };
  // Review cadence → scoped insights (the feed is flat today: only the default cadence
  // carries data; other cadences show a placeholder until the AI run covers them).
  const cadenceData = insights?.trading?.[cadence.toLowerCase()] || (cadence === 'Monthly' ? insights?.trading : null);
  return (
    <div>
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <FreshnessTag mode="manual" date={`${FY.labels.current} F&O auto${FY._lastCapture ? ` · last ${FY._lastCapture}` : ' · from Mon'}${FY._chargesReal ? '' : ' · est. charges'} · ${FY.labels.verified} ITR-verified`} />
      </div>

      {/* Trading Journal sub-tabs */}
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <div className="seg" role="tablist" aria-label="Trading Journal">
          {SUBTABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => pickSub(k)}>{label}</button>
          ))}
        </div>
      </div>

      {/* Overview — Groww/Dhan-style realised-F&O journal (calendar + stat panel + day curve) */}
      {sub === 'overview' && (
        <div className="sec">
          <PnlDashboard
            deployed={deployed}
            capital={dep.any
              ? { label: 'trading capital · live', value: <RsText>{cap(dep.total)}</RsText>, foot: <><span>{cap(dep.used)} used</span><span>{cap(dep.free)} free</span></> }
              : { label: 'own capital', value: <RsText>{cap(ownStatic)}</RsText> }}
          />
        </div>
      )}

      {sub === 'summary' && (<>
        {/* Capital composition — own vs client + the profit-share, so it's always clear
            what is yours vs the client's and what your cut is at settlement. */}
        <div className="card sec">
          <div className="ctitle" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            Capital composition <span className="badge ba" style={{ fontSize: 'var(--fs-2xs)' }}>own + client · profit-share</span>
          </div>
          <div className="g2">
            <div className="mini">
              <div className="lbl" style={{ marginBottom: 4 }}>{ALGO.s01.title} · {ALGO.s01.broker}</div>
              <div className="sub" style={{ margin: 0 }}><RsText>{`Total ${cap(ALGO.s01.split.own + ALGO.s01.split.client)} · Own ${cap(ALGO.s01.split.own)} · Client ${cap(ALGO.s01.split.client)}`}</RsText></div>
              <div className="sub" style={{ marginTop: 4, color: 'var(--txt3)' }}>You keep 100% of own + {Math.round(ALGO.s01.split.clientProfitShare * 100)}% of client profit at settlement</div>
            </div>
            <div className="mini">
              <div className="lbl" style={{ marginBottom: 4 }}>{ALGO.s02.title} · {ALGO.s02.broker}</div>
              <div className="sub" style={{ margin: 0 }}><RsText>{`Own ${cap(ALGO.s02.split.own)} · F&O ${cap(ALGO.s02.book.fno)} + Swing ${cap(ALGO.s02.book.swing)}`}</RsText></div>
              <div className="sub" style={{ marginTop: 4, color: 'var(--txt3)' }}>You keep {Math.round(ALGO.s02.userKeep * 100)}% of profit</div>
            </div>
          </div>
        </div>
        <FnoSummary fno={fno} />
      </>)}

      {sub === 'review' && (<>
        <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <div className="seg" role="tablist" aria-label="Review cadence">
            {CADENCES.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={cadence === c} className={cadence === c ? 'on' : ''} onClick={() => setCadence(c)}>{c}</button>
            ))}
          </div>
        </div>
        {insightsOn && (
          cadenceData && (cadenceData.performance || cadenceData.outlook)
            ? <AnalysisCard data={cadenceData} on={insightsOn} loading={insightsFirstLoad} accent="var(--pnk)" title={`AI review · ${cadence}`} />
            : <div className="card sec">
                <div className="ctitle" style={{ marginBottom: 8 }}>AI review · {cadence}</div>
                <div className="sub" style={{ lineHeight: 1.6 }}>No {cadence.toLowerCase()} review yet — generated reviews appear here once an AI run covers this cadence.</div>
              </div>
        )}

        <div className="card">
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
      </>)}

      {sub === 'analytics' && <AnalyticsTab ALGO={ALGO} />}
    </div>
  );
}
