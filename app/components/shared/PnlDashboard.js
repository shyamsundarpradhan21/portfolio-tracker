'use client';
// Groww/Dhan-style P&L dashboard for the Trading tab — stat panel + Day/Month/Year
// views (calendar heatmap) + monthly table, driven entirely by the realised-F&O
// ledger (Fyers + Upstox + Dhan). Reads APP.fnoLedger at render (post-hydration),
// never at module-eval. Direction is colour-only; sizes use --fs-* tokens; holds
// in both themes. Intraday (per-fill) curve is intentionally deferred — that needs
// a new capture pipeline — so the Day view shows the realised summary for now.
import { useMemo, useState, useEffect } from 'react';
import { APP } from '../../lib/appData';
import { cl, SInrF, SInrC, inrC, sFull, MON } from '../../lib/fmt';
import {
  dailySeries, summaryStats, quantileBuckets, monthMatrix, fyOf, returnsPct,
} from '../../lib/pnlDaily';
import IntradayChart from './IntradayChart';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// FY month order: Apr(3) … Dec(11), Jan(0) … Mar(2)
const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];
const bucketStyle = (b) =>
  b == null ? { background: 'var(--pnl-empty)' }
  : { background: `var(--pnl-b${b > 0 ? 'p' + b : b < 0 ? 'l' + -b : 'e'})` };
const Stat = ({ k, v, vc, vt, foot }) => (
  <div className="pnl-stat" style={{ display: 'flex', flexDirection: 'column' }}>
    <div className="lbl" style={{ margin: 0 }}>{k}</div>
    <div className={'vmd ' + (vc || '')} title={vt} style={{ marginTop: 5 }}>{v}</div>
    {foot ? <div className="fxc sub" style={{ marginTop: 8, gap: 8 }}>{foot}</div> : null}
  </div>
);
// Returns % — magnitude only; direction is colour-coded by the caller (cl), per the
// repo's "direction = colour, never a +/− glyph" rule.
const sPctG = (n) => Math.abs(n).toFixed(1) + '%';
// Profit factor display: the number, ∞ when there are wins but no losses, else —.
const pfDisplay = (s) => (s.profitFactor != null ? s.profitFactor.toFixed(2) : (s.winDays && !s.lossDays ? '∞' : '—'));

export default function PnlDashboard({ rows: rowsProp, summary = null, capital = null, deployed = null, liveMtm = null } = {}) {
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
          <div className="ctitle" style={{ margin: 0 }}>Trading Journal <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>F&amp;O</span></div>
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
  // The six stat cards recompute for the EXACT period in view (Day=day · Month=month ·
  // Year=FY · All=all-time) and the active broker — TWR returns on the deployed base.
  const statScope = view === 'all' ? series
    : view === 'year' ? series.filter((d) => fyOf(d.date) === periodKey)
    : view === 'month' ? series.filter((d) => d.date.slice(0, 7) === periodKey)
    : series.filter((d) => d.date === periodKey);
  const stats = summaryStats(statScope);
  // Deployed capital is configured per STRATEGY (own+client), not per broker — so a
  // single-broker filter has no attributable base (Dhan's P&L ÷ the whole S01 pool would
  // understate it). Show Returns% only for the combined view; per-broker → '—' (the
  // Analytics tab carries the per-strategy returns).
  const capBase = (deployed && activeBroker === 'all') ? deployed.all : null;
  const ret = returnsPct(statScope, capBase);
  const nav = (dir) => setCur((c) => ({ ...c, [view]: Math.min(lists[view].length - 1, Math.max(0, c[view] + dir)) }));
  // Calendar drill-down: click a day cell → open that day's Day view; click a month header → its Month view.
  const openDay = (iso) => { const i = lists.day.indexOf(iso); if (i >= 0) { setCur((c) => ({ ...c, day: i })); pick('day'); } };
  const openMonth = (ym) => { const i = lists.month.indexOf(ym); if (i >= 0) { setCur((c) => ({ ...c, month: i })); pick('month'); } };

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

      {/* capital line + verified/YTD summary — the journal's top context row */}
      {capital ? (
        <div className="pnl-capline">
          <span className="lbl" style={{ margin: 0 }}>{capital.label}</span>
          <span className="pnl-capval">{capital.value}</span>
          {capital.foot ? <span className="pnl-capfoot">{capital.foot}</span> : null}
        </div>
      ) : null}
      {summary ? <div className="pnl-summary">{summary}</div> : null}

      {/* ── controls: broker filter (drives the calendar AND recomputes the six cards) ── */}
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

      {/* ── stat panel — the SIX cards (3×2), recomputed per period × broker. HIDDEN on the
            Day view: the day panel below carries its own Gross/Charges/Net trio for that day,
            so the six would just duplicate it. Kept for Month/Year/All (no trio there). ── */}
      {view !== 'day' && (
      <div className="pnl-stats">
        <Stat k="Net realised" vc={cl(stats.net)} v={<SInrC n={stats.net} />} vt={sFull(stats.net)}
          foot={<><span className={cl(stats.gross)}>Gross {inrC(stats.gross)}</span><span style={{ color: 'var(--txt2)' }}>Charges {inrC(stats.charges)}</span></>} />
        <WinRateStat stats={stats} />
        <Stat k="Returns" vc={ret == null ? '' : cl(ret)} v={ret == null ? '—' : sPctG(ret)} vt="TWR on deployed capital"
          foot={activeBroker === 'all'
            ? <span style={{ color: 'var(--txt2)' }}>on {inrC(deployed?.all || 0)} deployed</span>
            : <span style={{ color: 'var(--txt3)' }}>per-broker capital n/a · see Analytics</span>} />
        <Stat k="Profit Factor" v={pfDisplay(stats)} vt="gross profit / gross loss"
          foot={<><span className="grn">profits {inrC(stats.winSum)}</span><span className="red">losses {inrC(Math.abs(stats.lossSum))}</span></>} />
        <MostLeastStat stats={stats} />
        <Stat k="Trading days" v={stats.tradingDays}
          foot={<><span>streak 🔥 {stats.bestStreak}</span><span>now {stats.currentStreak}{stats.currentStreakWin ? '' : ' (loss)'}</span></>} />
      </div>
      )}

      {/* ── period bar ── */}
      <div className="fxc pnl-periodbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="pnl-nav" onClick={() => nav(-1)} disabled={cur[view] <= 0} aria-label="Previous">‹</button>
          <span style={{ fontWeight: 600 }}>{periodLabel(view, periodKey)}</span>
          <button className="pnl-nav" onClick={() => nav(1)} disabled={cur[view] >= lists[view].length - 1} aria-label="Next">›</button>
        </div>
        {/* per-period Days/Charges/Net summary removed — already carried by the stat cards above */}
      </div>

      {/* ── view body ── */}
      <div style={{ padding: '4px 20px 18px' }}>
        {view === 'year' && <YearHeat fy={scopeFy} byDate={byDate} buckets={buckets} openDay={openDay} openMonth={openMonth} />}
        {view === 'month' && <MonthCal ym={periodKey} byDate={byDate} buckets={buckets} openDay={openDay} />}
        {view === 'day' && <DayPanel key={periodKey} date={periodKey} byDate={byDate} />}
        {view === 'all' && [...lists.year].reverse().map((fy) => (
          <div key={fy} style={{ marginBottom: 18 }}>
            <div className="lbl" style={{ margin: '0 0 6px' }}>{fy}</div>
            <YearHeat fy={fy} byDate={byDate} buckets={buckets} openDay={openDay} openMonth={openMonth} />
          </div>
        ))}
      </div>

      {view !== 'day' && <Legend />}
    </div>
  );
}

// The glance (net realised / charges / live MTM pills + an intraday curve) was fully removed
// 2026-07-05: those figures already live in the stat cards / F&O Positions card, and the sole
// intraday curve is the Day view's DayPanel. The Trading Journal now opens straight into the
// capital line + stat panel + calendar.

// ── view bodies ──
function YearHeat({ fy, byDate, buckets, openDay, openMonth }) {
  const baseY = 2000 + +fy.slice(3, 5); // FY 26-27 → 2026
  return (
    <div className="pnl-year">
      {FY_MONTHS.map((m0) => {
        const y = m0 >= 3 ? baseY : baseY + 1;
        const ym = `${y}-${String(m0 + 1).padStart(2, '0')}`;
        const weeks = monthMatrix(y, m0);
        let net = 0, has = false;
        weeks.flat().forEach((iso) => { const d = iso && byDate.get(iso); if (d) { net += d.net; has = true; } });
        return (
          <div key={m0} className="pnl-month">
            {/* month header → open that Month view (when the month has data) */}
            <div className="fxc" style={{ marginBottom: 6, cursor: has && openMonth ? 'pointer' : 'default' }}
              onClick={has && openMonth ? () => openMonth(ym) : undefined} title={has && openMonth ? `Open ${MON[m0]} ${y}` : ''}>
              <span className="sub" style={{ margin: 0, fontWeight: 600 }}>{MON[m0]}{m0 < 3 ? `'${String((baseY + 1) % 100)}` : ''}</span>
              <span className={'mono ' + (has ? cl(net) : '')} style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: has ? undefined : 'var(--txt3)' }}>
                {has ? <SInrF n={net} /> : '—'}
              </span>
            </div>
            <div className="pnl-grid">
              {weeks.flat().map((iso, i) => {
                const d = iso && byDate.get(iso);
                return (
                  <span key={i} className="pnl-cell"
                    style={{ ...(iso && byDate.has(iso) ? bucketStyle(buckets.get(iso)) : { background: iso ? 'var(--pnl-empty)' : 'transparent' }), cursor: d && openDay ? 'pointer' : 'default' }}
                    title={d ? `${prettyDate(iso)} · ${sFull(d.net)}` : (iso || '')}
                    onClick={d && openDay ? () => openDay(iso) : undefined} />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthCal({ ym, byDate, buckets, openDay }) {
  const y = +ym.slice(0, 4), m0 = +ym.slice(5, 7) - 1;
  const weeks = monthMatrix(y, m0);
  return (
    <div className="pnl-cal">
      {DOW.map((d) => <div key={d} className="pnl-dow">{d}</div>)}
      <div className="pnl-dow" style={{ textAlign: 'left', paddingLeft: 6 }}>Week</div>
      {weeks.map((w, wi) => (
        <Week key={wi} idx={wi} w={w} byDate={byDate} buckets={buckets} openDay={openDay} />
      ))}
    </div>
  );
}
function Week({ idx, w, byDate, buckets, openDay }) {
  let ws = 0, has = false;
  w.forEach((iso) => { const d = iso && byDate.get(iso); if (d) { ws += d.net; has = true; } });
  return (
    <>
      {w.map((iso, i) => {
        const d = iso && byDate.get(iso);
        return (
          <div key={i} className="pnl-daycell"
            style={{ ...(iso ? (d ? bucketStyle(buckets.get(iso)) : { background: 'var(--pnl-empty)' }) : { background: 'transparent', border: 'none' }), cursor: d && openDay ? 'pointer' : 'default' }}
            title={d ? `${prettyDate(iso)} · ${sFull(d.net)}` : (iso ? prettyDate(iso) : '')}
            onClick={d && openDay ? () => openDay(iso) : undefined}>
            {iso ? <span className="pnl-dn">{+iso.slice(8)}</span> : null}
            {d ? <span className={'pnl-dp ' + cl(d.net)}><SInrF n={d.net} /></span> : null}
          </div>
        );
      })}
      <div className="pnl-wk">
        <div className="lbl" style={{ margin: 0 }}>Wk {idx + 1}</div>
        <div className={'mono ' + (has ? cl(ws) : '')} style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: has ? undefined : 'var(--txt3)' }}>
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
  // Is this day baked into the committed archive this build ships? Seeded from the
  // hydrated archive (same build-time bundle the API imports); refreshed from the API's
  // `archived` flag on each poll. Drives the live-cache-only durability guard below.
  const [archived, setArchived] = useState(() => !!(APP.fnoIntraday?.days?.[date]?.length));
  useEffect(() => {
    if (!date) return;
    let on = true;
    const poll = async () => {
      try {
        const [res, niftyRes] = await Promise.all([
          fetch(`/api/intraday?date=${date}`, { cache: 'no-store' }),
          fetch(`/api/intraday?kind=nifty&date=${date}`, { cache: 'no-store' }),
        ]);
        if (on && res.ok) { const j = await res.json(); if (Array.isArray(j.tape)) setLiveTape(j.tape); if (Array.isArray(j.fills)) setFills(j.fills); if (typeof j.archived === 'boolean') setArchived(j.archived); }
        if (on && niftyRes.ok) { const j = await niftyRes.json(); if (Array.isArray(j.tape)) setCandles(j.tape); }
      } catch {}
    };
    poll();
    const id = date === todayIstIso() ? setInterval(poll, 12_000) : null;
    return () => { on = false; if (id) clearInterval(id); };
  }, [date]);
  const tape = liveTape != null ? liveTape : (APP.fnoIntraday?.days?.[date] || []);
  const mtmTape = toLiveMtmTape(tape);
  const pending = tape.some((p) => p.pending);
  // Durability guard: a PAST day that has data but isn't in this deployment's committed
  // archive lives only in the 3-day KV cache — flag it so a missed close-commit is visible
  // here instead of silently expiring. Today is legitimately cache-only until the evening
  // commit, so only past days qualify (ISO dates compare chronologically).
  const atRisk = tape.length > 0 && !archived && date < todayIstIso();
  // Flattened — contents sit directly in the view-body container (no nested .mini box,
  // which scaled oddly); the date + summary live in the period bar above, so no header here.
  return (
    <>
      {atRisk ? (
        <div role="status" style={{ display: 'flex', gap: 9, alignItems: 'flex-start', margin: '0 0 12px', padding: '9px 12px', borderRadius: 8, border: '.5px solid var(--warn-brd)', background: 'color-mix(in srgb, var(--sc-opt) 9%, transparent)', fontSize: 'var(--fs-xs)', color: 'var(--txt2)', lineHeight: 1.55 }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--sc-opt)', flexShrink: 0, marginTop: '0.4em' }} />
          <span><b style={{ color: 'var(--sc-opt)', fontWeight: 700 }}>Live-cache only.</b> This day isn&apos;t in the committed archive this build ships, so it survives only in the 3-day live cache and will vanish once that expires. Commit &amp; redeploy the intraday archive to keep it.</span>
        </div>
      ) : null}
      {mtmTape.length >= 2 ? <IntradayChart tape={mtmTape} candles={candles} pending={pending} fills={fills} ariaLabel="Live MTM" primaryLabel="Live MTM" /> : null}

      {d ? (
        <div className="g3" style={{ marginTop: 12 }}>
          <Mini k="Gross" v={<SInrF n={d.gross} />} vc={cl(d.gross)} />
          <Mini k="Charges" v={<SInrF n={d.charges} />} />
          <Mini k="Net realised" v={<SInrF n={d.net} />} vc={cl(d.net)} />
        </div>
      ) : (tape.length ? null : <div className="sub" style={{ marginTop: 12 }}>No trades captured this day.</div>)}

      {tape.length < 2 ? (
        <div className="sub" style={{ marginTop: 14, color: 'var(--txt3)', lineHeight: 1.6 }}>
          The live MTM curve (green above 0 / red below) draws once the capture has logged a few points — it snapshots open MTM through the session.
        </div>
      ) : null}
    </>
  );
}

const Mini = ({ k, v, vc }) => (
  <div className="csm"><div className="sub" style={{ margin: 0 }}>{k}</div><div className={'vsm ' + (vc || '')} style={{ marginTop: 4 }}>{v}</div></div>
);

function toLiveMtmTape(tape) {
  if (!Array.isArray(tape)) return [];
  return tape.map((p) => {
    if (!p || p.mtm == null || !Number.isFinite(+p.mtm)) return p;
    return {
      ...p,
      net: +p.mtm,
      dhan: p.dhanMtm ?? null,
      upstox: p.upstoxMtm ?? null,
      fyers: p.fyersMtm ?? null,
    };
  });
}

function PeriodSummary({ view, periodKey, byDate, series, liveToday }) {
  const sub = view === 'all' ? series
    : view === 'year' ? series.filter((d) => fyOf(d.date) === periodKey)
    : view === 'month' ? series.filter((d) => d.date.slice(0, 7) === periodKey)
    : series.filter((d) => d.date === periodKey);
  const s = summaryStats(sub);
  // Today has no realised LEDGER row until the evening sync — so show LIVE figures, not a
  // misleading ₹0. The post-2026-06-25 capture splits realised (closed legs) vs open MTM;
  // older points carry net only, so fall back to a single live figure.
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
        <span><span className="lbl">Net realised</span> <span className={'mono ' + cl(liveToday.realised)}><SInrF n={liveToday.realised} /></span></span>
      </div>
    );
  }
  if (liveDay) {
    return (
      <div className="pnl-psum">
        <Charges n={dayCharges} />
        <span><span className="lbl">Live MTM</span> <span className={'mono ' + cl(liveToday.net)}><SInrF n={liveToday.net} /></span></span>
      </div>
    );
  }
  return (
    <div className="pnl-psum">
      <span><span className="lbl">Days</span> <span className="mono">{s.tradingDays}</span></span>
      <Charges n={s.charges} />
      <span><span className="lbl">Net realised</span> <span className={'mono ' + cl(s.net)}><SInrF n={s.net} /></span></span>
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

// Win rate — % reads as a left-aligned value like every other stat card; the donut ring is
// a small accent tucked in the card's top corner. Footers label the win/loss counts that
// drive the %. (winPct is a rate, not a gain/loss — neutral colour, no direction class.)
function WinRateStat({ stats }) {
  return (
    <div className="pnl-stat" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div className="lbl" style={{ margin: 0 }}>Win rate</div>
      <div className="vmd" style={{ marginTop: 5 }}>{stats.winPct}%</div>
      <span className="pnl-wr-corner" aria-hidden="true"><Donut pct={stats.winPct} size="100%" /></span>
      {/* labelled win / loss counts (colour-coded) — they feed the % above */}
      <div className="fxc sub pnl-wr-foot">
        <span className="grn" style={{ fontWeight: 700 }}>Wins {stats.winDays}</span>
        <span className="red" style={{ fontWeight: 700 }}>Losses {stats.lossDays}</span>
      </div>
    </div>
  );
}

// Most & Least profitable day shown together — exact ₹ on hover (title), foot = the two dates.
// With a single P&L day (or most == least, i.e. one date is both best and worst) there's
// nothing to contrast, so it collapses to ONE "profitable day" stat (value still colour-coded).
function MostLeastStat({ stats }) {
  const m = stats.mostProfit, l = stats.leastProfit;
  const single = m && l && m.date === l.date;
  if (single) {
    return (
      <div className="pnl-stat" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="lbl" style={{ margin: 0 }}>Profitable day</div>
        <div className={'vmd ' + cl(m.net)} title={sFull(m.net)} style={{ marginTop: 5 }}><SInrC n={m.net} /></div>
        <div className="fxc sub" style={{ marginTop: 8, gap: 8 }}><span>{prettyDate(m.date)}</span></div>
      </div>
    );
  }
  return (
    <div className="pnl-stat" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="lbl" style={{ margin: 0 }}>Most / Least profitable day</div>
      {/* most (left) ↔ least (right) — split by alignment, not a "/" separator, mirroring the dates below */}
      <div className="vmd" title={[m && `most ${sFull(m.net)}`, l && `least ${sFull(l.net)}`].filter(Boolean).join(' · ')} style={{ marginTop: 5, display: 'flex', justifyContent: 'space-between', gap: 14 }}>
        <span className={m ? cl(m.net) : ''}>{m ? <SInrC n={m.net} /> : '—'}</span>
        <span className={l ? cl(l.net) : ''}>{l ? <SInrC n={l.net} /> : '—'}</span>
      </div>
      <div className="fxc sub" style={{ marginTop: 8, gap: 8 }}>
        <span>{m ? prettyDate(m.date) : '—'}</span><span>{l ? prettyDate(l.date) : '—'}</span>
      </div>
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
      {showPct ? <text x="14" y="14.5" textAnchor="middle" dominantBaseline="central" fill="var(--txt)" style={{ fontSize: '8.5px', fontWeight: 700 }}>{pct}%</text> : null}
    </svg>
  );
}

// Live figure for today, polled from the intraday tape (broker-aware). Hidden until a
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
