'use client';
import { useState, useEffect } from 'react';
import { cl, SInrF, RsText } from '../../lib/fmt';
import { LiveSInrF } from '../shared/Live';
import AnalysisCard from '../shared/AnalysisCard';
import FreshnessTag from '../shared/FreshnessTag';
import BrokerTable from '../shared/BrokerTable';
import YtdFno from '../shared/YtdFno';
import FnoHistory from '../shared/FnoHistory';
import FnoPositions from '../shared/FnoPositions';
import PnlDashboard from '../shared/PnlDashboard';
import Skel from '../shared/Skel';
import { fnoLive } from '../../lib/brokerState';

// Compact ₹ for capital figures: ₹3.9L / ₹40K — derived from ALGO splits.
const cap = (n) => n >= 1e5 ? '₹' + +(n / 1e5).toFixed(2) + 'L' : '₹' + Math.round(n / 1e3) + 'K';

export default function AlgoTab({
  ytdTotal, ytdRealised, cfEntering, cfAfterRealised,
  insights, insightsOn, insightsFirstLoad,
  ALGO, FY, fnoRealized,
}) {
  // One strategy card at a time (S01 / S02), persisted. The overall summaries
  // live OUTSIDE the strategy cards.
  const [strat, setStrat] = useState('s01');
  useEffect(() => { try { const s = localStorage.getItem('nwTracker.algoStrat'); if (s === 's01' || s === 's02') setStrat(s); } catch {} }, []);
  const pick = (s) => { setStrat(s); try { localStorage.setItem('nwTracker.algoStrat', s); } catch {} };
  // Live F&O positions (all brokers, open + closed) — one derivation feeds both the
  // panel below and the YTD open-MTM line in each strategy card, so they agree.
  const fno = fnoLive();
  // Live deployed capital per strategy from the broker funds reads (skip-not-zero: a
  // strategy with no captured margin is omitted, not shown as ₹0).
  const dep = (() => {
    const bs = fno.byStrategy;
    const used = [['S01', bs.S01.fundsUsed], ['S02', bs.S02.fundsUsed]].filter(([, v]) => v > 0);
    const free = bs.S01.fundsAvail + bs.S02.fundsAvail;
    return { str: used.map(([k, v]) => `${k} ${cap(v)}`).join(' + '), free, any: used.length > 0 || free > 0 };
  })();
  return (
    <div>
      <AnalysisCard data={insights?.trading} on={insightsOn} loading={insightsOn && insightsFirstLoad} accent="var(--pnk)" />
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <FreshnessTag mode="manual" date={`${FY.labels.current} F&O auto${FY._lastCapture ? ` · last ${FY._lastCapture}` : ' · from Mon'} · est. charges · ${FY.labels.verified} ITR-verified`} />
      </div>

      {/* Groww/Dhan-style P&L dashboard — realised-F&O calendar across Fyers/Upstox/Dhan */}
      <div className="sec"><PnlDashboard /></div>

      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">own capital · live deployed</div>
          <div className="vmd"><RsText>{cap(ALGO.s01.split.own + ALGO.s02.split.own)}</RsText></div>
          {dep.any && (
            <div className="sub"><RsText>{`deployed: ${dep.str || '—'}${dep.free > 0 ? ` · ${cap(dep.free)} free` : ''}`}</RsText></div>
          )}
        </div>
        <div className="csm">
          <div className="lbl">{FY.labels.verifiedLong}</div>
          <div className={'vmd ' + cl(FY.combinedVerified.net)}><SInrF n={FY.combinedVerified.net} /></div>
          <div className="sub">net realised · ITR-verified</div>
        </div>
        <div className="csm">
          <div className="lbl">{FY.labels.current} YTD</div>
          <div className={'vmd ' + (ytdTotal != null ? cl(ytdTotal) : '')}>{ytdTotal != null ? <LiveSInrF n={ytdTotal} /> : <Skel w={90} h={15} />}</div>
          <div className="sub">
            S01 <span className={cl(FY.s01.current.net)}><SInrF n={FY.s01.current.net} /></span> ·{' '}
            S02 <span className={cl(FY.s02.current.net)}><SInrF n={FY.s02.current.net} /></span>
          </div>
        </div>
      </div>

      {/* Strategy toggle — one card at a time; the overall summaries sit OUTSIDE */}
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <div className="seg" role="tablist" aria-label="Strategy">
          {[['s01', ALGO.s01.title], ['s02', ALGO.s02.title]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={strat === k} className={strat === k ? 'on' : ''} onClick={() => pick(k)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="sec">
        {strat === 's01' ? (
          <div className="card card-accent" style={{ borderLeftColor: 'var(--acc)', display: 'flex', flexDirection: 'column' }}>
            <div className="fxc" style={{ marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{ALGO.s01.title}</div>
                <div className="sub" style={{ margin: 0 }}>{ALGO.s01.broker}</div>
              </div>
              <span className="badge ba">{ALGO.s01.badge}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div className="mini">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div className="lbl" style={{ margin: '0 0 3px' }}>pool</div>
                    <div className="sub" style={{ margin: 0 }}><RsText>{`Total ${cap(ALGO.s01.split.own + ALGO.s01.split.client)} · Own ${cap(ALGO.s01.split.own)} · Client ${cap(ALGO.s01.split.client)} · 100% own + ${Math.round(ALGO.s01.split.clientProfitShare * 100)}% client profit`}</RsText></div>
                  </div>
                  <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--mono)', flexShrink: 0, letterSpacing: '-.5px' }}><RsText>{cap(ALGO.s01.split.own)}</RsText></div>
                </div>
              </div>
              <div className="mini">
                <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                  {FY.labels.verifiedLong} <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>ITR-verified</span>
                </div>
                <BrokerTable data={FY.s01.verified} />
              </div>
              <YtdFno label={`${FY.labels.currentLong} YTD — ${FY.s01.current.label}`} data={FY.s01.current} liveMtm={fno.byStrategy.S01.openMtm} />
              <div className="mini" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                  CF absorption — {FY.labels.current} <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>ITR</span>
                </div>
                <div className="fxc"><span style={{ color: 'var(--txt2)' }}>CF entering {FY.labels.current}</span><span className="red mono"><SInrF n={-cfEntering} /></span></div>
                <div className="fxc" style={{ marginTop: 8 }}><span style={{ color: 'var(--txt2)' }}>Realised F&amp;O YTD (S01 + S02)</span><span className="grn mono"><SInrF n={ytdRealised} /></span></div>
                <div className="fxc" style={{ marginTop: 10, paddingTop: 8, borderTop: '.5px solid var(--brd)' }}>
                  <span style={{ color: 'var(--txt2)' }}>CF remaining</span><span className="red mono"><SInrF n={-cfAfterRealised} /></span>
                </div>
              </div>
            </div>
            <div className="sub" style={{ marginTop: 12, lineHeight: 1.6 }}>
              Day-trading F&amp;O profits are non-speculative business income (Sec 44AB). The loss carryforward pool below absorbs future profits — tracked live as you trade.
            </div>
          </div>
        ) : (
          <div className="card card-accent" style={{ borderLeftColor: 'var(--grn)', display: 'flex', flexDirection: 'column' }}>
            <div className="fxc" style={{ marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{ALGO.s02.title}</div>
                <div className="sub" style={{ margin: 0 }}>{ALGO.s02.broker}</div>
              </div>
              <span className="badge bg">{ALGO.s02.badge}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div className="mini">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div className="lbl" style={{ margin: '0 0 3px' }}>capital</div>
                    <div className="sub" style={{ margin: 0 }}><RsText>{`Own ${cap(ALGO.s02.split.own)} · F&O ${cap(ALGO.s02.book.fno)} + Swing ${cap(ALGO.s02.book.swing)} · user keeps ${Math.round(ALGO.s02.userKeep * 100)}%`}</RsText></div>
                  </div>
                  <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--mono)', flexShrink: 0, letterSpacing: '-.5px' }}><RsText>{cap(ALGO.s02.split.own)}</RsText></div>
                </div>
              </div>
              <div className="mini">
                <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                  {FY.labels.verifiedLong} <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>ITR-verified</span>
                </div>
                <BrokerTable data={FY.s02.verified} />
              </div>
              <YtdFno label={`${FY.labels.currentLong} YTD — ${FY.s02.current.label}`} data={FY.s02.current} liveMtm={fno.byStrategy.S02.openMtm} />
            </div>
          </div>
        )}
      </div>

      {fno.hasAny ? <div className="sec"><FnoPositions data={fno} /></div> : null}

      {fnoRealized ? <div className="sec"><FnoHistory data={fnoRealized} /></div> : null}

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
    </div>
  );
}
