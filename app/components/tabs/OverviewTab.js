'use client';
import { cl, pctS, InrC, InrF, SInrC, SInrF, RsText, Rs, inrFull, inrC } from '../../lib/fmt';
import InsightBanner from '../shared/InsightBanner';
import CFMemo from '../shared/CFMemo';
import ProjectionTab from '../ProjectionTab';
import { MF, ALLOC_COLORS } from '../../portfolio';

export default function OverviewTab({
  ov, indian, usData, mf, fds, swing, fxRate,
  donutSegs, insights, insightsOn, insightsFirstLoad,
  ytdTotal, MF_CONFIG, FY,
  projSleeves, projInvested0, loan, baseYear,
}) {
  const sFull = (n) => (n >= 0 ? '+' : '-') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

  return (
    <div>
      <InsightBanner text={insightsOn ? insights?.overview : null} loading={insightsOn && insightsFirstLoad} />

      {/* Portfolio growth (invested + growth) + allocation share + scenario stack.
          Defaults to today; scrub forward to explore the projection. */}
      <ProjectionTab
        nw={Math.round(ov.nw)} loan={loan} sleeves={projSleeves}
        baseYear={baseYear} invested0={projInvested0} donutSegs={donutSegs}
      />

      <div className="card sec ov-fill">
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
