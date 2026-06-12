'use client';
import { useMemo } from 'react';
import { inrFull, inrC } from '../../lib/fmt';
import InsightBanner from '../shared/InsightBanner';
import CFMemo from '../shared/CFMemo';
import ProjectionTab from '../ProjectionTab';
import SipCard from '../shared/SipCard';
import { TRANSACTIONS, MF_CASHFLOWS, FDS, US_CASHFLOWS } from '../../portfolio';

export default function OverviewTab({
  ov, fx, insights, insightsOn, insightsFirstLoad, FY, snapshots,
  projSleeves, projInvested0, loan, baseYear, payslips,
  cmpsPension, cmpsService, cmpsRetirement,
}) {
  const sFull = (n) => '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

  // Build monthly deployed amounts from all ledgers
  const monthDeployed = useMemo(() => {
    const m = {};
    const add = (date, inr) => {
      const k = date.slice(0, 7);
      m[k] = (m[k] || 0) + Math.round(inr);
    };
    for (const t of TRANSACTIONS) add(t.date, t.invested);
    for (const c of MF_CASHFLOWS) add(c.date, -c.amount);
    for (const f of FDS.filter((f) => f.status !== 'pipeline')) add(f.open, f.newMoney ?? f.principal);
    // US cashflows — use 84 as rough fx (good enough for the bar chart)
    for (const c of US_CASHFLOWS) if (c.invested > 0) add(c.date, c.invested * 84);
    return m;
  }, []);

  const savingsRows = useMemo(() => {
    if (!payslips?.length) return [];
    return payslips.map(({ month, net }) => ({
      month,
      net,
      deployed: monthDeployed[month] || 0,
      rate: net > 0 ? Math.min(100, Math.round(((monthDeployed[month] || 0) / net) * 100)) : 0,
    }));
  }, [payslips, monthDeployed]);

  const maxNet = useMemo(() => Math.max(...savingsRows.map((r) => r.net), 1), [savingsRows]);

  const fmtMonth = (ym) => {
    const [y, mo] = ym.split('-');
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[+mo - 1]} '${y.slice(2)}`;
  };

  return (
    <div>
      <InsightBanner text={insightsOn ? insights?.overview : null} loading={insightsOn && insightsFirstLoad} />

      {/* Growth tracker + projection scrubber: history + fan in one timeline */}
      <ProjectionTab
        nw={Math.round(ov.nw)} loan={loan} sleeves={projSleeves}
        baseYear={baseYear} invested0={projInvested0} snapshots={snapshots}
        cmpsPension={cmpsPension} cmpsService={cmpsService} cmpsRetirement={cmpsRetirement}
      />

      {/* Capital deployment calendar — per-FY monthly flows from the ledgers */}
      <SipCard fx={fx} />

      {/* Savings rate — net pay vs deployed capital, month by month */}
      {savingsRows.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-hdr">
            <span className="card-title">Income &amp; Savings Rate</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>MCL payslips · Feb 2023 to date</span>
          </div>
          <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
            <div style={{ minWidth: savingsRows.length * 28, position: 'relative', height: 160, display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 4px' }}>
              {savingsRows.map(({ month, net, deployed, rate }) => {
                const netH = Math.round((net / maxNet) * 120);
                const depH = Math.round((deployed / maxNet) * 120);
                return (
                  <div key={month} style={{ flex: '0 0 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
                    title={`${fmtMonth(month)}\nNet pay: ₹${net.toLocaleString('en-IN')}\nDeployed: ₹${deployed.toLocaleString('en-IN')}\nSavings rate: ${rate}%`}>
                    <div style={{ fontSize: 8, color: rate >= 30 ? 'var(--grn)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{rate > 0 ? `${rate}%` : ''}</div>
                    <div style={{ position: 'relative', width: 20, height: 120, display: 'flex', alignItems: 'flex-end' }}>
                      {/* Net pay bar */}
                      <div style={{ position: 'absolute', bottom: 0, left: 0, width: 20, height: netH, background: 'var(--blu)', opacity: 0.25, borderRadius: '2px 2px 0 0' }} />
                      {/* Deployed bar */}
                      {deployed > 0 && (
                        <div style={{ position: 'absolute', bottom: 0, left: 0, width: 20, height: Math.min(depH, netH), background: 'var(--grn)', opacity: 0.85, borderRadius: '2px 2px 0 0' }} />
                      )}
                    </div>
                    <div style={{ fontSize: 7, color: 'var(--muted)', transform: 'rotate(-55deg)', transformOrigin: 'top left', marginTop: 4, whiteSpace: 'nowrap', width: 30 }}>
                      {fmtMonth(month)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Legend + summary */}
          <div style={{ display: 'flex', gap: 20, marginTop: 28, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--blu)', opacity: 0.35, borderRadius: 2, marginRight: 4 }} />Net pay</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--grn)', opacity: 0.85, borderRadius: 2, marginRight: 4 }} />Deployed to portfolio</span>
            <span style={{ marginLeft: 'auto' }}>
              Avg rate: <strong style={{ color: 'var(--fg)' }}>
                {Math.round(savingsRows.filter((r) => r.net > 0 && r.deployed > 0).reduce((s, r) => s + r.rate, 0) / savingsRows.filter((r) => r.net > 0 && r.deployed > 0).length)}%
              </strong>
            </span>
          </div>
        </div>
      )}

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
