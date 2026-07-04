'use client';
// Trading Journal → Summary sub-tab.
//   ① F&O Positions — live broker split (open MTM · capital utilised · available) from fnoLive.
//   ② F&O Realised  — a YEAR-DRILL panel (mirrors the RealizedPanel pattern used for the
//      Indian/US realised cards): an all-time headline with the gross→charges→net triplet, a
//      slim per-FY bar chart (click a bar to drill that FY), and a short per-broker breakdown
//      for the scope in view. Fixed height whether it's 3 FYs or 50 — the column-per-year
//      matrix didn't scale, and charges were buried. Money figures flow through the ₹/$ toggle.
// Direction is colour-only (no +/− glyph), per repo rule.
import { useMemo, useState } from 'react';
import { APP } from '../../lib/appData';
import { cl, SInrF, SInrC, numC } from '../../lib/fmt';
import { fyOf } from '../../lib/pnlDaily';

// Per-FY (and per-broker-within-FY) realised aggregation: gross, charges (real contract-note
// where parsed, else modeled est.), net, distinct trading days, and charge provenance.
function fnoRealised(rows) {
  const chargeOf = (r) => (r.chargeSource === 'real' ? (r.realCharge || 0) : (r.estCharges || 0));
  const byFy = new Map();
  for (const r of rows || []) {
    if (!r || !r.date) continue;
    const fy = fyOf(r.date);
    const charge = chargeOf(r);
    const gross = r.grossRealised != null ? r.grossRealised : (r.net || 0) + charge;
    const net = r.net != null ? r.net : gross - charge;
    let f = byFy.get(fy);
    if (!f) { f = { fy, gross: 0, charge: 0, net: 0, real: 0, est: 0, days: new Set(), brokers: new Map() }; byFy.set(fy, f); }
    f.gross += gross; f.charge += charge; f.net += net; f.days.add(r.date);
    if (r.chargeSource === 'real') f.real += charge; else f.est += charge;
    let b = f.brokers.get(r.broker);
    if (!b) { b = { broker: r.broker, sleeve: r.sleeve || null, gross: 0, charge: 0, net: 0, days: new Set() }; f.brokers.set(r.broker, b); }
    b.gross += gross; b.charge += charge; b.net += net; b.days.add(r.date);
    if (!b.sleeve && r.sleeve) b.sleeve = r.sleeve;
  }
  const fys = [...byFy.values()].map((f) => ({
    ...f, days: f.days.size,
    brokers: [...f.brokers.values()].map((b) => ({ ...b, days: b.days.size })).sort((a, b) => b.net - a.net),
  })).sort((a, b) => (a.fy < b.fy ? -1 : 1));
  const total = { gross: 0, charge: 0, net: 0, days: 0, real: 0, est: 0, brokers: [] };
  const ob = new Map();
  for (const f of fys) {
    total.gross += f.gross; total.charge += f.charge; total.net += f.net; total.days += f.days; total.real += f.real; total.est += f.est;
    for (const b of f.brokers) {
      let o = ob.get(b.broker);
      if (!o) { o = { broker: b.broker, sleeve: b.sleeve, gross: 0, charge: 0, net: 0, days: 0 }; ob.set(b.broker, o); }
      o.gross += b.gross; o.charge += b.charge; o.net += b.net; o.days += b.days; if (!o.sleeve && b.sleeve) o.sleeve = b.sleeve;
    }
  }
  total.brokers = [...ob.values()].sort((a, b) => b.net - a.net);
  return { fys, total };
}

// ② the scalable realised panel
function FnoRealisedPanel({ rows }) {
  const [sel, setSel] = useState(null); // null = overall (all FYs), else FY index
  const { fys, total } = useMemo(() => fnoRealised(rows), [rows]);

  if (!fys.length) {
    return (
      <div className="card sec">
        <div className="ctitle" style={{ marginBottom: 10 }}>F&amp;O Realised</div>
        <div className="sub">No realised F&amp;O history yet.</div>
      </div>
    );
  }

  const maxAbs = Math.max(1, ...fys.map((f) => Math.abs(f.net)));
  const scope = sel == null ? total : fys[sel];
  const brokers = scope.brokers;
  // charge provenance — what share of the charge ₹ is real contract-note vs modeled est.
  const provTot = total.real + total.est;
  const realPct = provTot > 0 ? Math.round((total.real / provTot) * 100) : null;
  const provBadge = provTot <= 0 ? 'charges n/a'
    : total.real === 0 ? 'charges · est. (modeled)'
    : total.est === 0 ? 'charges · contract-note'
    : `charges ${realPct}% contract-note`;
  const M = (n) => <SInrC n={n} />; // compact, magnitude, ₹/$-aware; colour via wrapper class

  return (
    <div className="card sec">
      {/* header: title + provenance badge · all-time net + the gross→charges→net triplet */}
      <div className="fxc" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
        <div>
          <div className="ctitle" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            F&amp;O Realised <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>{provBadge}</span>
          </div>
          <div className="sub" style={{ margin: 0 }}>all years · {fys.length} FY{fys.length > 1 ? 's' : ''} · click a bar to drill</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={'vt2 ' + cl(total.net)}>{M(total.net)}</div>
          <div className="sub" style={{ margin: 0 }}>
            <span className={cl(total.gross)}>Gross {M(total.gross)}</span>
            <span style={{ color: 'var(--txt2)' }}> · Charges {M(total.charge)}</span>
            <span className={cl(total.net)}> · Net {M(total.net)}</span>
          </div>
        </div>
      </div>

      {/* scope reset */}
      <div className="rz-scope">
        <button className={'rz-tab' + (sel == null ? ' on' : '')} onClick={() => setSel(null)}>Overall</button>
        <span className="sub" style={{ margin: 0 }}>{sel == null ? '· click a bar to drill into a year' : `· showing ${fys[sel].fy}`}</span>
      </div>

      {/* per-FY bar chart — fixed height whatever the FY count; green up / red down by net */}
      <div className="rz-bars">
        {fys.map((f, i) => {
          const h = Math.max(2, Math.round((Math.abs(f.net) / maxAbs) * 44));
          const up = f.net >= 0;
          const cls = 'rz-col' + (sel === i ? ' sel' : '') + (sel != null && sel !== i ? ' dim' : '');
          return (
            <div key={f.fy} className={cls} title={`${f.fy} · net ${f.net >= 0 ? '' : '−'}₹${Math.abs(Math.round(f.net)).toLocaleString('en-IN')}`}
              onClick={() => setSel(sel === i ? null : i)}>
              <div className="rz-half t"><div className="rz-up" style={{ height: up ? h : 0 }} /></div>
              <div className="rz-zero" />
              <div className="rz-half b"><div className="rz-dn" style={{ height: up ? 0 : h }} /></div>
            </div>
          );
        })}
      </div>
      <div className="rz-axis">
        {[0, fys.length >> 1, fys.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => <span key={i}>{fys[i].fy}</span>)}
      </div>

      {/* per-broker breakdown for the scope in view — charges a first-class column */}
      <div className="ovx sec">
        <table className="tbl">
          <thead>
            <tr>
              <th>Broker</th><th>Sleeve</th>
              <th className="ra">Gross</th><th className="ra">Charges</th><th className="ra">Net</th><th className="ra">Days</th>
            </tr>
          </thead>
          <tbody>
            {brokers.map((b) => (
              <tr key={b.broker}>
                <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{b.broker}</td>
                <td className="mut">{b.sleeve || '—'}</td>
                <td className={'ra mono ' + cl(b.gross)}>{M(b.gross)}</td>
                <td className="ra mono mut">{M(b.charge)}</td>
                <td className={'ra mono ' + cl(b.net)}>{M(b.net)}</td>
                <td className="ra mono">{b.days}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>{sel == null ? 'All-time' : fys[sel].fy}</td><td></td>
              <td className={'ra ' + cl(scope.gross)}>{M(scope.gross)}</td>
              <td className="ra mut">{M(scope.charge)}</td>
              <td className={'ra ' + cl(scope.net)}>{M(scope.net)}</td>
              <td className="ra">{scope.days}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sub" style={{ marginTop: 10, color: 'var(--txt3)', lineHeight: 1.6 }}>
        Net = gross realised − charges. Charges are real contract-note levies where parsed, else modeled estimates (same basis as the Overview). Bars are net by sell-date FY; days = distinct trading days in scope.
      </div>
    </div>
  );
}

// ① F&O Positions — live broker split (open MTM · utilised · available). Exported so it can
// live on the Overview (daily) sub-tab rather than beside the realised history (#35).
export function FnoPositionsLive({ fno }) {
  const inr = (n) => <SInrF n={n} />;
  const posBrokers = (fno?.brokers || []).filter((b) => b.funds || b.active);
  const usedTot = (fno?.byStrategy?.S01.fundsUsed || 0) + (fno?.byStrategy?.S02.fundsUsed || 0);
  const availTot = (fno?.byStrategy?.S01.fundsAvail || 0) + (fno?.byStrategy?.S02.fundsAvail || 0);
  return (
    <div className="card sec">
      <div className="ctitle" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        F&amp;O Positions <span className="badge ba" style={{ fontSize: 'var(--fs-2xs)' }}>live · broker split</span>
      </div>
      {posBrokers.length ? (
        <div className="ovx">
          <table className="tbl">
            <thead>
              <tr>
                <th>Broker</th><th>Strategy</th>
                <th className="ra">Open MTM</th><th className="ra">Capital utilised</th><th className="ra">Available</th>
              </tr>
            </thead>
            <tbody>
              {posBrokers.map((b) => (
                <tr key={b.key}>
                  <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{b.name}</td>
                  <td className="mut">{b.sleeve}</td>
                  <td className={'ra mono ' + (b.open.length ? cl(b.openMtm) : '')}>{b.open.length ? inr(b.openMtm) : '—'}</td>
                  <td className="ra mono">{b.funds ? numC(Number(b.funds.utilized) || 0) : '—'}</td>
                  <td className="ra mono">{b.funds ? numC(Number(b.funds.available) || 0) : '—'}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>Total</td><td></td>
                <td className={'ra ' + cl(fno.netOpenMtm)}>{inr(fno.netOpenMtm)}</td>
                <td className="ra mono">{numC(usedTot)}</td>
                <td className="ra mono">{numC(availTot)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : <div className="sub" style={{ lineHeight: 1.6 }}>No live broker funds captured yet — positions appear here once the brokers sync.</div>}
    </div>
  );
}

// ② the Summary sub-tab now carries only the F&O Realised year-drill panel — the live
// Positions card (① above) moved to the Overview (daily) sub-tab.
export default function FnoSummary() {
  return <FnoRealisedPanel rows={APP.fnoLedger?.rows || []} />;
}
