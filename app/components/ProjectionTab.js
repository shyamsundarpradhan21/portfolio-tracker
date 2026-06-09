'use client';

// Forward net-worth projection (1/5/10/30Y). The scenario outlook is shown as a
// card-based stack — one card per scenario (Conservative / Base / Optimistic),
// each with the corpus at the scrubbed horizon plus a mini per-year sparkline.
// The allocation panel stays ECharts-powered, lazy-loaded so the library only
// ships to this tab. NOTHING is hardcoded: starting net worth, sleeve values and
// the FD ceiling all arrive live; only the forward assumptions live in PROJECTION
// (app/portfolio.js). The model is a rolling window anchored to "today".

import { useEffect, useRef, useMemo, useState, memo } from 'react';
import { PROJECTION, FDS, FD_PIPELINE } from '../portfolio';

const SC = {
  cons: { c: '#5B9BE8', name: 'Conservative' },
  base: { c: '#34D399', name: 'Base' },
  opt:  { c: '#E8A857', name: 'Optimistic' },
};
const HORIZONS = [{ key: '1Y', y: 1 }, { key: '5Y', y: 5 }, { key: '10Y', y: 10 }, { key: '30Y', y: 30 }];
const SPARK_W = 240, SPARK_H = 48;

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
  const st = useRef({ t: 10, lastAlloc: -1, playing: false, sc: 'base', view: 'rose' });
  // Scenario / view / horizon live in React state so their button highlights
  // survive a live-price re-render; the fast-changing play time stays in a ref.
  const [sc, setSc] = useState('base');
  const [view, setView] = useState('rose');
  const [hsel, setHsel] = useState(10);
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

  // sparkline polyline for a scenario's full 0→MAXY curve (scaled to its own max)
  const sparkPts = (k) => {
    const arr = model.arr[k].corpus; const n = arr.length; const mx = arr[n - 1] || 1;
    return arr.map((v, i) => `${((i / (n - 1)) * SPARK_W).toFixed(1)},${(SPARK_H - (v / mx) * SPARK_H).toFixed(1)}`).join(' ');
  };

  const AXIS = {
    axisLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } },
    axisLabel: { color: '#6B6B7A', fontFamily: 'monospace', fontSize: 10 },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,.05)' } },
  };
  const TT = {
    backgroundColor: 'rgba(18,18,26,.96)', borderColor: 'rgba(255,255,255,.1)', borderWidth: 0.5,
    textStyle: { color: '#E8E8EC', fontSize: 12 },
    extraCssText: 'border-radius:10px;box-shadow:0 18px 40px -20px #000;',
  };

  // ── move the scrub readouts + scenario cards (cheap, per-frame) ──────────────
  function moveHead(t) {
    const scn = st.current.sc; const corpus = corpusAt(scn, t);
    const yEl = document.getElementById('pj-year'); if (yEl) yEl.innerHTML = `${baseYear + Math.round(t)}<small>year ${Math.round(t)}</small>`;
    const real = corpus / Math.pow(1 + model.infl, t), inv = investedAt(t), growth = corpus - inv;
    const set = (id, html, col) => { const el = document.getElementById(id); if (el) { el.innerHTML = html; if (col) el.style.color = col; } };
    set('pj-corpus', cr(corpus), SC[scn].c);
    set('pj-scn', SC[scn].name.toLowerCase());
    set('pj-range', `in ${baseYear + Math.round(t)} · range <span style="color:${SC.cons.c}">${cr(model.arr.cons.corpus[Math.round(t)])}</span> – <span style="color:${SC.opt.c}">${cr(model.arr.opt.corpus[Math.round(t)])}</span>`);
    set('pj-real', cr(real)); set('pj-inv', cr(inv)); set('pj-growth', cr(growth));
    set('pj-rng', `<span style="color:${SC.cons.c}">${cr(model.arr.cons.corpus[Math.round(t)])}</span><br><span style="color:${SC.opt.c}">${cr(model.arr.opt.corpus[Math.round(t)])}</span>`);

    // per-scenario cards: corpus at the scrubbed year + moving playhead dot
    PROJECTION.scenarios.forEach((s) => {
      const k = s.key; const c = corpusAt(k, t);
      set(`pj-scorp-${k}`, cr(c));
      const yl = document.getElementById(`pj-syr-${k}`); if (yl) yl.textContent = `at ${baseYear + Math.round(t)} · year ${Math.round(t)}`;
      const dot = document.getElementById(`pj-sdot-${k}`);
      if (dot) {
        const arr = model.arr[k].corpus; const mx = arr[arr.length - 1] || 1;
        dot.setAttribute('cx', ((t / MAXY) * SPARK_W).toFixed(1));
        dot.setAttribute('cy', (SPARK_H - (c / mx) * SPARK_H).toFixed(1));
      }
    });

    const aYr = document.getElementById('pj-ayr'); if (aYr) aYr.textContent = baseYear + Math.round(t);
    const kYr = document.getElementById('pj-kyr'); if (kYr) kYr.textContent = baseYear + Math.round(t);
    const sl = document.getElementById('pj-slider'); if (sl && document.activeElement !== sl) { sl.value = t; sl.style.setProperty('--p', (t / MAXY * 100) + '%'); }
    const yr = Math.round(t);
    if (yr !== st.current.lastAlloc) { st.current.lastAlloc = yr; drawAlloc(yr); }
  }

  // ── allocation panel (rose / race) ────────────────────────────────────────
  function drawAlloc(y) {
    const alloc = allocRef.current; if (!alloc) return;
    const sc = st.current.sc, view = st.current.view;
    const { out } = model.allocAt(model.arr[sc].corpus[y], y);
    const data = sleeves.map((s) => ({ value: Math.round(out[s.key]), name: s.label, itemStyle: { color: s.color } }));
    if (view === 'rose') {
      alloc.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', ...TT, formatter: (p) => `${p.name}<br><b style="font-family:var(--font-mono)">${crPlain(p.value)}</b> · ${p.percent}%` },
        series: [{ type: 'pie', roseType: 'area', radius: ['22%', '84%'], center: ['50%', '52%'], itemStyle: { borderColor: '#0C0C12', borderWidth: 2, borderRadius: 4 },
          label: { color: '#6B6B7A', fontSize: 10, formatter: '{b}\n{d}%' }, labelLine: { lineStyle: { color: 'rgba(255,255,255,.15)' }, length: 6, length2: 6 }, data }],
      }, true);
    } else {
      alloc.setOption({
        backgroundColor: 'transparent', grid: { left: 96, right: 76, top: 8, bottom: 18 },
        xAxis: { type: 'value', ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v) => v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : (v / 1e5).toFixed(0) + 'L' }, max: 'dataMax' },
        yAxis: { type: 'category', data: sleeves.map((s) => s.label), inverse: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, fontSize: 11, color: '#E8E8EC' }, animationDurationUpdate: 300 },
        series: [{ type: 'bar', realtimeSort: true, barWidth: '58%', data: data.map((d) => ({ value: d.value, itemStyle: { color: d.itemStyle.color, borderRadius: [0, 4, 4, 0] } })),
          label: { show: true, position: 'right', valueAnimation: true, formatter: (p) => crPlain(p.value), color: '#6B6B7A', fontFamily: 'monospace', fontSize: 11 } }],
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
      {/* controls */}
      <div className="card sec">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button id="pj-play" onClick={onPlay} className="pj-play">▶</button>
          <div id="pj-year" className="pj-year">{baseYear + 10}<small>year 10</small></div>
          <input id="pj-slider" type="range" min="0" max={MAXY} step="0.1" defaultValue="10" onInput={onScrub} className="pj-range" />
          <div className="seg" style={{ display: 'inline-flex', background: 'rgba(0,0,0,.3)', border: '.5px solid var(--brd2)', borderRadius: 9, padding: 3, gap: 2 }}>
            {HORIZONS.map((h) => (
              <button key={h.key} className={'pj-seg' + (hsel === h.y ? ' on' : '')} onClick={() => onHorizon(h.y)}>{h.key}</button>
            ))}
          </div>
        </div>
      </div>

      {/* HERO headline */}
      <div className="card sec pj-hero">
        <div className="lbl">Projected corpus · <span id="pj-scn">base</span></div>
        <div id="pj-corpus" className="pj-big" style={{ color: SC.base.c }}>—</div>
        <div id="pj-range" className="sub" style={{ marginTop: 6 }}>—</div>
      </div>

      {/* SCENARIO CARD STACK — click to select; each shows corpus @ horizon + curve */}
      <div className="g3 sec">
        {PROJECTION.scenarios.map((s) => {
          const k = s.key; const arr = model.arr[k].corpus; const final = arr[arr.length - 1];
          return (
            <div key={k} className={'card pj-scard' + (sc === k ? ' on' : '')} onClick={() => onScenario(k)}
              style={{ cursor: 'pointer', borderColor: sc === k ? SC[k].c : undefined }}>
              <div className="fxc" style={{ alignItems: 'baseline' }}>
                <div className="lbl" style={{ margin: 0, color: SC[k].c }}>{SC[k].name}</div>
                <div className="sub mono" style={{ margin: 0 }}>{(s.rate * 100).toFixed(0)}%/yr</div>
              </div>
              <div id={`pj-scorp-${k}`} className="vlg" style={{ color: SC[k].c, marginTop: 8 }}>—</div>
              <div id={`pj-syr-${k}`} className="sub" style={{ margin: '2px 0 10px' }}>—</div>
              <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" style={{ width: '100%', height: 48, display: 'block', overflow: 'visible' }}>
                <polyline points={sparkPts(k)} fill="none" stroke={SC[k].c} strokeWidth={k === sc ? 2.2 : 1.4}
                  strokeLinejoin="round" strokeLinecap="round" opacity={k === sc ? 1 : 0.55} vectorEffect="non-scaling-stroke" />
                <circle id={`pj-sdot-${k}`} r="3.2" fill={SC[k].c} stroke="var(--bg)" strokeWidth="1.5" cx="0" cy={SPARK_H} />
              </svg>
              <div className="sub mono" style={{ marginTop: 8 }}>{baseYear + MAXY}: <span dangerouslySetInnerHTML={{ __html: cr(final) }} /></div>
            </div>
          );
        })}
      </div>

      {/* KPIs | allocation */}
      <div className="g2">
        <div className="card">
          <div className="ctitle" style={{ fontSize: 15 }}>At <span id="pj-kyr" className="acc">{baseYear + 10}</span></div>
          <div className="sub">figures shown nowhere else</div>
          <div className="pj-kpis">
            <div className="csm"><div className="lbl">Today's money</div><div id="pj-real" className="vsm mono">—</div></div>
            <div className="csm"><div className="lbl">You put in</div><div id="pj-inv" className="vsm mono">—</div></div>
            <div className="csm"><div className="lbl">Growth</div><div id="pj-growth" className="vsm mono grn">—</div></div>
            <div className="csm"><div className="lbl">9% – 15% range</div><div id="pj-rng" className="mono" style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>—</div></div>
          </div>
        </div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div><div className="ctitle" style={{ fontSize: 15 }}>Allocation · <span id="pj-ayr" className="acc">{baseYear + 10}</span></div>
              <div className="sub">FD &amp; algo dilute · equities scale up</div></div>
            <div className="seg" style={{ display: 'inline-flex', background: 'rgba(0,0,0,.3)', border: '.5px solid var(--brd2)', borderRadius: 9, padding: 3, gap: 2 }}>
              <button className={'pj-seg' + (view === 'rose' ? ' on' : '')} onClick={() => onView('rose')}>Rose %</button>
              <button className={'pj-seg' + (view === 'race' ? ' on' : '')} onClick={() => onView('race')}>Race ₹</button>
            </div>
          </div>
          <div ref={allocEl} style={{ width: '100%', height: 270, marginTop: 8 }} />
        </div>
      </div>

      <div className="sub" style={{ marginTop: 14, color: 'var(--txt3)', lineHeight: 1.6 }}>
        Rolling {MAXY}-year window from today's live net worth (<span className="mono">{crPlain(nw)}</span>) + {crPlain(PROJECTION.monthly)}/mo
        stepping up {(PROJECTION.stepUp * 100).toFixed(0)}%/yr. Monthly compounding at {PROJECTION.scenarios.map((s) => (s.rate * 100).toFixed(0) + '%').join(' / ')};
        FD ceiling {crPlain(fdCeiling)} derived from your ladder; algo held at {(PROJECTION.allocRules.algo.target * 100).toFixed(0)}%. Indicative, not advice.
      </div>
    </div>
  );
}

export default memo(ProjectionTab);
