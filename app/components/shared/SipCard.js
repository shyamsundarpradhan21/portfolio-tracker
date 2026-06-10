'use client';
import { useEffect, useMemo, useState } from 'react';
import { RsText, inrFull } from '../../lib/fmt';
import { TRANSACTIONS, US_CASHFLOWS, MF_CASHFLOWS } from '../../portfolio';
import PLAN from '../../../data/sip_deployment.json';

// ── SIP deployment calendar ───────────────────────────────────────────────────
// Derived entirely from the ledgers in portfolio.js — no recorded month data:
//   JioBLK = MF_CASHFLOWS outflows · Picks = TRANSACTIONS buys ·
//   Vested = US_CASHFLOWS deposits, each converted at the USD/INR close of its
//   own outflow date (from /api/fx-history); live rate only while that loads.
// Months before the current one are closed actuals (₹0 if nothing fired), the
// current month is running, future months are planned. Clicking a month shows
// its composition; the FY chip shows the overall (YTD) aggregate.

const STREAM_COLORS = { JioBLK: 'var(--grn)', Vested: 'var(--blu)', Picks: 'var(--acc)' };
const monthKey = (d) => d.slice(0, 7);
const fK = (n) => n >= 100000 ? '₹' + (n / 100000).toFixed(2) + 'L' : '₹' + Math.round(n / 1000) + 'K';

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

  // Historical USD/INR closes covering the FY window.
  const [fxHist, setFxHist] = useState(null);
  useEffect(() => {
    let dead = false;
    fetch(`/api/fx-history?start=${PLAN.fyStartMonth}-01`)
      .then((r) => r.json())
      .then((j) => { if (!dead && j.rates) setFxHist(j.rates); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  const { MONTHS, committedMo } = useMemo(() => {
    const [startY, startM] = PLAN.fyStartMonth.split('-').map(Number);
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(startY, startM - 1 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const jio = MF_CASHFLOWS.filter((c) => monthKey(c.date) === key && c.amount < 0)
        .reduce((s, c) => s - c.amount, 0);
      const vested = US_CASHFLOWS.filter((c) => monthKey(c.date) === key && c.invested > 0)
        .reduce((s, c) => s + c.invested * (rateFor(fxHist, c.date) ?? fx), 0);
      const picks = TRANSACTIONS.filter((t) => monthKey(t.date) === key)
        .reduce((s, t) => s + t.invested, 0);
      const streams = [
        { label: 'JioBLK', amount: Math.round(jio) },
        { label: 'Vested', amount: Math.round(vested) },
        { label: 'Picks', amount: Math.round(picks) },
      ].filter((s) => s.amount > 0);
      return {
        key,
        mn: d.toLocaleString('en', { month: 'short' }).toUpperCase(),
        yy: String(d.getFullYear()).slice(2),
        streams,
        total: streams.reduce((s, x) => s + x.amount, 0),
        state: key < curKey ? 'closed' : key === curKey ? 'current' : 'planned',
      };
    });
    const committedMo = PLAN.committed.reduce((s, c) => s + (c.inr ?? Math.round(c.usd * fx)), 0);
    return { MONTHS: months, committedMo };
  }, [fx, fxHist]);

  // sel: month index, or 'fy' for the overall aggregate
  const defaultSel = (() => {
    const i = MONTHS.findIndex((m) => m.state === 'current');
    return i >= 0 ? i : 'fy';
  })();
  const [sel, setSel] = useState(defaultSel);

  const elapsed = MONTHS.filter((m) => m.state !== 'planned');
  const ytdTot = elapsed.reduce((a, m) => a + m.total, 0);

  // Selected view: a single month, or the FY aggregate
  const overall = sel === 'fy';
  const mo = overall ? null : MONTHS[sel];
  const viewStreams = overall
    ? Object.values(elapsed.flatMap((m) => m.streams).reduce((acc, s) => {
        (acc[s.label] ||= { label: s.label, amount: 0 }).amount += s.amount;
        return acc;
      }, {}))
    : (mo.streams || []);
  const viewTotal = overall ? ytdTot : mo.total;
  const planned = !overall && mo.state === 'planned';
  const segs = viewTotal ? viewStreams.map((s) => ({ ...s, color: STREAM_COLORS[s.label] || 'var(--pur)', pct: Math.round(s.amount / viewTotal * 100) })) : [];

  const committedYTD = committedMo * elapsed.length;
  const vsCommitted = committedYTD ? Math.round(ytdTot / committedYTD * 100) : null;
  const avgMo = elapsed.length ? Math.round(ytdTot / elapsed.length) : null;
  const annual = avgMo != null ? avgMo * 12 : null;

  return (
    <div className="card sec">
      <div className="fxc" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="ctitle">SIP Deployment</div>
          <div className="sub" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'var(--sur2)', border: '.5px solid var(--brd2)', borderRadius: 3, padding: '1px 8px' }}>
              {overall ? PLAN.fyLabel : `${mo.mn} ${mo.yy}`}
            </span>
            {overall ? 'overall · FY to date' : planned ? 'planned' : mo.state === 'current' ? 'current month' : 'closed'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={'vmd ' + (viewTotal ? 'grn' : '')}>{viewTotal ? <RsText>{inrFull(viewTotal)}</RsText> : '—'}</div>
          <div className="sub" style={{ margin: 0 }}>{overall ? 'deployed FY to date' : viewTotal ? 'deployed this month' : planned ? 'not yet deployed' : 'nothing deployed'}</div>
        </div>
      </div>

      {/* composition bar — derived from the selected view's ledger flows */}
      <div style={{ height: 22, background: 'var(--sur2)', borderRadius: 3, overflow: 'hidden', position: 'relative', marginBottom: 8 }}>
        {segs.map((s, i) => {
          const left = segs.slice(0, i).reduce((a, x) => a + x.pct, 0);
          return <div key={s.label} style={{ position: 'absolute', left: left + '%', top: 0, height: '100%', width: s.pct + '%', background: s.color, opacity: s.label === 'Picks' ? .75 : .95, transition: 'all .45s cubic-bezier(.16,1,.3,1)' }} />;
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

      {/* calendar grid */}
      <div className="fxc" style={{ marginBottom: 8 }}>
        <span onClick={() => setSel('fy')}
          style={{
            fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer',
            color: overall ? 'var(--acc)' : 'var(--txt3)',
            borderBottom: overall ? '1px solid var(--acc)' : '1px solid transparent',
          }}>
          {PLAN.fyLabel} · overall
        </span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>
          YTD <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}><RsText>{inrFull(ytdTot)}</RsText></strong>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, marginBottom: 16 }}>
        {MONTHS.map((m, i) => {
          const bg = m.state === 'planned' ? 'var(--brd2)' : m.total ? 'var(--grn)' : 'var(--sur2)';
          const op = m.state === 'planned' ? 1 : m.total ? Math.max(.45, Math.min(1, m.total / (committedMo * 2 || 1))) : .35;
          return (
            <div key={m.key} onClick={() => setSel(i)}
              style={{ cursor: 'pointer', borderRadius: 2, padding: 2, border: sel === i ? '.5px solid var(--txt)' : '.5px solid transparent', transition: 'border-color .1s' }}>
              <div style={{ height: 22, background: bg, opacity: op, borderRadius: 1 }} />
              <div style={{ fontSize: 7.5, textAlign: 'center', color: 'var(--txt3)', marginTop: 3, fontFamily: 'var(--mono)', letterSpacing: '.04em' }}>{m.mn}</div>
              <div style={{ fontSize: 7.5, textAlign: 'center', color: 'var(--txt2)', marginTop: 1, fontFamily: 'var(--mono)' }}>{m.state === 'planned' ? '—' : <RsText>{fK(m.total)}</RsText>}</div>
            </div>
          );
        })}
      </div>

      {/* summary stats — all derived from ledger flows */}
      <div className="g4">
        <div className="mini">
          <div className="lbl">deployed</div>
          <div className="vsm grn">{elapsed.length ? <RsText>{inrFull(ytdTot)}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">deployed vs committed</div>
          <div className="vsm" style={{ color: 'var(--acc)' }}>{vsCommitted != null && elapsed.length ? vsCommitted + '%' : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">avg / mo</div>
          <div className="vsm">{avgMo != null ? <RsText>{inrFull(avgMo)}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">annual</div>
          <div className="vsm">{annual != null ? <RsText>{inrFull(annual)}</RsText> : '—'}</div>
        </div>
      </div>
    </div>
  );
}
