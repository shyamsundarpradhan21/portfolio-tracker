'use client';
import { useState, useEffect } from 'react';
import { SInrF, RsText, displayCurrency, displayFx } from '../../lib/fmt';
import AnalysisCard from '../shared/AnalysisCard';
import AlgoScreenReview from '../shared/AlgoScreenReview';
import AlgoMonthlyReco from '../shared/AlgoMonthlyReco';
import FreshnessTag from '../shared/FreshnessTag';
import FnoSummary from '../shared/FnoSummary';
import PnlDashboard, { AlgoPnlSummary } from '../shared/PnlDashboard';
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

export default function AlgoTab({
  insights, insightsOn, insightsFirstLoad,
  ALGO, FY,
}) {
  const [sub, setSub] = useState('overview');     // Trading Journal sub-tab
  const [cadence, setCadence] = useState('Monthly'); // Review cadence (placeholder selector)
  // Computed screen — lazy-loaded ONLY when the Review sub-tab opens (off the hot
  // private payload). null=unfetched · 'loading' · object=loaded · 'error'.
  const [screen, setScreen] = useState(null);
  const [monthly, setMonthly] = useState(null); // monthly decision + review (KV algo-monthly:latest)
  useEffect(() => {
    try {
      const t = localStorage.getItem('nwTracker.algoSub'); if (SUBTABS.some(([k]) => k === t)) setSub(t);
    } catch {}
  }, []);
  useEffect(() => {
    if (sub !== 'review' || screen !== null) return;
    setScreen('loading'); setMonthly('loading');
    fetch('/api/algo-screen', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => setScreen(j))
      .catch(() => setScreen('error'));
    fetch('/api/algo-monthly', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => setMonthly(j))
      .catch(() => setMonthly('error'));
  }, [sub, screen]);
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
  // Returns% card. Dhan/Zerodha → S01, Upstox/Fyers → S02; 'all' = combined.
  const s01Base = ALGO.s01.split.own;
  const s02Base = ALGO.s02.split.own;
  const deployed = { all: s01Base + s02Base, Dhan: s01Base, Zerodha: s01Base, Upstox: s02Base, Fyers: s02Base };
  // Review cadence → scoped insights (the feed is flat today: only the default cadence
  // carries data; other cadences show a placeholder until the AI run covers them).
  const cadenceData = insights?.trading?.[cadence.toLowerCase()] || (cadence === 'Monthly' ? insights?.trading : null);
  return (
    <div>
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <FreshnessTag mode="manual" date={`${FY.labels.current} F&O auto${FY._lastCapture ? ` · last ${FY._lastCapture}` : ' · from Mon'}${FY._chargesReal ? '' : ' · est. charges'} · ${FY.labels.verified} ITR-verified`} />
      </div>

      {/* Persistent P&L summary — pills + live intraday curve; sits ABOVE the sub-tab
          switch so it shows on every sub-tab (Overview/Summary/Review/Analytics). */}
      <AlgoPnlSummary liveMtm={fno.netOpenMtm} />

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
        {/* Capital composition — own capital per strategy (100% owner-owned). */}
        <div className="card sec">
          <div className="ctitle" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            Capital composition <span className="badge ba" style={{ fontSize: 'var(--fs-2xs)' }}>own capital</span>
          </div>
          <div className="g2">
            <div className="mini">
              <div className="lbl" style={{ marginBottom: 4 }}>{ALGO.s01.title} · {ALGO.s01.broker}</div>
              <div className="sub" style={{ margin: 0 }}><RsText>{`Own ${cap(ALGO.s01.split.own)}`}</RsText></div>
              <div className="sub" style={{ marginTop: 4, color: 'var(--txt3)' }}>You keep 100% of the P&L</div>
            </div>
            <div className="mini">
              <div className="lbl" style={{ marginBottom: 4 }}>{ALGO.s02.title} · {ALGO.s02.broker}</div>
              <div className="sub" style={{ margin: 0 }}><RsText>{`Own ${cap(ALGO.s02.split.own)} · F&O ${cap(ALGO.s02.book.fno)} + Swing ${cap(ALGO.s02.book.swing)}`}</RsText></div>
              <div className="sub" style={{ marginTop: 4, color: 'var(--txt3)' }}>You keep 100% of the P&L</div>
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
          <AnalysisCard data={cadenceData} on={insightsOn} loading={insightsFirstLoad} accent="var(--pnk)"
            title={`AI review · ${cadence}`}
            emptyHint={`No ${cadence.toLowerCase()} review yet — generated reviews appear here once an AI run covers this cadence.`} />
        )}

        {/* The month's DECISION — the headline (KV algo-monthly:latest); the data-review below is background */}
        <AlgoMonthlyReco data={typeof monthly === 'object' ? monthly : null} loading={monthly === 'loading'} error={monthly === 'error'} />

        {/* Computed data-review — figures from the screen calc (KV algo-screen:v1), beside the AI prose */}
        <AlgoScreenReview data={typeof screen === 'object' ? screen : null} loading={screen === 'loading'} error={screen === 'error'} />

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
