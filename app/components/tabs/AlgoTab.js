'use client';
import { cl, pctS, InrF, SInrF, SInrC, RsText, inrFull } from '../../lib/fmt';
import InsightBanner from '../shared/InsightBanner';
import FreshnessTag from '../shared/FreshnessTag';
import BrokerTable from '../shared/BrokerTable';
import YtdFno from '../shared/YtdFno';
import Skel from '../shared/Skel';

export default function AlgoTab({
  swing, swingSorted, swSort, sortSw, markets,
  ytdTotal, ytdRealised, cfEntering, cfAfterRealised,
  insights, insightsOn, insightsFirstLoad,
  ALGO, FY,
}) {
  return (
    <div>
      <InsightBanner text={insightsOn ? insights?.algo : null} loading={insightsOn && insightsFirstLoad} />
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FreshnessTag mode="manual" date="FY25-26 ITR-verified · swing live" />
      </div>

      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">own capital</div>
          <div className="vmd"><RsText>{ALGO.summary.deployed}</RsText></div>
          <div className="sub"><RsText>{ALGO.summary.deployedNote}</RsText></div>
        </div>
        <div className="csm">
          <div className="lbl">FY 2025-26</div>
          <div className={'vmd ' + cl(FY.combined2526.net)}><SInrF n={FY.combined2526.net} /></div>
          <div className="sub">realised value</div>
        </div>
        <div className="csm">
          <div className="lbl">FY26-27 YTD</div>
          <div className={'vmd ' + (ytdTotal != null ? cl(ytdTotal) : '')}>{ytdTotal != null ? <SInrF n={ytdTotal} /> : <Skel w={90} h={15} />}</div>
          <div className="sub">
            <span className="grn">S01 <SInrF n={FY.s01.fy2627.net} /></span> ·{' '}
            <span className="grn">S02 <SInrF n={FY.s02.fy2627.net} /></span> ·{' '}
            swing {swing.valued ? <span className={cl(swing.pl)}><SInrF n={swing.pl} /></span> : '…'}
          </div>
        </div>
      </div>

      <div className="g2 sec">
        <div className="card card-accent" style={{ borderLeftColor: 'var(--acc)', display: 'flex', flexDirection: 'column' }}>
          <div className="fxc" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{ALGO.s01.title}</div>
              <div className="sub" style={{ margin: 0 }}>{ALGO.s01.broker}</div>
            </div>
            <span className="badge ba">{ALGO.s01.badge}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            <div className="mini">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="lbl" style={{ margin: '0 0 3px' }}>pool</div>
                  <div className="sub" style={{ margin: 0 }}><RsText>{ALGO.s01.pool}</RsText></div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--mono)', flexShrink: 0, letterSpacing: '-.5px' }}><RsText>{ALGO.s01.deployed}</RsText></div>
              </div>
            </div>
            <div className="mini">
              <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                FY2025-26 <span className="badge bb" style={{ fontSize: 10 }}>ITR-verified</span>
              </div>
              <BrokerTable data={FY.s01.fy2526} />
            </div>
            <YtdFno label={`FY2026-27 YTD — ${FY.s01.fy2627.label}`} data={FY.s01.fy2627} />
            <div className="mini" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                CF absorption — FY26-27 <span className="badge bb" style={{ fontSize: 10 }}>ITR</span>
              </div>
              <div className="fxc"><span style={{ color: 'var(--txt2)' }}>CF entering FY26-27</span><span className="red mono"><SInrF n={-cfEntering} /></span></div>
              <div className="fxc" style={{ marginTop: 8 }}><span style={{ color: 'var(--txt2)' }}>Realised F&amp;O YTD (S01 + S02)</span><span className="grn mono"><SInrF n={ytdRealised} /></span></div>
              <div className="fxc" style={{ marginTop: 10, paddingTop: 8, borderTop: '.5px solid var(--brd)' }}>
                <span style={{ color: 'var(--txt2)' }}>CF remaining</span><span className="red mono"><SInrF n={-cfAfterRealised} /></span>
              </div>
            </div>
          </div>
        </div>

        <div className="card card-accent" style={{ borderLeftColor: 'var(--grn)', display: 'flex', flexDirection: 'column' }}>
          <div className="fxc" style={{ marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{ALGO.s02.title}</div>
              <div className="sub" style={{ margin: 0 }}>{ALGO.s02.broker}</div>
            </div>
            <span className="badge bg">{ALGO.s02.badge}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            <div className="mini">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="lbl" style={{ margin: '0 0 3px' }}>capital</div>
                  <div className="sub" style={{ margin: 0 }}><RsText>{ALGO.s02.capital}</RsText></div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--txt)', fontFamily: 'var(--mono)', flexShrink: 0, letterSpacing: '-.5px' }}><RsText>{ALGO.s02.deployed}</RsText></div>
              </div>
            </div>
            <div className="mini">
              <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                FY2025-26 <span className="badge bb" style={{ fontSize: 10 }}>ITR-verified</span>
              </div>
              <BrokerTable data={FY.s02.fy2526} />
            </div>
            <YtdFno label={`FY2026-27 YTD — ${FY.s02.fy2627.label}`} data={FY.s02.fy2627} />
            <div className="mini">
              <div className="lbl" style={{ marginBottom: 7, display: 'flex', gap: 6 }}>
                Swing positions{' '}
                <span className={'badge ' + (markets.nse ? 'bg' : '')} style={{ fontSize: 10, ...(markets.nse ? {} : { background: 'rgba(90,90,114,.2)', color: 'var(--txt3)' }) }}>
                  {markets.nse ? 'LIVE' : 'NSE CLOSED'}
                </span>
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
                      <td className="ra">{swing.valued ? inrFull(swing.val) : '…'}</td>
                      <td className={'ra ' + cl(swing.pl)}>{swing.valued ? <SInrF n={swing.pl} /> : '…'}</td>
                      <td className={'ra ' + cl(swing.pl)}>{swing.valued ? pctS(swing.pct) : '…'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="csm sec">
        <span style={{ color: 'var(--txt2)' }}>
          FY25-26 combined — Gross: <span className="grn"><SInrF n={FY.combined2526.gross} /></span> ·
          Charges: <span className="red"><RsText>{inrFull(FY.combined2526.charges)}</RsText></span> ·
          Net F&amp;O (Sch BP): <span className={cl(FY.combined2526.net)}><SInrF n={FY.combined2526.net} /></span>
          {'  '}<span className="mut">(S01 <SInrF n={FY.s01.fy2526.total.net} /> · S02 <SInrF n={FY.s02.fy2526.total.net} />)</span>
        </span>
      </div>

      <div className="card">
        <div className="lbl" style={{ marginBottom: 10, display: 'flex', gap: 6 }}>
          F&amp;O Loss Carryforward <span className="badge bb" style={{ fontSize: 10 }}>ITR-verified · entering FY26-27</span>
        </div>
        <div className="g4">
          {FY.carryforward.map((c) => (
            <div className="csm" key={c.label} style={c.accent ? { borderColor: 'rgba(232,160,48,.35)' } : {}}>
              <div className="sub" style={{ margin: 0 }}>{c.label}</div>
              <div className="vsm" style={{ marginTop: 4, color: c.consumed ? 'var(--grn)' : 'var(--red)' }}>
                {c.consumed ? <><span className="rs">₹</span>0</> : <SInrF n={c.val} />}
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{c.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
