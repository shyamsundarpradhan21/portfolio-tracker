'use client';
import { cl, SInrF } from '../../lib/fmt';

export default function BrokerTable({ data }) {
  const { rows, total } = data;
  return (
    <div className="ovx">
      <table className="tbl">
        <thead>
          <tr>
            <th>Broker</th><th className="ra">Gross</th><th className="ra">Charges</th><th className="ra">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.broker}>
              <td style={{ color: 'var(--txt)', fontWeight: 500 }}>{r.broker}</td>
              <td className={'ra mono ' + cl(r.gross)}><SInrF n={r.gross} /></td>
              <td className="ra mono mut"><SInrF n={r.charges} /></td>
              <td className={'ra mono ' + cl(r.net)}><SInrF n={r.net} /></td>
            </tr>
          ))}
          <tr className="tot">
            <td>Total</td>
            <td className={'ra ' + cl(total.gross)}><SInrF n={total.gross} /></td>
            <td className="ra mut"><SInrF n={total.charges} /></td>
            <td className={'ra ' + cl(total.net)}><SInrF n={total.net} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
