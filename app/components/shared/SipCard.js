'use client';
import { useState } from 'react';
import { Rs, RsText } from '../../lib/fmt';
import SIP from '../../../data/sip_deployment.json';

// ── SIP deployment calendar ───────────────────────────────────────────────────
// Fully data-driven from data/sip_deployment.json (updated monthly). Only
// months present in the sheet count as deployed — each row records the base
// amount that actually fired plus the number of triggerSize picks. Months
// without a row are planned and contribute nothing (₹0, no assumptions).

const COMMIT = SIP.base.reduce((s, b) => s + b.amount, 0); // committed stream split
const BASE_COLORS = ['var(--grn)', 'var(--blu)', 'var(--pur)', 'var(--pnk)'];

// Build the 12 FY months from fyStartMonth, joining recorded sheet rows.
const [startY, startM] = SIP.fyStartMonth.split('-').map(Number);
const byMonth = Object.fromEntries(SIP.months.map((m) => [m.month, m]));
const now = new Date();
const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(startY, startM - 1 + i, 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const rec = byMonth[key] || null;
  return {
    key,
    mn: d.toLocaleString('en', { month: 'short' }).toUpperCase(),
    yy: String(d.getFullYear()).slice(2),
    base: rec ? rec.base : null,
    t: rec ? rec.triggers : null,
    total: rec ? rec.base + rec.triggers * SIP.triggerSize : null,
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
  const t = mo.t ?? 0;
  const picks = t * SIP.triggerSize;
  const total = mo.total ?? 0;
  // Composition: split the recorded base across the committed streams pro-rata.
  const basePcts = total ? SIP.base.map((b) => Math.round((mo.base * (b.amount / COMMIT)) / total * 100)) : SIP.base.map(() => 0);
  const pickPct = picks && total ? 100 - basePcts.reduce((a, p) => a + p, 0) : 0;

  const closed = MONTHS.filter((m) => m.total !== null);
  const ytdTot = closed.reduce((a, m) => a + m.total, 0);
  const trigYTD = closed.reduce((a, m) => a + m.t, 0);
  const estFY = closed.length ? Math.round(ytdTot / closed.length * 12) : 0;
  const peak = closed.length ? closed.reduce((b, m) => m.total > b.total ? m : b, closed[0]) : null;

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
          <div className={'vmd ' + (total ? 'grn' : '')}>{total ? <RsText>{fK(total)}</RsText> : '—'}</div>
          <div className="sub" style={{ margin: 0 }}>{total ? 'deployed this month' : 'not yet deployed'}</div>
        </div>
      </div>

      {/* composition bar */}
      <div style={{ height: 22, background: 'var(--sur2)', borderRadius: 3, overflow: 'hidden', position: 'relative', marginBottom: 8 }}>
        {SIP.base.map((b, i) => {
          const left = basePcts.slice(0, i).reduce((a, p) => a + p, 0);
          return <div key={b.label} style={{ position: 'absolute', left: left + '%', top: 0, height: '100%', width: basePcts[i] + '%', background: BASE_COLORS[i % BASE_COLORS.length], transition: 'all .45s cubic-bezier(.16,1,.3,1)' }} />;
        })}
        {pickPct > 0 && <div style={{ position: 'absolute', left: basePcts.reduce((a, p) => a + p, 0) + '%', top: 0, height: '100%', width: pickPct + '%', background: 'var(--acc)', opacity: .75, transition: 'all .45s cubic-bezier(.16,1,.3,1)' }} />}
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          ...SIP.base.map((b, i) => [BASE_COLORS[i % BASE_COLORS.length], planned ? `${b.label} —` : `${b.label} ${fK(Math.round(mo.base * (b.amount / COMMIT)))} · ${basePcts[i]}%`]),
          ['var(--acc)', picks ? `Picks ${fK(picks)} · ${t} trig` : planned ? 'Picks —' : 'Picks ₹0 · 0 trig'],
        ].map(([c, txt]) => (
          <span key={txt} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-2xs)', color: 'var(--txt2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} /><RsText>{txt}</RsText>
          </span>
        ))}
      </div>

      {/* calendar grid */}
      <div className="fxc" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{SIP.fyLabel} · click month</span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>
          YTD <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}><RsText>{fK(ytdTot)}</RsText></strong>
          {' · '}est FY <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}><Rs />{(estFY / 100000).toFixed(1)}L</strong>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, marginBottom: 16 }}>
        {MONTHS.map((m, i) => {
          const bg = m.total === null ? 'var(--brd2)' : 'var(--grn)';
          const op = m.total === null ? 1 : m.t === 0 ? .3 : m.t === 1 ? .65 : 1;
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

      {/* summary stats — all derived from sheet rows only */}
      <div className="g4">
        <div className="mini">
          <div className="lbl">committed /mo</div>
          <div className="vsm grn"><RsText>{fK(COMMIT)}</RsText></div>
        </div>
        <div className="mini">
          <div className="lbl">trig YTD</div>
          <div className="vsm" style={{ color: 'var(--acc)' }}>{trigYTD} · <RsText>{fK(trigYTD * SIP.triggerSize)}</RsText></div>
        </div>
        <div className="mini">
          <div className="lbl">avg / mo</div>
          <div className="vsm">{closed.length ? <RsText>{fK(Math.round(ytdTot / closed.length))}</RsText> : '—'}</div>
        </div>
        <div className="mini">
          <div className="lbl">peak mo</div>
          <div className="vsm">{peak ? <>{peak.mn} <RsText>{fK(peak.total)}</RsText></> : '—'}</div>
        </div>
      </div>
    </div>
  );
}
