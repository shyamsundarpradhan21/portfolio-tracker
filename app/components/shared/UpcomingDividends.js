'use client';

// Upcoming dividends for the stocks you hold — the Wrap's personalised
// corporate-actions card (re-map of the source mock's "In Watchlist": this app has
// no watchlist, but it knows your holdings). Each row: the company, the per-share
// payout, and when it goes ex — an accent "Today" badge on the ex-date, a muted date
// otherwise. Live from /api/dividends (NSE corp-actions filtered to holdings) or an
// honest empty state — nothing fabricated.

import { Rs } from '../../lib/fmt';

// Two-letter avatar mark from the company name (or ticker) — a tinted stand-in for
// the real logo, hue derived from the symbol so it's stable and distinct per name.
const initials = (name, sym) => {
  const src = String(name || sym || '?').trim();
  const w = src.split(/\s+/).filter(Boolean);
  return (w.length >= 2 ? w[0][0] + w[1][0] : src.slice(0, 2)).toUpperCase();
};
const hueOf = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const amt = (n) => (n == null || !isFinite(n) ? null : (Math.round(n * 100) / 100).toLocaleString('en-IN'));
const dateLbl = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }); };

function Row({ it }) {
  const a = amt(it.amount);
  const today = it.days === 0;
  return (
    <div className="updv-row">
      <span className="updv-av" style={{ background: `hsl(${hueOf(it.sym || it.name)} 52% 45%)` }}>{initials(it.name, it.sym)}</span>
      <div className="updv-mid">
        <div className="updv-name">{it.name || it.sym}</div>
        <div className="updv-sub">{a != null ? <>Dividend payout at <Rs />{a} /share</> : 'Dividend — amount to be announced'}</div>
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
      <div className="wlabel">Upcoming dividends <span className="hint">holdings with an ex-date ahead</span></div>
      {loading && !rows.length ? (
        <div className="sub">Loading…</div>
      ) : rows.length ? (
        rows.map((it) => <Row it={it} key={(it.sym || it.name) + it.exDate} />)
      ) : (
        <div className="sub updv-empty">No upcoming dividends across your holdings right now.</div>
      )}
    </div>
  );
}
