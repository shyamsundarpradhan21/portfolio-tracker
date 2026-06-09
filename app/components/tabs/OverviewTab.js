'use client';
import { cl, pctS, InrC, InrF, SInrC, SInrF, RsText, Rs, inrFull, inrC } from '../../lib/fmt';
import Donut from '../shared/Donut';
import InsightBanner from '../shared/InsightBanner';
import CFMemo from '../shared/CFMemo';
import Skel from '../shared/Skel';
import { MF, ALLOC_COLORS } from '../../portfolio';

export default function OverviewTab({
  ov, indian, usData, mf, fds, swing, fxRate,
  donutSegs, insights, insightsOn, insightsFirstLoad,
  ytdTotal, MF_CONFIG, FY,
}) {
  const sFull = (n) => (n >= 0 ? '+' : '-') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

  return (
    <div>
      <InsightBanner text={insightsOn ? insights?.overview : null} loading={insightsOn && insightsFirstLoad} />

      <div className="ov-top">
        <div className="card ov-donut" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="lbl" style={{ marginBottom: 10 }}>allocation</div>
          <Donut segments={donutSegs} />
        </div>

        <div className="ov-cards">
          <div className="g3">
            <div className="csm">
              <div className="lbl">net worth</div>
              <div className="vlg">{fxRate ? <InrC n={ov.nw} /> : <Skel />}</div>
              <div className="sub">assets minus loan</div>
            </div>
            <div className="csm">
              <div className="lbl">total tracked assets</div>
              <div className="vlg">{fxRate ? <InrC n={ov.totalAssets} /> : <Skel />}</div>
              <div className="sub">6 asset classes</div>
            </div>
            <div className="csm">
              <div className="lbl">liabilities</div>
              <div className="vlg" style={{ color: 'var(--red)' }}>~<Rs />7.50L</div>
              <div className="sub">personal loan, est. outstanding</div>
            </div>
          </div>

          <div className="g5">
            <div className="csm">
              <div className="lbl">Indian equity</div>
              <div className="vmd">{indian.valued ? <InrC n={indian.val} /> : <Skel w={64} h={18} />}</div>
              <div className={'sub ' + (indian.valued ? cl(indian.pl) : '')}>
                {indian.valued ? <><SInrC n={indian.pl} /> · {pctS(indian.pct)}</> : `${indian.rows?.length} stocks`}
              </div>
            </div>
            <div className="csm">
              <div className="lbl">Mutual funds</div>
              <div className="vmd"><InrC n={mf.totVal} /></div>
              <div className={'sub ' + cl(mf.totRet)}>{pctS(mf.totRet)} · live NAV</div>
            </div>
            <div className="csm">
              <div className="lbl">Fixed deposits</div>
              <div className="vmd"><InrC n={ov.fdValue} /></div>
              <div className="sub grn">+<InrF n={fds.accrued} /> accrued</div>
            </div>
            <div className="csm">
              <div className="lbl">US equity</div>
              <div className="vmd">{usData.val ? <InrC n={ov.usInr} /> : <Skel w={64} h={18} />}</div>
              <div className={'sub ' + (usData.val ? cl(usData.pl) : '')}>
                {usData.val ? <RsText>{`${pctS(usData.pct)} @₹${fxRate.toFixed(0)}`}</RsText> : `${usData.rows?.length} holdings`}
              </div>
            </div>
            <div className="csm">
              <div className="lbl">Algo capital</div>
              <div className="vmd"><InrC n={MF_CONFIG.algo} /></div>
              <div className={'sub ' + (ytdTotal != null ? cl(ytdTotal) : '')}>
                {ytdTotal != null ? <>FY27 <SInrC n={ytdTotal} /></> : 'own capital'}
              </div>
            </div>
          </div>

          <div className="card ov-fill">
            <div className="fxc" style={{ marginBottom: 12 }}>
              <div className="lbl" style={{ margin: 0 }}>monthly SIP commitment</div>
              <div className="vmd" style={{ color: 'var(--acc)' }}>{MF.sip.total}</div>
            </div>
            <div className="g3">
              {MF.sip.items.map((s, i) => (
                <div className="mini" key={s.label} style={{ borderLeft: `3px solid ${['var(--blu)','var(--grn)','var(--acc)'][i] || 'var(--brd2)'}` }}>
                  <div className="sub" style={{ margin: 0 }}>{s.label}</div>
                  <div className="vsm" style={{ marginTop: 4 }}>{s.val}</div>
                </div>
              ))}
            </div>
            <div className="sub" style={{ marginTop: 12, paddingTop: 10, borderTop: '.5px solid var(--brd)' }}>
              ✦ Auto-deployed every month · {MF.sip.items.length} streams feeding equities, US SIP &amp; conviction picks
            </div>
          </div>
        </div>
      </div>

      <CFMemo
        title="Loss Carryforward — Tax Asset"
        rows={[
          { label: 'Non-spec F&O',           val: sFull(-FY.cf.nonSpec),            sub: 'Sec 72 · 8-yr · offsets future F&O profit only' },
          { label: 'Speculative (intraday)', val: sFull(-FY.cf.speculative),        sub: 'Sec 73 · 4-yr · ₹16,958 expires AY28-29 first' },
          { label: 'Pool entering FY26-27',  val: sFull(-FY.cf.poolEnteringFY2627), accent: true,
            sub: `${inrFull(FY.cf.fy2627Realised)} realised absorbed → ${inrC(FY.cf.poolEnteringFY2627 - FY.cf.fy2627Realised)} remaining` },
        ]}
      />
    </div>
  );
}
