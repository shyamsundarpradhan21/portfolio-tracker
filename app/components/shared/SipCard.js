'use client';
import { useEffect, useMemo, useState } from 'react';
import { RsText, inrFull } from '../../lib/fmt';
import { TRANSACTIONS, US_CASHFLOWS, MF_CASHFLOWS } from '../../portfolio';

// ── Capital deployment calendar ──────────────────────────────────────────────
// Derived entirely from the ledgers in portfolio.js — nothing monthly recorded:
//   MF = MF_CASHFLOWS outflows · IND = TRANSACTIONS buys ·
//   US = US_CASHFLOWS deposits, each converted at the USD/INR close of its own
//   outflow date (from /api/fx-history); live rate only while that loads.
// Every FY touched by the ledgers gets a chip; selecting one rebuilds the
// 12-month grid for that year. Months before the current one are closed
// actuals (₹0 if nothing fired), the current month is running, future months
// are planned. Clicking a month shows its composition; the FY chip shows the
// year's aggregate.

// Fixed per-stream palette from the base tokens — deliberately NOT --acc
// (changes per tab) and NOT --grn (means profit everywhere else).
const STREAM_COLORS = { MF: 'var(--pur)', US: 'var(--cyn)', IND: 'var(--blu)' };
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

  const MONTHS = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const d = new Date(fySel, 3 + i, 1); // Apr = month index 3
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mf = MF_CASHFLOWS.filter((c) => monthKey(c.date) === key && c.amount < 0)
      .reduce((s, c) => s - c.amount, 0);
    const us = US_CASHFLOWS.filter((c) => monthKey(c.date) === key && c.invested > 0)
      .reduce((s, c) => s + c.invested * (rateFor(fxHist, c.date) ?? fx), 0);
    const ind = TRANSACTIONS.filter((t) => monthKey(t.date) === key)
      .reduce((s, t) => s + t.invested, 0);
    const streams = [
      { label: 'MF', amount: Math.round(mf) },
      { label: 'US', amount: Math.round(us) },
      { label: 'IND', amount: Math.round(ind) },
    ].filter((s) => s.amount > 0);
    return {
      key,
      mn: d.toLocaleString('en', { month: 'short' }).toUpperCase(),
      yy: String(d.getFullYear()).slice(2),
      streams,
      total: streams.reduce((s, x) => s + x.amount, 0),
      state: key < curKey ? 'closed' : key === curKey ? 'current' : 'planned',
    };
  }), [fySel, fx, fxHist]);

  // sel: month index, or 'fy' for the year aggregate
  const defaultSel = (() => {
    const i = MONTHS.findIndex((m) => m.state === 'current');
    return i >= 0 ? i : 'fy';
  })();
  const [sel, setSel] = useState(defaultSel);
  const pickFY = (y) => { setFySel(y); setSel(y === curFY ? defaultSel : 'fy'); };

  const elapsed = MONTHS.filter((m) => m.state !== 'planned');
  const fyTot = elapsed.reduce((a, m) => a + m.total, 0);
  const isCurFY = fySel === curFY;

  // Selected view: a single month, or the FY aggregate
  const overall = sel === 'fy';
  const mo = overall ? null : MONTHS[sel];
  const viewStreams = overall
    ? Object.values(elapsed.flatMap((m) => m.streams).reduce((acc, s) => {
        (acc[s.label] ||= { label: s.label, amount: 0 }).amount += s.amount;
        return acc;
      }, {}))
    : (mo.streams || []);
  const viewTotal = overall ? fyTot : mo.total;
  const planned = !overall && mo.state === 'planned';
  const segs = viewTotal ? viewStreams.map((s) => ({ ...s, color: STREAM_COLORS[s.label] || 'var(--pnk)', pct: Math.round(s.amount / viewTotal * 100) })) : [];

  const avgMo = elapsed.length ? Math.round(fyTot / elapsed.length) : null;
  const runRate = avgMo != null ? avgMo * 12 : null;
  const maxMonth = Math.max(...MONTHS.map((m) => m.total), 1);

  const headSub = overall
    ? (isCurFY ? 'deployed FY to date' : 'deployed across the year')
    : planned ? 'not yet deployed'
    : !viewTotal ? 'nothing deployed'
    : mo.state === 'current' ? 'deployed this month'
    : `deployed in ${mo.mn.charAt(0) + mo.mn.slice(1).toLowerCase()} ’${mo.yy}`;

  return (
    <div className="card sec">
      <div className="fxc" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="ctitle">Capital Deployment</div>
          <div className="sub" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'var(--sur2)', border: '.5px solid var(--brd2)', borderRadius: 3, padding: '1px 8px' }}>
              {overall ? fyLabel(fySel) : `${mo.mn} ${mo.yy}`}
            </span>
            {overall ? (isCurFY ? 'FY to date' : 'full year') : planned ? 'planned' : mo.state === 'current' ? 'current month' : 'closed'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={'vmd ' + (viewTotal ? 'grn' : '')}>{viewTotal ? <RsText>{inrFull(viewTotal)}</RsText> : '—'}</div>
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
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>{planned ? 'Month not reached.' : 'No flows recorded.'}</span>
        ) : segs.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-2xs)', color: 'var(--txt2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <RsText>{`${s.label} ${inrFull(s.amount)} · ${s.pct}%`}</RsText>
          </span>
        ))}
      </div>

      {/* FY chips — every year the ledgers touch; the active one drives the grid */}
      <div className="fxc" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {FYS.map((y) => {
            const active = y === fySel;
            return (
              <span key={y} onClick={() => pickFY(y)}
                style={{
                  fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer',
                  color: active ? 'var(--acc)' : 'var(--txt3)',
                  borderBottom: active ? '1px solid var(--acc)' : '1px solid transparent',
                }}>
                {fyLabel(y)}
              </span>
            );
          })}
        </div>
        <span onClick={() => setSel('fy')} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', cursor: 'pointer' }}>
          {isCurFY ? 'YTD' : 'Total'} <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}><RsText>{inrFull(fyTot)}</RsText></strong>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, marginBottom: 16 }}>
        {MONTHS.map((m, i) => {
          const bg = m.state === 'planned' ? 'var(--brd2)' : m.total ? 'var(--acc)' : 'var(--sur2)';
          const op = m.state === 'planned' ? 1 : m.total ? Math.max(.4, m.total / maxMonth) : .35;
          return (
            <div key={m.key} onClick={() => setSel(i)}
              style={{ cursor: 'pointer', borderRadius: 2, padding: 2, border: sel === i ? '.5px solid var(--txt)' : '.5px solid transparent', transition: 'border-color .1s' }}>
              <div style={{ height: 22, background: bg, opacity: op, borderRadius: 1 }} />
              <div style={{ fontSize: '0.6rem', textAlign: 'center', color: 'var(--txt3)', marginTop: 3, fontFamily: 'var(--mono)', letterSpacing: '.04em' }}>{m.mn}</div>
              <div style={{ fontSize: '0.6rem', textAlign: 'center', color: 'var(--txt2)', marginTop: 1, fontFamily: 'var(--mono)' }}>{m.state === 'planned' ? '—' : <RsText>{fK(m.total)}</RsText>}</div>
            </div>
          );
        })}
      </div>

      {/* summary stats — all derived from ledger flows */}
      <div className="g3">
        <div className="mini">
          <div className="lbl">deployed</div>
          <div className="vsm grn">{elapsed.length ? <RsText>{inrFull(fyTot)}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">avg / mo</div>
          <div className="vsm">{avgMo != null ? <RsText>{inrFull(avgMo)}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">run-rate (annualised)</div>
          <div className="vsm">{runRate != null ? <RsText>{inrFull(runRate)}</RsText> : '—'}</div>
        </div>
      </div>
    </div>
  );
}
