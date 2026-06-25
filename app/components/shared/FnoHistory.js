'use client';
// All-years F&O realised — per-FY rows × broker columns + an all-time total row.
// Mirrors the equity Realised panels (gross realised, color-only direction), but
// split broker-wise. Data: data/broker-tax.json → fno_realized (parser-derived).
import { cl, SInrF } from '../../lib/fmt';

const LABELS = { dhan: 'Dhan', zerodha_self: 'Zerodha', upstox: 'Upstox', fyers: 'Fyers', astha: 'Astha' };
const ORDER = ['dhan', 'zerodha_self', 'upstox', 'fyers', 'astha'];

export default function FnoHistory({ data }) {
  if (!data || !data.fy?.length) return null;
  const brokers = ORDER.filter((b) => data.brokers.includes(b))
    .concat(data.brokers.filter((b) => !ORDER.includes(b)));
  const cell = (v, key) => v == null
    ? <td key={key} className="ra mut">·</td>
    : <td key={key} className={'ra mono ' + cl(v)}><SInrF n={v} /></td>;

  return (
    <div className="card">
      <div className="ctitle" style={{ marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
        F&amp;O realised — all years
        <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>gross · by FY</span>
      </div>
      <div className="fxc" style={{ marginBottom: 10 }}>
        <span className="sub" style={{ margin: 0 }}>{brokers.length} brokers · {data.fy.length} FYs · as on {data.asOf}</span>
        <span className={'vt2 ' + cl(data.total)}><SInrF n={data.total} /></span>
      </div>
      <div className="ovx">
        <table className="tbl">
          <thead>
            <tr>
              <th>FY</th>
              {brokers.map((b) => <th key={b} className="ra">{LABELS[b] || b}</th>)}
              <th className="ra">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.fy.map((f) => (
              <tr key={f.label}>
                <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{f.label}</td>
                {brokers.map((b) => cell(f.byBroker[b], b))}
                <td className={'ra mono ' + cl(f.amt)}><SInrF n={f.amt} /></td>
              </tr>
            ))}
            <tr className="tot">
              <td>All-time</td>
              {brokers.map((b) => <td key={b} className={'ra ' + cl(data.byBroker[b])}><SInrF n={data.byBroker[b]} /></td>)}
              <td className={'ra ' + cl(data.total)}><SInrF n={data.total} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sub" style={{ marginTop: 10, color: 'var(--txt3)', lineHeight: 1.6 }}>
        Gross realised (pre-charges), bucketed by sell-date FY — like the equity Realised panels. Net-of-charges for the ITR-verified year is in the strategy cards above. Derived from the broker tax reports.
      </div>
    </div>
  );
}
