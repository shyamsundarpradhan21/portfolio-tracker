'use client';
import { useState } from 'react';
import { Rs, RsText } from '../../lib/fmt';

// ── SIP deployment calendar ───────────────────────────────────────────────────
// Base SIPs (Jio + Vested) fire automatically every month; on top of that,
// 0–2 discretionary "trigger" picks of ₹30K each get deployed on dips.
// Clicking a month shows its composition; closed months drive the YTD,
// average and full-year estimate figures.
const SIP_JIO = 20000, SIP_VES = 19000, SIP_EACH = 30000, SIP_SAL = 117500;
const SIP_AUTO = SIP_JIO + SIP_VES;
const SIP_FY = [
  { mn: 'APR', yy: '26', t: 1 },
  { mn: 'MAY', yy: '26', t: 2 },
  { mn: 'JUN', yy: '26', t: 0, cur: true },
  { mn: 'JUL', yy: '26', t: null }, { mn: 'AUG', yy: '26', t: null }, { mn: 'SEP', yy: '26', t: null },
  { mn: 'OCT', yy: '26', t: null }, { mn: 'NOV', yy: '26', t: null }, { mn: 'DEC', yy: '26', t: null },
  { mn: 'JAN', yy: '27', t: null }, { mn: 'FEB', yy: '27', t: null }, { mn: 'MAR', yy: '27', t: null },
];
const fK = (n) => n >= 100000 ? '₹' + (n / 100000).toFixed(2) + 'L' : '₹' + Math.round(n / 1000) + 'K';

export default function SipCard() {
  const [sel, setSel] = useState(SIP_FY.findIndex((m) => m.cur));
  const mo = SIP_FY[sel];
  const t = mo.t === null ? 0 : mo.t;
  const picks = t * SIP_EACH, total = SIP_AUTO + picks;
  const p1 = Math.round(SIP_JIO / total * 100);
  const p2 = Math.round(SIP_VES / total * 100);
  const p3 = picks ? 100 - p1 - p2 : 0;
  const sal = Math.round(total / SIP_SAL * 100);
  const planned = mo.t === null;

  const closed = SIP_FY.filter((m) => m.t !== null);
  const ytdTot = closed.reduce((a, m) => a + SIP_AUTO + m.t * SIP_EACH, 0);
  const trigYTD = closed.reduce((a, m) => a + m.t, 0);
  const avgT = trigYTD / closed.length;
  const estFY = Math.round((SIP_AUTO + avgT * SIP_EACH) * 12);
  const peak = closed.reduce((b, m) => m.t > b.t ? m : b, closed[0]);

  return (
    <div className="card sec">
      <div className="fxc" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="ctitle">SIP Deployment</div>
          <div className="sub" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'var(--sur2)', border: '.5px solid var(--brd2)', borderRadius: 3, padding: '1px 8px' }}>
              {mo.mn} {mo.yy}
            </span>
            {planned ? 'planned · base only' : mo.cur ? 'current month' : 'closed'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={'vmd ' + (sal >= 70 ? 'red' : sal >= 50 ? '' : 'grn')}><RsText>{fK(total)}</RsText></div>
          <div className="sub" style={{ margin: 0 }}>{sal}% of salary</div>
        </div>
      </div>

      {/* composition bar */}
      <div style={{ height: 22, background: 'var(--sur2)', borderRadius: 3, overflow: 'hidden', position: 'relative', marginBottom: 8 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: p1 + '%', background: 'var(--grn)', transition: 'width .45s cubic-bezier(.16,1,.3,1)' }} />
        <div style={{ position: 'absolute', left: p1 + '%', top: 0, height: '100%', width: p2 + '%', background: 'var(--blu)', transition: 'all .45s cubic-bezier(.16,1,.3,1)' }} />
        {p3 > 0 && <div style={{ position: 'absolute', left: (p1 + p2) + '%', top: 0, height: '100%', width: p3 + '%', background: 'var(--acc)', opacity: .75, transition: 'all .45s cubic-bezier(.16,1,.3,1)' }} />}
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {[['var(--grn)', `JioBLK ₹20K · ${p1}%`], ['var(--blu)', `Vested ₹19K · ${p2}%`], ['var(--acc)', picks ? `Picks ${fK(picks)} · ${t} trig` : 'Picks ₹0 · 0 trig']].map(([c, txt]) => (
          <span key={txt} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-2xs)', color: 'var(--txt2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} /><RsText>{txt}</RsText>
          </span>
        ))}
      </div>

      {/* calendar grid */}
      <div className="fxc" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>FY 26–27 · click month</span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>
          YTD <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}><RsText>{fK(ytdTot)}</RsText></strong>
          {' · '}est FY <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}><Rs />{(estFY / 100000).toFixed(1)}L</strong>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3, marginBottom: 16 }}>
        {SIP_FY.map((m, i) => {
          const moTotal = m.t === null ? null : SIP_AUTO + m.t * SIP_EACH;
          const bg = m.t === null ? 'var(--brd2)' : 'var(--grn)';
          const op = m.t === null ? 1 : m.t === 0 ? .3 : m.t === 1 ? .65 : 1;
          return (
            <div key={i} onClick={() => setSel(i)}
              style={{ cursor: 'pointer', borderRadius: 2, padding: 2, border: sel === i ? '.5px solid var(--txt)' : '.5px solid transparent', transition: 'border-color .1s' }}>
              <div style={{ height: 22, background: bg, opacity: op, borderRadius: 1 }} />
              <div style={{ fontSize: 7.5, textAlign: 'center', color: 'var(--txt3)', marginTop: 3, fontFamily: 'var(--mono)', letterSpacing: '.04em' }}>{m.mn}</div>
              <div style={{ fontSize: 7.5, textAlign: 'center', color: 'var(--txt2)', marginTop: 1, fontFamily: 'var(--mono)' }}>{moTotal === null ? '—' : <RsText>{fK(moTotal)}</RsText>}</div>
            </div>
          );
        })}
      </div>

      {/* summary stats */}
      <div className="g4">
        <div className="mini">
          <div className="lbl">floor</div>
          <div className="vsm grn"><RsText>{fK(SIP_AUTO)}</RsText>/mo</div>
        </div>
        <div className="mini">
          <div className="lbl">trig YTD</div>
          <div className="vsm" style={{ color: 'var(--acc)' }}>{trigYTD} · <RsText>{fK(trigYTD * SIP_EACH)}</RsText></div>
        </div>
        <div className="mini">
          <div className="lbl">avg / mo</div>
          <div className="vsm"><RsText>{fK(Math.round(ytdTot / closed.length))}</RsText></div>
        </div>
        <div className="mini">
          <div className="lbl">peak mo</div>
          <div className="vsm">{peak.mn} <RsText>{fK(SIP_AUTO + peak.t * SIP_EACH)}</RsText></div>
        </div>
      </div>
    </div>
  );
}
