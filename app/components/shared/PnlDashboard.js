'use client';
// Groww/Dhan-style P&L dashboard for the Trading tab — stat panel + Day/Month/Year
// views (calendar heatmap) + monthly table, driven entirely by the realised-F&O
// ledger (Fyers + Upstox + Dhan). Reads APP.fnoLedger at render (post-hydration),
// never at module-eval. Direction is colour-only; sizes use --fs-* tokens; holds
// in both themes. Intraday (per-fill) curve is intentionally deferred — that needs
// a new capture pipeline — so the Day view shows the realised summary for now.
import { useMemo, useState, useEffect } from 'react';
import { APP } from '../../lib/appData';
import { cl, SInrF, inrC, MON } from '../../lib/fmt';
import {
  dailySeries, summaryStats, quantileBuckets, monthMatrix, fyOf,
} from '../../lib/pnlDaily';
import IntradayChart from './IntradayChart';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// FY month order: Apr(3) … Dec(11), Jan(0) … Mar(2)
const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];
const bucketStyle = (b) =>
  b == null ? { background: 'var(--pnl-empty)' }
  : { background: `var(--pnl-b${b > 0 ? 'p' + b : b < 0 ? 'l' + -b : 'e'})` };
const Stat = ({ k, v, vc, foot }) => (
  <div className="pnl-stat" style={{ display: 'flex', flexDirection: 'column' }}>
    <div className="lbl" style={{ margin: 0 }}>{k}</div>
    <div className={'vmd ' + (vc || '')} style={{ marginTop: 5 }}>{v}</div>
    {foot ? <div className="fxc sub" style={{ marginTop: 'auto', paddingTop: 8, gap: 8 }}>{foot}</div> : null}
  </div>
);

export default function PnlDashboard({ rows: rowsProp, summary = null } = {}) {
  const allRows = rowsProp || APP.fnoLedger?.rows || [];
  // Brokers present, busiest first — drives the broker toggle (All + each broker).
  const brokers = useMemo(() => {
    const days = {};
    for (const r of allRows) days[r.broker] = (days[r.broker] || 0) + 1;
    return Object.keys(days).sort((a, b) => days[b] - days[a]);
  }, [allRows]);

  const [view, setView] = useState('year');
  const [broker, setBroker] = useState('all');
  const [metric, setMetric] = useState('net');   // 'net' | 'gross' — what the whole dashboard counts
  const [dayMode, setDayMode] = useState('most'); // 'most' | 'least' profitable day
  useEffect(() => {
    try {
      const v = localStorage.getItem('nwTracker.pnlView'); if (['day', 'month', 'year', 'all'].includes(v)) setView(v);
      const b = localStorage.getItem('nwTracker.pnlBroker'); if (b) setBroker(b);
      const m = localStorage.getItem('nwTracker.pnlMetric'); if (m === 'gross' || m === 'net') setMetric(m);
    } catch {}
  }, []);
  // Today's live F&O MTM, for the Day-view period bar — realised is ₹0 until the
  // evening sync books today, so the bar shows live MTM during the session instead.
  const [liveToday, setLiveToday] = useState(null);
  useEffect(() => {
    let on = true;
    const today = todayIstIso();
    const poll = async () => {
      try {
        const r = await fetch(`/api/intraday?kind=fno&date=${today}`, { cache: 'no-store' });
        if (!r.ok || !on) return;
        const pts = (await r.json()).tape || [];
        if (on) setLiveToday(pts.length ? pts[pts.length - 1] : null); // whole point: {net, realised, mtm}
      } catch {}
    };
    poll();
    const id = setInterval(poll, 12_000);
    return () => { on = false; clearInterval(id); };
  }, []);
  const pick = (v) => { setView(v); try { localStorage.setItem('nwTracker.pnlView', v); } catch {} };
  const pickBroker = (b) => { setBroker(b); try { localStorage.setItem('nwTracker.pnlBroker', b); } catch {} };
  const pickMetric = (m) => { setMetric(m); try { localStorage.setItem('nwTracker.pnlMetric', m); } catch {} };
  // Fall back to All if a persisted broker is no longer in the data.
  const activeBroker = broker !== 'all' && brokers.includes(broker) ? broker : 'all';

  const rows = useMemo(
    () => (activeBroker === 'all' ? allRows : allRows.filter((r) => r.broker === activeBroker)),
    [allRows, activeBroker],
  );
  const base = useMemo(() => dailySeries(rows), [rows]);
  // Gross mode swaps each day's `net` for its gross so every downstream view (stats,
  // calendar buckets, period summary) recomputes on gross with no other changes.
  const series = useMemo(
    () => (metric === 'gross' ? base.map((d) => ({ ...d, net: d.gross })) : base),
    [base, metric],
  );
  const byDate = useMemo(() => new Map(series.map((d) => [d.date, d])), [series]);
  const buckets = useMemo(() => quantileBuckets(series), [series]);

  // Period lists (newest last) + a cursor per view; default to the latest data.
  const lists = useMemo(() => {
    const fys = [...new Set(series.map((d) => fyOf(d.date)))];
    const months = [...new Set(series.map((d) => d.date.slice(0, 7)))];
    const days = series.map((d) => d.date);
    // Today's REALISED row only lands at the evening sync, but its LIVE intraday curve
    // exists all session — so make today selectable in the Day view (and its default,
    // since it's newest), else the live curve has nowhere to render until tomorrow.
    const today = todayIstIso();
    if (!days.includes(today)) days.push(today);
    return { year: fys, month: months, day: days, all: ['all'] };
  }, [series]);
  const [cur, setCur] = useState({ year: 0, month: 0, day: 0, all: 0 });
  // Snap each cursor to the newest entry once data is known.
  useEffect(() => {
    setCur({ year: Math.max(0, lists.year.length - 1), month: Math.max(0, lists.month.length - 1), day: Math.max(0, lists.day.length - 1), all: 0 });
  }, [lists]);

  if (!series.length) {
    return (
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px' }}>
          <div className="ctitle" style={{ margin: 0 }}>Trading Journal</div>
        </div>
        {summary ? <div className="pnl-summary">{summary}</div> : null}
        <div className="sub" style={{ padding: '12px 20px 16px' }}>No captured F&amp;O days yet — the realised ledger fills as the daily broker sync runs.</div>
      </div>
    );
  }

  const periodKey = lists[view][Math.min(cur[view], lists[view].length - 1)] || lists[view][lists[view].length - 1];
  // The FY in scope drives the top stat panel + monthly table regardless of view.
  const scopeFy = view === 'all' ? null
    : view === 'year' ? periodKey
    : view === 'month' ? fyOf(periodKey + '-01')
    : fyOf(periodKey);
  // The stat panel scopes to the period in view — all-time for All, else the FY in scope.
  const statSeries = view === 'all' ? series : series.filter((d) => fyOf(d.date) === scopeFy);
  const stats = summaryStats(statSeries);
  const nav = (dir) => setCur((c) => ({ ...c, [view]: Math.min(lists[view].length - 1, Math.max(0, c[view] + dir)) }));

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* ── header ── */}
      <div className="fxc" style={{ padding: '16px 20px 12px' }}>
        <div className="ctitle" style={{ margin: 0 }}>Trading Journal <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>F&amp;O · realised</span></div>
        <div className="seg" role="tablist" aria-label="P&L period">
          {['day', 'month', 'year', 'all'].map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => pick(v)}>
              {v === 'all' ? 'All' : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* capital / verified / YTD summary — folded into the journal as its top row */}
      {summary ? <div className="pnl-summary">{summary}</div> : null}

      {/* ── controls: broker filter (Net/Gross removed — captured in the cards) ── */}
      {brokers.length > 1 && (
        <div className="pnl-brokers">
          <div className="seg" role="tablist" aria-label="Broker">
            {['all', ...brokers].map((b) => (
              <button key={b} role="tab" aria-selected={activeBroker === b} className={activeBroker === b ? 'on' : ''} onClick={() => pickBroker(b)}>
                {b === 'all' ? 'All' : b}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── stat panel — every subtext is a 2-corner FOOTER (value left / right, colour-coded) ── */}
      <div className="pnl-stats">
        <Stat k="Net P&L" vc={cl(stats.net)} v={<SInrF n={stats.net} />}
          foot={<><span className={cl(stats.gross)}>Gross {inrC(stats.gross)}</span><span style={{ color: 'var(--txt2)' }}>Charges {inrC(stats.charges)}</span></>} />
        <WinRateStat stats={stats} />
        <DayStat stats={stats} mode={dayMode} onToggle={() => setDayMode((m) => (m === 'most' ? 'least' : 'most'))} />
        <Stat k="Trading days" v={stats.tradingDays}
          foot={<><span>streak 🔥 {stats.bestStreak}</span><span>now {stats.currentStreak}{stats.currentStreakWin ? '' : ' (loss)'}</span></>} />
      </div>

      {/* ── period bar ── */}
      <div className="fxc pnl-periodbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="pnl-nav" onClick={() => nav(-1)} disabled={cur[view] <= 0} aria-label="Previous">‹</button>
          <span style={{ fontWeight: 600 }}>{periodLabel(view, periodKey)}</span>
          <button className="pnl-nav" onClick={() => nav(1)} disabled={cur[view] >= lists[view].length - 1} aria-label="Next">›</button>
        </div>
        <PeriodSummary view={view} periodKey={periodKey} byDate={byDate} series={series} liveToday={liveToday} />
      </div>

      {/* ── view body ── */}
      <div style={{ padding: '4px 20px 18px' }}>
        {view === 'year' && <YearHeat fy={scopeFy} byDate={byDate} buckets={buckets} />}
        {view === 'month' && <MonthCal ym={periodKey} byDate={byDate} buckets={buckets} />}
        {view === 'day' && <DayPanel key={periodKey} date={periodKey} byDate={byDate} />}
        {view === 'all' && [...lists.year].reverse().map((fy) => (
          <div key={fy} style={{ marginBottom: 18 }}>
            <div className="lbl" style={{ margin: '0 0 6px' }}>{fy}</div>
            <YearHeat fy={fy} byDate={byDate} buckets={buckets} />
          </div>
        ))}
      </div>

      {view !== 'day' && <Legend />}
    </div>
  );
}

// ── view bodies ──
function YearHeat({ fy, byDate, buckets }) {
  const baseY = 2000 + +fy.slice(3, 5); // FY 26-27 → 2026
  return (
    <div className="pnl-year">
      {FY_MONTHS.map((m0) => {
        const y = m0 >= 3 ? baseY : baseY + 1;
        const weeks = monthMatrix(y, m0);
        let net = 0, has = false;
        weeks.flat().forEach((iso) => { const d = iso && byDate.get(iso); if (d) { net += d.net; has = true; } });
        return (
          <div key={m0} className="pnl-month">
            <div className="fxc" style={{ marginBottom: 6 }}>
              <span className="sub" style={{ margin: 0, fontWeight: 600 }}>{MON[m0]}{m0 < 3 ? `'${String((baseY + 1) % 100)}` : ''}</span>
              <span className={'mono ' + (has ? cl(net) : '')} style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: has ? undefined : 'var(--txt3)' }}>
                {has ? <SInrF n={net} /> : '—'}
              </span>
            </div>
            <div className="pnl-grid">
              {weeks.flat().map((iso, i) => (
                <span key={i} className="pnl-cell" style={iso && byDate.has(iso) ? bucketStyle(buckets.get(iso)) : { background: iso ? 'var(--pnl-empty)' : 'transparent' }} title={iso || ''} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthCal({ ym, byDate, buckets }) {
  const y = +ym.slice(0, 4), m0 = +ym.slice(5, 7) - 1;
  const weeks = monthMatrix(y, m0);
  return (
    <div className="pnl-cal">
      {DOW.map((d) => <div key={d} className="pnl-dow">{d}</div>)}
      <div className="pnl-dow" style={{ textAlign: 'left', paddingLeft: 6 }}>Week</div>
      {weeks.map((w, wi) => (
        <Week key={wi} idx={wi} w={w} byDate={byDate} buckets={buckets} />
      ))}
    </div>
  );
}
function Week({ idx, w, byDate, buckets }) {
  let ws = 0, has = false;
  w.forEach((iso) => { const d = iso && byDate.get(iso); if (d) { ws += d.net; has = true; } });
  return (
    <>
      {w.map((iso, i) => {
        const d = iso && byDate.get(iso);
        return (
          <div key={i} className="pnl-daycell" style={iso ? (d ? bucketStyle(buckets.get(iso)) : { background: 'var(--pnl-empty)' }) : { background: 'transparent', border: 'none' }}>
            {iso ? <span className="pnl-dn">{+iso.slice(8)}</span> : null}
            {d ? <span className={'pnl-dp ' + cl(d.net)}><SInrF n={d.net} /></span> : null}
          </div>
        );
      })}
      <div className="pnl-wk">
        <div className="lbl" style={{ margin: 0 }}>Wk {idx + 1}</div>
        <div className={'mono ' + (has ? cl(ws) : '')} style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', color: has ? undefined : 'var(--txt3)' }}>
          {has ? <SInrF n={ws} /> : '—'}
        </div>
      </div>
    </>
  );
}

function DayPanel({ date, byDate }) {
  const d = byDate.get(date);
  // Live tape: poll /api/intraday for the selected day. Held in local state (never
  // mutating APP) so re-renders are explicit; seeded from the hydrated archive so
  // the chart shows instantly, then refreshed. Only the CURRENT day keeps polling
  // — past days are static history, so one fetch is enough.
  // Seeded from the hydrated archive so the chart shows instantly; DayPanel is
  // keyed by date at the call site, so this state resets cleanly per day (no
  // stale-frame flash). Only the CURRENT day keeps polling — past days are static.
  const [liveTape, setLiveTape] = useState(() => APP.fnoIntraday?.days?.[date] || null);
  const [candles, setCandles] = useState(() => APP.niftyOhlc?.days?.[date] || null);
  const [fills, setFills] = useState(() => APP.fnoIntraday?.fills?.[date] || []);
  useEffect(() => {
    if (!date) return;
    let on = true;
    const poll = async () => {
      try {
        const [res, niftyRes] = await Promise.all([
          fetch(`/api/intraday?date=${date}`, { cache: 'no-store' }),
          fetch(`/api/intraday?kind=nifty&date=${date}`, { cache: 'no-store' }),
        ]);
        if (on && res.ok) { const j = await res.json(); if (Array.isArray(j.tape)) setLiveTape(j.tape); if (Array.isArray(j.fills)) setFills(j.fills); }
        if (on && niftyRes.ok) { const j = await niftyRes.json(); if (Array.isArray(j.tape)) setCandles(j.tape); }
      } catch {}
    };
    poll();
    const id = date === todayIstIso() ? setInterval(poll, 12_000) : null;
    return () => { on = false; if (id) clearInterval(id); };
  }, [date]);
  const tape = liveTape != null ? liveTape : (APP.fnoIntraday?.days?.[date] || []);
  const pending = tape.some((p) => p.pending);
  // Flattened — contents sit directly in the view-body container (no nested .mini box,
  // which scaled oddly); the date + summary live in the period bar above, so no header here.
  return (
    <>
      {tape.length >= 2 ? <IntradayChart tape={tape} candles={candles} pending={pending} fills={fills} /> : null}

      {d ? (
        <div className="g4" style={{ marginTop: 12 }}>
          <Mini k="Gross" v={<SInrF n={d.gross} />} vc={cl(d.gross)} />
          <Mini k="Charges" v={<SInrF n={d.charges} />} />
          <Mini k="Orders" v={d.orders || '—'} />
          <Mini k="Net" v={<SInrF n={d.net} />} vc={cl(d.net)} />
        </div>
      ) : (tape.length ? null : <div className="sub" style={{ marginTop: 12 }}>No trades captured this day.</div>)}

      {tape.length < 2 ? (
        <div className="sub" style={{ marginTop: 14, color: 'var(--txt3)', lineHeight: 1.6 }}>
          The intraday P&amp;L curve (green above 0 / red below) draws once the live capture has logged a few points — it snapshots realised + open MTM every few minutes through the session.
        </div>
      ) : null}
    </>
  );
}

const Mini = ({ k, v, vc }) => (
  <div className="csm"><div className="sub" style={{ margin: 0 }}>{k}</div><div className={'vsm ' + (vc || '')} style={{ marginTop: 4 }}>{v}</div></div>
);

function PeriodSummary({ view, periodKey, byDate, series, liveToday }) {
  const sub = view === 'all' ? series
    : view === 'year' ? series.filter((d) => fyOf(d.date) === periodKey)
    : view === 'month' ? series.filter((d) => d.date.slice(0, 7) === periodKey)
    : series.filter((d) => d.date === periodKey);
  const s = summaryStats(sub);
  // Today has no realised LEDGER row until the evening sync — so show LIVE figures, not a
  // misleading ₹0. The post-2026-06-25 capture splits realised (closed legs) vs open MTM;
  // older points carry net only, so fall back to a single Live P&L figure.
  const liveDay = view === 'day' && periodKey === todayIstIso() && liveToday != null;
  const split = liveDay && liveToday.realised != null && liveToday.mtm != null;
  // Charges is a COST, not a P&L direction → neutral, never red. Booked at the evening
  // sync, so on the live day it reads — until the day's realised row lands.
  const dayCharges = byDate.get(periodKey)?.charges;
  const Charges = ({ n }) => (
    <span><span className="lbl">Charges</span> <span className="mono" style={{ color: 'var(--txt2)' }}>{n != null ? <SInrF n={n} /> : '—'}</span></span>
  );
  if (split) {
    return (
      <div className="pnl-psum">
        <span><span className="lbl">Realised</span> <span className={'mono ' + cl(liveToday.realised)}><SInrF n={liveToday.realised} /></span></span>
        <span><span className="lbl">Open MTM</span> <span className={'mono ' + cl(liveToday.mtm)}><SInrF n={liveToday.mtm} /></span></span>
        <Charges n={dayCharges} />
        <span><span className="lbl">Net</span> <span className={'mono ' + cl(liveToday.net)}><SInrF n={liveToday.net} /></span></span>
      </div>
    );
  }
  if (liveDay) {
    return (
      <div className="pnl-psum">
        <Charges n={dayCharges} />
        <span><span className="lbl">Live P&amp;L</span> <span className={'mono ' + cl(liveToday.net)}><SInrF n={liveToday.net} /></span></span>
      </div>
    );
  }
  return (
    <div className="pnl-psum">
      <span><span className="lbl">Orders</span> <span className="mono">{s.orders || '—'}</span></span>
      <span><span className="lbl">Days</span> <span className="mono">{s.tradingDays}</span></span>
      <Charges n={s.charges} />
      <span><span className="lbl">Net</span> <span className={'mono ' + cl(s.net)}><SInrF n={s.net} /></span></span>
    </div>
  );
}

function Legend() {
  return (
    <div className="pnl-legend">
      <span>Loss</span>
      <span className="pnl-sw" style={{ background: 'var(--pnl-bl3)' }} />
      <span className="pnl-sw" style={{ background: 'var(--pnl-bl2)' }} />
      <span className="pnl-sw" style={{ background: 'var(--pnl-bl1)' }} />
      <span className="pnl-sw" style={{ background: 'var(--pnl-bp1)' }} />
      <span className="pnl-sw" style={{ background: 'var(--pnl-bp2)' }} />
      <span className="pnl-sw" style={{ background: 'var(--pnl-bp3)' }} />
      <span>Profit</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 16 }}>
        <span className="pnl-sw" style={{ background: 'var(--pnl-be)' }} /> Breakeven / carry
      </span>
      <span style={{ marginLeft: 'auto', color: 'var(--txt3)' }}>intensity ∝ your own daily range</span>
    </div>
  );
}

// Win rate — shows the % number, hover swaps it for the donut ring.
function WinRateStat({ stats }) {
  return (
    <div className="pnl-stat" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="lbl" style={{ margin: 0 }}>Win rate</div>
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
        <Donut pct={stats.winPct} size={56} showPct />
      </div>
      {/* win count (green, left) · loss count (red, right) — counts only, colour-coded */}
      <div className="fxc sub" style={{ marginTop: 'auto', paddingTop: 8 }}>
        <span className="grn" style={{ fontWeight: 700 }}>{stats.winDays}</span>
        <span className="red" style={{ fontWeight: 700 }}>{stats.lossDays}</span>
      </div>
    </div>
  );
}

// Most / least profitable day, click to toggle.
function DayStat({ stats, mode, onToggle }) {
  const d = mode === 'most' ? stats.mostProfit : stats.leastProfit;
  return (
    <div className="pnl-stat" onClick={onToggle} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column' }} title="Click to toggle most / least profitable day">
      <div className="lbl" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {mode === 'most' ? 'Most profitable day' : 'Least profitable day'} <span style={{ color: 'var(--txt3)', fontSize: 'var(--fs-sm)' }}>↻</span>
      </div>
      <div className={'vmd ' + (d ? cl(d.net) : '')} style={{ marginTop: 5 }}>{d ? <SInrF n={d.net} /> : '—'}</div>
      <div className="sub" style={{ marginTop: 'auto', paddingTop: 8 }}>{d ? prettyDate(d.date) : ''}</div>
    </div>
  );
}

// Win-rate ring (Groww-style). Green arc = win%.
function Donut({ pct, color = 'var(--grn)', size = 26, showPct = false }) {
  const r = 11, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--pnl-empty)" strokeWidth="4" />
      <circle cx="14" cy="14" r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={c} strokeDashoffset={c * (1 - (pct || 0) / 100)}
        strokeLinecap="round" transform="rotate(-90 14 14)" />
      {showPct ? <text x="14" y="14.5" textAnchor="middle" dominantBaseline="central" fill="var(--txt)" style={{ fontSize: '7.5px', fontWeight: 700 }}>{pct}%</text> : null}
    </svg>
  );
}

// Live P&L for today, polled from the intraday tape (broker-aware). Hidden until a
// point exists today (market hours), so it never shows a stale/zero ticker.
function LivePnl({ broker }) {
  const [net, setNet] = useState(null);
  useEffect(() => {
    let on = true;
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const poll = async () => {
      try {
        const r = await fetch(`/api/intraday?kind=fno&date=${today}`, { cache: 'no-store' });
        if (!r.ok || !on) return;
        const pts = (await r.json()).tape || [];
        if (!pts.length) { if (on) setNet(null); return; }
        const last = pts[pts.length - 1];
        const v = broker === 'all' ? last.net : (last[broker] ?? null);
        if (on) setNet(Number.isFinite(v) ? v : null);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 12_000);
    return () => { on = false; clearInterval(id); };
  }, [broker]);
  if (net == null) return null;
  return (
    <span className="pnl-live">
      <span className="pnl-livedot" />
      <span className="lbl" style={{ margin: 0 }}>Live</span>
      <span className={'mono ' + cl(net)} style={{ fontWeight: 700 }}><SInrF n={net} /></span>
    </span>
  );
}

const prettyDate = (iso) => `${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
// Today's date in IST (the market's timezone), for deciding when to keep polling.
const todayIstIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const periodLabel = (view, key) =>
  view === 'all' ? 'All-time'
  : view === 'year' ? key
  : view === 'month' ? `${MON[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`
  : prettyDate(key);
