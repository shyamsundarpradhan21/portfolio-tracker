'use client';
// Live equity intraday day-change curve — the equity analog of the Trading tab's
// F&O Day view. Polls /api/intraday?kind=<kind> (the daemon publishes Σ qty×
// (price−prevClose) to KV every ~minute), green above 0 / red below. Seeded from
// the hydrated archive so it shows instantly; polls only the current session day.
// Renders nothing until the tape has ≥2 points, so it stays invisible outside
// market hours / before the daemon runs.
//
// India (default): kind 'eq', APP.eqIntraday, today's IST date.
// US: kind 'us', APP.usIntraday, the US SESSION date (overnight IST → prev date
//     before 06:00 IST, matching scripts/lib/marketHours usSessionDate).
import { useState, useEffect } from 'react';
import { APP } from '../../lib/appData';
import IntradayChart from './IntradayChart';

const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const todayIstIso = () => istNow().toISOString().slice(0, 10);
const usSessionIso = () => {
  const d = istNow();
  if (d.getUTCHours() < 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const PRESETS = {
  eq: { archive: 'eqIntraday', title: 'Equity P&L today', dateOf: todayIstIso,
        note: 'Mark-to-market vs previous close across delivery + swing holdings, refreshed through the session.' },
  us: { archive: 'usIntraday', title: 'US equity P&L today', dateOf: usSessionIso,
        note: 'US holdings marked vs previous close, in ₹ at the live USD/INR — refreshed through the US session (overnight IST).' },
};

export default function EquityDayCurve({ kind = 'eq' }) {
  const cfg = PRESETS[kind] || PRESETS.eq;
  const date = cfg.dateOf();
  const [tape, setTape] = useState(() => APP[cfg.archive]?.days?.[date] || []);
  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/intraday?kind=${kind}&date=${date}`, { cache: 'no-store' });
        if (!res.ok || !on) return;
        const j = await res.json();
        if (on && Array.isArray(j.tape)) setTape(j.tape);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { on = false; clearInterval(id); };
  }, [kind, date]);

  if (tape.length < 2) return null;
  return (
    <div className="card sec">
      <div>
        <div className="ctitle" style={{ margin: 0 }}>{cfg.title} <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>live · day-change</span></div>
      </div>
      <IntradayChart tape={tape} ariaLabel={`${cfg.title} day-change`} />
      <div className="sub" style={{ marginTop: 8, color: 'var(--txt3)' }}>{cfg.note}</div>
    </div>
  );
}
