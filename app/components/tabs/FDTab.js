'use client';
import { useState } from 'react';
import { InrC, InrF, Pct, fmtNavDate, fmtDateObj } from '../../lib/fmt';
import { LiveInrF } from '../shared/Live';
import AnalysisCard from '../shared/AnalysisCard';
import FreshnessTag from '../shared/FreshnessTag';

// Active-FDs table columns — drives both the sortable header and the sort.
const FD_COLS = [
  { key: 'bank',         label: 'Bank',        num: false },
  { key: 'label',        label: 'FD',          num: false },
  { key: 'matures',      label: 'Matures',     num: false },
  { key: 'principal',    label: 'Principal',   num: true },
  { key: 'rate',         label: 'Rate',        num: true },
  { key: 'accruedSoFar', label: 'Accrued',     num: true },
  { key: 'maturityValue',label: 'At maturity', num: true },
];

export default function FDTab({ fds, now, insights, insightsOn, insightsFirstLoad }) {
  const banks = [...new Set(fds.rows.map((f) => f.bank))].join(', ');
  // sort the Active FDs table — default: soonest maturity first
  const [sort, setSort] = useState({ key: 'matures', dir: 1 });
  const sortBy = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'bank' || key === 'label' ? 1 : -1 }));
  const activeRows = [...fds.rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (av instanceof Date || bv instanceof Date) return sort.dir * (((av && av.getTime()) || 0) - ((bv && bv.getTime()) || 0));
    if (typeof av === 'string') return sort.dir * String(av).localeCompare(String(bv));
    return sort.dir * ((av ?? -Infinity) - (bv ?? -Infinity));
  });
  return (
    <div>
      <AnalysisCard data={insights?.fd} on={insightsOn} loading={insightsOn && insightsFirstLoad} />
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FreshnessTag mode="manual" date={`${fmtDateObj(now)} · accrued recalculated daily`} />
      </div>

      <div className="g4 sec">
        <div className="csm">
          <div className="lbl">active deployed</div>
          <div className="vmd"><InrC n={fds.principal} /></div>
          <div className="sub">{fds.rows.length} FDs · {banks}</div>
        </div>
        <div className="csm">
          <div className="lbl">accrued interest</div>
          <div className="vmd grn"><LiveInrF n={fds.accrued} /></div>
          <div className="sub">accruing live · quarterly compounding</div>
        </div>
        <div className="csm">
          <div className="lbl">value at maturity</div>
          <div className="vmd"><InrC n={fds.maturity} /></div>
          <div className="sub"><InrF n={fds.maturity - fds.principal} /> total interest</div>
        </div>
        <div className="csm">
          <div className="lbl">blended rate</div>
          <div className="vmd"><Pct n={fds.blendedRate} /></div>
          <div className="sub">principal-weighted avg rate</div>
        </div>
      </div>

      <div className="card sec">
        <div className="ctitle" style={{ marginBottom: 10 }}>Active FDs</div>
        <div className="ovx">
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                {FD_COLS.map((c) => (
                  <th key={c.key} className={c.num ? 'ra' : ''} onClick={() => sortBy(c.key)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {c.label} {sort.key === c.key ? (sort.dir < 0 ? '↓' : '↑') : '↕'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeRows.map((f) => (
                <tr key={f.bank + f.label}>
                  <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.bank}</td>
                  <td className="mut">{f.label}</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="mut" style={{ marginBottom: 4 }}>{fmtNavDate(f.matures)}</div>
                    <span className="bar-trk" style={{ display: 'block', height: 4 }}>
                      <span className="bar-fil" style={{ width: f.progress.toFixed(1) + '%', height: 4, background: 'linear-gradient(90deg, var(--grn), #5FE3B0)' }} />
                    </span>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', marginTop: 3 }}><Pct n={f.progress} d={0} /> elapsed</div>
                  </td>
                  <td className="ra mono"><InrC n={f.principal} /></td>
                  <td className="ra grn mono"><Pct n={f.rate} /></td>
                  <td className="ra grn mono"><InrF n={f.accruedSoFar} /></td>
                  <td className="ra">
                    <div className="mono"><InrC n={f.maturityValue} /></div>
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}><InrF n={f.maturityInterest} /> interest</div>
                  </td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={3}>Total — {fds.rows.length} FDs</td>
                <td className="ra"><InrC n={fds.principal} /></td>
                <td className="ra mono"><Pct n={fds.blendedRate} /></td>
                <td className="ra grn"><InrF n={fds.accrued} /></td>
                <td className="ra"><InrC n={fds.maturity} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
          All FDs are cumulative — interest compounds quarterly and reinvests into principal. Accrued interest is included in your net worth daily. Tax on interest is due on accrual under your slab regardless of when you receive it.
        </div>
      </div>

      <div className="card">
        <div className="fxc" style={{ marginBottom: 10 }}>
          <div className="ctitle" style={{ margin: 0 }}>Pipeline — Not Yet Deployed</div>
          <div className="sub" style={{ margin: 0 }}>Pipeline <InrC n={fds.pipelineTotal} /> · Grand total <InrC n={fds.principal + fds.pipelineTotal} /></div>
        </div>
        <div className="ovx">
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Bank</th><th>FD</th><th>Deploy date</th><th>Maturity</th>
                <th>Tenure</th><th className="ra">Amount</th><th />
              </tr>
            </thead>
            <tbody>
              {fds.pipeline.map((f) => (
                <tr key={f.bank + f.label}>
                  <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.bank}</td>
                  <td className="mut">{f.label}</td>
                  <td className="mut">{fmtNavDate(f.deploy)}</td>
                  <td className="mut">{fmtNavDate(f.maturity)}</td>
                  <td className="mut">{f.tenure}</td>
                  <td className="ra mono"><InrC n={f.amount} /></td>
                  <td>{f.badge && <span className="badge ba">{f.badge}</span>}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={5}>Total pipeline</td>
                <td className="ra"><InrC n={fds.pipelineTotal} /></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--txt3)', marginTop: 10, paddingTop: 10, borderTop: '.5px solid var(--brd)' }}>
          Strategy: maturities laddered quarterly across 4 banks — spreads reinvestment risk and keeps each bank's annual interest
          below the <span className="rs">₹</span>40,000 Sec 194A TDS threshold. Pipeline stays out of net worth until its deploy date arrives.
        </div>
      </div>

      {fds.matured.length > 0 && (
        <div className="card sec" style={{ borderLeft: '2px solid var(--gld)' }}>
          <div className="fxc" style={{ marginBottom: 10 }}>
            <div className="ctitle" style={{ margin: 0 }}>Matured — Cash In</div>
            <div className="sub" style={{ margin: 0 }}>awaiting redeployment · <InrC n={fds.maturedCash} /> idle</div>
          </div>
          <div className="ovx">
            <table className="tbl" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>Bank</th><th>FD</th><th>Matured on</th>
                  <th className="ra">Principal</th><th className="ra">Rate</th><th className="ra">Cash in</th>
                </tr>
              </thead>
              <tbody>
                {fds.matured.map((f) => (
                  <tr key={f.id}>
                    <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.bank}</td>
                    <td className="mut">{f.label}</td>
                    <td className="mut">{fmtNavDate(f.matures)}</td>
                    <td className="ra mono"><InrC n={f.principal} /></td>
                    <td className="ra mono"><Pct n={f.rate} /></td>
                    <td className="ra grn mono"><InrF n={f.maturityValue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--txt3)', marginTop: 10 }}>
            Auto-derived: an active FD past maturity counts as cash from its maturity date — record a new row only when this is redeployed.
          </div>
        </div>
      )}

      {fds.closed.length > 0 && (
        <div className="card sec">
          <div className="ctitle" style={{ marginBottom: 10 }}>Matured &amp; Redeemed</div>
          <div className="ovx">
            <table className="tbl" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>Bank</th><th>FD</th><th>Held</th>
                  <th className="ra">Principal</th><th className="ra">Rate</th><th className="ra">Interest earned</th>
                </tr>
              </thead>
              <tbody>
                {fds.closed.map((f) => (
                  <tr key={f.id}>
                    <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.bank}</td>
                    <td className="mut">{f.label}</td>
                    <td className="mut">{fmtNavDate(f.open)} → {fmtNavDate(f.closedOn || f.matures)}</td>
                    <td className="ra mono"><InrC n={f.principal} /></td>
                    <td className="ra mono">{f.rate != null ? <Pct n={f.rate} /> : '—'}</td>
                    <td className="ra grn mono"><InrF n={f.maturityInterest} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
            Closed history — principal returned and interest booked. Interest here was already taxed on accrual in the years it was earned, so redemption itself triggers no fresh tax.
          </div>
        </div>
      )}
    </div>
  );
}
