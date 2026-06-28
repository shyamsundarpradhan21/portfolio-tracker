'use client';
import { fmtNavDate } from '../../lib/fmt';

export default function FreshnessTag({ mode, date, marketState, casDate }) {
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
    else   { dot = 'var(--acc)'; text = casDate ? `Last-known NAV · ${casDate}` : 'Last-known NAV'; }
  } else {
    dot = 'var(--txt3)'; text = `as of ${date || 'manual'}`;
  }
  return (
    // minWidth:0 + the text WRAPS (overflow-wrap:anywhere + 2-line clamp, the .vsm pattern) so a
    // long "Last-known NAV · date" in a narrow .statgrid card wraps instead of clipping (contentX=0).
    // In wide contexts there's room, so it stays on one line.
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--txt2)', fontWeight: 500, minWidth: 0 }}>
      <span className={blink ? 'live-dot on' : ''} style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0, margin: 0 }} />
      {/* the green "bling" — a glowing LIVE wordmark when the market is open, so
          live state reads at a glance; the rest of the label stays muted */}
      {live && <strong className="live-word">LIVE</strong>}
      {text ? (
        <span style={{ color: live ? 'var(--txt3)' : 'inherit', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }}>
          {live ? `· ${text}` : text}
        </span>
      ) : null}
    </span>
  );
}
