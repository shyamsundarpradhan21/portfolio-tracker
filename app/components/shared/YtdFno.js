'use client';
import { cl, SInrF, numC } from '../../lib/fmt';

export default function YtdFno({ label, data, extra }) {
  return (
    <div className="mini">
      <div className="lbl" style={{ marginBottom: 6 }}>{label}</div>
      <div className="fxc"><span style={{ color: 'var(--txt2)' }}>Gross</span><span className={'mono ' + cl(data.gross)}><SInrF n={data.gross} /></span></div>
      <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>Charges</span><span className="mono mut">{numC(data.charges)}</span></div>
      <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>Net realised</span><span className={'mono ' + cl(data.net)}><SInrF n={data.net} /></span></div>
      {extra && (
        <div className="fxc" style={{ marginTop: 3 }}>
          <span style={{ color: 'var(--txt2)' }}>{extra.label}</span>{extra.node}
        </div>
      )}
    </div>
  );
}
