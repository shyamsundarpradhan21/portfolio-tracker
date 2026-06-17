'use client';
import { fmtNavDate } from '../../lib/fmt';

export default function FreshnessTag({ mode, date, marketState }) {
  let dot = 'var(--txt3)', text = '', blink = false, live = false;
  if (mode === 'live') {
    const open = marketState && marketState.open;
    dot  = open ? 'var(--grn)' : 'var(--txt3)';
    blink = !!open;
    live  = !!open;
    text = marketState ? marketState.label : '';
  } else if (mode === 'nav') {
    const f = fmtNavDate(date);
    if (f) { dot = 'var(--grn)';  text = `NAV as of ${f}`; }
    else   { dot = 'var(--acc)'; text = 'Showing last-known NAV (CAS 05 Jun 2026)'; }
  } else {
    dot = 'var(--txt3)'; text = `as of ${date || 'manual'}`;
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--txt2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
      <span className={blink ? 'live-dot on' : ''} style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0, margin: 0 }} />
      {/* the green "bling" — a glowing LIVE wordmark when the market is open, so
          live state reads at a glance; the rest of the label stays muted */}
      {live && <strong className="live-word">LIVE</strong>}
      {live && text ? <span style={{ color: 'var(--txt3)' }}>· {text}</span> : text}
    </span>
  );
}
