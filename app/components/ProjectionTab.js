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
const SC_FALLBACK = { cons: '#3B82F6', base: '#A78BFA', opt: '#E8A857', acc: '#C2A9A0', txt3: '#8A8F98' };
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
        txt3: cs.getPropertyValue('--txt3').trim()    || SC_FALLBACK.txt3,
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
// Celebratory net-worth ladder — each round number the journey crosses earns a
// star on the curve (1L, 10L, 50L, 1Cr, 5Cr, 10Cr, 50Cr, 100Cr). Levels behind
// us become history stars; those ahead unfurl as the projection is scrubbed.
const MILESTONES = [1e5, 1e6, 5e6, 1e7, 5e7, 1e8, 5e8, 1e9];
const RETIRE_ISO = '2055-03-31';
const W = 1100, H = 252, PADL = 46, PADR = 14, PADT = 40, PADB = 22;

// Round the axis ceiling up to a clean 1/2/2.5/5 × 10^n so gridlines land on
// human numbers (₹5L, ₹10L … ₹50Cr) that line up with the milestone ladder.
const niceMax = (v) => {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
};
// Classic "nice numbers" (Heckbert) — used for the ZOOMED ranges (D/W/M/Y),
// where the axis is framed to the visible window instead of zero so day/week
// movement is legible. Returns a floor, a ceiling and a step that all land on
// human values so gridlines read cleanly.
const niceNum = (x, round) => {
  if (!(x > 0)) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * Math.pow(10, exp);
};
const niceScale = (lo, hi, ticks = 4) => {
  if (!(hi > lo)) hi = lo + Math.max(1, Math.abs(lo) * 0.02);
  const step = niceNum((hi - lo) / Math.max(1, ticks - 1), true);
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
};
// Axis tick label — like crShort but keeps one decimal for a partial lakh so
// zoomed gridlines (₹17.5L) don't round onto each other.
const axLabel = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + +(a / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) { const l = a / 1e5; return '₹' + (Number.isInteger(l) ? l : +l.toFixed(1)) + 'L'; }
  if (a >= 1e3) return '₹' + Math.round(a / 1e3) + 'k';
  return '₹' + Math.round(a);
};
// SVG <text> sizes are viewBox user-space (W=1100) and scale with the rendered
// width, so they can't be the rem --fs-* tokens directly. Centralised here
// (≈ the --fs scale at a typical render) instead of inline literals.
const SVG_FS = { grid: 15, label: 14.5, caption: 13, value: 21, flag: 14.5 };

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
  if (a >= 1e7) return '₹' + (a / 1e7).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'Cr';
  if (a >= 1e5) return '₹' + Math.round(a / 1e5) + 'L';
  return '₹' + Math.round(a / 1e3) + 'k';
};
const ms = (iso) => new Date(iso + 'T00:00:00Z').getTime();
const monYr = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const YEAR_MS = 365.25 * 864e5;

// One milestone flag: a twinkling ★ planted ON the curve where a net-worth
// level is reached (the star IS the marker — no separate dot), with a value·date
// chip and a faint rule back to the axis so low crossings don't read as zero.
// Shared by the achieved-history stars and the future projection ladder.
function MilestoneFlag({ cx, cy, label, tone, idx, blink = true }) {
  const lw = label.length * 7.5 + 16;
  // keep the chip clear of the top edge and the top-right scrub tooltip (which
  // occupies y ≈ PADT+6 … PADT+76 — high crossings near it drop below instead)
  const nearTip = cx > W - PADR - 250 && cy < PADT + 112;
  const below = cy < PADT + 40 || nearTip;
  const lx = Math.max(PADL, Math.min(W - PADR - lw, cx - lw / 2));
  const ly = below ? cy + 14 : cy - 31;
  const ty = ly + 12.8;
  return (
    <g>
      <line x1={PADL} y1={cy} x2={cx} y2={cy} stroke={tone}
        strokeOpacity=".15" strokeDasharray="2 4" strokeWidth="1" />
      <rect x={lx} y={ly} width={lw} height="18" rx="5" fill="var(--bg)"
        stroke={tone} strokeOpacity=".55" strokeWidth=".75" />
      <RsSvg x={lx + lw / 2} y={ty} fontSize={SVG_FS.flag} fill={tone}
        fontWeight="700" textAnchor="middle" fontFamily="var(--mono)">{label}</RsSvg>
      {/* the ★ sits on the curve itself — the celebratory event marker. A
          projected level (blink) gets a one-shot "achievement" burst the moment
          the scrub crosses it (the CSS animation fires on mount), then the star
          pops in and settles into a gentle twinkle. Achieved-history stars are
          calm and solid. Star + burst ride a translate() group so they animate
          around their own centre while the flag glides with the scrub. */}
      <g transform={`translate(${cx},${cy})`}>
        {blink && (
          <>
            <circle className="pjx-burst" r="5" fill="none" stroke={tone} strokeWidth="2.5" />
            <circle className="pjx-burst pjx-burst-2" r="3" fill={tone} />
          </>
        )}
        <text className={blink ? 'pjx-star-pop' : undefined} x={0} y={0}
          fontSize="17" fill={tone} fontWeight="700"
          textAnchor="middle" dominantBaseline="central">
          ★
          {blink && (
            <animate attributeName="opacity" values="1;.3;1" dur="1.9s"
              begin={`${idx * 0.5}s`} repeatCount="indefinite" />
          )}
        </text>
      </g>
    </g>
  );
}

// A tiny allocation waffle: n cells split by each sleeve's share of the
// window's GROSS market move (|gain|), coloured by the sleeve. A sleeve that
// dragged the window (negative) renders hollow, so a glance reads which classes
// drove the move and which fought it. The signed breakdown rides the title.
const INR0 = (v) => (v >= 0 ? '+' : '−') + '₹' + Math.abs(Math.round(v)).toLocaleString('en-IN');
function Waffle({ parts, n = 10 }) {
  const tot = parts.reduce((s, p) => s + Math.abs(p.gain), 0);
  if (!(tot > 0)) return null;
  // largest-remainder so the cells total exactly n
  const rows = parts.map((p) => ({ ...p, exact: (Math.abs(p.gain) / tot) * n }));
  rows.forEach((r) => { r.c = Math.floor(r.exact); });
  let used = rows.reduce((s, r) => s + r.c, 0);
  rows.map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach((x) => { if (used < n) { rows[x.i].c++; used++; } });
  const cells = [];
  rows.forEach((r) => { for (let k = 0; k < r.c; k++) cells.push({ color: r.color, neg: r.gain < 0 }); });
  const title = parts
    .slice().sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))
    .map((p) => `${p.label} ${INR0(p.gain)}`).join('  ·  ');
  return (
    <span className="pjx-waffle" title={title}>
      {cells.map((c, i) => (
        <i key={i} className={'pjx-wf' + (c.neg ? ' neg' : '')} style={{ '--wc': c.color }} />
      ))}
    </span>
  );
}

function ProjectionTab({ nw, loan = 0, fx, sleeves = [], onDrift, baseYear, invested0, snapshots, dayGain = {}, sleeveBasis = {}, cmpsRetirement, cmpsPension = 0, cmpsService = null, cmpsVested = false, cmpsVestYear = null, dataReady = true }) {
  const [t, setT] = useState(0);
  const [sc, setSc] = useState('base');
  const [range, setRange] = useState('Max');
  const [playing, setPlaying] = useState(false);
  // bumped each time live NW first crosses a not-yet-celebrated milestone; the
  // bump remounts the TODAY-dot celebration so its CSS animation re-fires.
  const [celebrateKey, setCelebrateKey] = useState(0);
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

    // Crossing year per scenario — where each curve first reaches a milestone.
    // Per-scenario (not just base) so a flag sits exactly on the active curve.
    const crossings = {};
    for (const k of ['cons', 'base', 'opt']) {
      crossings[k] = [];
      for (const target of MILESTONES) {
        if (base >= target) continue;          // already behind us
        const corpus = arr[k].corpus;
        const i = corpus.findIndex((c) => c >= target);
        // interpolate the exact (fractional) month the curve reaches the
        // milestone value so the ★ lands ON the line at value=target, not at
        // the next monthly sample that already overshot it
        if (i > 0) {
          const a = corpus[i - 1], b = corpus[i];
          const f = b > a ? Math.max(0, Math.min(1, (target - a) / (b - a))) : 0;
          crossings[k].push({ value: target, year: (i - 1 + f) / 12 });
        }
      }
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

  // Net-worth levels already crossed in the recorded history — planted as stars
  // on the growth curve so the past wins are celebrated too (the future ladder
  // lives on the projection). Only levels we've actually reached qualify.
  const histCrossings = useMemo(() => {
    if (!hist.length) return [];
    const out = [];
    for (const target of MILESTONES) {
      const i = hist.findIndex((s) => (s.nw ?? 0) >= target);
      if (i < 0) continue;
      // interpolate the moment the line crosses the milestone value (between the
      // last snapshot below it and the first at/above) so the ★ sits ON the
      // curve at value=target, not at the next vertex that already overshot
      let atMs = ms(hist[i].d);
      if (i > 0) {
        const a = hist[i - 1], b = hist[i];
        const an = a.nw ?? 0, bn = b.nw ?? 0;
        if (bn > an) {
          const f = Math.max(0, Math.min(1, (target - an) / (bn - an)));
          atMs = ms(a.d) + (ms(b.d) - ms(a.d)) * f;
        }
      }
      out.push({ value: target, atMs });
    }
    return out;
  }, [hist]);

  // Per-window market-gain attribution by asset class, for the growth pills'
  // waffles. DAY uses live per-sleeve day P&L (accurate today). The longer
  // windows need a per-sleeve snapshot at the window start — recording of that
  // began recently, so they light up on their own as history accrues (a window
  // with no per-sleeve ref simply gets no waffle). Per-sleeve gain over a window
  // = value change minus capital deployed into that sleeve.
  const attribution = useMemo(() => {
    const byKey = {}; sleeves.forEach((s) => { byKey[s.key] = s; });
    const order = sleeves.map((s) => s.key);
    const mk = (gains) => order
      .map((k) => ({ key: k, label: byKey[k]?.label || k, color: byKey[k]?.color || 'var(--txt3)', gain: gains[k] || 0 }))
      .filter((x) => Math.abs(x.gain) >= 1);
    const out = {};
    if (dayGain && order.some((k) => Math.abs(dayGain[k] || 0) >= 1)) out.D = mk(dayGain);
    if (hist.length && sleeveBasis) {
      const last = hist[hist.length - 1];
      for (const r of RANGES) {
        if (r.key === 'D') continue;
        let ref;
        if (r.key === 'Max') ref = hist.find((s) => s.sl);      // since per-sleeve tracking began
        else {
          const cutoff = ms(last.d) - r.days * 864e5;
          for (let i = hist.length - 1; i >= 0; i--) if (ms(hist[i].d) <= cutoff && hist[i].sl) { ref = hist[i]; break; }
        }
        if (!ref || !ref.sl) continue;
        const gains = {};
        for (const k of order) {
          const cur = sleeveBasis[k], st = ref.sl[k];
          if (cur && st) gains[k] = (cur.v - st.v) - (cur.i - st.i);
        }
        const arr = mk(gains);
        if (arr.length) out[r.key] = arr;
      }
    }
    return out;
  }, [dayGain, hist, sleeveBasis, sleeves]);

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
    // years-per-ms so the full horizon plays over ~19s — slow enough to read
    // each milestone celebration as the curve crosses it (was ~9s, too fast).
    const SPEED = MAXY / 19000;
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

  // Live milestone celebration: when net worth first crosses a higher round
  // number than we've celebrated before, fire the burst+pop on the TODAY dot.
  // The highest reached level is persisted in localStorage so it celebrates the
  // *moment* of crossing, not on every reload. First run just records the
  // current level silently (no retroactive party). MUST sit above the early
  // return — hooks can't be conditional.
  useEffect(() => {
    if (!dataReady || !(nw > 0) || typeof window === 'undefined') return;
    const reached = MILESTONES.filter((m) => nw >= m).pop() || 0;
    let stored;
    try { stored = localStorage.getItem('pjx-ms-celebrated'); } catch { return; }
    if (stored === null) {                         // first run → set baseline, no party
      try { localStorage.setItem('pjx-ms-celebrated', String(reached)); } catch {}
      return;
    }
    if (reached > (+stored || 0)) {
      try { localStorage.setItem('pjx-ms-celebrated', String(reached)); } catch {}
      setCelebrateKey((k) => k + 1);
    }
  }, [nw, dataReady]);

  if (hist.length < 2) return null;
  const first = pts[0], lastH = pts[pts.length - 1];
  const histMs = Math.max(864e5, ms(lastH.d) - ms(first.d));
  const futMs = t * YEAR_MS;
  const histFrac = scrubbing ? Math.max(0.15, histMs / (histMs + futMs)) : 1;
  const xToday = PADL + (W - PADL - PADR) * histFrac;
  const xHistMs = (m) => PADL + ((m - ms(first.d)) / histMs) * (xToday - PADL);
  const xHist = (iso) => xHistMs(ms(iso));
  const xFut = (yr) => xToday + (t > 0 ? (yr / t) * (W - PADR - xToday) : 0);

  const liveNw = nw ?? lastH.nw;
  // Axis framing. MAX (and any scrubbed projection) keeps the zero-baseline
  // "journey from nothing" identity — the area fills mean accumulated wealth.
  // The shorter ranges (D/W/M/Y) instead frame the VISIBLE window so the
  // day/week/month move actually has vertical room and isn't a flat sliver
  // pinned to the top of a 0→₹20L scale.
  const zeroBase = scrubbing || range === 'Max';
  const seriesHi = Math.max(
    1, liveNw,
    ...pts.map((s) => Math.max(s.nw ?? 0, s.invested ?? 0)),
    scrubbing ? sampleAt(model.arr[sc].corpus, t) : 0,
  );
  let yMin, yMax, gridVals;
  if (zeroBase) {
    yMin = 0;
    yMax = niceMax(seriesHi);
    gridVals = [0.25, 0.5, 0.75, 1].map((f) => yMax * f);
  } else {
    const seriesLo = Math.min(liveNw, ...pts.map((s) => {
      const v = [s.nw, s.invested].filter((x) => Number.isFinite(x) && x > 0);
      return v.length ? Math.min(...v) : Infinity;
    }));
    const ns = niceScale(seriesLo, seriesHi, 4);
    yMin = ns.lo; yMax = ns.hi;
    gridVals = [];
    for (let v = yMin; v <= yMax + ns.step * 0.5; v += ns.step) gridVals.push(v);
  }
  const ySpan = yMax - yMin || 1;
  const Y = (v) => PADT + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / ySpan) * (H - PADT - PADB);

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

  const yr = Math.round(t);
  const deflate = Math.pow(1 + PROJECTION.inflation, t);
  const corpusNow   = sampleAt(model.arr[sc].corpus, t);
  const investedNow = sampleAt(model.arr.base.invested, t);
  const growthNow   = corpusNow - investedNow;


  const retireIso  = cmpsRetirement ? cmpsRetirement.toISOString().slice(0, 10) : RETIRE_ISO;
  const retireYr   = (ms(retireIso) - ms(lastH.d)) / YEAR_MS;
  const showRetire = scrubbing && t >= retireYr - 0.01 && retireYr > 0;

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
      {/* projection sentence rides in-graph too (same frosted card), kept as
          terse as the growth card's decomposition so the two read alike across
          the transition. Rate model lives in the footnote, not here. */}
      {scrubbing && (
        <div className="pjx-explain">
          By {baseYear + yr} <b><Crs n={corpusNow} /></b> = <b><Crs n={investedNow} /></b> deployed + <b className="up"><Crs n={growthNow} /></b> market growth
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
            <stop offset="0%" stopColor={SC_HEX.txt3} stopOpacity=".16" />
            <stop offset="100%" stopColor={SC_HEX.txt3} stopOpacity="0" />
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
          {/* fill handoff — same idea for the AREA under the curve: an
             accent-tinted wedge that fades out just after TODAY, overlaid on
             the scenario fill so the tint blends instead of switching */}
          <linearGradient id="pjx-fillblend" gradientUnits="userSpaceOnUse"
            x1={xToday} y1="0" x2={W - PADR} y2="0">
            <stop offset="0%" stopColor={SC_HEX.acc} stopOpacity=".16" />
            <stop offset="28%" stopColor={SC_HEX.acc} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* grid + y labels — use RsSvg so ₹ renders in body font */}
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PADL} y1={Y(v)} x2={W - PADR} y2={Y(v)} stroke="var(--brd2)" strokeWidth=".5" />
            <RsSvg x={4} y={Y(v) + 3} fontSize={SVG_FS.grid} fill="var(--txt3)" fontFamily="var(--mono)">{axLabel(v)}</RsSvg>
          </g>
        ))}

        {/* history: invested fill+line, NW fill+line */}
        <path d={histInvFill} fill="url(#pjx-invfill)" />
        <path d={histNwFill}  fill="url(#pjx-nwfill)" />
        <path d={histInvPath} fill="none" stroke="var(--txt3)" strokeWidth="1.3" strokeDasharray="3 4" />
        <path d={histNwPath}  fill="none" stroke="var(--acc)" strokeWidth="2.2" strokeLinejoin="round" />

        {/* initial point — the first sample sits hard on the Y-axis, so ring it
            and label its starting value; otherwise you can't see where the
            history begins (the TODAY end is marked, this end wasn't) */}
        <circle cx={xHist(first.d)} cy={Y(first.nw ?? 0)} r="3.2" fill="var(--bg)"
          stroke="var(--acc)" strokeWidth="1.8" />
        <RsSvg x={xHist(first.d) + 7} y={Y(first.nw ?? 0) - 7} fontSize={SVG_FS.label}
          fill="var(--acc)" fontWeight="700" textAnchor="start" fontFamily="var(--mono)">
          {cr(first.nw ?? 0)}
        </RsSvg>

        {/* achieved milestones — stars on the history curve (at rest), the past
            wins; they fill the sparse upper-left and set up the future ladder */}
        {!scrubbing && histCrossings
          .filter((c) => c.atMs >= ms(first.d))
          .map((c, i) => (
            <MilestoneFlag key={'h' + c.value} cx={xHistMs(c.atMs)} cy={Y(c.value)}
              label={`${crShort(c.value)}·${new Date(c.atMs).getUTCFullYear()}`} tone="var(--acc)" idx={i} blink={false} />
          ))}

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
        {/* live milestone party — mounts (and animates) only when celebrateKey
            bumps, i.e. NW just crossed a fresh round number. Reuses the same
            burst as the projected ladder; a ★ pops on the TODAY dot and fades. */}
        {!scrubbing && celebrateKey > 0 && (
          <g key={celebrateKey} transform={`translate(${xToday},${Y(liveNw)})`} style={{ pointerEvents: 'none' }}>
            <circle className="pjx-burst" r="6" fill="none" stroke="var(--acc)" strokeWidth="2.5" />
            <circle className="pjx-burst pjx-burst-2" r="3.5" fill="var(--acc)" />
            <text className="pjx-live-star" x={0} y={0} fontSize="18" fill="var(--acc)"
              fontWeight="700" textAnchor="middle" dominantBaseline="central">★</text>
          </g>
        )}
        <RsSvg x={scrubbing ? xToday : xToday - 8} y={PADT - 16}
          fontSize={SVG_FS.label} fill="var(--acc)" fontWeight="700" fontFamily="var(--mono)"
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
            {/* active scenario fill — tinted with that scenario's color,
                with the accent wedge blending the seam (see pjx-fillblend) */}
            <path d={futPaths.activeFill} fill="url(#pjx-scfill)" />
            <path d={futPaths.activeFill} fill="url(#pjx-fillblend)" />
            <path d={futPaths.inv} fill="none" stroke="var(--txt3)" strokeWidth="1.3" strokeDasharray="3 4" />
            {['cons', 'base', 'opt'].map((k) => (
              <path key={k} d={futPaths[k]} fill="none"
                stroke={sc === k ? 'url(#pjx-handoff)' : SC_META[k].tone}
                strokeWidth={sc === k ? 2.2 : 1.6}
                strokeDasharray={sc === k ? 'none' : '5 4'}
                opacity={sc === k ? 1 : 0.5}
                strokeLinejoin="round" />
            ))}

            {/* milestone ladder — each round number the active curve reaches gets
                a twinkling ★ on the line plus a value·year chip; revealed one by
                one as you scrub past each crossing */}
            {model.crossings[sc].filter((c) => c.year <= t).map((c, i) => (
              <MilestoneFlag key={c.value} cx={xFut(c.year)} cy={Y(c.value)}
                label={`${crShort(c.value)}·${baseYear + Math.round(c.year)}`}
                tone={scTone} idx={i} />
            ))}

            {/* retirement flag */}
            {showRetire && (
              <g>
                <line x1={xFut(retireYr)} y1={PADT - 6} x2={xFut(retireYr)} y2={H - PADB}
                  stroke="var(--acc)" strokeOpacity=".35" strokeWidth="1" />
                <text x={xFut(retireYr)} y={PADT - 10} fontSize={SVG_FS.label} fill="var(--acc)"
                  textAnchor="middle" fontWeight="700">⚑ {retireIso.slice(0, 7).replace('-', ' · ')}</text>
              </g>
            )}

            {/* scrub-head tooltip */}
            <circle cx={W - PADR} cy={Y(corpusNow)} r="5" fill={scTone} stroke="var(--bg)" strokeWidth="2" />
            <g transform={`translate(${W - PADR - 235},${PADT + 6})`}>
              <rect width="223" height="70" rx="10" fill="var(--bg)" stroke="var(--brd)" strokeWidth=".5" />
              <text x="14" y="20" fontSize={SVG_FS.caption} fill={scTone} fontWeight="700" fontFamily="var(--mono)">
                PROJECTED · {SC_META[sc].name.toUpperCase().split(' ')[0]}
              </text>
              <RsSvg x="14" y="44" fontSize={SVG_FS.value} fill="var(--txt)" fontWeight="700" fontFamily="var(--mono)">{cr(corpusNow)}</RsSvg>
              <RsSvg x="14" y="61" fontSize={SVG_FS.caption} fill="var(--txt2)" fontFamily="var(--mono)">{`${cr(corpusNow / deflate)} in today's money`}</RsSvg>
            </g>
          </>
        )}

        {/* x-axis labels */}
        <text x={PADL} y={H - 5} fontSize={SVG_FS.grid} fill="var(--txt3)" fontFamily="var(--mono)">{monYr(first.d)}</text>
        <text x={scrubbing ? xToday : W - PADR} y={H - 5} fontSize={SVG_FS.grid} fill="var(--acc)"
          fontWeight="700" textAnchor={scrubbing ? 'middle' : 'end'} fontFamily="var(--mono)">now</text>
        {scrubbing && (
          <text x={W - PADR} y={H - 5} fontSize={SVG_FS.grid} fill="var(--txt)"
            fontWeight="700" textAnchor="end" fontFamily="var(--mono)">{baseYear + yr}</text>
        )}
      </svg>
      </div>

      {/* scrub rail — fill color tracks the active scenario */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        {/* at rest the button wears the tab accent (the growth view's colour);
            once scrubbing it adopts the scrubber/scenario tone to match the rail */}
        <button onClick={onPlay} className="pj-play"
          style={{ '--play-clr': scrubbing ? scTone : 'var(--acc)' }}
          aria-label={playing ? 'Pause' : 'Play projection'}>
          {playing ? '❚❚' : t >= MAXY ? '↻' : '▶'}
        </button>
        <div className="pj-year">{baseYear + yr}<small>{yr === 0 ? 'today' : `year ${yr}`}</small></div>
        <div className="pjx-rail">
          <input type="range" min="0" max={MAXY} step="0.1" value={t} onInput={onScrub}
            className="pj-range" style={{ width: '100%', '--p': `${(t / MAXY) * 100}%`, '--range-clr': scrubbing ? scTone : 'var(--acc)' }}
            aria-label="Projection year" />
          <div className="pjx-notches">
            {/* milestones now ride the chart as flags; the rail keeps only the
                retirement marker */}
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
                <span className="pjx-gmeta">
                  <span className="pjx-gk">{g.key === 'Max' ? 'MAX' : { D: 'DAY', W: 'WEEK', M: 'MONTH', Y: 'YEAR' }[g.key]}</span>
                  {/* deltas against live NW are meaningless while a sleeve is unpriced */}
                  {dataReady ? (
                    <>
                      {/* +/- figures keep their semantic green/red P&L coding;
                          the tab accent lives in the selection chrome only */}
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
                </span>
                {/* gain attribution by asset class, vertical on the right — DAY is
                    live; longer windows appear as per-sleeve snapshot history accrues */}
                {dataReady && attribution[g.key] && <Waffle parts={attribution[g.key]} />}
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
                    {SC_META[k].name} <span className="pjx-screte">({(rates[k].start * 100).toFixed(1)}%)</span>
                  </span>
                  {/* nominal + inflation-adjusted on one line: real value sits
                      in () at a smaller size so it fills the row instead of a
                      second line */}
                  <span className="pjx-scval mono">
                    <Crs n={c} /> <span className="pjx-screal"><Crs of={`(${cr(c / deflate)})`} /></span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* CMPS defined-benefit pension — a one-line note just above the footnote.
          The figure is the FULL-CAREER projection (pension = salary × service ÷ 70
          with service run to superannuation), so it's contingent on serving to 60;
          and it only vests at the 10-yr qualifying mark — before that, leaving
          yields a contribution refund, not a pension. Framed honestly so the
          number doesn't read as a current entitlement. */}
      {cmpsPension > 0 && (
        <div className="pjx-cmps-line">
          <span className="pjx-cmps-flag">⚑ CMPS pension</span>{' '}
          projected <b><Crs of={`₹${cmpsPension.toLocaleString('en-IN')}/mo`} /></b> at superannuation ({retireIso.slice(0, 4)}) if served to 60
          {!cmpsVested && cmpsVestYear
            ? <> · not yet vested — needs 10 yrs ({cmpsService != null ? `${cmpsService.toFixed(1)} now, ` : ''}vests {cmpsVestYear}); leave before and it&rsquo;s a contribution refund, not a pension</>
            : <> · {cmpsService != null ? `${cmpsService.toFixed(1)} yrs service · ` : ''}defined benefit, for life</>}
        </div>
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
