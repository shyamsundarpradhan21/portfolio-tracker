'use client';
import { useState, useEffect } from 'react';
import { cl, pctS, InrF, SInrF, SInrC, RsText, inrFull } from '../../lib/fmt';
import { LiveSInrF } from '../shared/Live';
import AnalysisCard from '../shared/AnalysisCard';
import FreshnessTag from '../shared/FreshnessTag';
import SyncBadge from '../shared/SyncBadge';
import BrokerTable from '../shared/BrokerTable';
import YtdFno from '../shared/YtdFno';
import Skel from '../shared/Skel';

// Compact ₹ for capital figures: ₹3.9L / ₹40K — derived from ALGO splits.
const cap = (n) => n >= 1e5 ? '₹' + +(n / 1e5).toFixed(2) + 'L' : '₹' + Math.round(n / 1e3) + 'K';

export default function AlgoTab({
  swing, swingSorted, swSort, sortSw, markets,
  ytdTotal, ytdRealised, cfEntering, cfAfterRealised,
  insights, insightsOn, insightsFirstLoad,
  ALGO, FY, swingRec,
}) {
  // One strategy card at a time (S01 / S02), persisted. Swing + the overall summaries
  // live OUTSIDE the strategy cards.
  const [strat, setStrat] = useState('s01');
  useEffect(() => { try { const s = localStorage.getItem('nwTracker.algoStrat'); if (s === 's01' || s === 's02') setStrat(s); } catch {} }, []);
  const pick = (s) => { setStrat(s); try { localStorage.setItem('nwTracker.algoStrat', s); } catch {} };
  return (
    <div>
      <AnalysisCard data={insights?.trading} on={insightsOn} loading={insightsOn && insightsFirstLoad} />
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <FreshnessTag mode="manual" date={`${FY.labels.current} F&O auto${FY._lastCapture ? ` · last ${FY._lastCapture}` : ' · from Mon'} · est. charges · ${FY.labels.verified} ITR-verified · swing live`} />
      </div>

      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">own capital</div>
          <div className="vmd"><RsText>{cap(ALGO.s01.split.own + ALGO.s02.split.own)}</RsText></div>
          <div className="sub"><RsText>{`S01 ${cap(ALGO.s01.split.own)} + S02 ${cap(ALGO.s02.split.own)} · own capital · excluded from net worth`}</RsText></div>
        </div>
        <div className="csm">
          <div className="lbl">{FY.labels.verifiedLong}</div>
          <div className={'vmd ' + cl(FY.combined2526.net)}><SInrF n={FY.combined2526.net} /></div>
          <div className="sub">net realised · ITR-verified</div>
        </div>
        <div className="csm">
          <div className="lbl">{FY.labels.current} YTD</div>
          <div className={'vmd ' + (ytdTotal != null ? cl(ytdTotal) : '')}>{ytdTotal != null ? <LiveSInrF n={ytdTotal} /> : <Skel w={90} h={15} />}</div>
          <div className="sub">
            S01 <span className={cl(FY.s01.fy2627.net)}><SInrF n={FY.s01.fy2627.net} /></span> ·{' '}
            S02 <span className={cl(FY.s02.fy2627.net)}><SInrF n={FY.s02.fy2627.net} /></span> ·{' '}
            swing {swing.valued ? <span className={cl(swing.pl)}><SInrF n={swing.pl} /></span> : '…'}
          </div>
        </div>
      </div>

      {/* Strategy toggle — one card at a time; swing + the overall summaries sit OUTSIDE */}
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
                <BrokerTable data={FY.s01.fy2526} />
              </div>
              <YtdFno label={`${FY.labels.currentLong} YTD — ${FY.s01.fy2627.label}`} data={FY.s01.fy2627} />
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
                <BrokerTable data={FY.s02.fy2526} />
              </div>
              <YtdFno label={`${FY.labels.currentLong} YTD — ${FY.s02.fy2627.label}`} data={FY.s02.fy2627} />
            </div>
          </div>
        )}
      </div>

      {/* Swing positions — lifted OUT of the S02 card into its own (delivery book, STCG/LTCG, not F&O business income) */}
      <div className="card sec">
        <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          Swing positions{' '}
          <FreshnessTag mode="live" marketState={{ open: markets.nse, label: `NSE ${markets.nse ? 'OPEN' : 'CLOSED'}` }} />
          <SyncBadge rec={swingRec} />
        </div>
        <div className="ovx">
          <table className="tbl" style={{ minWidth: 360 }}>
            <thead>
              <tr>
                {[['sym','Symbol',false],['qty','Qty',true],['cost','Avg',true],['ltp','LTP',true],['pl','P&L',true],['pct','%',true]].map(([k, label, num]) => (
                  <th key={k} className={num ? 'ra' : ''} onClick={() => sortSw(k)}>
                    {label} {swSort.key === k ? (swSort.dir < 0 ? '↓' : '↑') : '↕'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {swingSorted.map((r) => (
                <tr key={r.sym}>
                  <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{r.sym}</td>
                  <td className="ra mut">{r.qty}</td>
                  <td className="ra mut mono">{r.cost.toFixed(2)}</td>
                  <td className="ra mono">{r.ltp != null ? r.ltp.toFixed(2) : <Skel w={42} h={11} />}</td>
                  <td className={'ra mono ' + (r.pl != null ? cl(r.pl) : 'mut')}>{r.pl != null ? <SInrF n={r.pl} /> : '—'}</td>
                  <td className={'ra mono ' + (r.pct != null ? cl(r.pct) : 'mut')}>{r.pct != null ? pctS(r.pct) : '—'}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Total</td><td /><td className="ra"><InrF n={swing.inv} /></td>
                <td className="ra">{swing.valued ? <InrF n={swing.val} /> : '…'}</td>
                <td className={'ra ' + cl(swing.pl)}>{swing.valued ? <SInrF n={swing.pl} /> : '…'}</td>
                <td className={'ra ' + cl(swing.pl)}>{swing.valued ? pctS(swing.pct) : '…'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 12, lineHeight: 1.6 }}>
          Swing positions held overnight in the delivery book — P&amp;L is STCG (&lt;12m) or LTCG (&gt;12m), not business income. MTM is live from the last NSE tick; gains crystallise only on exit.
        </div>
      </div>

      <div className="csm sec">
        <span style={{ color: 'var(--txt2)' }}>
          {FY.labels.verified} combined — Gross: <span className="grn"><SInrF n={FY.combined2526.gross} /></span> ·
          Charges: <span className="red"><RsText>{inrFull(FY.combined2526.charges)}</RsText></span> ·
          Net F&amp;O (Sch BP): <span className={cl(FY.combined2526.net)}><SInrF n={FY.combined2526.net} /></span>
          {'  '}<span className="mut">(S01 <SInrF n={FY.s01.fy2526.total.net} /> · S02 <SInrF n={FY.s02.fy2526.total.net} />)</span>
        </span>
      </div>

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
