'use client';

// Net-worth growth tracker + projection scrubber, one continuous timeline.
//
// At rest (t=0): ledger-true history, TODAY at extreme right, D/W/M/Y/Max
// growth cards, humanised sentence, and allocation strip.
// Scrubbing: today seam slides left, projection fan unfolds right; C/B/O
// are tabs — active = bold solid line + scenario-tinted fill, inactive = dotted.
//
// Base rate = live money-weighted XIRR from snapshots (fallback: the base
// scenario rate until MIN_HISTORY_DAYS of history). Cons/Opt bracket at
// ∓SPREAD. Native SVG, no libraries.

import { useMemo, useRef, useState, useEffect, memo } from 'react';
import { PROJECTION, FDS } from '../portfolio';
import { simMonthly, deriveProjInputs } from '../lib/projection';
import { xirr } from '../lib/calc';

// Single source for the numbers quoted in the footer caveat — the XIRR gate,
// the pre-history fallback rate and the Cons/Opt bracket all read from here.
const MIN_HISTORY_DAYS = 90;
const SPREAD = 0.03;
const FALLBACK_RATE = PROJECTION.scenarios.find((s) => s.key === 'base')?.rate ?? 0.12;

// Raw hex values — needed for SVG linearGradient stopColor (CSS vars don't
// work inside SVG stop elements in all browsers). These are FALLBACKS only:
// useScHex resolves the live --sc-* tokens at runtime so the chart follows
// the day/night theme instead of being stuck on the night palette.
const SC_FALLBACK = { cons: '#5B9BE8', base: '#34D399', opt: '#E8A857', acc: '#F0A6C0' };
const SC_META = {
  cons: { tone: 'var(--sc-cons)', name: 'Conservative' },
  base: { tone: 'var(--sc-base)', name: 'Base · XIRR' },
  opt:  { tone: 'var(--sc-opt)',  name: 'Optimistic' },
};
function useScHex() {
  const [hex, setHex] = useState(SC_FALLBACK);
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      setHex({
        cons: cs.getPropertyValue('--sc-cons').trim() || SC_FALLBACK.cons,
        base: cs.getPropertyValue('--sc-base').trim() || SC_FALLBACK.base,
        opt:  cs.getPropertyValue('--sc-opt').trim()  || SC_FALLBACK.opt,
        acc:  cs.getPropertyValue('--acc').trim()     || SC_FALLBACK.acc,
      });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-time', 'data-tab'] });
    return () => mo.disconnect();
  }, []);
  return hex;
}
const RANGES = [
  { key: 'D', days: 1 }, { key: 'W', days: 7 }, { key: 'M', days: 30 },
  { key: 'Y', days: 365 }, { key: 'Max', days: null },
];
const MILESTONES = [1e7, 2e7, 5e7, 1e8];
const RETIRE_ISO = '2055-03-31';
const W = 1100, H = 252, PADL = 46, PADR = 14, PADT = 26, PADB = 22;

// ₹ label for SVG <text>: the rupee glyph lives in Source Sans (body font),
// not in JetBrains Mono. We render it as a <tspan> with the body font so the
// digit portion stays mono while the symbol glyph uses the correct typeface.
function RsSvg({ x, y, children, ...rest }) {
  const s = String(children);
  const parts = s.split('₹');
  if (parts.length === 1) return <text x={x} y={y} {...rest}>{s}</text>;
  return (
    <text x={x} y={y} {...rest}>
      {parts.map((p, i) => (
        <tspan key={i}>
          {i > 0 && <tspan fontFamily="var(--body)" fontSize="1.05em">₹</tspan>}
          {p}
        </tspan>
      ))}
    </text>
  );
}

const cr = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (a / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return '₹' + (a / 1e5).toFixed(2) + 'L';
  return '₹' + Math.round(a).toLocaleString('en-IN');
};
// ₹ in HTML text: the mono face has no ₹ glyph, so the body-font fallback
// renders oversized next to mono digits. Routing every cr() value through
// this gives the symbol the global .rs treatment (sized/weighted to match).
const Crs = ({ n, of }) => {
  const s = of != null ? of : cr(n);
  const i = s.indexOf('₹');
  return i === -1 ? s : <>{s.slice(0, i)}<span className="rs">₹</span>{s.slice(i + 1)}</>;
};
const crShort = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (a / 1e7).toFixed(a >= 1e8 ? 0 : 1) + 'Cr';
  if (a >= 1e5) return '₹' + Math.round(a / 1e5) + 'L';
  return '₹' + Math.round(a / 1e3) + 'k';
};
const ms = (iso) => new Date(iso + 'T00:00:00Z').getTime();
const monYr = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const YEAR_MS = 365.25 * 864e5;

function ProjectionTab({ nw, loan = 0, fx, sleeves = [], onDrift, baseYear, invested0, snapshots, cmpsPension, cmpsService, cmpsRetirement, dataReady = true }) {
  const [t, setT] = useState(0);
  const [sc, setSc] = useState('base');
  const [range, setRange] = useState('Max');
  const [playing, setPlaying] = useState(false);
  const raf = useRef(null);
  const MAXY = PROJECTION.horizonYears;
  const SC_HEX = useScHex();

  // Contribution + step-up derived from the ledgers/payslips — never typed in.
  const projIn = useMemo(() => deriveProjInputs(fx), [fx]);

  const hist = useMemo(
    () => (snapshots || []).filter((s) => s && s.d && Number.isFinite(s.nw)),
    [snapshots],
  );

  const liveXirr = useMemo(() => {
    if (hist.length < 2) return null;
    const first = hist[0], last = hist[hist.length - 1];
    if (ms(last.d) - ms(first.d) < MIN_HISTORY_DAYS * 864e5) return null;
    const cfs = [{ date: new Date(first.d), amount: -(first.invested || 0) }];
    let prev = first.invested || 0;
    for (let i = 1; i < hist.length; i++) {
      const dep = (hist[i].invested || 0) - prev;
      if (Math.abs(dep) > 1) cfs.push({ date: new Date(hist[i].d), amount: -dep });
      prev = hist[i].invested || 0;
    }
    // Terminal value MUST be nw — the invested legs are net-worth basis, so
    // using gross assets (loan-funded) here inflates XIRR to absurd figures.
    cfs.push({ date: new Date(last.d), amount: last.nw ?? 0 });
    const r = xirr(cfs);
    return r != null && isFinite(r) && r > -0.5 && r < 2 ? r : null;
  }, [hist]);

  // Each scenario: live starting rate (XIRR ∓ spread) gliding to the
  // scenario's long-run anchor — see simMonthly for the glide schedule.
  const rates = useMemo(() => {
    const start = liveXirr ?? FALLBACK_RATE;
    const longOf = (k) => PROJECTION.scenarios.find((s) => s.key === k)?.rate ?? FALLBACK_RATE;
    return {
      cons: { start: Math.max(0.02, start - SPREAD), longRun: longOf('cons') },
      base: { start, longRun: longOf('base') },
      opt:  { start: start + SPREAD, longRun: longOf('opt') },
    };
  }, [liveXirr]);

  const fdCeiling = useMemo(
    () => FDS.filter((f) => f.status !== 'closed').reduce((a, f) => a + f.principal, 0),
    [],
  );

  // allocAt takes an explicit scenario key so it doesn't close over `sc` and
  // break when sc changes while the model memo hasn't re-run yet.
  const model = useMemo(() => {
    const base = nw || 0;
    const inv0 = invested0 != null ? invested0 : base;
    const months = MAXY * 12;
    const arr = {};
    for (const k of ['cons', 'base', 'opt']) arr[k] = simMonthly(rates[k], base, inv0, months, projIn);

    const crossings = [];
    for (const target of MILESTONES) {
      if (base >= target) continue;
      const i = arr.base.corpus.findIndex((c) => c >= target);
      if (i > 0) crossings.push({ value: target, year: i / 12 });
    }

    const assetTotal0 = sleeves.reduce((a, s) => a + (s.value || 0), 0) || (base + loan);
    const byKey = {}; sleeves.forEach((s) => { byKey[s.key] = s; });
    const startShare = {}; sleeves.forEach((s) => { startShare[s.key] = (s.value || 0) / assetTotal0; });
    const scaleKeys = sleeves.filter((s) => (PROJECTION.allocRules[s.key]?.rule || 'scale') === 'scale').map((s) => s.key);
    const scaleSum = scaleKeys.reduce((a, k) => a + (byKey[k].value || 0), 0) || 1;

    const allocAt = (scKey, y) => {
      const corpus = arr[scKey].corpus[Math.min(arr[scKey].corpus.length - 1, Math.round(y * 12))];
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
  }, [nw, loan, sleeves, MAXY, fdCeiling, invested0, rates, projIn]);

  const sampleAt = (a, yr) => {
    const m = yr * 12, i = Math.floor(m), f = m - i;
    if (i >= a.length - 1) return a[a.length - 1];
    return a[i] + (a[i + 1] - a[i]) * f;
  };

  // Growth = MARKET move only: NW change minus the capital deployed in the
  // window. Without the deduction a deposit day reads as a +10% "gain".
  const growth = useMemo(() => {
    if (hist.length < 2) return [];
    const last = hist[hist.length - 1];
    const liveNw = nw ?? last.nw;
    const liveInv = invested0 ?? last.invested ?? 0;
    return RANGES.map((r) => {
      let ref = hist[0];
      if (r.days != null) {
        const cutoff = ms(last.d) - r.days * 864e5;
        for (let i = hist.length - 1; i >= 0; i--) if (ms(hist[i].d) <= cutoff) { ref = hist[i]; break; }
      }
      const chg = (liveNw - (ref.nw ?? 0)) - (liveInv - (ref.invested ?? 0));
      const pct = ref.nw > 0 ? (chg / ref.nw) * 100 : 0;
      return { key: r.key, chg, pct };
    });
  }, [hist, nw, invested0]);

  const pts = useMemo(() => {
    if (!hist.length) return [];
    const r = RANGES.find((x) => x.key === range);
    if (!r || r.days == null) return hist;
    const cutoff = ms(hist[hist.length - 1].d) - r.days * 864e5;
    const f = hist.filter((s) => ms(s.d) >= cutoff);
    return f.length >= 2 ? f : hist.slice(-2);
  }, [hist, range]);

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  const stopPlay = () => {
    setPlaying(false);
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
  };
  const startPlay = () => {
    setPlaying(true);
    const SPEED = MAXY / 9000;
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

  // Report the drifted allocation upward so the Allocation sunburst card
  // moves with the scrubbed projection (null = back to live values).
  // MUST sit above the early return below — hooks can't be conditional.
  const scrubbing = t > 0.001;
  useEffect(() => {
    if (!onDrift) return;
    onDrift(scrubbing ? { year: baseYear + Math.round(t), out: model.allocAt(sc, t).out } : null);
  }, [onDrift, scrubbing, t, sc, model, baseYear]);

  if (hist.length < 2) return null;
  const first = pts[0], lastH = pts[pts.length - 1];
  const histMs = Math.max(864e5, ms(lastH.d) - ms(first.d));
  const futMs = t * YEAR_MS;
  const histFrac = scrubbing ? Math.max(0.15, histMs / (histMs + futMs)) : 1;
  const xToday = PADL + (W - PADL - PADR) * histFrac;
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

  const histNwPts  = pts.map((s) => `${xHist(s.d).toFixed(1)},${Y(s.nw ?? 0).toFixed(1)}`);
  const histInvPts = pts.map((s) => `${xHist(s.d).toFixed(1)},${Y(s.invested ?? 0).toFixed(1)}`);
  const baseLineY  = (H - PADB).toFixed(1);
  const histNwPath  = 'M' + histNwPts.join(' L');
  const histInvPath = 'M' + histInvPts.join(' L');
  const histNwFill  = histNwPath  + ` L${xToday.toFixed(1)},${baseLineY} L${PADL},${baseLineY} Z`;
  const histInvFill = histInvPath + ` L${xToday.toFixed(1)},${baseLineY} L${PADL},${baseLineY} Z`;

  let futPaths = null;
  if (scrubbing) {
    const N = Math.min(120, Math.max(12, Math.ceil(t * 12)));
    const seq = (a) => {
      const p = [];
      for (let i = 0; i <= N; i++) {
        const yr = (i / N) * t;
        p.push(`${xFut(yr).toFixed(1)},${Y(sampleAt(a, yr)).toFixed(1)}`);
      }
      return p;
    };
    const cons = seq(model.arr.cons.corpus), base = seq(model.arr.base.corpus),
          opt  = seq(model.arr.opt.corpus),  inv  = seq(model.arr.base.invested);
    const active = seq(model.arr[sc].corpus);
    futPaths = {
      cons: 'M' + cons.join(' L'),
      base: 'M' + base.join(' L'),
      opt:  'M' + opt.join(' L'),
      inv:  'M' + inv.join(' L'),
      fan:  'M' + opt.join(' L') + ' L' + [...cons].reverse().join(' L') + ' Z',
      activeFill: 'M' + active.join(' L') + ` L${(W - PADR).toFixed(1)},${baseLineY} L${xToday.toFixed(1)},${baseLineY} Z`,
      invFill:    'M' + inv.join(' L')    + ` L${(W - PADR).toFixed(1)},${baseLineY} L${xToday.toFixed(1)},${baseLineY} Z`,
    };
  }

  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => yMax * f / 1.06);
  const yr = Math.round(t);
  const deflate = Math.pow(1 + PROJECTION.inflation, t);
  const corpusNow   = sampleAt(model.arr[sc].corpus, t);
  const investedNow = sampleAt(model.arr.base.invested, t);
  const growthNow   = corpusNow - investedNow;


  const retireIso  = cmpsRetirement ? cmpsRetirement.toISOString().slice(0, 10) : RETIRE_ISO;
  const retireYr   = (ms(retireIso) - ms(lastH.d)) / YEAR_MS;
  const showRetire = scrubbing && t >= retireYr - 0.01 && retireYr > 0;
  const nearRetire = scrubbing && Math.abs(t - retireYr) < 2;

  const maxRow   = growth.find((g) => g.key === 'Max');
  const histGains = liveNw - (lastH.invested ?? model.inv0);
  const xirrPct   = liveXirr != null ? (liveXirr * 100).toFixed(1) : null;
  const ratePct   = (rates[sc].start * 100).toFixed(1);
  const longPct   = (rates[sc].longRun * 100).toFixed(0);

  const scHex  = SC_HEX[sc];
  const scTone = SC_META[sc].tone;

  const onScrub = (e) => { stopPlay(); setT(+e.target.value); };
  const onPlay  = () => (playing ? stopPlay() : startPlay());
  const reset   = () => { stopPlay(); setT(0); };

  return (
    <div className="card sec pjx">
      <div className="fxc" style={{ alignItems: 'baseline' }}>
        <div className="lbl" style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          {scrubbing ? 'Net worth · projected' : 'Net worth · growth'}
          {!dataReady && (
            <span style={{ fontSize: 'var(--fs-2xs)', fontFamily: 'var(--mono)', color: 'var(--gld)', textTransform: 'none', letterSpacing: 0 }}>
              ⚠ live pricing incomplete — figures provisional
            </span>
          )}
        </div>
        <div className="sub" style={{ margin: 0, fontFamily: 'var(--mono)' }}>
          {monYr(first.d)} → {scrubbing ? baseYear + yr : 'today'}
          {scrubbing && (
            <button className="pjx-reset" onClick={reset} title="Back to today">⟲ today</button>
          )}
        </div>
      </div>

      <div style={{ position: 'relative', marginTop: 10 }}>
      {/* the growth story rides INSIDE the chart's empty upper-left;
          methodology lives in the small footnote below the card */}
      {!scrubbing && maxRow && dataReady && (
        <div className="pjx-explain">
          {/* honest decomposition: ΔNW = deposits + market gains */}
          Net worth <b><Crs n={liveNw} /></b> since {monYr(hist[0].d)} ={' '}
          <b><Crs n={lastH.invested ?? model.inv0} /></b> deployed {histGains >= 0 ? '+' : '−'}{' '}
          <b className={histGains >= 0 ? 'up' : 'dn'}><Crs n={histGains} /></b> market {histGains >= 0 ? 'gains' : 'loss'}
          {xirrPct != null && <> · <b className={liveXirr >= 0 ? 'up' : 'dn'}>{xirrPct}% XIRR</b></>}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          {/* history NW fill — wears the TAB accent (identity colour); the
             scenario greens/blues/ambers are reserved for the projection fan */}
          <linearGradient id="pjx-nwfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SC_HEX.acc} stopOpacity=".22" />
            <stop offset="100%" stopColor={SC_HEX.acc} stopOpacity="0" />
          </linearGradient>
          {/* invested fill — neutral */}
          <linearGradient id="pjx-invfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8A8F98" stopOpacity=".16" />
            <stop offset="100%" stopColor="#8A8F98" stopOpacity="0" />
          </linearGradient>
          {/* active-scenario fill — uses the selected scenario's color */}
          <linearGradient id="pjx-scfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={scHex} stopOpacity=".18" />
            <stop offset="100%" stopColor={scHex} stopOpacity="0" />
          </linearGradient>
          {/* seam handoff — the active projected line leaves TODAY in the tab
             accent (the history line's colour) and eases into its scenario
             colour, so history and projection read as ONE continuous curve */}
          <linearGradient id="pjx-handoff" gradientUnits="userSpaceOnUse"
            x1={xToday} y1="0" x2={W - PADR} y2="0">
            <stop offset="0%" stopColor={SC_HEX.acc} />
            <stop offset="28%" stopColor={scHex} />
            <stop offset="100%" stopColor={scHex} />
          </linearGradient>
        </defs>

        {/* grid + y labels — use RsSvg so ₹ renders in body font */}
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PADL} y1={Y(v)} x2={W - PADR} y2={Y(v)} stroke="var(--brd2)" strokeWidth=".5" />
            <RsSvg x={4} y={Y(v) + 3} fontSize="13.5" fill="var(--txt3)" fontFamily="var(--mono)">{crShort(v)}</RsSvg>
          </g>
        ))}

        {/* history: invested fill+line, NW fill+line */}
        <path d={histInvFill} fill="url(#pjx-invfill)" />
        <path d={histNwFill}  fill="url(#pjx-nwfill)" />
        <path d={histInvPath} fill="none" stroke="var(--txt3)" strokeWidth="1.3" strokeDasharray="3 4" />
        <path d={histNwPath}  fill="none" stroke="var(--acc)" strokeWidth="2.2" strokeLinejoin="round" />

        {/* TODAY seam */}
        <line x1={xToday} y1={PADT - 12} x2={xToday} y2={H - PADB + 6}
          stroke="var(--acc)" strokeOpacity=".45" strokeWidth="1"
          strokeDasharray={scrubbing ? '2 3' : 'none'} />
        <circle cx={xToday} cy={Y(liveNw)} r={scrubbing ? 4 : 5.5} fill="var(--acc)">
          {!scrubbing && <animate attributeName="opacity" values="1;.5;1" dur="2s" repeatCount="indefinite" />}
        </circle>
        {!scrubbing && (
          <circle cx={xToday} cy={Y(liveNw)} r="10" fill="none"
            stroke="var(--acc)" strokeOpacity=".35" strokeWidth="2" />
        )}
        <RsSvg x={scrubbing ? xToday : xToday - 8} y={PADT - 16}
          fontSize="13" fill="var(--acc)" fontWeight="700" fontFamily="var(--mono)"
          textAnchor={scrubbing ? 'middle' : 'end'}>
          {`TODAY${!scrubbing ? ` · ${cr(liveNw)}` : ''}`}
        </RsSvg>

        {/* projection fan */}
        {futPaths && (
          <>
            {/* soft fan band between cons and opt */}
            <path d={futPaths.fan} fill={scHex} opacity=".07" />
            {/* invested projection fill */}
            <path d={futPaths.invFill} fill="url(#pjx-invfill)" />
            {/* active scenario fill — tinted with that scenario's color */}
            <path d={futPaths.activeFill} fill="url(#pjx-scfill)" />
            <path d={futPaths.inv} fill="none" stroke="var(--txt3)" strokeWidth="1.3" strokeDasharray="3 4" />
            {['cons', 'base', 'opt'].map((k) => (
              <path key={k} d={futPaths[k]} fill="none"
                stroke={sc === k ? 'url(#pjx-handoff)' : SC_META[k].tone}
                strokeWidth={sc === k ? 2.2 : 1.6}
                strokeDasharray={sc === k ? 'none' : '5 4'}
                opacity={sc === k ? 1 : 0.5}
                strokeLinejoin="round" />
            ))}

            {/* milestone markers visible on the active curve */}
            {model.crossings.filter((c) => c.year <= t).map((c) => {
              const cx = xFut(c.year), cy = Y(sampleAt(model.arr[sc].corpus, c.year));
              return (
                <g key={c.value}>
                  <circle cx={cx} cy={cy} r="3.5" fill="none" stroke={scTone} strokeWidth="1.5" />
                  <RsSvg x={cx} y={cy + 19} fontSize="12.5" fill="var(--txt2)"
                    textAnchor="middle" fontFamily="var(--mono)">
                    {`${crShort(c.value)} · ${baseYear + Math.round(c.year)}`}
                  </RsSvg>
                </g>
              );
            })}

            {/* retirement flag */}
            {showRetire && (
              <g>
                <line x1={xFut(retireYr)} y1={PADT - 6} x2={xFut(retireYr)} y2={H - PADB}
                  stroke="var(--acc)" strokeOpacity=".35" strokeWidth="1" />
                <text x={xFut(retireYr)} y={PADT - 10} fontSize="13" fill="var(--acc)"
                  textAnchor="middle" fontWeight="700">⚑ {retireIso.slice(0, 7).replace('-', ' · ')}</text>
              </g>
            )}

            {/* scrub-head tooltip */}
            <circle cx={W - PADR} cy={Y(corpusNow)} r="5" fill={scTone} stroke="var(--bg)" strokeWidth="2" />
            <g transform={`translate(${W - PADR - 235},${PADT + 6})`}>
              <rect width="223" height="70" rx="10" fill="var(--bg)" stroke="var(--brd)" strokeWidth=".5" />
              <text x="14" y="20" fontSize="12" fill={scTone} fontWeight="700" fontFamily="var(--mono)">
                PROJECTED · {SC_META[sc].name.toUpperCase().split(' ')[0]}
              </text>
              <RsSvg x="14" y="44" fontSize="20" fill="var(--txt)" fontWeight="700" fontFamily="var(--mono)">{cr(corpusNow)}</RsSvg>
              <RsSvg x="14" y="61" fontSize="12" fill="var(--txt2)" fontFamily="var(--mono)">{`${cr(corpusNow / deflate)} in today's money`}</RsSvg>
            </g>
          </>
        )}

        {/* x-axis labels */}
        <text x={PADL} y={H - 5} fontSize="13.5" fill="var(--txt3)" fontFamily="var(--mono)">{monYr(first.d)}</text>
        <text x={scrubbing ? xToday : W - PADR} y={H - 5} fontSize="13.5" fill="var(--acc)"
          fontWeight="700" textAnchor={scrubbing ? 'middle' : 'end'} fontFamily="var(--mono)">now</text>
        {scrubbing && (
          <text x={W - PADR} y={H - 5} fontSize="13.5" fill="var(--txt)"
            fontWeight="700" textAnchor="end" fontFamily="var(--mono)">{baseYear + yr}</text>
        )}
      </svg>
      </div>

      {/* scrub rail — fill color tracks the active scenario */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button onClick={onPlay} className="pj-play" style={{ '--play-clr': scTone }}
          aria-label={playing ? 'Pause' : 'Play projection'}>
          {playing ? '❚❚' : t >= MAXY ? '↻' : '▶'}
        </button>
        <div className="pj-year">{baseYear + yr}<small>{yr === 0 ? 'today' : `year ${yr}`}</small></div>
        <div className="pjx-rail">
          <input type="range" min="0" max={MAXY} step="0.1" value={t} onInput={onScrub}
            className="pj-range" style={{ width: '100%', '--p': `${(t / MAXY) * 100}%`, '--range-clr': scTone }}
            aria-label="Projection year" />
          <div className="pjx-notches">
            {/* alternate label rows so close crossings can't overlap */}
            {model.crossings.map((c, i) => (
              <span key={c.value} className={'pjx-notch' + (i % 2 ? ' alt' : '')} style={{ left: `${(c.year / MAXY) * 100}%` }}>
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
          <div className="pjx-gcards">
            {growth.map((g) => (
              <button key={g.key} className={'pjx-gcell' + (range === g.key ? ' on' : '')}
                onClick={() => setRange(g.key)} aria-pressed={range === g.key}>
                <span className="pjx-gk">{g.key === 'Max' ? 'MAX' : { D: 'DAY', W: 'WEEK', M: 'MONTH', Y: 'YEAR' }[g.key]}</span>
                {/* deltas against live NW are meaningless while a sleeve is unpriced */}
                {dataReady ? (
                  <>
                    {/* no +/− prefixes — direction is colour-coded (up/dn) */}
                    <span className={'pjx-gv mono ' + (g.chg >= 0 ? 'up' : 'dn')}>
                      <Crs n={g.chg} />
                    </span>
                    <span className={'pjx-gp mono ' + (g.chg >= 0 ? 'up' : 'dn')}>
                      {g.key === 'Max' && xirrPct != null
                        ? `XIRR ${xirrPct}%`
                        : `${Math.abs(g.pct).toFixed(2)}%`}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pjx-gv mono">—</span>
                    <span className="pjx-gp mono">loading</span>
                  </>
                )}
              </button>
            ))}
          </div>

        </>
      ) : (
        <>
          {/* C/B/O scenario tabs — active uses the scenario color */}
          <div className="pjx-sctabs" role="tablist" aria-label="Projection scenario">
            {['cons', 'base', 'opt'].map((k) => {
              const c = sampleAt(model.arr[k].corpus, t);
              return (
                <button key={k} role="tab" aria-selected={sc === k}
                  className={'pjx-sctab' + (sc === k ? ' on' : '')}
                  style={{ '--tone': SC_META[k].tone }} onClick={() => setSc(k)}>
                  <span className="pjx-scname">
                    <i className={sc === k ? 'pjx-solid' : 'pjx-dotted'} />
                    {SC_META[k].name}
                  </span>
                  <span className="pjx-scval mono"><Crs n={c} /></span>
                  <span className="pjx-scsub mono">≈ <Crs n={c / deflate} /> real</span>
                </button>
              );
            })}
          </div>

          <div className="pjx-sentence" style={{ '--sentence-clr': scTone }}>
            Starting at <b>{ratePct}%</b>{sc === 'base' && liveXirr != null && <> — your live XIRR —</>} and easing to <b>{longPct}%</b> long-run, by {baseYear + yr} the book reaches{' '}
            <b style={{ color: scTone }}><Crs n={corpusNow} /></b>, of which <b className="up"><Crs n={growthNow} /></b> is compounding growth on{' '}
            <b><Crs n={investedNow} /></b> put in. In today&rsquo;s purchasing power that&rsquo;s <b><Crs n={corpusNow / deflate} /></b>.
          </div>

          {nearRetire && cmpsPension > 0 && (
            <div className="pjx-cmps-banner">
              <span className="pjx-cmps-label">⚑ CMPS pension at superannuation</span>
              <span className="pjx-cmps-val"><span className="rs">₹</span>{cmpsPension.toLocaleString('en-IN')}<small>/mo</small></span>
              <span className="pjx-cmps-sub">
                {cmpsService != null ? `${cmpsService.toFixed(1)} yrs service · ` : ''}defined benefit · for life
              </span>
            </div>
          )}
        </>
      )}

      {/* methodology footnote — one compact line; every number is derived */}
      <div className="pjx-foot">
        {MAXY}-yr model · <span className="rs">₹</span>{projIn.monthly.toLocaleString('en-IN')}/mo (T12M avg deployment)
        stepping {(projIn.stepUp * 100).toFixed(1)}%→inflation · base = live XIRR{xirrPct != null ? ` ${xirrPct}%` : ''} →
        {' '}{(rates.base.longRun * 100).toFixed(0)}% long-run · Cons/Opt ∓{(SPREAD * 100).toFixed(0)} pts ·
        inflation {(PROJECTION.inflation * 100).toFixed(0)}% for real values · indicative, not advice
      </div>
    </div>
  );
}

export default memo(ProjectionTab);
