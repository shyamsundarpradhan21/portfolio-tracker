'use client';
import { useState } from 'react';
import { inrFull, inrC } from '../../lib/fmt';
import AnalysisCard from '../shared/AnalysisCard';
import CFMemo from '../shared/CFMemo';
import ProjectionTab from '../ProjectionTab';
import AllocBar from '../shared/AllocBar';
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
      <AnalysisCard data={insights?.overview} on={insightsOn} loading={insightsOn && insightsFirstLoad} accent="var(--acc)" />

      {/* Net worth growth/projection scrubber, with the live allocation strip merged
          into its footer (replaces the separate sunburst card). */}
      <ProjectionTab
        nw={Math.round(ov.nw)} loan={ov.loan} fx={fx} sleeves={projSleeves} onDrift={setDrift}
        baseYear={baseYear} invested0={projInvested0} snapshots={snapshots} histSeries={histSeries} dataReady={dataReady}
        dayGain={dayGain} sleeveBasis={sleeveBasis}
        cmpsRetirement={cmpsRetirement} cmpsPension={cmpsPension} cmpsService={cmpsService}
        cmpsVested={cmpsVested} cmpsVestYear={cmpsVestYear}
        footer={<AllocBar sleeves={projSleeves} mfAlloc={mfAlloc} drift={drift} />}
      />

      {/* Capital deployment calendar — per-FY monthly flows from the ledgers */}
      <SipCard fx={fx} />

      <CFMemo
        title="Loss Carryforward — Tax Asset"
        rows={[
          { label: 'Non-spec F&O',           val: sFull(-FY.cf.nonSpec),            sub: FY.cf.nonSpecSub },
          { label: 'Speculative (intraday)', val: sFull(-FY.cf.speculative),        sub: FY.cf.speculativeSub },
          { label: `Pool entering ${FY.labels.current}`, val: sFull(-FY.cf.poolEntering), accent: true,
            sub: `${inrFull(FY.cf.currentRealised)} realised absorbed → ${inrC(FY.cf.poolEntering - FY.cf.currentRealised)} remaining` },
        ]}
        foot="Past F&O losses filed in the ITR offset future F&O profits rupee-for-rupee — every profit the pool absorbs is tax-free until it runs out."
      />
    </div>
  );
}
