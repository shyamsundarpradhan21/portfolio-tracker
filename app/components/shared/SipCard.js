'use client';
import { useState } from 'react';
import { Rs, RsText } from '../../lib/fmt';
import SIP from '../../../data/sip_deployment.json';

// ── SIP deployment calendar ───────────────────────────────────────────────────
// Fully data-driven from data/sip_deployment.json (uploaded monthly). Each
// recorded month lists the streams that actually deployed; the composition
// bar, legend and every stat derive from those rows. Months without a row are
// planned and contribute nothing. "Picks" streams count as dip-buy triggers.

const STREAM_COLORS = ['var(--grn)', 'var(--blu)', 'var(--pur)', 'var(--pnk)', 'var(--cyn)'];
const isPicks = (s) => /pick/i.test(s.label);
const streamColor = (label, idx) => (/pick/i.test(label) ? 'var(--acc)' : STREAM_COLORS[idx % STREAM_COLORS.length]);

// Build the 12 FY months from fyStartMonth, joining recorded sheet rows.
const [startY, startM] = SIP.fyStartMonth.split('-').map(Number);
const byMonth = Object.fromEntries(SIP.months.map((m) => [m.month, m]));
const now = new Date();
const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(startY, startM - 1 + i, 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const rec = byMonth[key] || null;
  const streams = rec ? rec.streams : null;
  const total = streams ? streams.reduce((s, x) => s + x.amount, 0) : null;
  const trig = streams ? Math.round(streams.filter(isPicks).reduce((s, x) => s + x.amount, 0) / SIP.triggerSize) : null;
  return {
    key,
    mn: d.toLocaleString('en', { month: 'short' }).toUpperCase(),
    yy: String(d.getFullYear()).slice(2),
    streams, total, trig,
    cur: key === curKey,
  };
});
const fK = (n) => n >= 100000 ? '₹' + (n / 100000).toFixed(2) + 'L' : '₹' + Math.round(n / 1000) + 'K';

export default function SipCard() {
  const defaultSel = (() => {
    const i = MONTHS.findIndex((m) => m.cur);
    return i >= 0 ? i : MONTHS.findIndex((m) => m.total !== null);
  })();
  const [sel, setSel] = useState(defaultSel >= 0 ? defaultSel : 0);
  const mo = MONTHS[sel];
  const planned = mo.total === null;
  const segs = (mo.streams || []).map((s, i) => ({ ...s, color: streamColor(s.label, i), pct: Math.round(s.amount / mo.total * 100) }));

  const closed = MONTHS.filter((m) => m.total !== null);
  const ytdTot = closed.reduce((a, m) => a + m.total, 0);
  const committedYTD = SIP.committedMonthly * closed.length;
  const vsCommitted = committedYTD ? Math.round(ytdTot / committedYTD * 100) : null;
  const avgMo = closed.length ? Math.round(ytdTot / closed.length) : null;
  const annual = avgMo != null ? avgMo * 12 : null;

  return (
    <div className="card sec">
      <div className="fxc" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="ctitle">SIP Deployment</div>
          <div className="sub" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'var(--sur2)', border: '.5px solid var(--brd2)', borderRadius: 3, padding: '1px 8px' }}>
              {mo.mn} {mo.yy}
            </span>
            {planned ? 'planned · awaiting sheet' : mo.cur ? 'current month' : 'closed'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={'vmd ' + (planned ? '' : 'grn')}>{planned ? '—' : <RsText>{fK(mo.total)}</RsText>}</div>
          <div className="sub" style={{ margin: 0 }}>{planned ? 'not yet deployed' : 'deployed this month'}</div>
        </div>
      </div>

      {/* composition bar — rendered from the selected month's sheet streams */}
      <div style={{ height: 22, background: 'var(--sur2)', borderRadius: 3, overflow: 'hidden', position: 'relative', marginBottom: 8 }}>
        {segs.map((s, i) => {
          const left = segs.slice(0, i).reduce((a, x) => a + x.pct, 0);
          return <div key={s.label} style={{ position: 'absolute', left: left + '%', top: 0, height: '100%', width: s.pct + '%', background: s.color, opacity: isPicks(s) ? .75 : .95, transition: 'all .45s cubic-bezier(.16,1,.3,1)' }} />;
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', minHeight: 16 }}>
        {planned ? (
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>No deployment recorded for this month yet.</span>
        ) : segs.map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-2xs)', color: 'var(--txt2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <RsText>{`${s.label} ${fK(s.amount)} · ${s.pct}%`}</RsText>
            {isPicks(s) && mo.trig > 0 ? <span style={{ color: 'var(--txt3)' }}>· {mo.trig} trig</span> : null}
          </span>
        ))}
      </div>

      {/* calendar grid */}
      <div className="fxc" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{SIP.fyLabel} · click month</span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>
          YTD <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}><RsText>{fK(ytdTot)}</RsText></strong>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, marginBottom: 16 }}>
        {MONTHS.map((m, i) => {
          const bg = m.total === null ? 'var(--brd2)' : 'var(--grn)';
          const op = m.total === null ? 1 : m.trig === 0 ? .3 : m.trig === 1 ? .65 : 1;
          return (
            <div key={m.key} onClick={() => setSel(i)}
              style={{ cursor: 'pointer', borderRadius: 2, padding: 2, border: sel === i ? '.5px solid var(--txt)' : '.5px solid transparent', transition: 'border-color .1s' }}>
              <div style={{ height: 22, background: bg, opacity: op, borderRadius: 1 }} />
              <div style={{ fontSize: 7.5, textAlign: 'center', color: 'var(--txt3)', marginTop: 3, fontFamily: 'var(--mono)', letterSpacing: '.04em' }}>{m.mn}</div>
              <div style={{ fontSize: 7.5, textAlign: 'center', color: 'var(--txt2)', marginTop: 1, fontFamily: 'var(--mono)' }}>{m.total === null ? '—' : <RsText>{fK(m.total)}</RsText>}</div>
            </div>
          );
        })}
      </div>

      {/* summary stats — all derived from sheet rows */}
      <div className="g4">
        <div className="mini">
          <div className="lbl">deployed</div>
          <div className="vsm grn">{closed.length ? <RsText>{fK(ytdTot)}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">deployed vs committed</div>
          <div className="vsm" style={{ color: 'var(--acc)' }}>{vsCommitted != null && closed.length ? vsCommitted + '%' : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">avg / mo</div>
          <div className="vsm">{avgMo != null ? <RsText>{fK(avgMo)}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">annual</div>
          <div className="vsm">{annual != null ? <RsText>{fK(annual)}</RsText> : '—'}</div>
        </div>
      </div>
    </div>
  );
}
