'use client';
// Indian equity intraday day-change curve — the equity analog of the Trading
// tab's F&O Day view. Polls /api/intraday?kind=eq (the daemon publishes Σ qty×
// (price−prevClose) across INDIAN + SWING every ~minute to KV), green above 0 /
// red below. Seeded from the hydrated archive so it shows instantly; only polls
// during the current IST day. Renders nothing until the tape has ≥2 points, so it
// stays invisible outside market hours / before the daemon runs.
import { useState, useEffect } from 'react';
import { APP } from '../../lib/appData';
import { cl, SInrF } from '../../lib/fmt';
import IntradayChart from './IntradayChart';

const todayIstIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export default function EquityDayCurve() {
  const date = todayIstIso();
  const [tape, setTape] = useState(() => APP.eqIntraday?.days?.[date] || []);
  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/intraday?kind=eq&date=${date}`, { cache: 'no-store' });
        if (!res.ok || !on) return;
        const j = await res.json();
        if (on && Array.isArray(j.tape)) setTape(j.tape);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => { on = false; clearInterval(id); };
  }, [date]);

  if (tape.length < 2) return null;
  const net = tape[tape.length - 1].net;
  return (
    <div className="card sec">
      <div className="fxc">
        <div className="ctitle" style={{ margin: 0 }}>Equity P&amp;L today <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>live · day-change</span></div>
        <div className={'vmd ' + cl(net)}><SInrF n={net} /></div>
      </div>
      <IntradayChart tape={tape} ariaLabel="Equity day-change" />
      <div className="sub" style={{ marginTop: 8, color: 'var(--txt3)' }}>
        Mark-to-market vs previous close across delivery + swing holdings, refreshed through the session.
      </div>
    </div>
  );
}
