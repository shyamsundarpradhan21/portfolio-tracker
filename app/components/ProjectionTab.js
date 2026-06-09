'use client';

// Forward net-worth outlook, embedded in Overview. No charts here — the only
// graph on Overview is the historical invested+growth curve (HistoryCurve).
// Conservative / Base case / Optimistic render as one row of three flat columns
// (rate, corpus at the scrubbed year, ×multiple vs today, inflation-adjusted
// value); clicking a column selects that scenario. Below it, a two-line text:
// "You'll have put in X / of which Y is compounding growth". The allocation
// panel stays ECharts-powered, lazy-loaded so the library only ships here.
// NOTHING is hardcoded: starting net worth, sleeve values and the FD ceiling
// all arrive live; only the forward assumptions live in PROJECTION
// (app/portfolio.js). The model is a rolling window anchored to "today".

import { useEffect, useRef, useMemo, useState, memo } from 'react';
import { PROJECTION, FDS, FD_PIPELINE } from '../portfolio';
import { NNBSP } from '../lib/fmt';

const SC = {
  cons: { c: '#5B9BE8', name: 'Conservative' },
  base: { c: '#34D399', name: 'Base case' },
  opt:  { c: '#E8A857', name: 'Optimistic' },
};
const HORIZONS = [{ key: 'Now', y: 0 }, { key: '1Y', y: 1 }, { key: '5Y', y: 5 }, { key: '10Y', y: 10 }, { key: '30Y', y: 30 }];

// rupee formatters (Cr / L) — color conveys sign elsewhere; these are unsigned
const cr = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return '<span class="rs">₹</span>' + (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return '<span class="rs">₹</span>' + (a / 1e5).toFixed(2) + ' L';
  return '<span class="rs">₹</span>' + Math.round(a).toLocaleString('en-IN');
};
const crPlain = (n) => cr(n).replace(/<[^>]+>/g, '');

function ProjectionTab({ nw, loan, sleeves, baseYear, invested0 }) {
  const allocEl = useRef(null);
  const allocRef = useRef(null);
  const echRef = useRef(null);
  const raf = useRef(null);
  const st = useRef({ t: 0, lastAlloc: -1, playing: false, sc: 'base', view: 'rose' });
  // Scenario / view / horizon live in React state so their button highlights
  // survive a live-price re-render; the fast-changing play time stays in a ref.
  const [sc, setSc] = useState('base');
  const [view, setView] = useState('rose');
  const [hsel, setHsel] = useState(0);
  st.current.sc = sc; st.current.view = view;

  const MAXY = PROJECTION.horizonYears;
  const fdCeiling = useMemo(
    () => FDS.reduce((a, f) => a + f.principal, 0) + FD_PIPELINE.reduce((a, f) => a + f.amount, 0),
    [],
  );

  // ── pure model ────────────────────────────────────────────────────────────
  const model = useMemo(() => {
    const base = nw || 0;
    // Invested anchor = capital deployed to date (cost basis). Defaults to today's
    // net worth only if a cost basis isn't supplied — otherwise the gap between
    // corpus and invested at year 0 reflects the gains already in the book.
    const inv0 = invested0 != null ? invested0 : base;
    const M0 = PROJECTION.monthly, step = PROJECTION.stepUp, infl = PROJECTION.inflation;
    const assetTotal0 = sleeves.reduce((a, s) => a + (s.value || 0), 0) || (base + loan);
    const sim = (rate) => {
      const mr = rate / 12; let c = base, inv = inv0;
      const corpus = [c], invested = [inv];
      for (let m = 1; m <= MAXY * 12; m++) {
        const x = M0 * Math.pow(1 + step, Math.floor((m - 1) / 12));
        c = c * (1 + mr) + x; inv += x;
        if (m % 12 === 0) { corpus.push(c); invested.push(inv); }
      }
      return { corpus, invested };
    };
    const arr = {};
    PROJECTION.scenarios.forEach((s) => { arr[s.key] = sim(s.rate); });
    const invested = arr.base.invested;
    const rates = {}; PROJECTION.scenarios.forEach((s) => { rates[s.key] = s.rate; });

    // allocation drift at a (possibly fractional) year, for a given corpus
    const byKey = {}; sleeves.forEach((s) => { byKey[s.key] = s; });
    const startShare = {}; sleeves.forEach((s) => { startShare[s.key] = (s.value || 0) / assetTotal0; });
    const scaleKeys = sleeves.filter((s) => (PROJECTION.allocRules[s.key]?.rule || 'scale') === 'scale').map((s) => s.key);
    const scaleSum = scaleKeys.reduce((a, k) => a + (byKey[k].value || 0), 0) || 1;
    const allocAt = (corpus, y) => {
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
    return { base, arr, invested, infl, rates, allocAt };
  }, [nw, loan, sleeves, MAXY, fdCeiling, invested0]);

  const corpusAt = (sc, t) => {
    const a = model.arr[sc].corpus; const i = Math.floor(t), f = t - i;
    if (i >= a.length - 1) return a[a.length - 1];
    return a[i] + (a[i + 1] - a[i]) * f;
  };
  const investedAt = (t) => {
    const a = model.invested; const i = Math.floor(t), f = t - i;
    if (i >= a.length - 1) return a[a.length - 1];
    return a[i] + (a[i + 1] - a[i]) * f;
  };

  // ECharts is canvas-rendered, so CSS variables don't reach it — read the live
  // theme tokens off <html> and build day/night-aware chart styles each draw.
  const palette = () => {
    const cs = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const v = (n, f) => (cs ? cs.getPropertyValue(n).trim() || f : f);
    const day = typeof document !== 'undefined' && document.documentElement.dataset.time === 'day';
    return {
      txt: v('--txt', '#E8E8EC'),
      txt2: v('--txt2', '#6B6B7A'),
      bg: v('--bg', '#0C0C12'),
      axisLine: day ? 'rgba(40,60,90,.22)' : 'rgba(255,255,255,.12)',
      splitLine: day ? 'rgba(40,60,90,.10)' : 'rgba(255,255,255,.05)',
      ttBg: day ? 'rgba(255,255,255,.97)' : 'rgba(18,18,26,.96)',
      ttBorder: day ? 'rgba(40,60,90,.16)' : 'rgba(255,255,255,.1)',
      shadow: day ? 'rgba(40,60,90,.22)' : '#000',
    };
  };
  const axisOf = (p) => ({
    axisLine: { lineStyle: { color: p.axisLine } },
    axisLabel: { color: p.txt2, fontFamily: 'monospace', fontSize: 10 },
    splitLine: { lineStyle: { color: p.splitLine } },
  });
  const ttOf = (p) => ({
    backgroundColor: p.ttBg, borderColor: p.ttBorder, borderWidth: 0.5,
    textStyle: { color: p.txt, fontSize: 12 },
    extraCssText: `border-radius:10px;box-shadow:0 18px 40px -20px ${p.shadow};`,
  });

  // ── move the scrub readouts (cheap, per-frame; no graphs) ───────────────────
  function moveHead(t) {
    const scn = st.current.sc; const yr = Math.round(t);
    const inv = investedAt(t);
    const deflate = Math.pow(1 + model.infl, t);
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

    const yEl = document.getElementById('pj-year');
    if (yEl) yEl.innerHTML = `${baseYear + yr}<small>${yr === 0 ? 'today' : 'year ' + yr}</small>`;

    // Conservative / Base case / Optimistic columns: corpus at the scrubbed
    // year, ×multiple vs today's net worth, and the inflation-adjusted value.
    PROJECTION.scenarios.forEach((s) => {
      const c = corpusAt(s.key, t);
      const mult = model.base > 0 ? c / model.base : 0;
      set(`pj-cv-${s.key}`, cr(c));
      set(`pj-cm-${s.key}`, `×${mult.toFixed(1)} · ${cr(c / deflate)} today`);
    });

    // "You'll have put in X / of which Y is compounding growth" — growth from
    // the selected scenario's corpus.
    const growth = corpusAt(scn, t) - inv;
    set('pj-figs',
      `${yr === 0 ? "You've" : "You'll have"} put in <b class="mono">${cr(inv)}</b><br>` +
      `of which <b class="mono" style="color:var(--grn)">${cr(growth)}</b> is compounding growth`);

    const aYr = document.getElementById('pj-ayr'); if (aYr) aYr.textContent = baseYear + yr;
    const sl = document.getElementById('pj-slider'); if (sl && document.activeElement !== sl) { sl.value = t; sl.style.setProperty('--p', (t / MAXY * 100) + '%'); }
    if (yr !== st.current.lastAlloc) { st.current.lastAlloc = yr; drawAlloc(yr); }
  }

  // ── allocation panel (rose / race) ────────────────────────────────────────
  function drawAlloc(y) {
    const alloc = allocRef.current; if (!alloc) return;
    const sc = st.current.sc, view = st.current.view;
    const p = palette(); const AXIS = axisOf(p);
    const { out } = model.allocAt(model.arr[sc].corpus[y], y);
    const data = sleeves.map((s) => ({ value: Math.round(out[s.key]), name: s.label, itemStyle: { color: s.color } }));
    if (view === 'rose') {
      alloc.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', ...ttOf(p), formatter: (pt) => `${pt.name}<br><b style="font-family:var(--font-mono)">${crPlain(pt.value)}</b> · ${pt.percent}%` },
        series: [{ type: 'pie', roseType: 'area', radius: ['22%', '84%'], center: ['50%', '52%'], itemStyle: { borderColor: p.bg, borderWidth: 2, borderRadius: 4 },
          label: { color: p.txt2, fontSize: 10, formatter: '{b}\n{d}%' }, labelLine: { lineStyle: { color: p.axisLine }, length: 6, length2: 6 }, data }],
      }, true);
    } else {
      alloc.setOption({
        backgroundColor: 'transparent', grid: { left: 96, right: 76, top: 8, bottom: 18 },
        xAxis: { type: 'value', ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v) => v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : (v / 1e5).toFixed(0) + 'L' }, max: 'dataMax' },
        yAxis: { type: 'category', data: sleeves.map((s) => s.label), inverse: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, fontSize: 11, color: p.txt }, animationDurationUpdate: 300 },
        series: [{ type: 'bar', realtimeSort: true, barWidth: '58%', data: data.map((d) => ({ value: d.value, itemStyle: { color: d.itemStyle.color, borderRadius: [0, 4, 4, 0] } })),
          label: { show: true, position: 'right', valueAnimation: true, formatter: (pt) => crPlain(pt.value), color: p.txt2, fontFamily: 'monospace', fontSize: 11 } }],
        animationDuration: 0, animationDurationUpdate: 600, animationEasing: 'linear', animationEasingUpdate: 'linear',
      }, true);
    }
  }

  // ── play loop (rAF, smooth fractional time) ───────────────────────────────
  function stopPlay() {
    st.current.playing = false;
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
    const b = document.getElementById('pj-play'); if (b) b.textContent = '▶';
  }
  function startPlay() {
    if (st.current.t >= MAXY) st.current.t = 0;
    st.current.playing = true;
    const b = document.getElementById('pj-play'); if (b) b.textContent = '❚❚';
    const SPEED = MAXY / 9000; // 30y over ~9s
    let last = performance.now();
    const tick = (now) => {
      if (!st.current.playing) return;
      const dt = now - last; last = now;
      st.current.t = Math.min(MAXY, st.current.t + dt * SPEED);
      moveHead(st.current.t);
      if (st.current.t >= MAXY) { stopPlay(); document.getElementById('pj-play').textContent = '↻'; return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  // ── init / teardown ───────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    import('echarts').then((ech) => {
      if (disposed || !allocEl.current) return;
      echRef.current = ech;
      allocRef.current = ech.init(allocEl.current);
      st.current.lastAlloc = -1;
      moveHead(st.current.t); drawAlloc(Math.round(st.current.t));
    });
    const onResize = () => { allocRef.current && allocRef.current.resize(); };
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true; stopPlay(); window.removeEventListener('resize', onResize);
      allocRef.current && allocRef.current.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // redraw when the live model changes (prices refreshed)
  useEffect(() => {
    st.current.lastAlloc = -1;
    moveHead(st.current.t); if (allocRef.current) drawAlloc(Math.round(st.current.t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // redraw the canvas chart when the day/night theme flips (data-time on <html>);
  // CSS vars don't reach ECharts, so we re-pull the palette and redraw.
  useEffect(() => {
    const obs = new MutationObserver(() => { if (allocRef.current) drawAlloc(Math.round(st.current.t)); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-time'] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // redraw on scenario / view change (state-driven; survives re-renders)
  useEffect(() => {
    moveHead(st.current.t); if (allocRef.current) drawAlloc(Math.round(st.current.t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc]);
  useEffect(() => {
    if (!allocRef.current) return;
    drawAlloc(Math.round(st.current.t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── handlers ──────────────────────────────────────────────────────────────
  const onScenario = (k) => setSc(k);
  const onView = (v) => setView(v);
  const onHorizon = (y) => { stopPlay(); setHsel(y); st.current.t = y; st.current.lastAlloc = -1; moveHead(y); };
  const onScrub = (e) => { stopPlay(); st.current.t = +e.target.value; moveHead(st.current.t); };
  const onPlay = () => { st.current.playing ? stopPlay() : startPlay(); };

  return (
    <div>
      {/* Allocation (left) · Outlook scrubber + C/B/O line + figures text (right) */}
      <div className="g2 sec pj-outlook">
        {/* LEFT — allocation share */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <div className="ctitle" style={{ fontSize: 15 }}>Allocation · <span id="pj-ayr" className="acc">{baseYear}</span></div>
              <div className="sub">FD &amp; algo dilute · equities scale up</div>
            </div>
            <div className="seg" style={{ display: 'inline-flex', background: 'rgba(0,0,0,.3)', border: '.5px solid var(--brd2)', borderRadius: 9, padding: 3, gap: 2 }}>
              <button className={'pj-seg' + (view === 'rose' ? ' on' : '')} onClick={() => onView('rose')}>Rose %</button>
              <button className={'pj-seg' + (view === 'race' ? ' on' : '')} onClick={() => onView('race')}>Race ₹</button>
            </div>
          </div>
          <div ref={allocEl} style={{ width: '100%', height: 270, marginTop: 8 }} />
        </div>

        {/* RIGHT — outlook: scrub, then the C/B/O columns, then figures text */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="lbl" style={{ marginBottom: 10 }}>Projected outlook</div>

          {/* the scroll */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button id="pj-play" onClick={onPlay} className="pj-play">▶</button>
            <div id="pj-year" className="pj-year">{baseYear}<small>today</small></div>
            <input id="pj-slider" type="range" min="0" max={MAXY} step="0.1" defaultValue="0" onInput={onScrub} className="pj-range" style={{ flex: 1, minWidth: 140 }} />
          </div>
          <div className="seg" style={{ display: 'inline-flex', alignSelf: 'flex-start', background: 'rgba(0,0,0,.3)', border: '.5px solid var(--brd2)', borderRadius: 9, padding: 3, gap: 2, marginTop: 10 }}>
            {HORIZONS.map((h) => (
              <button key={h.key} className={'pj-seg' + (hsel === h.y ? ' on' : '')} onClick={() => onHorizon(h.y)}>{h.key}</button>
            ))}
          </div>

          {/* Conservative / Base case / Optimistic — one row just below the
              scroll; clicking a column selects that scenario. */}
          <div className="pj-cbo-row">
            {PROJECTION.scenarios.map((s) => (
              <button key={s.key} className={'pj-cbo-col' + (sc === s.key ? ' on' : '')}
                style={{ '--tone': SC[s.key].c }} aria-pressed={sc === s.key}
                onClick={() => onScenario(s.key)}>
                <div className="pj-cbo-name" style={{ color: SC[s.key].c }}>{SC[s.key].name}</div>
                <div className="pj-cbo-rate">{(s.rate * 100).toFixed(0)}{NNBSP}% p.a.</div>
                <div id={`pj-cv-${s.key}`} className="pj-cbo-val mono">—</div>
                <div id={`pj-cm-${s.key}`} className="pj-cbo-sub mono">—</div>
              </button>
            ))}
          </div>

          {/* you'll have put in · compounding growth — text below the C/B/O values */}
          <div id="pj-figs" className="sub" style={{ marginTop: 12, lineHeight: 1.7 }}>—</div>
        </div>
      </div>

      <div className="sub" style={{ marginTop: 14, color: 'var(--txt3)', lineHeight: 1.6 }}>
        Rolling {MAXY}-year window from today's live net worth (<span className="mono">{crPlain(nw)}</span>) + {crPlain(PROJECTION.monthly)}/mo
        stepping up {(PROJECTION.stepUp * 100).toFixed(0)}{NNBSP}%/yr. Monthly compounding at {PROJECTION.scenarios.map((s) => (s.rate * 100).toFixed(0) + NNBSP + '%').join(' / ')};
        FD ceiling {crPlain(fdCeiling)} derived from your ladder. Algo capital is tracked separately, outside net worth. Indicative, not advice.
      </div>
    </div>
  );
}

export default memo(ProjectionTab);
