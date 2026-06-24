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
  dailySeries, summaryStats, quantileBuckets, monthMatrix, monthlyRollup, fyOf,
  scaleIntraday,
} from '../../lib/pnlDaily';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// FY month order: Apr(3) … Dec(11), Jan(0) … Mar(2)
const FY_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];
const bucketStyle = (b) =>
  b == null ? { background: 'var(--pnl-empty)' }
  : { background: `var(--pnl-b${b > 0 ? 'p' + b : b < 0 ? 'l' + -b : 'e'})` };
const Stat = ({ k, v, vc, sub }) => (
  <div className="pnl-stat">
    <div className="lbl" style={{ margin: 0 }}>{k}</div>
    <div className={'vmd ' + (vc || '')} style={{ marginTop: 5 }}>{v}</div>
    {sub ? <div className="sub" style={{ marginTop: 3 }}>{sub}</div> : null}
  </div>
);

export default function PnlDashboard({ rows: rowsProp } = {}) {
  const rows = rowsProp || APP.fnoLedger?.rows || [];
  const series = useMemo(() => dailySeries(rows), [rows]);
  const byDate = useMemo(() => new Map(series.map((d) => [d.date, d])), [series]);
  const buckets = useMemo(() => quantileBuckets(series), [series]);

  const [view, setView] = useState('year');
  useEffect(() => {
    try { const v = localStorage.getItem('nwTracker.pnlView'); if (['day', 'month', 'year'].includes(v)) setView(v); } catch {}
  }, []);
  const pick = (v) => { setView(v); try { localStorage.setItem('nwTracker.pnlView', v); } catch {} };

  // Period lists (newest last) + a cursor per view; default to the latest data.
  const lists = useMemo(() => {
    const fys = [...new Set(series.map((d) => fyOf(d.date)))];
    const months = [...new Set(series.map((d) => d.date.slice(0, 7)))];
    const days = series.map((d) => d.date);
    return { year: fys, month: months, day: days };
  }, [series]);
  const [cur, setCur] = useState({ year: 0, month: 0, day: 0 });
  // Snap each cursor to the newest entry once data is known.
  useEffect(() => {
    setCur({ year: Math.max(0, lists.year.length - 1), month: Math.max(0, lists.month.length - 1), day: Math.max(0, lists.day.length - 1) });
  }, [lists]);

  if (!series.length) {
    return (
      <div className="card">
        <div className="ctitle">P&amp;L Dashboard</div>
        <div className="sub">No captured F&amp;O days yet — the realised ledger fills as the daily broker sync runs.</div>
      </div>
    );
  }

  const periodKey = lists[view][Math.min(cur[view], lists[view].length - 1)] || lists[view][lists[view].length - 1];
  // The FY in scope drives the top stat panel + monthly table regardless of view.
  const scopeFy = view === 'year' ? periodKey
    : view === 'month' ? fyOf(periodKey + '-01')
    : fyOf(periodKey);
  const fySeries = series.filter((d) => fyOf(d.date) === scopeFy);
  const stats = summaryStats(fySeries);
  const nav = (dir) => setCur((c) => ({ ...c, [view]: Math.min(lists[view].length - 1, Math.max(0, c[view] + dir)) }));

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* ── header ── */}
      <div className="fxc" style={{ padding: '16px 20px 12px' }}>
        <div className="ctitle" style={{ margin: 0 }}>P&amp;L Dashboard <span className="badge bb" style={{ fontSize: 'var(--fs-2xs)' }}>F&amp;O · realised</span></div>
        <div className="seg" role="tablist" aria-label="P&L period">
          {['day', 'month', 'year'].map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => pick(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── stat panel (FY in scope) ── */}
      <div className="pnl-stats">
        <Stat k="Net P&L" vc={cl(stats.net)} v={<SInrF n={stats.net} />} sub={`Gross ${inrC(stats.gross)} · charges ${inrC(stats.charges)}`} />
        <Stat k="Win rate" v={`${stats.winPct}%`} sub={`${stats.winDays} win · ${stats.lossDays} loss days`} />
        <Stat k="Most profitable day" vc="grn"
          v={stats.mostProfit ? <SInrF n={stats.mostProfit.net} /> : '—'}
          sub={stats.mostProfit ? prettyDate(stats.mostProfit.date) : ''} />
        <Stat k="Orders" v={stats.orders} sub={`${stats.tradingDays ? (stats.orders / stats.tradingDays).toFixed(1) : 0} avg/day`} />
        <Stat k="Trading days" v={stats.tradingDays}
          sub={`streak 🔥 ${stats.bestStreak} · now ${stats.currentStreak}${stats.currentStreakWin ? '' : ' loss'}`} />
      </div>

      {/* ── period bar ── */}
      <div className="fxc pnl-periodbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="pnl-nav" onClick={() => nav(-1)} disabled={cur[view] <= 0} aria-label="Previous">‹</button>
          <span style={{ fontWeight: 600 }}>{periodLabel(view, periodKey)}</span>
          <button className="pnl-nav" onClick={() => nav(1)} disabled={cur[view] >= lists[view].length - 1} aria-label="Next">›</button>
        </div>
        <PeriodSummary view={view} periodKey={periodKey} byDate={byDate} series={series} />
      </div>

      {/* ── view body ── */}
      <div style={{ padding: '4px 20px 18px' }}>
        {view === 'year' && <YearHeat fy={scopeFy} byDate={byDate} buckets={buckets} />}
        {view === 'month' && <MonthCal ym={periodKey} byDate={byDate} buckets={buckets} />}
        {view === 'day' && <DayPanel date={periodKey} byDate={byDate} />}
      </div>

      {view !== 'day' && <Legend />}

      {/* ── monthly table (FY in scope) ── */}
      <div style={{ padding: '6px 20px 18px' }}>
        <div className="lbl" style={{ marginBottom: 6 }}>Monthly trades — {scopeFy}</div>
        <table className="tbl">
          <thead><tr><th>Month</th><th className="ra">Orders</th><th className="ra">Days</th><th className="ra">Gross</th><th className="ra">Charges</th><th className="ra">Net</th></tr></thead>
          <tbody>
            {monthlyRollup(fySeries).map((m) => (
              <tr key={m.ym}>
                <td>{m.label}</td>
                <td className="ra mono">{m.orders}</td>
                <td className="ra mono">{m.days}</td>
                <td className={'ra mono ' + cl(m.gross)}><SInrF n={m.gross} /></td>
                <td className="ra mono red"><SInrF n={m.charges} /></td>
                <td className={'ra mono ' + cl(m.net)}><SInrF n={m.net} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const [liveTape, setLiveTape] = useState(null);
  useEffect(() => {
    setLiveTape(null);
    if (!date) return;
    let on = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/intraday?date=${date}`, { cache: 'no-store' });
        if (!res.ok || !on) return;
        const j = await res.json();
        if (on && Array.isArray(j.tape)) setLiveTape(j.tape);
      } catch {}
    };
    poll();
    const id = date === todayIstIso() ? setInterval(poll, 12_000) : null;
    return () => { on = false; if (id) clearInterval(id); };
  }, [date]);
  const tape = liveTape != null ? liveTape : (APP.fnoIntraday?.days?.[date] || []);
  const pending = tape.some((p) => p.pending);
  return (
    <div className="mini" style={{ padding: '16px 18px' }}>
      <div className="fxc">
        <div className="lbl" style={{ margin: 0 }}>{tape.length ? 'P&L' : 'Realised P&L'} · {prettyDate(date)}</div>
        <div className={'vmd ' + (d ? cl(d.net) : '')}>{d ? <SInrF n={d.net} /> : '—'}</div>
      </div>

      {tape.length >= 2 ? <IntradayChart tape={tape} pending={pending} /> : null}

      {d ? (
        <div className="g4" style={{ marginTop: 12 }}>
          <Mini k="Gross" v={<SInrF n={d.gross} />} vc={cl(d.gross)} />
          <Mini k="Charges" v={<SInrF n={d.charges} />} vc="red" />
          <Mini k="Orders" v={d.orders} />
          <Mini k="Net" v={<SInrF n={d.net} />} vc={cl(d.net)} />
        </div>
      ) : <div className="sub">No trades captured this day.</div>}

      {tape.length < 2 ? (
        <div className="sub" style={{ marginTop: 14, color: 'var(--txt3)', lineHeight: 1.6 }}>
          The intraday P&amp;L curve (green above 0 / red below) draws once the live capture has logged a few points — it snapshots realised + open MTM every few minutes through the session.
        </div>
      ) : null}
    </div>
  );
}

// Intraday tape → green-above-0 / red-below-0 line with a dashed line + pill at the
// CURRENT P&L level (the live value), per the agreed Day-view spec. No index/NIFTY
// reference; a faint target line is drawn only when the API flagged a pending order.
function IntradayChart({ tape, pending }) {
  const W = 660, H = 200;
  const g = scaleIntraday(tape, W, H);
  if (!g) return null;
  const d = g.pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const uid = `pnl-${tape.length}-${Math.round(g.curY)}`;
  const curColor = g.ud ? 'var(--grn)' : 'var(--red)';
  const first = tape[0].t, last = tape[tape.length - 1].t;
  const mid = tape[Math.floor(tape.length / 2)].t;
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" height="auto" style={{ marginTop: 12, display: 'block' }} role="img" aria-label="Intraday P&L">
      <clipPath id={`up-${uid}`}><rect x="0" y="0" width={W} height={g.zeroY} /></clipPath>
      <clipPath id={`dn-${uid}`}><rect x="0" y={g.zeroY} width={W} height={H - g.zeroY} /></clipPath>
      <line x1="0" y1={g.zeroY} x2={W} y2={g.zeroY} stroke="var(--txt3)" strokeWidth=".5" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke="var(--grn)" strokeWidth="2" clipPath={`url(#up-${uid})`} />
      <path d={d} fill="none" stroke="var(--red)" strokeWidth="2" clipPath={`url(#dn-${uid})`} />
      {/* dashed reference line + pill at the current (latest) P&L */}
      <line x1="0" y1={g.curY} x2={W} y2={g.curY} stroke={curColor} strokeWidth=".7" strokeDasharray="4 3" opacity=".55" />
      <circle cx={g.pts[g.pts.length - 1].x} cy={g.curY} r="3.5" fill={curColor} />
      {pending ? <line x1="0" y1={g.zeroY - 0.1} x2={W} y2={g.zeroY - 0.1} stroke="var(--acc)" strokeWidth=".7" strokeDasharray="6 4" opacity=".5" /> : null}
      <text x="2" y={H + 16} className="pnl-axt">{first}</text>
      <text x={W / 2} y={H + 16} className="pnl-axt" textAnchor="middle">{mid}</text>
      <text x={W - 2} y={H + 16} className="pnl-axt" textAnchor="end">{last}{pending ? ' · pending order' : ''}</text>
    </svg>
  );
}
const Mini = ({ k, v, vc }) => (
  <div className="csm"><div className="sub" style={{ margin: 0 }}>{k}</div><div className={'vsm ' + (vc || '')} style={{ marginTop: 4 }}>{v}</div></div>
);

function PeriodSummary({ view, periodKey, byDate, series }) {
  const sub = view === 'year' ? series.filter((d) => fyOf(d.date) === periodKey)
    : view === 'month' ? series.filter((d) => d.date.slice(0, 7) === periodKey)
    : series.filter((d) => d.date === periodKey);
  const s = summaryStats(sub);
  return (
    <div className="pnl-psum">
      <span><span className="lbl">Orders</span> <span className="mono">{s.orders}</span></span>
      <span><span className="lbl">Days</span> <span className="mono">{s.tradingDays}</span></span>
      <span><span className="lbl">Charges</span> <span className="mono red"><SInrF n={s.charges} /></span></span>
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
      <span className="pnl-sw" style={{ background: 'var(--pnl-be)' }} />
      <span className="pnl-sw" style={{ background: 'var(--pnl-bp1)' }} />
      <span className="pnl-sw" style={{ background: 'var(--pnl-bp2)' }} />
      <span className="pnl-sw" style={{ background: 'var(--pnl-bp3)' }} />
      <span>Profit</span>
      <span style={{ marginLeft: 'auto', color: 'var(--txt3)' }}>intensity ∝ your own daily range</span>
    </div>
  );
}

const prettyDate = (iso) => `${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
// Today's date in IST (the market's timezone), for deciding when to keep polling.
const todayIstIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const periodLabel = (view, key) =>
  view === 'year' ? key
  : view === 'month' ? `${MON[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`
  : prettyDate(key);
