'use client';
// Trading Journal → Summary sub-tab. Two broker-wise tables that reuse the .ovx/.tbl
// chrome (same as BrokerTable / FnoHistory) so each owns its horizontal scroll and the
// responsive gate stays green. Direction is colour-only (no +/− glyph), per repo rule.
//   ① F&O Positions — live broker split (open MTM · capital utilised · available) from fnoLive.
//   ② F&O Realised — all-years, broker-wise net (overlaid charges, the Overview's basis).
import { APP } from '../../lib/appData';
import { cl, SInrF, numC } from '../../lib/fmt';
import { brokerRealisedMatrix } from '../../lib/pnlDaily';

export default function FnoSummary({ fno }) {
  const inr = (n) => <SInrF n={n} />;

  // ① Positions — one row per live broker that has captured funds or an open position.
  const posBrokers = (fno?.brokers || []).filter((b) => b.funds || b.active);
  const usedTot = (fno?.byStrategy?.S01.fundsUsed || 0) + (fno?.byStrategy?.S02.fundsUsed || 0);
  const availTot = (fno?.byStrategy?.S01.fundsAvail || 0) + (fno?.byStrategy?.S02.fundsAvail || 0);

  // ② Realised — broker-wise, ordered to match the positions table (live FNO_META order
  // first, ledger-only brokers after). Most-recent FY column = the YTD one.
  const rows = APP.fnoLedger?.rows || [];
  const order = (fno?.brokers || []).map((b) => b.name);
  const m = brokerRealisedMatrix(rows, order);
  const ytdFy = m.fys[m.fys.length - 1] || null;
  const netCell = (v, key) => v == null
    ? <td key={key} className="ra mut">·</td>
    : <td key={key} className={'ra mono ' + cl(v)}>{inr(v)}</td>;

  return (
    <>
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

      <div className="card sec">
        <div className="ctitle" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          F&amp;O Realised <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>all years · broker-wise</span>
        </div>
        {m.brokers.length ? (
          <>
            <div className="ovx">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Broker</th><th>Sleeve</th>
                    {m.fys.map((fy) => (
                      <th key={fy} className="ra">{fy === ytdFy ? <>{fy} <span style={{ opacity: .6 }}>YTD</span></> : fy}</th>
                    ))}
                    <th className="ra">All-time net</th><th className="ra">Charges</th><th className="ra">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {m.brokers.map((b) => (
                    <tr key={b.broker}>
                      <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{b.broker}</td>
                      <td className="mut">{b.sleeve || '—'}</td>
                      {m.fys.map((fy) => netCell(b.byFy[fy], fy))}
                      <td className={'ra mono ' + cl(b.net)}>{inr(b.net)}</td>
                      <td className="ra mono mut">{numC(b.charges)}</td>
                      <td className="ra mono">{b.days}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td>Total</td><td></td>
                    {m.fys.map((fy) => (
                      <td key={fy} className={'ra ' + cl(m.total.byFy[fy] || 0)}>{inr(m.total.byFy[fy] || 0)}</td>
                    ))}
                    <td className={'ra ' + cl(m.total.net)}>{inr(m.total.net)}</td>
                    <td className="ra mut">{numC(m.total.charges)}</td>
                    <td className="ra">{m.total.days}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="sub" style={{ marginTop: 10, color: 'var(--txt3)', lineHeight: 1.6 }}>
              Net realised after charges — real contract-note levies where parsed, else estimated (same basis as the Overview). Bucketed by sell-date FY; days = distinct trading days per broker.
            </div>
          </>
        ) : <div className="sub">No realised F&amp;O history yet.</div>}
      </div>
    </>
  );
}
