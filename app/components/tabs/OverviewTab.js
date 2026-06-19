'use client';
import { useState } from 'react';
import { inrFull, inrC } from '../../lib/fmt';
import AnalysisCard from '../shared/AnalysisCard';
import CFMemo from '../shared/CFMemo';
import ProjectionTab from '../ProjectionTab';
import AllocCard from '../shared/AllocCard';
import SipCard from '../shared/SipCard';

export default function OverviewTab({
  ov, fx, insights, insightsOn, insightsFirstLoad, FY, snapshots, histSeries,
  projSleeves, projInvested0, baseYear, payslips, dataReady, mfAlloc,
  dayGain, sleeveBasis,
  cmpsPension, cmpsService, cmpsRetirement, cmpsVested, cmpsVestYear,
}) {
  const sFull = (n) => '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
  // Scrubbing the projection reports the drifted allocation here so the
  // sunburst follows the timeline; null = back to live values.
  const [drift, setDrift] = useState(null);

  return (
    <div>
      <AnalysisCard data={insights?.overview} on={insightsOn} loading={insightsOn && insightsFirstLoad} />

      {/* Live allocation sunburst + growth tracker/projection scrubber */}
      <div className="ov-top">
        <AllocCard sleeves={projSleeves} mfAlloc={mfAlloc} dataReady={dataReady} drift={drift} />
        <ProjectionTab
          nw={Math.round(ov.nw)} loan={ov.loan} fx={fx} sleeves={projSleeves} onDrift={setDrift}
          baseYear={baseYear} invested0={projInvested0} snapshots={snapshots} histSeries={histSeries} dataReady={dataReady}
          dayGain={dayGain} sleeveBasis={sleeveBasis}
          cmpsRetirement={cmpsRetirement} cmpsPension={cmpsPension} cmpsService={cmpsService}
          cmpsVested={cmpsVested} cmpsVestYear={cmpsVestYear}
        />
      </div>

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
