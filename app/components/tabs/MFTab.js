'use client';
import { useState } from 'react';
import { cl, pctS, pct1, Pct, InrC, InrF, SInrF, Rs, inrCd } from '../../lib/fmt';
import InsightBanner from '../shared/InsightBanner';
import FreshnessTag from '../shared/FreshnessTag';
import CFMemo from '../shared/CFMemo';
import TreeMap from '../shared/TreeMap';

const platStyle = (p) => p === 'JioBLK'
  ? { background: 'color-mix(in srgb, var(--pur) 14%, transparent)', color: 'var(--pur)' }
  : { background: 'color-mix(in srgb, var(--grn) 14%, transparent)', color: 'var(--grn)' };

// ── Asset-allocation donut — wider ring, larger legend ───────────────────────
function AllocDonut({ segs, total }) {
  const [hov, setHov] = useState(null);
  const size = 200, thick = 32, r = (size - thick) / 2, C = 2 * Math.PI * r;
  const live = segs.filter((s) => s.val > 0);
  const gapFrac = live.length > 1 ? 2.5 / 360 : 0;
  const tot = total || live.reduce((s, x) => s + x.val, 0) || 1;
  const centre = hov || { label: 'invested', val: tot };
  let acc = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg className="svgchart" viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: 240, height: 'auto' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sur2)" strokeWidth={thick} />
        {live.map((s) => {
          const frac = s.val / tot;
          const arc = Math.max(frac - gapFrac, 0.004) * C;
          const rot = acc * 360 - 90 + (gapFrac * 360) / 2;
          acc += frac;
          return (
            <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thick}
              strokeDasharray={`${arc} ${C}`}
              transform={`rotate(${rot} ${size / 2} ${size / 2})`}
              opacity={hov && hov.label !== s.label ? 0.2 : 1}
              style={{ transition: 'opacity .15s', cursor: 'pointer' }}
              onMouseEnter={() => setHov({ label: s.label, val: s.val })}
              onMouseLeave={() => setHov(null)} />
          );
        })}
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle"
          style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.5px', fill: 'var(--txt)' }}>
          <tspan fontSize="17">₹</tspan>{inrCd(centre.val)}
        </text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle"
          style={{ fontSize: 10, letterSpacing: '0.8px', textTransform: 'uppercase', fontWeight: 700, fill: 'var(--txt3)' }}>
          {centre.label}
        </text>
      </svg>
      <div style={{ width: '100%', marginTop: 16 }}>
        {segs.map((s) => (
          <div key={s.label} className="fxc"
            style={{ marginBottom: 9, opacity: s.val > 0 ? 1 : 0.4, cursor: 'default' }}
            onMouseEnter={() => s.val > 0 && setHov({ label: s.label, val: s.val })}
            onMouseLeave={() => setHov(null)}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--txt2)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color, flexShrink: 0 }} />{s.label}
            </span>
            <span className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
              <InrC n={s.val} /> · <Pct n={(s.val / tot) * 100} d={1} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Zero-anchored XIRR bar chart ──────────────────────────────────────────────
function XirrChart({ port, bench, delta }) {
  const max = Math.max(Math.abs(port ?? 0), Math.abs(bench ?? 0), 8) * 1.2;
  const bars = [
    { label: 'YOU',   val: port,  color: (port ?? 0) >= 0 ? 'var(--grn)' : 'var(--red)' },
    { label: 'NIFTY', val: bench, color: (bench ?? 0) >= 0 ? 'var(--grn)' : 'var(--red)', dim: true },
  ];
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="fxc" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>XIRR vs Benchmark</span>
        {delta != null && (
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: delta >= 0 ? 'var(--grn)' : 'var(--red)' }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} pts {delta >= 0 ? 'ahead' : 'behind'}
          </span>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18 }}>
        {bars.map(({ label, val, color, dim }) => {
          if (val == null) return <div key={label} style={{ height: 42 }} />;
          const w = Math.min(Math.abs(val) / max * 100, 100) + '%';
          const pos = val >= 0;
          return (
            <div key={label}>
              <div className="fxc" style={{ marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--txt2)', fontWeight: 600, letterSpacing: '.05em' }}>{label}</span>
                <span className="mono" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color }}>{val >= 0 ? '+' : ''}{val.toFixed(1)}%</span>
              </div>
              <div style={{ display: 'flex', height: 20 }}>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch' }}>
                  {!pos && <div style={{ width: w, background: color, opacity: dim ? .65 : .9, borderRadius: '3px 0 0 3px', flexShrink: 0 }} />}
                </div>
                <div style={{ width: 1, background: 'var(--brd)', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', alignItems: 'stretch' }}>
                  {pos && <div style={{ width: w, background: color, opacity: dim ? .65 : .9, borderRadius: '0 3px 3px 0', flexShrink: 0 }} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* "0%" centered over the axis line using absolute positioning */}
      <div style={{ position: 'relative', height: 16, marginTop: 10 }}>
        <span className="mono" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>0%</span>
      </div>
    </div>
  );
}

// ── SIP deployment calendar ───────────────────────────────────────────────────
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

function SipCard() {
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
          <div className={'vmd ' + (sal >= 70 ? 'red' : sal >= 50 ? '' : 'grn')}>{fK(total)}</div>
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
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />{txt}
          </span>
        ))}
      </div>

      {/* calendar grid */}
      <div className="fxc" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>FY 26–27 · click month</span>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>
          YTD <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}>{fK(ytdTot)}</strong>
          {' · '}est FY <strong style={{ color: 'var(--txt)', fontFamily: 'var(--mono)' }}>₹{(estFY / 100000).toFixed(1)}L</strong>
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
              <div style={{ fontSize: 7.5, textAlign: 'center', color: 'var(--txt2)', marginTop: 1, fontFamily: 'var(--mono)' }}>{moTotal === null ? '—' : fK(moTotal)}</div>
            </div>
          );
        })}
      </div>

      {/* summary stats */}
      <div className="g4">
        <div className="mini">
          <div className="lbl">floor</div>
          <div className="vsm grn">{fK(SIP_AUTO)}/mo</div>
        </div>
        <div className="mini">
          <div className="lbl">trig YTD</div>
          <div className="vsm" style={{ color: 'var(--acc)' }}>{trigYTD} · {fK(trigYTD * SIP_EACH)}</div>
        </div>
        <div className="mini">
          <div className="lbl">avg / mo</div>
          <div className="vsm">{fK(Math.round(ytdTot / closed.length))}</div>
        </div>
        <div className="mini">
          <div className="lbl">peak mo</div>
          <div className="vsm">{peak.mn} {fK(SIP_AUTO + peak.t * SIP_EACH)}</div>
        </div>
      </div>
    </div>
  );
}

const MF_COLS = [
  { key: 'name',     label: 'Fund · share', num: false },
  { key: 'platform', label: 'Platform',     num: false },
  { key: 'units',    label: 'Units',        num: true  },
  { key: 'nav',      label: 'NAV',          num: true  },
  { key: 'value',    label: 'Value',        num: true  },
  { key: 'cost',     label: 'Cost',         num: true  },
  { key: 'ret',      label: 'Return',       num: true  },
];

export default function MFTab({ mf, mfx, mfSorted, mfSort, sortMf, insights, insightsOn, insightsFirstLoad, MF_FUNDS, UNITS_AS_OF, FY }) {
  const mfDate = (mf.rows.find((r) => r.navDate) || {}).navDate || null;
  const delta   = mfx.port != null && mfx.bench != null ? mfx.port - mfx.bench : null;

  const allocSegs = [
    { label: 'Equity',    val: mf.alloc.equity,    color: 'var(--pur)' },
    { label: 'Arbitrage', val: mf.alloc.arbitrage, color: 'var(--blu)' },
    { label: 'Debt',      val: mf.alloc.debt,      color: 'var(--txt3)' },
  ];
  const capSegs = [
    { label: 'Large',       val: mf.cap.large,  color: 'var(--blu)' },
    { label: 'Mid',         val: mf.cap.mid,    color: 'var(--pur)' },
    { label: 'Small',       val: mf.cap.small,  color: 'var(--grn)' },
    { label: 'Multi/Flexi', val: mf.cap.multi,  color: 'var(--pnk)' },
    { label: 'Hedged',      val: mf.cap.hedged, color: 'var(--acc)' },
  ];

  return (
    <div>
      <InsightBanner text={insightsOn ? insights?.mutual_funds : null} loading={insightsOn && insightsFirstLoad} />

      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">total invested</div>
          <div className="vmd"><InrF n={mf.totCost} /></div>
          <div className="sub">{MF_FUNDS.length} funds · 2 platforms</div>
        </div>
        <div className="csm">
          <div className="fxc">
            <div className="lbl" style={{ margin: 0 }}>current value</div>
            <FreshnessTag mode="nav" date={mfDate} />
          </div>
          <div className="vmd grn" style={{ marginTop: 6 }}><InrF n={mf.totVal} /></div>
          <div className="sub">live NAV × CAS units ({UNITS_AS_OF})</div>
        </div>
        <div className="csm">
          <div className="lbl">total return</div>
          <div className={'vmd ' + cl(mf.totRet)}>{pctS(mf.totRet)}</div>
          <div className="sub"><SInrF n={mf.totVal - mf.totCost} /> abs</div>
        </div>
      </div>

      <div className="mf-g3">
        <XirrChart port={mfx.port} bench={mfx.bench} delta={delta} />

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="ctitle" style={{ marginBottom: 14 }}>Asset Allocation</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <AllocDonut segs={allocSegs} total={mf.totVal} />
          </div>
          <div className="sub" style={{ marginTop: 10 }}>Arbitrage held as a cash-like sleeve, separate from equity.</div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="ctitle" style={{ marginBottom: 4 }}>Market Cap</div>
          <div className="sub" style={{ marginBottom: 12 }}>Each fund bucketed by mandate; Flexi Cap &amp; ELSS are multi-cap.</div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <TreeMap items={capSegs} height={252} />
          </div>
        </div>
      </div>

      <SipCard />

      <div className="card sec">
        <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="ctitle">Holdings</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="mf-chip"><span className="mf-dot" style={{ background: '#BCAEFF' }} />JioBlackRock <InrF n={mf.jio.value} /> <span className={cl(mf.jio.ret)} style={{ marginLeft: 2 }}>{pctS(mf.jio.ret)}</span></span>
            <span className="mf-chip"><span className="mf-dot" style={{ background: '#6EE7B7' }} />Zerodha ELSS <InrF n={mf.elss.value} /> <span className={cl(mf.elss.ret)} style={{ marginLeft: 2 }}>{pctS(mf.elss.ret)}</span></span>
          </div>
        </div>
        <div className="ovx">
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                {MF_COLS.map((c) => (
                  <th key={c.key} className={c.num ? 'ra' : ''} onClick={() => sortMf(c.key)}>
                    {c.label} {mfSort.key === c.key ? (mfSort.dir < 0 ? '↓' : '↑') : '↕'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mfSorted.map((f) => (
                <tr key={f.id}>
                  <td style={{ color: 'var(--txt)', fontWeight: 500 }}>
                    {f.name}
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', fontWeight: 400, marginTop: 2 }}>{f.cat} · <Pct n={f.share} d={1} /></div>
                  </td>
                  <td><span className="mf-pill" style={platStyle(f.platform)}>{f.platform}</span></td>
                  <td className="ra mono mut">{f.units.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                  <td className="ra mono">{f.nav.toFixed(4)}</td>
                  <td className="ra mono"><InrF n={f.value} /></td>
                  <td className="ra mono mut"><InrF n={f.cost} /></td>
                  <td className={'ra mono ' + cl(f.ret)}>{pctS(f.ret)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={4}>Total — {MF_FUNDS.length} funds</td>
                <td className="ra"><InrF n={mf.totVal} /></td>
                <td className="ra"><InrF n={mf.totCost} /></td>
                <td className={'ra ' + cl(mf.totRet)}>{pctS(mf.totRet)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
          JioBlackRock: <Rs />20K/mo SIP active — seeded <Rs />20K (13-Jan-26) + <Rs />30K (20-Mar-26). Zerodha ELSS: 3-yr lock-in, unlocks 26-Feb-2027.
        </div>
      </div>

      <CFMemo
        title="MF Redemption Tax — FY25-26 Capital Gains"
        rows={[
          { label: 'FY25-26 MF redemptions', val: 'Nil', color: 'var(--txt2)', sub: FY.cf.cg2526.mfStcgNote },
          { label: 'STCG loss carried into FY26-27', val: '₹0', color: 'var(--grn)', sub: FY.cf.stcgNote },
        ]}
      />
    </div>
  );
}
