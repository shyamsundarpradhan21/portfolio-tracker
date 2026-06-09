'use client';
import { cl, pctS, Pct, InrC, InrF, SInrF, Rs } from '../../lib/fmt';
import InsightBanner from '../shared/InsightBanner';
import FreshnessTag from '../shared/FreshnessTag';
import CFMemo from '../shared/CFMemo';

const fmtX = (n) => n == null ? '—' : Math.abs(n).toFixed(1) + '%';
const platStyle = (p) => p === 'JioBLK'
  ? { background: 'rgba(155,138,251,.16)', color: '#BCAEFF' }
  : { background: 'rgba(52,211,153,.16)', color: '#6EE7B7' };

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
  const capTot = capSegs.reduce((s, x) => s + x.val, 0) || 1;

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
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="ctitle" style={{ marginBottom: 12 }}>XIRR vs Nifty 50</div>
          <div className="g2" style={{ flex: 1 }}>
            {[
              { label: 'Your portfolio', val: mfx.port, sub: 'annualised' },
              { label: 'Nifty 50',       val: mfx.bench, sub: 'same dated rupees' },
            ].map(({ label, val, sub }) => (
              <div key={label} className="mini" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div className="lbl" style={{ marginBottom: 6 }}>{label}</div>
                <div className={'mono ' + (val != null ? cl(val) : '')} style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1 }}>{fmtX(val)}</div>
                <div className="sub" style={{ marginTop: 6 }}>{sub}</div>
              </div>
            ))}
          </div>
          {delta != null && (
            <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, textAlign: 'center', fontWeight: 700, fontSize: 14,
              ...(delta >= 0 ? { background: 'var(--grn-bg)', color: 'var(--grn)' } : { background: 'var(--red-bg)', color: 'var(--red)' }) }}>
              {delta >= 0 ? '▲ Ahead' : '▼ Behind'} by {Math.abs(delta).toFixed(1)} pts
            </div>
          )}
        </div>

        <div className="card">
          <div className="ctitle" style={{ marginBottom: 12 }}>Asset Allocation</div>
          {allocSegs.map((s) => {
            const pct = mf.totVal ? (s.val / mf.totVal) * 100 : 0;
            return (
              <div key={s.label} style={{ marginBottom: 12 }}>
                <div className="fxc" style={{ marginBottom: 5 }}>
                  <span style={{ fontSize: 13, color: 'var(--txt2)' }}>{s.label}</span>
                  <span className="mono" style={{ fontSize: 13 }}><InrC n={s.val} /> · <Pct n={pct} d={1} /></span>
                </div>
                <span className="bar-trk" style={{ display: 'block' }}>
                  <span className="bar-fil" style={{ width: pct + '%', background: s.color }} />
                </span>
              </div>
            );
          })}
          <div className="sub" style={{ marginTop: 10 }}>Arbitrage held as a cash-like sleeve, separate from equity.</div>
        </div>

        <div className="card">
          <div className="ctitle" style={{ marginBottom: 4 }}>Market Cap</div>
          <div className="sub" style={{ marginBottom: 12 }}>Each fund bucketed by mandate; Flexi Cap &amp; ELSS are multi-cap.</div>
          <div className="mf-stack">
            {capSegs.map((s) => (
              <span key={s.label} style={{ width: (s.val / capTot) * 100 + '%', background: s.color }} />
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            {capSegs.map((s) => (
              <div key={s.label} className="fxc" style={{ marginBottom: 7 }}>
                <span style={{ fontSize: 13, color: 'var(--txt2)', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <span className="mf-dot" style={{ background: s.color }} />{s.label}
                </span>
                <span className="mono" style={{ fontSize: 13 }}><InrC n={s.val} /> · <Pct n={(s.val / capTot) * 100} d={1} /></span>
              </div>
            ))}
          </div>
        </div>
      </div>

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
                    <div style={{ fontSize: 11, color: 'var(--txt3)', fontWeight: 400, marginTop: 2 }}>{f.cat} · <Pct n={f.share} d={1} /></div>
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
