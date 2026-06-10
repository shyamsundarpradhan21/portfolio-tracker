'use client';
import { cl, pctS, Pct, InrC, InrF, SInrF, Rs } from '../../lib/fmt';
import InsightBanner from '../shared/InsightBanner';
import FreshnessTag from '../shared/FreshnessTag';
import CFMemo from '../shared/CFMemo';
import SunburstMix from '../SunburstMix';

const platStyle = (p) => p === 'JioBLK'
  ? { background: 'color-mix(in srgb, var(--pur) 14%, transparent)', color: 'var(--pur)' }
  : { background: 'color-mix(in srgb, var(--grn) 14%, transparent)', color: 'var(--grn)' };

// ── Zero-anchored XIRR bar chart — portfolio vs several index counterfactuals.
// One compact row per series: name | bar around a shared 0% axis | XIRR | Δ vs
// you. Your bar takes the tab accent; every benchmark uses the same neutral
// fill so colour only ever encodes "you vs the market".
function XirrChart({ port, bench, delta, extra = [] }) {
  const rows = [
    { label: 'You',      val: port, you: true },
    { label: 'Nifty 50', val: bench },
    ...extra.map((b) => ({ label: b.label, val: b.xirr })),
  ];
  const max = Math.max(...rows.map((r) => Math.abs(r.val ?? 0)), 8) * 1.15;
  const grid = { display: 'grid', gridTemplateColumns: '128px 1fr 76px 76px', gap: 12, alignItems: 'center' };
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="fxc" style={{ marginBottom: 2, flexWrap: 'wrap', gap: 8 }}>
        <div className="ctitle">XIRR vs Benchmarks</div>
        {delta != null && (
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: delta >= 0 ? 'var(--grn)' : 'var(--red)' }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} pts vs Nifty 50
          </span>
        )}
      </div>
      <div className="sub" style={{ marginBottom: 14 }}>Your MF cashflows replayed into each index · annualised</div>

      <div style={{ ...grid, marginBottom: 8 }}>
        {['Benchmark', '', 'XIRR', 'Δ you'].map((h, i) => (
          <span key={i} style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.07em', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</span>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' }}>
        {rows.map(({ label, val, you }) => {
          const pos = (val ?? 0) >= 0;
          const w = val == null ? '0%' : Math.min(Math.abs(val) / max * 100, 100) + '%';
          const fill = you ? 'var(--acc)' : 'color-mix(in srgb, var(--txt3) 55%, transparent)';
          const d = !you && val != null && port != null ? port - val : null;
          return (
            <div key={label} style={grid}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: you ? 700 : 500, color: you ? 'var(--acc)' : 'var(--txt2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              <div style={{ display: 'flex', height: you ? 34 : 28 }}>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                  {val != null && !pos && <div style={{ width: w, background: fill, borderRadius: '4px 0 0 4px' }} />}
                </div>
                <div style={{ width: 1, background: 'var(--brd2)', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex' }}>
                  {val != null && pos && <div style={{ width: w, background: fill, borderRadius: '0 4px 4px 0' }} />}
                </div>
              </div>
              <span className="mono" style={{ fontSize: 'var(--fs-sm)', fontWeight: you ? 700 : 600, textAlign: 'right', color: val == null ? 'var(--txt3)' : val >= 0 ? 'var(--grn)' : 'var(--red)' }}>
                {val == null ? '—' : (val >= 0 ? '+' : '') + val.toFixed(1) + '%'}
              </span>
              <span className="mono" style={{ fontSize: 'var(--fs-sm)', textAlign: 'right', color: d == null ? 'var(--txt3)' : d >= 0 ? 'var(--grn)' : 'var(--red)' }}>
                {d == null ? (you ? '·' : '—') : (d >= 0 ? '+' : '') + d.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ ...grid, marginTop: 10 }}>
        <span />
        <div style={{ position: 'relative', height: 14 }}>
          <span className="mono" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--fs-2xs)', color: 'var(--txt3)' }}>0%</span>
        </div>
        <span /><span />
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

export default function MFTab({ mf, mfx, mfBench = [], mfSorted, mfSort, sortMf, insights, insightsOn, insightsFirstLoad, MF_FUNDS, UNITS_AS_OF, FY }) {
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

      {/* Dual-ring sunburst (outer = asset class, inner = cap mix) on the left;
          multi-benchmark XIRR chart on the right. */}
      <div className="mf-g2 sec">
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="ctitle" style={{ marginBottom: 14 }}>Asset Allocation &amp; Market Cap</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SunburstMix
              sectors={capSegs.filter((s) => s.val > 0).map((s) => ({ ...s, pct: mf.totVal ? (s.val / mf.totVal) * 100 : 0 }))}
              caps={allocSegs.map((s) => ({ ...s, pct: mf.totVal ? (s.val / mf.totVal) * 100 : 0 }))}
              total={mf.totVal}
              secColors={capSegs.filter((s) => s.val > 0).map((s) => s.color)}
              capColor={Object.fromEntries(allocSegs.map((s) => [s.label, s.color]))}
              innerTitle="Class" innerSuffix="" />
          </div>
          <div className="sub" style={{ marginTop: 10 }}>
            Outer ring market cap by mandate (Flexi &amp; ELSS multi-cap) · inner ring asset class. Arbitrage held as a cash-like sleeve.
          </div>
        </div>

        <XirrChart port={mfx.port} bench={mfx.bench} delta={delta}
          extra={mfBench.filter((b) => b.key !== 'nifty50')} />
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
