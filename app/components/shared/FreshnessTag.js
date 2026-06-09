'use client';
import { fmtNavDate } from '../../lib/fmt';

export default function FreshnessTag({ mode, date, marketState }) {
  let dot = 'var(--txt3)', text = '';
  if (mode === 'live') {
    const open = marketState && marketState.open;
    dot  = open ? 'var(--grn)' : 'var(--txt3)';
    text = (open ? 'LIVE · ' : '') + (marketState ? marketState.label : '');
  } else if (mode === 'nav') {
    const f = fmtNavDate(date);
    if (f) { dot = 'var(--grn)';  text = `NAV as of ${f}`; }
    else   { dot = 'var(--acc)'; text = 'Showing last-known NAV (CAS 05 Jun 2026)'; }
  } else {
    dot = 'var(--txt3)'; text = `as of ${date || 'manual'}`;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--txt2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      {text}
    </span>
  );
}
