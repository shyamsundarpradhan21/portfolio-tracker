'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RsText, inrFull } from '../../lib/fmt';
import { TRANSACTIONS, US_CASHFLOWS, MF_CASHFLOWS, fdFlows, fdRedemptions, PAYSLIPS } from '../../portfolio';
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
const STREAM_COLORS = { MF: 'var(--pur)', US: 'var(--cyn)', IND: 'var(--blu)', FD: 'var(--gld)' };

// Build a lookup from PAYSLIPS: { 'YYYY-MM': netPay }
const PAYSLIP_MAP = Object.fromEntries(PAYSLIPS.map((p) => [p.month, p.net]));

function SavingsSparkline({ months }) {
  const svgRef = useRef(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    // Read tab accent from CSS — resolves to whatever the current tab sets
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim();
    const red = getComputedStyle(document.documentElement).getPropertyValue('--red').trim();
    const gld = getComputedStyle(document.documentElement).getPropertyValue('--gld').trim();

    const W = el.clientWidth || 600;
    const H = 88, PAD = 14, RPAD = 42;
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

    const maxR = Math.max(130, ...pts.map((p) => p.r + 10));
    // Log scale — compresses spikes, gives resolution to the 0-100% range
    const toY = (r) => gH - (Math.log(Math.min(r, maxR) + 1) / Math.log(maxR + 1)) * gH + 4;
    const toX = (i) => PAD + (i / (months.length - 1)) * gW;

    const R30  = toY(30);
    const R50  = toY(50);
    const R100 = toY(100);

    const linePath = pts.map((p, j) => `${j === 0 ? 'M' : 'L'} ${toX(p.i).toFixed(1)},${toY(p.r).toFixed(1)}`).join(' ');
    const areaPath =
      `M ${toX(pts[0].i).toFixed(1)},${R50.toFixed(1)} ` +
      pts.map((p) => `L ${toX(p.i).toFixed(1)},${toY(p.r).toFixed(1)}`).join(' ') +
      ` L ${toX(pts[pts.length - 1].i).toFixed(1)},${R50.toFixed(1)} Z`;

    const id = Math.random().toString(36).slice(2);

    el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    el.innerHTML = `
      <defs>
        <clipPath id="ab${id}"><rect x="0" y="0" width="${W}" height="${R50.toFixed(1)}"/></clipPath>
        <clipPath id="be${id}"><rect x="0" y="${R50.toFixed(1)}" width="${W}" height="${H}"/></clipPath>
        <linearGradient id="gG${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${acc}" stop-opacity=".25"/>
          <stop offset="100%" stop-color="${acc}" stop-opacity=".02"/>
        </linearGradient>
        <linearGradient id="gR${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${red}" stop-opacity=".02"/>
          <stop offset="100%" stop-color="${red}" stop-opacity=".22"/>
        </linearGradient>
      </defs>

      <path d="${areaPath}" fill="url(#gG${id})" clip-path="url(#ab${id})"/>
      <path d="${areaPath}" fill="url(#gR${id})" clip-path="url(#be${id})"/>

      <line x1="${PAD}" y1="${R30.toFixed(1)}" x2="${(W - RPAD).toFixed(1)}" y2="${R30.toFixed(1)}"
        stroke="${red}" stroke-opacity=".3" stroke-width="1" stroke-dasharray="3,5"/>
      <text x="${(W - RPAD + 5).toFixed(1)}" y="${(R30 + 3.5).toFixed(1)}"
        font-size="8.5" fill="${red}" fill-opacity=".45" font-family="monospace">30%</text>

      <line x1="${PAD}" y1="${R50.toFixed(1)}" x2="${(W - RPAD).toFixed(1)}" y2="${R50.toFixed(1)}"
        stroke="${acc}" stroke-opacity=".6" stroke-width="1" stroke-dasharray="4,4"/>
      <text x="${(W - RPAD + 5).toFixed(1)}" y="${(R50 + 3.5).toFixed(1)}"
        font-size="8.5" fill="${acc}" fill-opacity=".8" font-family="monospace">50%</text>

      <line x1="${PAD}" y1="${R100.toFixed(1)}" x2="${(W - RPAD).toFixed(1)}" y2="${R100.toFixed(1)}"
        stroke="${gld}" stroke-opacity=".55" stroke-width="1" stroke-dasharray="4,4"/>
      <text x="${(W - RPAD + 5).toFixed(1)}" y="${(R100 + 3.5).toFixed(1)}"
        font-size="8.5" fill="${gld}" fill-opacity=".75" font-family="monospace">100%</text>

      <path d="${linePath}" fill="none" stroke="${acc}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" opacity=".85" clip-path="url(#ab${id})"/>
      <path d="${linePath}" fill="none" stroke="${red}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" opacity=".85" clip-path="url(#be${id})"/>

      ${pts.map((p) => `
        <circle cx="${toX(p.i).toFixed(1)}" cy="${toY(p.r).toFixed(1)}" r="2.8"
          fill="${acc}" stroke="#050506" stroke-width="1.5">
          <title>${months[p.i].mn}: ${p.r}%</title>
        </circle>`).join('')}

      ${months.map((m, i) => `
        <text x="${toX(i).toFixed(1)}" y="${(H - 1).toFixed(1)}"
          font-size="7" fill="rgba(255,255,255,.18)" text-anchor="middle"
          font-family="monospace">${m.mn}</text>`).join('')}
    `;
  }, [months]);

  return (
    <svg ref={svgRef} style={{ width: '100%', display: 'block', overflow: 'visible', marginBottom: 14 }} height={88} />
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
    const streams = [
      { label: 'MF', amount: Math.round(mf) },
      { label: 'US', amount: Math.round(us) },
      { label: 'IND', amount: Math.round(ind) },
      { label: 'FD', amount: Math.round(fd) },
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
    const gross = streams.reduce((s, x) => s + x.amount, 0);
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
    const streams = [
      { label: 'MF', amount: Math.round(mf) },
      { label: 'US', amount: Math.round(us) },
      { label: 'IND', amount: Math.round(ind) },
      { label: 'FD', amount: Math.round(fd) },
    ].filter((s) => s.amount > 0);
    const gross = streams.reduce((s, x) => s + x.amount, 0);
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
  const segs = viewGross ? viewStreams.map((s) => ({ ...s, color: STREAM_COLORS[s.label] || 'var(--pnk)', pct: Math.round(s.amount / viewGross * 100) })) : [];

  // Minis follow the view: all-time when "overall", else the selected FY
  const statTot    = allFys ? allTime.total : fyTot; // net
  const statOut    = allFys ? allTime.out   : fyOut;
  const statMonths = allFys ? allTime.months : elapsed.length;
  const avgMo = statMonths ? Math.round(statTot / statMonths) : null;
  const runRate = avgMo != null ? avgMo * 12 : null;
  const maxMonth = Math.max(...MONTHS.map((m) => Math.abs(m.total)), 1);

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
          return <div key={s.label} style={{ position: 'absolute', left: left + '%', top: 0, height: '100%', width: s.pct + '%', background: s.color, opacity: .9, transition: 'all .45s cubic-bezier(.16,1,.3,1)' }} />;
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', minHeight: 16 }}>
        {!segs.length ? (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--txt3)' }}>{planned ? 'Month not reached.' : 'No flows recorded.'}</span>
        ) : segs.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--txt2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <RsText>{`${s.label} ${inrFull(s.amount)} · ${s.pct}%`}</RsText>
          </span>
        ))}
        {viewOut > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--red)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--red)', flexShrink: 0 }} />
            <RsText>{`withdrawn ${inrFull(viewOut)}`}</RsText>
          </span>
        )}
      </div>

      {/* Savings-rate sparkline — sits between allocation and deployment */}
      <SavingsSparkline months={MONTHS} />

      {/* FY chips — every year the ledgers touch; the active one drives the
          grid. No-wrap + scroll so the row stays one line however many years
          accumulate. Clicking a chip (or "overall") shows the year aggregate. */}
      <div className="fxc" style={{ marginBottom: 8, gap: 14 }}>
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', whiteSpace: 'nowrap', scrollbarWidth: 'none', minWidth: 0 }}>
          {FYS.map((y) => {
            const active = y === fySel && !allFys;
            return (
              <span key={y} onClick={() => pickFY(y)}
                style={{
                  fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer', flex: '0 0 auto',
                  color: active ? 'var(--acc)' : 'var(--txt3)',
                  borderBottom: active ? '1px solid var(--acc)' : '1px solid transparent',
                }}>
                {fyLabel(y)}
              </span>
            );
          })}
        </div>
        <span onClick={() => setSel('all')}
          style={{
            fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer', flex: '0 0 auto',
            color: allFys ? 'var(--acc)' : 'var(--txt3)',
            borderBottom: allFys ? '1px solid var(--acc)' : '1px solid transparent',
          }}>
          overall
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, marginBottom: 16 }}>
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

      {/* summary stats — all derived from ledger flows */}
      <div className={statOut > 0 ? 'g4' : 'g3'}>
        <div className="mini">
          <div className="lbl">{allFys ? 'net deployed all-time' : 'net deployed'}</div>
          <div className={'vsm ' + (statTot < 0 ? 'red' : 'grn')}>{statMonths ? <RsText>{inrFull(Math.abs(statTot))}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">avg / mo</div>
          <div className="vsm">{avgMo != null ? <RsText>{inrFull(avgMo)}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">run-rate (annualised)</div>
          <div className="vsm">{runRate != null ? <RsText>{inrFull(runRate)}</RsText> : '—'}</div>
        </div>
        {statOut > 0 && (
          <div className="mini">
            <div className="lbl">withdrawn</div>
            <div className="vsm red"><RsText>{inrFull(statOut)}</RsText></div>
          </div>
        )}
      </div>
    </div>
  );
}
