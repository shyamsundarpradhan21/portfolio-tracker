'use client';

// Upcoming corp actions for the stocks you hold — the Wrap's personalised corporate-actions
// card. Dividends (₹/share for Indian names, $/share for US), plus bonus / split / rights
// (shown by ratio). An accent "Today" badge on the ex-date, a muted date otherwise, and an
// IN/US tag per row. Live from /api/dividends (NSE + US calendars filtered to holdings) or an
// honest empty state — nothing fabricated.

import { Rs } from '../../lib/fmt';

// Two-letter avatar mark from the company name (or ticker), hue derived from the symbol.
const initials = (name, sym) => {
  const src = String(name || sym || '?').trim();
  const w = src.split(/\s+/).filter(Boolean);
  return (w.length >= 2 ? w[0][0] + w[1][0] : src.slice(0, 2)).toUpperCase();
};
const hueOf = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const num = (n) => (n == null || !isFinite(n) ? null : (Math.round(n * 100) / 100).toLocaleString('en-IN'));
const dateLbl = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); };

// The middle line: dividends show the per-share payout in the row's currency ($ for US, ₹ for
// IN); bonus / split / rights show the ratio. Nothing invented — falls back to a plain label.
function Detail({ it }) {
  if (it.type === 'dividend') {
    const a = num(it.amount);
    if (a == null) return <>Dividend — amount to be announced</>;
    return <>Dividend payout at {it.market === 'US' ? '$' : <Rs />}{a} /share</>;
  }
  const label = it.type === 'bonus' ? 'Bonus issue' : it.type === 'split' ? 'Stock split' : it.type === 'rights' ? 'Rights issue' : 'Corp action';
  return <>{label}{it.ratio ? ` · ${it.ratio}` : ''}</>;
}

function Row({ it }) {
  const today = it.days === 0;
  return (
    <div className="updv-row">
      <span className="updv-av" style={{ background: `hsl(${hueOf(it.sym || it.name)} 52% 45%)` }}>{initials(it.name, it.sym)}</span>
      <div className="updv-mid">
        <div className="updv-name">{it.name || it.sym}<span className={'updv-mkt m-' + (it.market || 'IN').toLowerCase()}>{it.market || 'IN'}</span></div>
        <div className="updv-sub"><Detail it={it} /></div>
      </div>
      <span className={'updv-when' + (today ? ' today' : '')}>{today ? 'Today' : dateLbl(it.exDate)}</span>
    </div>
  );
}

export default function UpcomingDividends({ items, loading }) {
  const rows = (items || [])
    .filter((i) => i && (i.name || i.sym) && i.exDate && i.days != null && i.days >= 0)
    .sort((a, b) => a.days - b.days);
  return (
    <div className="card sec updv">
      <div className="wlabel">Upcoming corp actions <span className="hint">holdings with an ex-date ahead</span></div>
      {loading && !rows.length ? (
        <div className="sub">Loading…</div>
      ) : rows.length ? (
        rows.map((it) => <Row it={it} key={(it.sym || it.name) + it.exDate} />)
      ) : (
        <div className="sub updv-empty">No upcoming corp actions across your holdings right now.</div>
      )}
    </div>
  );
}
