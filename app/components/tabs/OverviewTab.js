'use client';
import { inrFull, inrC } from '../../lib/fmt';
import InsightBanner from '../shared/InsightBanner';
import CFMemo from '../shared/CFMemo';
import ProjectionTab from '../ProjectionTab';
import SipCard from '../shared/SipCard';

export default function OverviewTab({
  ov, fx, insights, insightsOn, insightsFirstLoad, FY, snapshots,
  projSleeves, projInvested0, loan, baseYear, payslips, dataReady,
  cmpsPension, cmpsService, cmpsRetirement,
}) {
  const sFull = (n) => '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

  return (
    <div>
      <InsightBanner text={insightsOn ? insights?.overview : null} loading={insightsOn && insightsFirstLoad} />

      {/* Growth tracker + projection scrubber: history + fan in one timeline */}
      <ProjectionTab
        nw={Math.round(ov.nw)} loan={loan} sleeves={projSleeves}
        baseYear={baseYear} invested0={projInvested0} snapshots={snapshots} dataReady={dataReady}
        cmpsPension={cmpsPension} cmpsService={cmpsService} cmpsRetirement={cmpsRetirement}
      />

      {/* Capital deployment calendar — per-FY monthly flows from the ledgers */}
      <SipCard fx={fx} />

      <CFMemo
        title="Loss Carryforward — Tax Asset"
        rows={[
          { label: 'Non-spec F&O',           val: sFull(-FY.cf.nonSpec),            sub: FY.cf.nonSpecSub },
          { label: 'Speculative (intraday)', val: sFull(-FY.cf.speculative),        sub: FY.cf.speculativeSub },
          { label: `Pool entering ${FY.labels.current}`, val: sFull(-FY.cf.poolEnteringFY2627), accent: true,
            sub: `${inrFull(FY.cf.fy2627Realised)} realised absorbed → ${inrC(FY.cf.poolEnteringFY2627 - FY.cf.fy2627Realised)} remaining` },
        ]}
        foot="Past F&O losses filed in the ITR offset future F&O profits rupee-for-rupee — every profit the pool absorbs is tax-free until it runs out."
      />
    </div>
  );
}
