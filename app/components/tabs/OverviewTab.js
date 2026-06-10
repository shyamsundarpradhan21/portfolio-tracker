'use client';
import { inrFull, inrC } from '../../lib/fmt';
import InsightBanner from '../shared/InsightBanner';
import CFMemo from '../shared/CFMemo';
import ProjectionTab from '../ProjectionTab';
import HistoryCurve from '../shared/HistoryCurve';
import SipCard from '../shared/SipCard';

export default function OverviewTab({
  ov, fx, insights, insightsOn, insightsFirstLoad, FY, snapshots,
  projSleeves, projInvested0, loan, baseYear,
}) {
  const sFull = (n) => (n >= 0 ? '+' : '-') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

  return (
    <div>
      <InsightBanner text={insightsOn ? insights?.overview : null} loading={insightsOn && insightsFirstLoad} />

      {/* Historical growth from persisted daily snapshots */}
      <HistoryCurve snapshots={snapshots} />

      {/* Forward outlook: allocation share + scenario stack. Defaults to today. */}
      <ProjectionTab
        nw={Math.round(ov.nw)} loan={loan} sleeves={projSleeves}
        baseYear={baseYear} invested0={projInvested0}
      />

      {/* SIP deployment calendar (moved from the MF tab; replaces the old
          monthly-SIP commitment card, which it supersedes) */}
      <SipCard fx={fx} />

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
