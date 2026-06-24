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
import { cl, SInrF } from '../../lib/fmt';
import { mergeLiveTapes } from '../../lib/pnlDaily';
import IntradayChart from './IntradayChart';

// Overlay config for the three sleeves (distinct from the broker palette).
const SLEEVES = [
  { key: 'fno', c: '#7C9CF0', label: 'F&O' },
  { key: 'eq', c: '#5FC9B5', label: 'Equity' },
  { key: 'us', c: '#E0A35C', label: 'US' },
];
// Today's date in IST (the Indian market's timezone).
const todayIstIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export default function PortfolioLiveCurve() {
  const [parts, setParts] = useState({ fno: [], eq: [], us: [] });
  useEffect(() => {
    let on = true;
    const date = todayIstIso();
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

  const net = tape[tape.length - 1].net;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="fxc" style={{ padding: '16px 20px 8px' }}>
        <div className="ctitle" style={{ margin: 0 }}>
          Live P&amp;L <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>today · all sleeves</span>
        </div>
        <div className={'vmd ' + cl(net)}><SInrF n={net} /></div>
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <IntradayChart tape={tape} overlays={SLEEVES} ariaLabel="Live portfolio P&L today" />
      </div>
    </div>
  );
}
