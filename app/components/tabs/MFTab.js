'use client';
import { cl, pctS, Pct, InrC, InrF, SInrF, Rs } from '../../lib/fmt';
import { LiveInrF } from '../shared/Live';
import { MF_CASHFLOWS, MF_SIP } from '../../portfolio';
import AnalysisCard from '../shared/AnalysisCard';
import FreshnessTag from '../shared/FreshnessTag';
import CFMemo from '../shared/CFMemo';
import SunburstMix from '../SunburstMix';

// '2026-01-13' → '13-Jan-26' (footer prose); pass fullYear for '26-Feb-2027'.
const dmy = (iso, fullYear = false) => {
  const d = new Date(iso + 'T00:00:00Z');
  const y = fullYear ? d.getUTCFullYear() : String(d.getUTCFullYear()).slice(2);
  return `${d.getUTCDate()}-${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}-${y}`;
};

const platStyle = (p) => p === 'JioBLK'
  ? { background: 'color-mix(in srgb, var(--pur) 14%, transparent)', color: 'var(--pur)' }
  : { background: 'color-mix(in srgb, var(--grn) 14%, transparent)', color: 'var(--grn)' };

// ── Zero-anchored XIRR bar chart — portfolio vs several index counterfactuals.
// One row per series: name | bar around a shared 0% axis, with the percentage
// printed beside the axis on the side opposite the bar. Your bar takes the tab
// accent; benchmarks share a neutral fill so colour encodes "you vs market".
function XirrChart({ port, bench, delta, extra = [], minis = [] }) {
  const rows = [
    { label: 'You',      val: port, you: true },
    { label: 'Nifty 50', val: bench },
    ...extra.map((b) => ({ label: b.label, val: b.xirr })),
  ];
  const max = Math.max(...rows.map((r) => Math.abs(r.val ?? 0)), 8) * 1.15;
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
      <div className="sub" style={{ marginBottom: 16 }}>Your MF cashflows replayed into each index · annualised</div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
        {rows.map(({ label, val, you }) => {
          const pos = (val ?? 0) >= 0;
          const w = val == null ? '0%' : Math.min(Math.abs(val) / max * 100, 100) + '%';
          const fill = you ? 'var(--acc)' : 'color-mix(in srgb, var(--txt3) 55%, transparent)';
          const pctTxt = val == null ? '—' : Math.abs(val).toFixed(1) + '%';
          const pctEl = (
            <span className="mono" style={{ fontSize: 'var(--fs-md)', fontWeight: you ? 700 : 600, padding: '0 10px', whiteSpace: 'nowrap', color: val == null ? 'var(--txt3)' : val >= 0 ? 'var(--grn)' : 'var(--red)' }}>
              {pctTxt}
            </span>
          );
          return (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: 'minmax(118px, 9.5em) 1fr', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-md)', fontWeight: you ? 700 : 500, color: you ? 'var(--acc)' : 'var(--txt2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
              <div style={{ display: 'flex', height: you ? '3.2em' : '2.6em', alignItems: 'center' }}>
                {/* left half: negative bar grows from the axis; % sits here for positive rows */}
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', alignSelf: 'stretch' }}>
                  {val != null && !pos
                    ? <div style={{ width: w, background: fill, borderRadius: '4px 0 0 4px', alignSelf: 'stretch' }} />
                    : pctEl}
                </div>
                <div style={{ width: 1, background: 'var(--brd2)', flexShrink: 0, alignSelf: 'stretch' }} />
                {/* right half: positive bar grows from the axis; % sits here for negative rows */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', alignSelf: 'stretch' }}>
                  {val != null && pos
                    ? <div style={{ width: w, background: fill, borderRadius: '0 4px 4px 0', alignSelf: 'stretch' }} />
                    : val != null ? pctEl : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {minis.length > 0 && (
        <>
          <div style={{ height: 1, background: 'var(--brd)', margin: '16px 0 14px' }} />
          <div className="g3">
            {minis.map(({ label, cls, name, sub, subCls }) => (
              <div className="mini" key={label}>
                <div className="lbl" style={{ marginBottom: 4 }}>{label}</div>
                <div className={'vsm ' + (cls || '')} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || '—'}</div>
                <div className={'sub ' + (subCls || '')}>{sub}</div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sub" style={{ marginTop: 12, color: 'var(--txt3)', lineHeight: 1.6 }}>
        Counterfactual: every SIP/lump-sum replayed into each index at the same dates — XIRR weights early money more. A young SIP book swings hard on recent months; the gap narrows as history builds.
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

  // Winner / Drag / Largest minis — same trio as the equity tabs, by fund.
  const funded  = mf.rows.filter((r) => r.cost > 0);
  const winner  = funded.length ? funded.reduce((a, b) => (b.ret > a.ret ? b : a)) : null;
  const laggard = funded.length ? funded.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;
  const largest = funded.length ? funded.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const minis = [
    { label: 'Winner',  cls: 'grn', name: winner?.cat,  sub: winner  ? pctS(winner.ret)  : 'by return', subCls: winner  ? cl(winner.ret)  : '' },
    { label: 'Drag',    cls: 'red', name: laggard?.cat, sub: laggard ? pctS(laggard.ret) : 'by return', subCls: laggard ? cl(laggard.ret) : '' },
    { label: 'Largest', cls: '',    name: largest?.cat, sub: largest ? `${largest.share.toFixed(0)}% of book` : 'by value' },
  ];

  return (
    <div>
      <AnalysisCard data={insights?.mf} on={insightsOn} loading={insightsOn && insightsFirstLoad} />

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
          <div className="vmd grn" style={{ marginTop: 6 }}><LiveInrF n={mf.totVal} /></div>
          <div className="sub">live NAV × CAS units ({UNITS_AS_OF})</div>
        </div>
        <div className="csm">
          <div className="lbl">total return</div>
          <div className={'vmd ' + cl(mf.totRet)}>{pctS(mf.totRet)}</div>
          <div className="sub"><SInrF n={mf.totVal - mf.totCost} /> unrealised</div>
        </div>
      </div>

      {/* Dual-ring sunburst (outer = asset class, inner = cap mix) on the left;
          multi-benchmark XIRR chart on the right. */}
      <div className="g2 sec">
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
          extra={mfBench.filter((b) => b.key !== 'nifty50')} minis={minis} />
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
          {(() => {
            const jioDates = new Set(MF_FUNDS.filter((f) => f.platform === MF_SIP.platformShort).map((f) => f.bought));
            const seeds = MF_CASHFLOWS.filter((c) => jioDates.has(c.date));
            const elss = MF_FUNDS.find((f) => f.id === 'elss');
            const unlock = elss ? dmy(`${+elss.bought.slice(0, 4) + MF_SIP.elssLockYears}${elss.bought.slice(4)}`, true) : null;
            return (
              <>
                {MF_SIP.platform}: <Rs />{Math.round(MF_SIP.monthly / 1000)}K/mo SIP active
                {seeds.length > 0 && <> — seeded {seeds.map((c, i) => (
                  <span key={c.date}>{i > 0 && ' + '}<Rs />{Math.round(-c.amount / 1000)}K ({dmy(c.date)})</span>
                ))}</>}.
                {elss && <> Zerodha ELSS: {MF_SIP.elssLockYears}-yr lock-in, unlocks {unlock}.</>}
              </>
            );
          })()}
        </div>
      </div>

      <CFMemo
        title={`MF Redemption Tax — ${FY.labels.verified} Capital Gains`}
        rows={[
          { label: `${FY.labels.verified} MF redemptions`, val: FY.cf.cg2526.mfStcg === 0 ? 'Nil' : '+₹' + FY.cf.cg2526.mfStcg.toLocaleString('en-IN'), color: 'var(--txt2)', sub: FY.cf.cg2526.mfStcgNote },
          { label: `STCG loss carried into ${FY.labels.current}`, val: '₹' + FY.cf.stcgCarried.toLocaleString('en-IN'), color: 'var(--grn)', sub: FY.cf.stcgNote },
        ]}
        foot={`${FY.cf.cg2526.mfStcg === 0 ? `No redemptions in ${FY.labels.verified} — no MF capital-gains event.` : `${FY.labels.verified} redemptions taxed as capital gains.`} ELSS units stay locked ${MF_SIP.elssLockYears} years from each SIP date; gains crystallise only on redemption.`}
      />
    </div>
  );
}
