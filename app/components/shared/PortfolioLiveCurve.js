'use client';
// Live intraday portfolio P&L for the Overview tab — the day-change generated
// across all three live sleeves stitched into one curve: F&O positions, the
// Indian equity book, and the US sleeve (INR). Each sleeve has its own capture
// tape (/api/intraday?kind=fno|eq|us); this polls all three for today, merges
// them chronologically (mergeLiveTapes), and draws the aggregate net + per-sleeve
// overlay with the shared IntradayChart. Mirrors the Trading-tab Day curve.
//
// Reads nothing at module-eval; all data comes from the runtime API. Hidden until
// at least one sleeve has logged a point today, so it never shows a stale frame.
import { useEffect, useState } from 'react';
import { mergeLiveTapes } from '../../lib/pnlDaily';
import IntradayChart from './IntradayChart';

// Sleeve config — the curve draws ONE net line; these only label the hover split, each in
// its TAB accent (Indian / US / Algo tab colours) so a row says which sleeve it is without a
// second on-chart curve. (Resolve via the --tab-* vars so they're the real tab colours, not a
// bespoke palette — per "hover labels always use the tab colour".)
const SLEEVES = [
  { key: 'fno', c: 'var(--tab-algo)', label: 'F&O' },
  { key: 'eq', c: 'var(--tab-indian)', label: 'Equity' },
  { key: 'us', c: 'var(--tab-us)', label: 'US' },
];
// The portfolio "day" the curve shows. The US sleeve runs overnight (IST), so
// before 06:00 IST the live session still belongs to the PREVIOUS IST date — and
// that same date also buckets that day's earlier India sleeves, so one date keys
// all three. Matches scripts/lib/marketHours usSessionDate + EquityDayCurve; using
// the plain IST date here meant the card vanished every night after IST midnight
// while the US market was still open.
const sessionIstIso = () => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  if (d.getUTCHours() < 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export default function PortfolioLiveCurve() {
  const [parts, setParts] = useState({ fno: [], eq: [], us: [] });
  useEffect(() => {
    let on = true;
    const date = sessionIstIso();
    const poll = async () => {
      try {
        const got = await Promise.all(['fno', 'eq', 'us'].map((kind) =>
          fetch(`/api/intraday?kind=${kind}&date=${date}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null)).catch(() => null)));
        if (!on) return;
        const next = {};
        ['fno', 'eq', 'us'].forEach((kind, i) => { next[kind] = Array.isArray(got[i]?.tape) ? got[i].tape : []; });
        setParts(next);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 12_000);
    return () => { on = false; clearInterval(id); };
  }, []);

  const tape = mergeLiveTapes(parts);
  if (tape.length < 2) return null;                 // hidden until the day has shape

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px 8px' }}>
        <div className="ctitle" style={{ margin: 0 }}>
          Live P&amp;L <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>today · all sleeves</span>
        </div>
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <IntradayChart tape={tape} overlays={SLEEVES} legsInHoverOnly ariaLabel="Live portfolio P&L today" />
      </div>
    </div>
  );
}
