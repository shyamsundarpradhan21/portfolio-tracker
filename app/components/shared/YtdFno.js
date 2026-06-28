'use client';
import { cl, SInrF, numC } from '../../lib/fmt';

export default function YtdFno({ label, data, extra, liveMtm }) {
  return (
    <div className="mini">
      <div className="lbl" style={{ marginBottom: 6 }}>{label}</div>
      <div className="fxc"><span style={{ color: 'var(--txt2)' }}>Gross</span><span className={'mono ' + cl(data.gross)}><SInrF n={data.gross} /></span></div>
      <div className="fxc" style={{ marginTop: 3 }}>
        <span style={{ color: 'var(--txt2)' }}>Charges{data.auto && !data.chargesReal && <span style={{ color: 'var(--txt3)', fontSize: 'var(--fs-2xs)' }}> est.</span>}</span>
        <span className="mono mut">{numC(data.charges)}</span>
      </div>
      <div className="fxc" style={{ marginTop: 3 }}><span style={{ color: 'var(--txt2)' }}>Net realised</span><span className={'mono ' + cl(data.net)}><SInrF n={data.net} /></span></div>
      {liveMtm != null && liveMtm !== 0 && (
        <>
          <div className="fxc" style={{ marginTop: 3 }}>
            <span style={{ color: 'var(--txt2)' }}>Open MTM<span style={{ color: 'var(--txt3)', fontSize: 'var(--fs-2xs)' }}> live</span></span>
            <span className={'mono ' + cl(liveMtm)}><SInrF n={liveMtm} /></span>
          </div>
          <div className="fxc" style={{ marginTop: 5, paddingTop: 5, borderTop: '.5px solid var(--brd2)' }}>
            <span style={{ color: 'var(--txt)', fontWeight: 600 }}>Net + open MTM</span>
            <span className={'mono ' + cl(data.net + liveMtm)}><SInrF n={data.net + liveMtm} /></span>
          </div>
        </>
      )}
      {extra && (
        <div className="fxc" style={{ marginTop: 3 }}>
          <span style={{ color: 'var(--txt2)' }}>{extra.label}</span>{extra.node}
        </div>
      )}
      {data.auto && (
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', marginTop: 6, lineHeight: 1.5 }}>
          auto · {data.capturedDays} day{data.capturedDays === 1 ? '' : 's'} captured{data.lastCapture ? ` · last ${data.lastCapture}` : ''}
        </div>
      )}
    </div>
  );
}
