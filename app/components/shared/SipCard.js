'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RsText, inrFull } from '../../lib/fmt';
import { TRANSACTIONS, US_CASHFLOWS, MF_CASHFLOWS, fdFlows, fdRedemptions, PAYSLIPS, CMPF_CONTRIBUTIONS } from '../../portfolio';
import INDIAN_EXITS from '../../../data/indian_exits.json';

// ── Capital deployment calendar ──────────────────────────────────────────────
// Derived entirely from the ledgers in portfolio.js — nothing monthly recorded:
//   MF = MF_CASHFLOWS outflows · IND = TRANSACTIONS buys · FD = FDS principal
//   on its open date · US = US_CASHFLOWS deposits, each converted at the
//   USD/INR close of its own outflow date (from /api/fx-history); live rate
//   only while that loads.
// Every FY touched by the ledgers gets a chip; selecting one rebuilds the
// 12-month grid for that year. Months before the current one are closed
// actuals (₹0 if nothing fired), the current month is running, future months
// are planned. Clicking a month shows its composition; the FY chip shows the
// year's aggregate.

// Fixed per-stream palette from the base tokens — deliberately NOT --acc
// (changes per tab) and NOT --grn (means profit everywhere else).
// Each stream wears its own tab's accent: MF violet, IND sapphire, US cyan,
// FD gold — uniform with the rest of the dashboard.
const STREAM_COLORS = { MF: 'var(--pur)', US: 'var(--cyn)', IND: 'var(--blu)', FD: 'var(--gld)', CMPF: 'var(--grn)' };

// Build a lookup from PAYSLIPS: { 'YYYY-MM': netPay }
const PAYSLIP_MAP = Object.fromEntries(PAYSLIPS.map((p) => [p.month, p.net]));
// Total CMPF deployment = employee + employer match (corpus = 2× emp side)
const CMPF_MAP = Object.fromEntries(CMPF_CONTRIBUTIONS.map((c) => [c.month, c.emp * 2]));

function SavingsSparkline({ months }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const render = () => {
    // Read tab accent from CSS — resolves to whatever the current tab sets
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim();
    const red = getComputedStyle(document.documentElement).getPropertyValue('--red').trim();
    const gld = getComputedStyle(document.documentElement).getPropertyValue('--gld').trim();

    const W = el.clientWidth || 600;
    const H = 110, PAD = 14, RPAD = 42;
    const gW = W - PAD - RPAD;
    const gH = H - 18;

    // Compute rates: deployed gross ÷ net pay, uncapped
    const pts = months.map((m, i) => {
      const netPay = PAYSLIP_MAP[m.key];
      if (!netPay || m.gross === 0) return null;
      const r = Math.round((m.gross / netPay) * 100);
      return { i, r };
    }).filter(Boolean);

    if (pts.length < 2) { el.innerHTML = ''; return; }

    // Robust centre/spread: median + MAD (×1.4826 ≈ σ under normality).
    // A 300% bonus-month spike barely moves these, unlike mean/stdev —
    // the band stays anchored to TYPICAL months and spikes read as outliers.
    const rs = pts.map((p) => p.r);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const mu = med(rs);
    const sd = 1.4826 * med(rs.map((r) => Math.abs(r - mu)));

    // Dynamic window around the robust band, snapped to 10s. Spike months
    // beyond the ceiling clip at the top edge and keep their true value in
    // the dot label — the window stays zoomed to where typical months live.
    const dataMin = Math.min(...rs), dataMax = Math.max(...rs);
    const FLOOR = Math.max(0, Math.floor(Math.min(mu - 2 * sd, dataMin) / 10) * 10);
    const CEILV = Math.ceil(Math.max(mu + 2 * sd, Math.min(dataMax, mu + 3 * sd), FLOOR + 40) / 10) * 10;
    const toY = (r) => gH - ((Math.max(FLOOR, Math.min(r, CEILV)) - FLOOR) / (CEILV - FLOOR)) * gH + 4;
    // toX maps a month's calendar index (0=APR … 11=MAR) to its x position
    // so every month lands at the same horizontal slot regardless of whether
    // it has data — temporal alignment is preserved across FYs.
    const toX = (calIdx) => PAD + (calIdx / 11) * gW;

    // Band at ±1σ: with lumpy deployment data the 1σ envelope hugs routine
    // months and lets lump-sum months pop above it; ±2σ added no coverage,
    // only a fatter rectangle. The window keeps 2σ headroom regardless.
    const R50 = toY(50);
    const bTop = toY(Math.min(mu + sd, CEILV));
    const bBot = toY(Math.max(mu - sd, FLOOR));
    const bMid = toY(mu);

    // Benchmarks render only when inside the window, so a lean year isn't
    // squashed to keep an unreachable 100% line in frame.
    const refs = [
      [30, red, .3, .45, '3,5', '30%'],
      [50, acc, .6, .8, '4,4', '50%'],
      [100, gld, .55, .75, '4,4', '100%'],
    ].filter(([v]) => v >= FLOOR && v <= CEILV);

    const linePath = pts.map((p, j) => `${j === 0 ? 'M' : 'L'} ${toX(p.i).toFixed(1)},${toY(p.r).toFixed(1)}`).join(' ');
    const areaPath =
      `M ${toX(pts[0].i).toFixed(1)},${R50.toFixed(1)} ` +
      pts.map((p) => `L ${toX(p.i).toFixed(1)},${toY(p.r).toFixed(1)}`).join(' ') +
      ` L ${toX(pts[pts.length - 1].i).toFixed(1)},${R50.toFixed(1)} Z`;

    const id = Math.random().toString(36).slice(2);

    el.removeAttribute('viewBox');
    el.innerHTML = `
      <defs>
        <clipPath id="ab${id}"><rect x="0" y="0" width="${W}" height="${R50.toFixed(1)}"/></clipPath>
        <clipPath id="be${id}"><rect x="0" y="${R50.toFixed(1)}" width="${W}" height="${H}"/></clipPath>
        <linearGradient id="gG${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${acc}" stop-opacity=".28"/>
          <stop offset="100%" stop-color="${acc}" stop-opacity=".03"/>
        </linearGradient>
        <linearGradient id="gR${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${red}" stop-opacity=".03"/>
          <stop offset="100%" stop-color="${red}" stop-opacity=".24"/>
        </linearGradient>
      </defs>

      <path d="${areaPath}" fill="url(#gG${id})" clip-path="url(#ab${id})"/>
      <path d="${areaPath}" fill="url(#gR${id})" clip-path="url(#be${id})"/>

      ${refs.map(([v, col, lop, , dash]) => `
        <line x1="${PAD}" y1="${toY(v).toFixed(1)}" x2="${(W - RPAD).toFixed(1)}" y2="${toY(v).toFixed(1)}"
          stroke="${col}" stroke-opacity="${lop}" stroke-width="1" stroke-dasharray="${dash}"/>`).join('')}

      <line x1="${PAD}" y1="${bMid.toFixed(1)}" x2="${(W - RPAD).toFixed(1)}" y2="${bMid.toFixed(1)}"
        stroke="${acc}" stroke-opacity=".5" stroke-width="1.1"/>
      <path d="${linePath}" fill="none" stroke="${acc}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" opacity=".85" clip-path="url(#ab${id})"/>
      <path d="${linePath}" fill="none" stroke="${red}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" opacity=".85" clip-path="url(#be${id})"/>

      ${pts.map((p) => {
        const clipped = p.r > CEILV;
        const x = toX(p.i).toFixed(1), y = toY(p.r).toFixed(1);
        return `
        <circle cx="${x}" cy="${y}" r="2.8"
          fill="${clipped ? gld : acc}" stroke="#050506" stroke-width="1.5">
          <title>${months[p.i].mn}: ${p.r}%</title>
        </circle>`;
      }).join('')}

      ${months.map((m, i) => `
        <text x="${toX(i).toFixed(1)}" y="${(H - 1).toFixed(1)}"
          style="font-size:var(--fs-xs)" fill="var(--txt3)" text-anchor="middle"
          font-family="var(--mono)">${m.mn}</text>`).join('')}
    `;
    };

    render();
    // Re-render at the new width when the card resizes — the chart is
    // drawn in absolute pixels, so it must be rebuilt, not stretched.
    const ro = new ResizeObserver(render);
    ro.observe(el);
    return () => ro.disconnect();
  }, [months]);

  return (
    <svg ref={svgRef} style={{ width: '100%', display: 'block', overflow: 'visible', marginBottom: 14 }} height={110} />
  );
}
const monthKey = (d) => d.slice(0, 7);
const fK = (n) => n >= 100000 ? '₹' + (n / 100000).toFixed(2) + 'L' : '₹' + Math.round(n / 1000) + 'K';
// Indian FY: Apr–Mar. fyOf('2026-02-…') → 2025 (i.e. FY 25-26).
const fyOf = (iso) => +iso.slice(0, 4) - (+iso.slice(5, 7) < 4 ? 1 : 0);
const fyLabel = (y) => `FY ${String(y).slice(2)}–${String(y + 1).slice(2)}`;

// Rate for a date = that day's close, else the nearest prior trading day's.
function rateFor(rates, date) {
  if (!rates) return null;
  if (rates[date] != null) return rates[date];
  const keys = Object.keys(rates).filter((k) => k < date).sort();
  return keys.length ? rates[keys[keys.length - 1]] : null;
}

export default function SipCard({ fx }) {
  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const curFY = fyOf(curKey + '-01');

  // Every FY the ledgers touch, oldest first.
  const FYS = useMemo(() => {
    const dates = [
      ...MF_CASHFLOWS.filter((c) => c.amount < 0).map((c) => c.date),
      ...US_CASHFLOWS.filter((c) => c.invested > 0).map((c) => c.date),
      ...TRANSACTIONS.map((t) => t.date),
      ...fdFlows().map((f) => f.date),
      ...INDIAN_EXITS.trades.map(([e]) => e),
    ];
    const first = dates.length ? fyOf(dates.sort()[0]) : curFY;
    return Array.from({ length: curFY - first + 1 }, (_, i) => first + i);
  }, [curFY]);

  // Historical USD/INR closes covering the whole ledger window.
  const [fxHist, setFxHist] = useState(null);
  useEffect(() => {
    let dead = false;
    fetch(`/api/fx-history?start=${FYS[0]}-04-01`)
      .then((r) => r.json())
      .then((j) => { if (!dead && j.rates) setFxHist(j.rates); })
      .catch(() => {});
    return () => { dead = true; };
  }, [FYS]);

  const [fySel, setFySel] = useState(curFY);

  // Withdrawals — money coming BACK from the sleeves: MF redemptions
  // (positive amounts), US withdrawals (negative invested), Indian sells
  // (negative invested, if ever recorded) and FD redemptions. These net
  // against deployment month by month — a heavy booking month goes negative.
  const withdrawalsIn = (pred) =>
    MF_CASHFLOWS.filter((c) => c.amount > 0 && pred(c.date)).reduce((s, c) => s + c.amount, 0) +
    US_CASHFLOWS.filter((c) => c.invested < 0 && pred(c.date)).reduce((s, c) => s - c.invested * (rateFor(fxHist, c.date) ?? fx), 0) +
    TRANSACTIONS.filter((t) => t.invested < 0 && pred(t.date)).reduce((s, t) => s - t.invested, 0) +
    fdRedemptions().filter((r) => pred(r.date)).reduce((s, r) => s + r.amount, 0) +
    INDIAN_EXITS.trades.filter(([, x]) => pred(x)).reduce((s, [, , , sell]) => s + sell, 0);
  // Exited Indian delivery buys (Zerodha tax P&L) — deployment at entry date
  const exitBuysIn = (pred) =>
    INDIAN_EXITS.trades.filter(([e]) => pred(e)).reduce((s, [, , buy]) => s + buy, 0);

  // All-time aggregate (the "overall" view) — straight off the full ledgers.
  const allTime = useMemo(() => {
    const mf = MF_CASHFLOWS.filter((c) => c.amount < 0).reduce((s, c) => s - c.amount, 0);
    const us = US_CASHFLOWS.filter((c) => c.invested > 0)
      .reduce((s, c) => s + c.invested * (rateFor(fxHist, c.date) ?? fx), 0);
    const ind = TRANSACTIONS.filter((t) => t.invested > 0).reduce((s, t) => s + t.invested, 0)
      + exitBuysIn(() => true);
    const fd = fdFlows().reduce((s, f) => s + f.amount, 0);
    const cmpf = CMPF_CONTRIBUTIONS.reduce((s, c) => s + c.emp * 2, 0);
    const streams = [
      { label: 'MF',   amount: Math.round(mf) },
      { label: 'US',   amount: Math.round(us) },
      { label: 'IND',  amount: Math.round(ind) },
      { label: 'FD',   amount: Math.round(fd) },
      { label: 'CMPF', amount: Math.round(cmpf) },
    ].filter((s) => s.amount > 0);
    const out = Math.round(withdrawalsIn(() => true));
    const dates = [
      ...MF_CASHFLOWS.filter((c) => c.amount < 0).map((c) => c.date),
      ...US_CASHFLOWS.filter((c) => c.invested > 0).map((c) => c.date),
      ...TRANSACTIONS.map((t) => t.date),
      ...fdFlows().map((f) => f.date),
      ...INDIAN_EXITS.trades.map(([e]) => e),
    ].sort();
    const first = dates[0];
    // inclusive month count from first flow to now
    const months = first
      ? (now.getFullYear() - +first.slice(0, 4)) * 12 + (now.getMonth() + 1 - +first.slice(5, 7)) + 1
      : 0;
    // Same take-home-only rule as MONTHS: CMPF stays in the bar, not the sums.
    const gross = streams.filter((s) => s.label !== 'CMPF').reduce((s, x) => s + x.amount, 0);
    return { streams, gross, out, total: gross - out, months };
  }, [fx, fxHist]); // eslint-disable-line react-hooks/exhaustive-deps

  const MONTHS = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const d = new Date(fySel, 3 + i, 1); // Apr = month index 3
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mf = MF_CASHFLOWS.filter((c) => monthKey(c.date) === key && c.amount < 0)
      .reduce((s, c) => s - c.amount, 0);
    const us = US_CASHFLOWS.filter((c) => monthKey(c.date) === key && c.invested > 0)
      .reduce((s, c) => s + c.invested * (rateFor(fxHist, c.date) ?? fx), 0);
    const ind = TRANSACTIONS.filter((t) => monthKey(t.date) === key && t.invested > 0)
      .reduce((s, t) => s + t.invested, 0)
      + exitBuysIn((dt) => monthKey(dt) === key);
    const fd = fdFlows().filter((f) => monthKey(f.date) === key)
      .reduce((s, f) => s + f.amount, 0);
    const cmpf = CMPF_MAP[key] || 0;
    const streams = [
      { label: 'MF',   amount: Math.round(mf) },
      { label: 'US',   amount: Math.round(us) },
      { label: 'IND',  amount: Math.round(ind) },
      { label: 'FD',   amount: Math.round(fd) },
      { label: 'CMPF', amount: Math.round(cmpf) },
    ].filter((s) => s.amount > 0);
    // Aggregates count take-home money only — CMPF is pre-tax payroll (half
    // employer's), so it stays in the composition bar but out of the sums.
    const gross = streams.filter((s) => s.label !== 'CMPF').reduce((s, x) => s + x.amount, 0);
    const out = Math.round(withdrawalsIn((dt) => monthKey(dt) === key));
    return {
      key,
      mn: d.toLocaleString('en', { month: 'short' }).toUpperCase(),
      yy: String(d.getFullYear()).slice(2),
      streams,
      gross, out,
      total: gross - out, // NET — a heavy booking/redemption month goes negative
      state: key < curKey ? 'closed' : key === curKey ? 'current' : 'planned',
    };
  }), [fySel, fx, fxHist]); // eslint-disable-line react-hooks/exhaustive-deps

  // sel: month index, 'fy' for the year aggregate, 'all' for every FY combined
  const defaultSel = (() => {
    const i = MONTHS.findIndex((m) => m.state === 'current');
    return i >= 0 ? i : 'fy';
  })();
  const [sel, setSel] = useState(defaultSel);
  const pickFY = (y) => { setFySel(y); setSel('fy'); };

  const elapsed = MONTHS.filter((m) => m.state !== 'planned');
  const fyTot = elapsed.reduce((a, m) => a + m.total, 0);
  const isCurFY = fySel === curFY;

  // Selected view: a single month, the FY aggregate, or all-time
  const allFys = sel === 'all';
  const yearView = sel === 'fy';
  const mo = allFys || yearView ? null : MONTHS[sel];
  const viewStreams = allFys
    ? allTime.streams
    : yearView
    ? Object.values(elapsed.flatMap((m) => m.streams).reduce((acc, s) => {
        (acc[s.label] ||= { label: s.label, amount: 0 }).amount += s.amount;
        return acc;
      }, {}))
    : (mo.streams || []);
  const fyGross = elapsed.reduce((a, m) => a + m.gross, 0);
  const fyOut   = elapsed.reduce((a, m) => a + m.out, 0);
  const viewGross = allFys ? allTime.gross : yearView ? fyGross : mo.gross;
  const viewOut   = allFys ? allTime.out   : yearView ? fyOut   : mo.out;
  const viewTotal = viewGross - viewOut; // NET
  const planned = mo && mo.state === 'planned';
  // Composition stays gross — it shows where money went IN; withdrawals get
  // their own legend line rather than distorting the split.
  // Bar percentages are based on total capital formed (incl. CMPF) so the
  // segments still sum to 100% — viewGross itself is take-home only.
  const viewGrossAll = viewStreams.reduce((s, x) => s + x.amount, 0);
  // CMPF always renders last so its hatched segment sits at the right edge
  // of the bar, mirroring its right-aligned legend entry.
  const segs = viewGrossAll
    ? viewStreams
        .map((s) => ({ ...s, color: STREAM_COLORS[s.label] || 'var(--pnk)', pct: Math.round(s.amount / viewGrossAll * 100) }))
        .sort((a, b) => (a.label === 'CMPF') - (b.label === 'CMPF'))
    : [];

  // Minis follow the view: all-time when "overall", else the selected FY
  const statTot    = allFys ? allTime.total : fyTot; // net
  const statOut    = allFys ? allTime.out   : fyOut;
  const statMonths = allFys ? allTime.months : elapsed.length;
  const avgMo = statMonths ? Math.round(statTot / statMonths) : null;
  const runRate = avgMo != null ? avgMo * 12 : null;
  const maxMonth = Math.max(...MONTHS.map((m) => Math.abs(m.total)), 1);

  // Savings rate = gross deployed ÷ net take-home.
  // Always FY-level (or all-time) — never scoped to a single month so it
  // stays consistent with the other four minis which also show FY context.
  const srFor = (ms) => {
    const net = ms.reduce((s, m) => s + (PAYSLIP_MAP[m.key] || 0), 0);
    const gross = ms.reduce((s, m) => s + m.gross, 0);
    return net > 0 ? Math.round(gross / net * 100) : null;
  };
  const viewSavingsRate = allFys
    ? (() => {
        const net = PAYSLIPS.reduce((s, p) => s + p.net, 0);
        return net > 0 ? Math.round(allTime.gross / net * 100) : null;
      })()
    : srFor(elapsed); // same for both month-drill and FY view

  // Summary sentence stats (robust: median + MAD).
  // When "overall" is active, compute across every payslip month in the ledger.
  // Otherwise use the selected FY's elapsed months only.
  const _med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const grossForMonthKey = (key) =>
    MF_CASHFLOWS.filter((c) => monthKey(c.date) === key && c.amount < 0).reduce((s, c) => s - c.amount, 0) +
    US_CASHFLOWS.filter((c) => monthKey(c.date) === key && c.invested > 0).reduce((s, c) => s + c.invested * (rateFor(fxHist, c.date) ?? fx), 0) +
    TRANSACTIONS.filter((t) => monthKey(t.date) === key && t.invested > 0).reduce((s, t) => s + t.invested, 0) +
    exitBuysIn((dt) => monthKey(dt) === key) +
    fdFlows().filter((f) => monthKey(f.date) === key).reduce((s, f) => s + f.amount, 0);
  // CMPF is not included: it is deployed from gross pay before take-home, so
  // counting it in both numerator and denominator would inflate the savings rate.
  const srRates = allFys
    ? PAYSLIPS.map((p) => { const g = grossForMonthKey(p.month); return g > 0 ? Math.round(g / p.net * 100) : null; }).filter(Boolean)
    : elapsed.map((m) => { const net = PAYSLIP_MAP[m.key]; return net && m.gross > 0 ? Math.round(m.gross / net * 100) : null; }).filter(Boolean);
  const srMu = srRates.length ? Math.round(_med(srRates)) : null;
  const srSd = srRates.length ? Math.round(1.4826 * _med(srRates.map((r) => Math.abs(r - srMu)))) : null;
  const srCV = srMu ? Math.round(srSd / srMu * 100) : null;
  const srInside = srRates.filter((r) => r >= srMu - srSd && r <= srMu + srSd).length;
  const srDesc = srCV == null ? '' : srCV < 30 ? 'steady discipline' : srCV < 60 ? 'moderate variance' : 'lump-sum driven';

  const headSub = allFys
    ? `net deployed all-time · ${allTime.months} months`
    : yearView
    ? (viewTotal < 0 ? 'net withdrawn this FY' : isCurFY ? 'net deployed FY to date' : 'net deployed across the year')
    : planned ? 'not yet deployed'
    : !viewTotal ? 'nothing deployed'
    : viewTotal < 0 ? 'net withdrawn this month'
    : mo.state === 'current' ? 'deployed this month'
    : `deployed in ${mo.mn.charAt(0) + mo.mn.slice(1).toLowerCase()} ’${mo.yy}`;

  return (
    <div className="card sec">
      <div className="fxc" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="ctitle">Capital Deployment</div>
          <div className="sub" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'var(--sur2)', border: '.5px solid var(--brd2)', borderRadius: 3, padding: '1px 8px' }}>
              {allFys ? 'ALL FYS' : yearView ? fyLabel(fySel) : `${mo.mn} ${mo.yy}`}
            </span>
            {allFys ? 'since first flow' : yearView ? (isCurFY ? 'FY to date' : 'full year') : planned ? 'planned' : mo.state === 'current' ? 'current month' : 'closed'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={'vmd ' + (viewTotal > 0 ? 'grn' : viewTotal < 0 ? 'red' : '')}>{viewTotal ? <RsText>{inrFull(Math.abs(viewTotal))}</RsText> : '—'}</div>
          <div className="sub" style={{ margin: 0 }}>{headSub}</div>
        </div>
      </div>

      {/* composition bar — derived from the selected view's ledger flows */}
      <div style={{ height: 22, background: 'var(--sur2)', borderRadius: 3, overflow: 'hidden', position: 'relative', marginBottom: 8 }}>
        {segs.map((s, i) => {
          const left = segs.slice(0, i).reduce((a, x) => a + x.pct, 0);
          const bg = s.label === 'CMPF'
            ? 'repeating-linear-gradient(45deg, #9e9e9e 0, #9e9e9e 2.5px, #161616 2.5px, #161616 6.5px)'
            : s.color;
          return <div key={s.label} style={{ position: 'absolute', left: left + '%', top: 0, height: '100%', width: s.pct + '%', background: bg, opacity: s.label === 'CMPF' ? 1 : .9, transition: 'all .45s cubic-bezier(.16,1,.3,1)' }} />;
        })}
      </div>
      <div className="alloc-leg" style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', minHeight: 16 }}>
        {!segs.length ? (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--txt3)' }}>{planned ? 'Month not reached.' : 'No flows recorded.'}</span>
        ) : segs.filter((s) => s.label !== 'CMPF').map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--txt2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: s.color }} />
            <RsText>{`${s.label} ${inrFull(s.amount)} · ${s.pct}%`}</RsText>
          </span>
        ))}
        {viewOut > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--red)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--red)', flexShrink: 0 }} />
            <RsText>{`withdrawn ${inrFull(viewOut)}`}</RsText>
          </span>
        )}
        {segs.find((s) => s.label === 'CMPF') && (() => { const c = segs.find((s) => s.label === 'CMPF'); return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--txt2)', marginLeft: 'auto' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0,
              background: 'repeating-linear-gradient(45deg, #9e9e9e 0, #9e9e9e 2.5px, #161616 2.5px, #161616 6.5px)' }} />
            <RsText>{`${c.label} ${inrFull(c.amount)} · ${c.pct}%`}</RsText>
          </span>
        ); })()}
      </div>

      {/* FY-scoped zone: sparkline + FY chips + month grid.
          Dims when "overall" is active — this data is per-FY only.
          "overall" chip stays outside so it's always tappable. */}
      <div style={{ opacity: allFys ? 0.22 : 1, filter: allFys ? 'blur(0.3px)' : 'none', transition: 'opacity .3s ease, filter .3s ease', pointerEvents: allFys ? 'none' : 'auto' }}>
        <SavingsSparkline months={MONTHS} />
      </div>

      <div className="fxc" style={{ marginBottom: 8, gap: 14 }}>
        {/* FY year chips — dim when overall active but stay clickable so user can exit */}
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', whiteSpace: 'nowrap', scrollbarWidth: 'none', minWidth: 0 }}>
          {FYS.map((y) => {
            const active = y === fySel && !allFys;
            return (
              <span key={y} onClick={() => pickFY(y)}
                style={{
                  fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer', flex: '0 0 auto',
                  color: active ? 'var(--acc)' : 'var(--txt2)',
                  borderBottom: active ? '1px solid var(--acc)' : '1px solid transparent',
                }}>
                {fyLabel(y)}
              </span>
            );
          })}
        </div>
        {/* overall chip — always live, never dimmed */}
        <span onClick={() => setSel('all')}
          style={{
            fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer', flex: '0 0 auto',
            color: allFys ? 'var(--acc)' : 'var(--txt3)',
            borderBottom: allFys ? '1px solid var(--acc)' : '1px solid transparent',
          }}>
          overall
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, marginBottom: 16, opacity: allFys ? 0.22 : 1, filter: allFys ? 'blur(0.3px)' : 'none', transition: 'opacity .3s ease, filter .3s ease' }}>
        {MONTHS.map((m, i) => {
          const bg = m.state === 'planned' ? 'var(--brd2)' : m.total < 0 ? 'var(--red)' : m.total ? 'var(--acc)' : 'var(--sur2)';
          const op = m.state === 'planned' ? 1 : m.total ? Math.max(.4, Math.abs(m.total) / maxMonth) : .35;
          const seld = sel === i;
          const glow = { color: 'var(--acc)', textShadow: '0 0 9px color-mix(in srgb, var(--acc) 70%, transparent)' };
          return (
            <div key={m.key} onClick={() => setSel(i)}
              style={{ cursor: 'pointer', borderRadius: 2, padding: 2, border: seld ? '.5px solid var(--acc)' : '.5px solid transparent', transition: 'border-color .15s' }}>
              <div style={{ height: 22, background: bg, opacity: op, borderRadius: 1 }} />
              <div style={{ fontSize: '0.7rem', textAlign: 'center', color: 'var(--txt3)', marginTop: 3, fontFamily: 'var(--mono)', letterSpacing: '.04em', transition: 'color .15s, text-shadow .15s', ...(seld ? glow : null) }}>{m.mn}</div>
              <div style={{ fontSize: '0.7rem', textAlign: 'center', color: m.total < 0 ? 'var(--red)' : 'var(--txt2)', marginTop: 1, fontFamily: 'var(--mono)', transition: 'color .15s, text-shadow .15s', ...(seld ? glow : null) }}>{m.state === 'planned' ? '—' : <RsText>{fK(Math.abs(m.total))}</RsText>}</div>
            </div>
          );
        })}
      </div>

      {/* summary stats — minis always show FY or all-time context, never single-month */}
      <div className={viewSavingsRate != null ? (statOut > 0 ? 'g5' : 'g4') : (statOut > 0 ? 'g4' : 'g3')} style={{ marginBottom: 12 }}>
        <div className="mini">
          <div className="lbl">{allFys ? 'net deployed all-time' : mo ? 'net deployed · this FY' : 'net deployed'}</div>
          <div className={'vsm ' + (statTot < 0 ? 'red' : 'grn')}>{statMonths ? <RsText>{inrFull(Math.abs(statTot))}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">{mo ? 'avg / mo · this FY' : 'avg / mo'}</div>
          <div className="vsm">{avgMo != null ? <RsText>{inrFull(avgMo)}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">{mo ? 'run-rate · this FY' : 'run-rate (annualised)'}</div>
          <div className="vsm">{runRate != null ? <RsText>{inrFull(runRate)}</RsText> : '—'}</div>
        </div>
        {statOut > 0 && (
          <div className="mini">
            <div className="lbl">{mo ? 'withdrawn · this FY' : 'withdrawn'}</div>
            <div className="vsm red"><RsText>{inrFull(statOut)}</RsText></div>
          </div>
        )}
        {viewSavingsRate != null && (
          <div className="mini">
            <div className="lbl">{allFys ? 'savings rate · all-time' : 'savings rate · FY avg'}</div>
            <div className="vsm acc">{viewSavingsRate}%</div>
          </div>
        )}
      </div>

      {/* prose summary */}
      {srMu != null && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--txt3)', lineHeight: 1.6, fontFamily: 'var(--mono)', borderTop: '.5px solid var(--brd2)', paddingTop: 10 }}>
          {allFys ? <>Across all FYs </> : <>In a typical month </>}
          <span style={{ color: 'var(--acc)' }}>{srMu}%</span> of take-home is deployed
          {srRates.length > 1 && <> · <span style={{ color: 'var(--txt2)' }}>{srInside} of {srRates.length}</span> months on track</>}
          {srCV != null && <> · <span style={{ color: 'var(--txt2)' }}>{srCV}% swing</span> month-to-month</>}
          {srDesc && <> — {srDesc}</>}
          {(() => { const c = viewStreams.find((s) => s.label === 'CMPF'); return c ? <> · <span style={{ color: 'var(--acc)' }}><RsText>{inrFull(c.amount)}</RsText></span> CMPF alongside (pre-tax, incl. employer match)</> : null; })()}
        </div>
      )}
    </div>
  );
}
