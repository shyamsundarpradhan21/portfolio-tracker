'use client';

// Net-worth growth tracker + projection scrubber, one continuous timeline.
//
// At rest (t = 0) the chart is pure ledger-true history with TODAY pinned at
// the extreme right; below it sit D/W/M/Y/Max growth cards (clicking one sets
// the visible history window), a humanized summary sentence and today's
// allocation strip. Scrubbing (or playing) extends the x-domain to today + t
// years: the today seam slides left as the projection fan unfolds to the
// right. The fan is the shared monthly model (lib/projection) — the active
// scenario draws as a bold solid line with a shaded fill, the other two as
// dotted lines; Conservative / Base / Optimistic select as tabs.
//
// The BASE rate is not a fixed assumption: it is the live money-weighted XIRR
// of the asset book, derived from snapshot invested-capital deltas (fallback:
// PROJECTION's base rate while history is too short). Cons/Opt bracket it at
// ∓3 pts. Native SVG throughout — no chart library.

import { useMemo, useRef, useState, useEffect, memo } from 'react';
import { PROJECTION, FDS } from '../portfolio';
import { simMonthly } from '../lib/projection';
import { xirr } from '../lib/calc';

const SC_META = {
  cons: { tone: 'var(--sc-cons)', name: 'Conservative' },
  base: { tone: 'var(--sc-base)', name: 'Base · XIRR' },
  opt:  { tone: 'var(--sc-opt)',  name: 'Optimistic' },
};
const RANGES = [
  { key: 'D', days: 1 }, { key: 'W', days: 7 }, { key: 'M', days: 30 },
  { key: 'Y', days: 365 }, { key: 'Max', days: null },
];
const MILESTONES = [1e7, 2e7, 5e7, 1e8]; // 1 / 2 / 5 / 10 Cr
const RETIRE_ISO = '2055-03-31';

const W = 1100, H = 300, PADL = 46, PADR = 14, PADT = 26, PADB = 22;

// unsigned ₹ Cr/L formatter (sign and color are applied by the caller)
const cr = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return '₹' + (a / 1e5).toFixed(2) + ' L';
  return '₹' + Math.round(a).toLocaleString('en-IN');
};
const crShort = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (a / 1e7).toFixed(a >= 1e8 ? 0 : 1) + 'Cr';
  if (a >= 1e5) return '₹' + Math.round(a / 1e5) + 'L';
  return '₹' + Math.round(a / 1e3) + 'k';
};
const ms = (iso) => new Date(iso + 'T00:00:00Z').getTime();
const monYr = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const YEAR_MS = 365.25 * 864e5;

function ProjectionTab({ nw, loan, sleeves, baseYear, invested0, snapshots }) {
  const [t, setT] = useState(0);            // scrub position, years (0 = at rest)
  const [sc, setSc] = useState('base');     // active scenario tab
  const [range, setRange] = useState('Max');// history window (at-rest cards)
  const [playing, setPlaying] = useState(false);
  const raf = useRef(null);
  const MAXY = PROJECTION.horizonYears;

  const fdCeiling = useMemo(
    () => FDS.filter((f) => f.status !== 'closed').reduce((a, f) => a + f.principal, 0),
    [],
  );

  // ── history rows ──────────────────────────────────────────────────────────
  const hist = useMemo(
    () => (snapshots || []).filter((s) => s && s.d && Number.isFinite(s.nw)),
    [snapshots],
  );

  // ── live money-weighted XIRR of the asset book ────────────────────────────
  // Cashflows = invested-capital deltas between snapshots (deployments out),
  // terminal value = the asset book today. Needs ≥ ~3 months of history to be
  // meaningful; otherwise fall back to the configured base rate.
  const liveXirr = useMemo(() => {
    if (hist.length < 2) return null;
    const first = hist[0], last = hist[hist.length - 1];
    if (ms(last.d) - ms(first.d) < 90 * 864e5) return null;
    const cfs = [{ date: new Date(first.d), amount: -(first.invested || 0) }];
    let prev = first.invested || 0;
    for (let i = 1; i < hist.length; i++) {
      const dep = (hist[i].invested || 0) - prev;
      if (Math.abs(dep) > 1) cfs.push({ date: new Date(hist[i].d), amount: -dep });
      prev = hist[i].invested || 0;
    }
    cfs.push({ date: new Date(last.d), amount: last.assets ?? last.nw ?? 0 });
    const r = xirr(cfs);
    return r != null && isFinite(r) && r > -0.5 && r < 2 ? r : null;
  }, [hist]);

  // Scenario rates: base rides the live XIRR; cons/opt bracket it at ∓3 pts.
  const rates = useMemo(() => {
    const fallback = PROJECTION.scenarios.find((s) => s.key === 'base')?.rate ?? 0.12;
    const base = liveXirr ?? fallback;
    return { cons: Math.max(0.02, base - 0.03), base, opt: base + 0.03 };
  }, [liveXirr]);

  // ── forward model (monthly resolution, all three scenarios) ──────────────
  const model = useMemo(() => {
    const base = nw || 0;
    const inv0 = invested0 != null ? invested0 : base;
    const months = MAXY * 12;
    const arr = {};
    for (const k of ['cons', 'base', 'opt']) arr[k] = simMonthly(rates[k], base, inv0, months);

    // milestone crossing years on the base curve (fractional)
    const crossings = [];
    for (const target of MILESTONES) {
      if (base >= target) continue;
      const i = arr.base.corpus.findIndex((c) => c >= target);
      if (i > 0) crossings.push({ value: target, year: i / 12 });
    }

    // allocation drift — same rules as before (scale / capped / target)
    const assetTotal0 = sleeves.reduce((a, s) => a + (s.value || 0), 0) || (base + loan);
    const byKey = {}; sleeves.forEach((s) => { byKey[s.key] = s; });
    const startShare = {}; sleeves.forEach((s) => { startShare[s.key] = (s.value || 0) / assetTotal0; });
    const scaleKeys = sleeves.filter((s) => (PROJECTION.allocRules[s.key]?.rule || 'scale') === 'scale').map((s) => s.key);
    const scaleSum = scaleKeys.reduce((a, k) => a + (byKey[k].value || 0), 0) || 1;
    const allocAt = (y) => {
      const corpus = arr[sc].corpus[Math.min(arr[sc].corpus.length - 1, Math.round(y * 12))];
      const assets = corpus + loan;
      const out = {}; let fixed = 0;
      sleeves.forEach((s) => {
        const r = PROJECTION.allocRules[s.key] || { rule: 'scale' };
        if (r.rule === 'capped') {
          const ceil = r.ceiling != null ? r.ceiling : fdCeiling;
          out[s.key] = Math.min(ceil, (s.value || 0) + (ceil - (s.value || 0)) * Math.min(1, y / (r.rampYears || 2.5)));
          fixed += out[s.key];
        } else if (r.rule === 'target') {
          const share = startShare[s.key] + (r.target - startShare[s.key]) * Math.min(1, y / (r.rampYears || 4));
          out[s.key] = Math.max(0, share) * assets; fixed += out[s.key];
        }
      });
      const residual = Math.max(0, assets - fixed);
      scaleKeys.forEach((k) => { out[k] = residual * ((byKey[k].value || 0) / scaleSum); });
      return { assets, out };
    };
    return { base, inv0, arr, crossings, allocAt };
  }, [nw, loan, sleeves, MAXY, fdCeiling, invested0, rates, sc]);

  const sampleAt = (a, yr) => {
    const m = yr * 12, i = Math.floor(m), f = m - i;
    if (i >= a.length - 1) return a[a.length - 1];
    return a[i] + (a[i + 1] - a[i]) * f;
  };

  // ── growth cards (at rest): change over D/W/M/Y/Max windows ──────────────
  const growth = useMemo(() => {
    if (hist.length < 2) return [];
    const last = hist[hist.length - 1];
    const liveNw = nw ?? last.nw;
    return RANGES.map((r) => {
      let ref = hist[0];
      if (r.days != null) {
        const cutoff = ms(last.d) - r.days * 864e5;
        for (let i = hist.length - 1; i >= 0; i--) if (ms(hist[i].d) <= cutoff) { ref = hist[i]; break; }
      }
      const chg = liveNw - (ref.nw ?? 0);
      const pct = ref.nw > 0 ? (chg / ref.nw) * 100 : 0;
      return { key: r.key, chg, pct };
    });
  }, [hist, nw]);

  // ── visible history (windowed by the selected card) ───────────────────────
  const pts = useMemo(() => {
    if (!hist.length) return [];
    const r = RANGES.find((x) => x.key === range);
    if (!r || r.days == null) return hist;
    const cutoff = ms(hist[hist.length - 1].d) - r.days * 864e5;
    const f = hist.filter((s) => ms(s.d) >= cutoff);
    return f.length >= 2 ? f : hist.slice(-2);
  }, [hist, range]);

  // ── play loop ─────────────────────────────────────────────────────────────
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  const stopPlay = () => { setPlaying(false); if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; } };
  const startPlay = () => {
    setPlaying(true);
    const SPEED = MAXY / 9000; // full horizon over ~9s
    let last = performance.now();
    const tick = (now) => {
      const dt = now - last; last = now;
      setT((prev) => {
        const next = Math.min(MAXY, prev + dt * SPEED);
        if (next >= MAXY) { setPlaying(false); raf.current = null; return MAXY; }
        raf.current = requestAnimationFrame(tick);
        return next;
      });
    };
    setT((prev) => (prev >= MAXY ? 0 : prev));
    raf.current = requestAnimationFrame(tick);
  };

  if (hist.length < 2) return null; // HistoryCurve already shows the empty state

  // ── geometry: one x-domain across history + unfolded future ──────────────
  const scrubbing = t > 0.001;
  const first = pts[0], lastH = pts[pts.length - 1];
  const histMs = Math.max(864e5, ms(lastH.d) - ms(first.d));
  const futMs = t * YEAR_MS;
  // today seam slides left as the fan unfolds; history never thinner than 15%
  const histFrac = scrubbing ? Math.max(0.15, histMs / (histMs + futMs)) : 1;
  const plotW = W - PADL - PADR;
  const xToday = PADL + plotW * histFrac;
  const xHist = (iso) => PADL + ((ms(iso) - ms(first.d)) / histMs) * (xToday - PADL);
  const xFut = (yr) => xToday + (t > 0 ? (yr / t) * (W - PADR - xToday) : 0);

  const liveNw = nw ?? lastH.nw;
  const yMax = Math.max(
    1,
    ...pts.map((s) => Math.max(s.nw ?? 0, s.invested ?? 0)),
    liveNw,
    scrubbing ? sampleAt(model.arr.opt.corpus, t) : 0,
  ) * 1.06;
  const Y = (v) => PADT + (1 - Math.max(0, v) / yMax) * (H - PADT - PADB);

  // history paths
  const histNw = pts.map((s) => `${xHist(s.d).toFixed(1)},${Y(s.nw ?? 0).toFixed(1)}`);
  const histInv = pts.map((s) => `${xHist(s.d).toFixed(1)},${Y(s.invested ?? 0).toFixed(1)}`);
  const baseLineY = (H - PADB).toFixed(1);
  const histNwPath = 'M' + histNw.join(' L');
  const histInvPath = 'M' + histInv.join(' L');
  const histNwFill = histNwPath + ` L${xToday.toFixed(1)},${baseLineY} L${PADL},${baseLineY} Z`;
  const histInvFill = histInvPath + ` L${xToday.toFixed(1)},${baseLineY} L${PADL},${baseLineY} Z`;

  // future paths (only when scrubbing) — sample ≤120 points across [0, t]
  let futPaths = null;
  if (scrubbing) {
    const N = Math.min(120, Math.max(12, Math.ceil(t * 12)));
    const seq = (arr) => {
      const p = [];
      for (let i = 0; i <= N; i++) {
        const yr = (i / N) * t;
        p.push(`${xFut(yr).toFixed(1)},${Y(sampleAt(arr, yr)).toFixed(1)}`);
      }
      return p;
    };
    const cons = seq(model.arr.cons.corpus), base = seq(model.arr.base.corpus),
      opt = seq(model.arr.opt.corpus), inv = seq(model.arr.base.invested);
    const active = seq(model.arr[sc].corpus);
    futPaths = {
      cons: 'M' + cons.join(' L'),
      base: 'M' + base.join(' L'),
      opt: 'M' + opt.join(' L'),
      inv: 'M' + inv.join(' L'),
      fan: 'M' + opt.join(' L') + ' L' + [...cons].reverse().join(' L') + ' Z',
      activeFill: 'M' + active.join(' L') + ` L${(W - PADR).toFixed(1)},${baseLineY} L${xToday.toFixed(1)},${baseLineY} Z`,
      invFill: 'M' + inv.join(' L') + ` L${(W - PADR).toFixed(1)},${baseLineY} L${xToday.toFixed(1)},${baseLineY} Z`,
    };
  }

  // y gridlines (4)
  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => yMax * f / 1.06);

  // readouts at the scrub head
  const yr = Math.round(t);
  const deflate = Math.pow(1 + PROJECTION.inflation, t);
  const corpusNow = sampleAt(model.arr[sc].corpus, t);
  const investedNow = sampleAt(model.arr.base.invested, t);
  const growthNow = corpusNow - investedNow;
  const alloc = model.allocAt(scrubbing ? t : 0);
  const allocTotal = sleeves.reduce((a, s) => a + (alloc.out[s.key] || 0), 0) || 1;

  // retirement flag position (only once the scrub reaches it)
  const retireYr = (ms(RETIRE_ISO) - ms(lastH.d)) / YEAR_MS;
  const showRetire = scrubbing && t >= retireYr - 0.01 && retireYr > 0;

  // humanized sentences
  const maxRow = growth.find((g) => g.key === 'Max');
  const histGains = liveNw - (lastH.invested ?? model.inv0);
  const xirrPct = liveXirr != null ? (liveXirr * 100).toFixed(1) : null;
  const ratePct = (rates[sc] * 100).toFixed(1);

  const onScrub = (e) => { stopPlay(); setT(+e.target.value); };
  const onPlay = () => (playing ? stopPlay() : startPlay());
  const reset = () => { stopPlay(); setT(0); };

  return (
    <div className="card sec pjx">
      <div className="fxc" style={{ alignItems: 'baseline' }}>
        <div className="lbl" style={{ margin: 0 }}>
          {scrubbing ? 'Net worth · projected' : 'Net worth · growth'}
        </div>
        <div className="sub" style={{ margin: 0, fontFamily: 'var(--mono)' }}>
          {monYr(first.d)} → {scrubbing ? baseYear + yr : 'today'}
          {scrubbing && (
            <button className="pjx-reset" onClick={reset} title="Back to today">⟲ today</button>
          )}
        </div>
      </div>

      {/* ── the chart ── */}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 10, display: 'block' }}>
        <defs>
          <linearGradient id="pjx-nwfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--grn)" stopOpacity=".20" />
            <stop offset="100%" stopColor="var(--grn)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="pjx-invfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--txt3)" stopOpacity=".16" />
            <stop offset="100%" stopColor="var(--txt3)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="pjx-scfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--grn)" stopOpacity=".14" />
            <stop offset="100%" stopColor="var(--grn)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* grid + y labels */}
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PADL} y1={Y(v)} x2={W - PADR} y2={Y(v)} stroke="var(--brd2)" strokeWidth=".5" />
            <text x={4} y={Y(v) + 3} fontSize="10" fill="var(--txt3)" fontFamily="var(--mono)">{crShort(v)}</text>
          </g>
        ))}

        {/* history: invested fill+line, NW fill+line */}
        <path d={histInvFill} fill="url(#pjx-invfill)" />
        <path d={histNwFill} fill="url(#pjx-nwfill)" />
        <path d={histInvPath} fill="none" stroke="var(--txt3)" strokeWidth="1.3" strokeDasharray="3 4" />
        <path d={histNwPath} fill="none" stroke="var(--grn)" strokeWidth="2.2" strokeLinejoin="round" />

        {/* TODAY seam */}
        <line x1={xToday} y1={PADT - 12} x2={xToday} y2={H - PADB + 6} stroke="var(--acc)"
          strokeOpacity=".45" strokeWidth="1" strokeDasharray={scrubbing ? '2 3' : 'none'} />
        <circle cx={xToday} cy={Y(liveNw)} r={scrubbing ? 4 : 5.5} fill="var(--grn)">
          {!scrubbing && <animate attributeName="opacity" values="1;.5;1" dur="2s" repeatCount="indefinite" />}
        </circle>
        {!scrubbing && <circle cx={xToday} cy={Y(liveNw)} r="10" fill="none" stroke="var(--grn)" strokeOpacity=".35" strokeWidth="2" />}
        <text x={scrubbing ? xToday : xToday - 8} y={PADT - 16}
          fontSize="9.5" fill="var(--acc)" fontWeight="700" fontFamily="var(--mono)"
          textAnchor={scrubbing ? 'middle' : 'end'}>
          TODAY{!scrubbing && ` · ${cr(liveNw)}`}
        </text>

        {/* projection fan */}
        {futPaths && (
          <>
            <path d={futPaths.fan} fill="var(--sc-base)" opacity=".06" />
            <path d={futPaths.invFill} fill="url(#pjx-invfill)" />
            <path d={futPaths.activeFill} fill="url(#pjx-scfill)" />
            <path d={futPaths.inv} fill="none" stroke="var(--txt3)" strokeWidth="1.3" strokeDasharray="3 4" />
            {['cons', 'base', 'opt'].map((k) => (
              <path key={k} d={futPaths[k]} fill="none" stroke={SC_META[k].tone}
                strokeWidth={sc === k ? 2.8 : 1.6}
                strokeDasharray={sc === k ? 'none' : '5 4'}
                opacity={sc === k ? 1 : 0.55} strokeLinejoin="round" />
            ))}

            {/* milestone markers that have entered view (base curve) */}
            {model.crossings.filter((c) => c.year <= t).map((c) => (
              <g key={c.value}>
                <circle cx={xFut(c.year)} cy={Y(sampleAt(model.arr.base.corpus, c.year))} r="3.5"
                  fill="none" stroke="var(--txt2)" strokeWidth="1.5" />
                <text x={xFut(c.year)} y={Y(sampleAt(model.arr.base.corpus, c.year)) + 17}
                  fontSize="9.5" fill="var(--txt2)" textAnchor="middle" fontFamily="var(--mono)">
                  {crShort(c.value)} · {baseYear + Math.round(c.year)}
                </text>
              </g>
            ))}

            {/* retirement flag */}
            {showRetire && (
              <g>
                <line x1={xFut(retireYr)} y1={PADT - 6} x2={xFut(retireYr)} y2={H - PADB} stroke="var(--acc)" strokeOpacity=".35" strokeWidth="1" />
                <text x={xFut(retireYr)} y={PADT - 10} fontSize="10" fill="var(--acc)" textAnchor="middle" fontWeight="700">⚑ Mar 2055</text>
              </g>
            )}

            {/* scrub head readout at the right edge */}
            <circle cx={W - PADR} cy={Y(corpusNow)} r="5" fill={SC_META[sc].tone} stroke="var(--bg)" strokeWidth="2" />
            <g transform={`translate(${W - PADR - 190},${PADT + 6})`}>
              <rect width="178" height="56" rx="10" fill="var(--bg)" stroke="var(--brd)" strokeWidth=".5" />
              <text x="13" y="17" fontSize="9.5" fill={SC_META[sc].tone} fontWeight="700" fontFamily="var(--mono)">
                PROJECTED · {SC_META[sc].name.toUpperCase().split(' ')[0]}
              </text>
              <text x="13" y="36" fontSize="16" fill="var(--txt)" fontWeight="700" fontFamily="var(--mono)">{cr(corpusNow)}</text>
              <text x="13" y="49" fontSize="9.5" fill="var(--txt2)" fontFamily="var(--mono)">{cr(corpusNow / deflate)} in today's money</text>
            </g>
          </>
        )}

        {/* x labels */}
        <text x={PADL} y={H - 6} fontSize="10" fill="var(--txt3)" fontFamily="var(--mono)">{monYr(first.d)}</text>
        <text x={scrubbing ? xToday : W - PADR} y={H - 6} fontSize="10" fill="var(--acc)" fontWeight="700"
          textAnchor={scrubbing ? 'middle' : 'end'} fontFamily="var(--mono)">now</text>
        {scrubbing && (
          <text x={W - PADR} y={H - 6} fontSize="10" fill="var(--txt)" fontWeight="700" textAnchor="end" fontFamily="var(--mono)">
            {baseYear + yr}
          </text>
        )}
      </svg>

      {/* ── scrub rail ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button id="pj-play" onClick={onPlay} className="pj-play" aria-label={playing ? 'Pause' : 'Play projection'}>
          {playing ? '❚❚' : t >= MAXY ? '↻' : '▶'}
        </button>
        <div className="pj-year">{baseYear + yr}<small>{yr === 0 ? 'today' : `year ${yr}`}</small></div>
        <div className="pjx-rail">
          <input type="range" min="0" max={MAXY} step="0.1" value={t} onInput={onScrub}
            className="pj-range" style={{ width: '100%', '--p': `${(t / MAXY) * 100}%` }}
            aria-label="Projection year" />
          <div className="pjx-notches">
            {model.crossings.map((c) => (
              <span key={c.value} className="pjx-notch" style={{ left: `${(c.year / MAXY) * 100}%` }}>
                <i /><em>{crShort(c.value)}</em>
              </span>
            ))}
            {retireYr > 0 && retireYr <= MAXY && (
              <span className="pjx-notch ret" style={{ left: `${(retireYr / MAXY) * 100}%` }}>
                <i /><em>⚑ Retire</em>
              </span>
            )}
          </div>
        </div>
      </div>

      {!scrubbing ? (
        <>
          {/* ── at rest: D/W/M/Y/Max growth cards ── */}
          <div className="pjx-gcards">
            {growth.map((g) => (
              <button key={g.key} className={'pjx-gcell' + (range === g.key ? ' on' : '')}
                onClick={() => setRange(g.key)} aria-pressed={range === g.key}>
                <span className="pjx-gk">{g.key === 'Max' ? 'MAX' : { D: 'DAY', W: 'WEEK', M: 'MONTH', Y: 'YEAR' }[g.key]}</span>
                <span className={'pjx-gv mono ' + (g.chg >= 0 ? 'up' : 'dn')}>
                  {g.chg >= 0 ? '+' : '−'}{cr(g.chg)}
                </span>
                <span className={'pjx-gp mono ' + (g.chg >= 0 ? 'up' : 'dn')}>
                  {g.key === 'Max' && xirrPct != null
                    ? `XIRR ${xirrPct}%`
                    : `${g.pct >= 0 ? '+' : '−'}${Math.abs(g.pct).toFixed(2)}%`}
                </span>
              </button>
            ))}
          </div>

          {maxRow && (
            <div className="pjx-sentence">
              You&rsquo;ve grown <b className={maxRow.chg >= 0 ? 'up' : 'dn'}>{maxRow.chg >= 0 ? '+' : '−'}{cr(maxRow.chg)}</b> since {monYr(hist[0].d)} —{' '}
              <b>{cr(Math.max(0, histGains))}</b> of today&rsquo;s book is market gains on <b>{cr(lastH.invested ?? model.inv0)}</b> deployed
              {xirrPct != null && <>, compounding at <b className="up">{xirrPct}% XIRR</b></>}.
            </div>
          )}
        </>
      ) : (
        <>
          {/* ── scrubbing: C/B/O scenario tabs ── */}
          <div className="pjx-sctabs" role="tablist" aria-label="Projection scenario">
            {['cons', 'base', 'opt'].map((k) => {
              const c = sampleAt(model.arr[k].corpus, t);
              const mult = model.base > 0 ? c / model.base : 0;
              return (
                <button key={k} role="tab" aria-selected={sc === k}
                  className={'pjx-sctab' + (sc === k ? ' on' : '')}
                  style={{ '--tone': SC_META[k].tone }} onClick={() => setSc(k)}>
                  <span className="pjx-scname">
                    <i className={sc === k ? 'pjx-solid' : 'pjx-dotted'} />
                    {SC_META[k].name}
                  </span>
                  <span className="pjx-screte mono">
                    {(rates[k] * 100).toFixed(1)}% p.a.{k === 'base' && liveXirr != null ? ' · live' : ''}
                  </span>
                  <span className="pjx-scval mono">{cr(c)}</span>
                  <span className="pjx-scsub mono">×{mult.toFixed(1)} · {cr(c / deflate)} real</span>
                </button>
              );
            })}
          </div>

          <div className="pjx-sentence">
            At <b>{ratePct}%</b>{sc === 'base' && liveXirr != null && <> — your live XIRR —</>} by {baseYear + yr} the book reaches{' '}
            <b style={{ color: SC_META[sc].tone }}>{cr(corpusNow)}</b>, of which <b className="up">{cr(growthNow)}</b> is compounding growth on{' '}
            <b>{cr(investedNow)}</b> put in. In today&rsquo;s purchasing power that&rsquo;s <b>{cr(corpusNow / deflate)}</b>.
          </div>
        </>
      )}

      {/* ── allocation strip (both states) ── */}
      <div className="pjx-alloc">
        <div className="pjx-alloc-title">
          {scrubbing ? `Allocation drift → ${baseYear + yr}` : 'Allocation today'}
        </div>
        <div className="pjx-abar">
          {sleeves.map((s) => {
            const share = (alloc.out[s.key] || 0) / allocTotal;
            if (share < 0.002) return null;
            return <span key={s.key} style={{ flexGrow: share * 1000, background: s.color }}
              title={`${s.label} ${(share * 100).toFixed(0)}%`} />;
          })}
        </div>
        <div className="pjx-aleg">
          {sleeves.map((s) => {
            const share = (alloc.out[s.key] || 0) / allocTotal;
            if (share < 0.002) return null;
            return (
              <span key={s.key}>
                <i style={{ background: s.color }} />{s.label} {(share * 100).toFixed(0)}%
              </span>
            );
          })}
        </div>
      </div>

      <div className="sub" style={{ marginTop: 14, color: 'var(--txt3)', lineHeight: 1.6 }}>
        Rolling {MAXY}-year window from today&rsquo;s live net worth + ₹{PROJECTION.monthly.toLocaleString('en-IN')}/mo stepping
        up {(PROJECTION.stepUp * 100).toFixed(0)}%/yr. Base compounds at your live asset-book XIRR
        ({xirrPct != null ? `${xirrPct}%` : 'building — using 12% until ~3 months of history'}); Conservative/Optimistic bracket it
        at ∓3 pts. Inflation {(PROJECTION.inflation * 100).toFixed(0)}% for real values. Indicative, not advice.
      </div>
    </div>
  );
}

export default memo(ProjectionTab);
