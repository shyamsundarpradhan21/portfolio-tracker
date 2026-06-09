'use client';
import { RsText } from '../../lib/fmt';

export default function CFMemo({ title, lead, rows, foot }) {
  return (
    <div className="card sec">
      <div className="lbl" style={{ marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        {title} <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>ITR-verified</span>
      </div>
      {lead && <div className="sub" style={{ marginTop: 0, marginBottom: rows ? 12 : 0, lineHeight: 1.6 }}>{lead}</div>}
      {rows && (
        <div className="g3">
          {rows.map((r) => (
            <div className="csm" key={r.label} style={r.accent ? { borderColor: 'var(--warn-brd)' } : {}}>
              <div className="sub" style={{ margin: 0 }}>{r.label}</div>
              <div className="vsm" style={{ marginTop: 4, color: r.color || 'var(--red)' }}>
                <RsText>{String(r.val).replace(/^[+\-−]/, '')}</RsText>
              </div>
              {r.sub && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}><RsText>{r.sub}</RsText></div>}
            </div>
          ))}
        </div>
      )}
      {foot && <div className="sub" style={{ marginTop: rows ? 12 : 0, paddingTop: rows ? 10 : 0, borderTop: rows ? '.5px solid var(--brd)' : 'none', lineHeight: 1.6 }}>{foot}</div>}
    </div>
  );
}
