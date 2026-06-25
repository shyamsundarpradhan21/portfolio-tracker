'use client';
import { cl, pctS, pct1, InrC, SInrF, Rs, UsdF } from '../../lib/fmt';
import { LiveUsdF } from '../shared/Live';
import BenchmarkBars from '../shared/BenchmarkBars';
import { SECTOR_PALETTE, OTHERS_COLOR, US_COLS } from '../../lib/constants';
import AnalysisCard from '../shared/AnalysisCard';
import FreshnessTag from '../shared/FreshnessTag';
import CFMemo from '../shared/CFMemo';
import SunburstMix from '../SunburstMix';
import RealizedPanel from '../RealizedPanel';
import EquityDayCurve from '../shared/EquityDayCurve';
import Skel from '../shared/Skel';


export default function USTab({
  usData, usStats, usSorted, usSort, sortUs, ov, fxRate, flash, markets, lastUpdate,
  insights, insightsOn, insightsFirstLoad,
  US, US_REALIZED, US_DIVIDENDS, FY,
}) {
  return (
    <div>
      <AnalysisCard data={insights?.us} on={insightsOn} loading={insightsOn && insightsFirstLoad} accent="var(--cyn)" />
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <FreshnessTag mode="live" marketState={{ open: markets.nyse, label: `NYSE ${markets.nyse ? 'OPEN' : 'CLOSED'} · ${lastUpdate}` }} />
      </div>

      {/* Live intraday US-equity day-change curve (₹), captured during US hours */}
      <EquityDayCurve kind="us" />

      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">Invested (cost)</div>
          <div className="vmd"><UsdF n={usData.inv} /></div>
          <div className="sub">≈<span className="mut"><InrC n={usData.inv * fxRate} /></span> · {US.length} holdings</div>
        </div>
        <div className="csm">
          <div className="lbl">Current value</div>
          <div className="vmd">{usData.val ? <LiveUsdF n={usData.val} /> : <Skel w={90} h={20} />}</div>
          <div className="sub">{usData.val && fxRate ? <>≈<span className="mut"><InrC n={ov.usInr} /></span> @ <Rs />{fxRate.toFixed(2)}</> : 'live NYSE'}</div>
        </div>
        <div className="csm">
          <div className="lbl">Unrealized P&amp;L</div>
          <div className={'vmd ' + (usData.val ? cl(usData.pl) : '')}>{usData.val ? <LiveUsdF n={usData.pl} /> : <Skel w={80} h={20} />}</div>
          <div className="sub">{usData.val ? <>{pctS(usData.pct)} on cost · ≈<span className="mut"><InrC n={Math.abs(usData.pl) * fxRate} /></span></> : 'value − cost'}</div>
        </div>
      </div>
      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">Day change</div>
          <div className={'vmd ' + (usData.val ? cl(usStats.dayPl) : '')}>{usData.val ? <LiveUsdF n={usStats.dayPl} /> : <Skel w={80} h={20} />}</div>
          <div className="sub">{usData.val ? <>{pctS(usStats.dayPct)} vs prev close · ≈<span className="mut"><InrC n={Math.abs(usStats.dayPl) * fxRate} /></span></> : 'vs prev close'}</div>
        </div>
        <div className="csm">
          <div className="lbl">CAGR (annualised)</div>
          <div className={'vmd ' + (usStats.cagr != null ? cl(usStats.cagr) : '')}>{usStats.cagr != null ? pct1(usStats.cagr) : <Skel w={70} h={20} />}</div>
          <div className="sub">money-weighted · since Mar 2024</div>
        </div>
        <div className="csm">
          <div className="lbl">Realized P&amp;L (YTD)</div>
          <div className={'vmd ' + cl(US_REALIZED.ytdUsd)}><UsdF n={US_REALIZED.ytdUsd} /></div>
          <div className="sub">{US_REALIZED.ytdLabel} · ≈<span className="mut"><InrC n={Math.abs(US_REALIZED.ytdUsd) * fxRate} /></span></div>
        </div>
      </div>

      <div className="g2 sec">
        <div className="card">
          <div className="ctitle" style={{ marginBottom: 4 }}>vs Benchmarks</div>
          <div className="sub" style={{ marginBottom: 14 }}>Same dated dollars — your <UsdF n={usStats.netInvested} d={0} /> <span className="mut">(≈<InrC n={usStats.netInvested * fxRate} />)</span> deployed into each instead.</div>
          <BenchmarkBars you={usStats.xirr} rows={usStats.benchmarks.filter((b) => ['sp500', 'nasdaq', 'germany', 'china', 'gold', 'bitcoin'].includes(b.key)).map((b) => ({ label: b.label, val: b.xirr }))} />
          <div className="sub" style={{ marginTop: 12 }}>
            CAGR {pct1(usStats.cagr)}
            {usStats.years != null ? ` over a ${usStats.years.toFixed(1)}-yr weighted holding` : ''} · price-only (ex-dividend) index returns.
          </div>
          <div className="sub" style={{ marginTop: 8, color: 'var(--txt3)', lineHeight: 1.6 }}>
            Counterfactual: your exact deposit dates replayed into each index — same rupees, same timing; indicative, not proven edge.
          </div>
          <div style={{ height: 1, background: 'var(--brd)', margin: '16px 0 14px' }} />
          <div className="g3">
            {[
              { label: 'Winner',  cls: 'grn', sym: usStats.winner?.sym,  pct: usStats.winner?.livePct },
              { label: 'Drag',    cls: 'red', sym: usStats.laggard?.sym, pct: usStats.laggard?.livePct },
              { label: 'Largest', cls: '',    sym: usStats.topPos?.sym,
                sub: usStats.topPos && usData.val ? ((usStats.topPos.liveVal / usData.val)*100).toFixed(0) + '% of book' : 'by value' },
            ].map(({ label, cls, sym, pct, sub }) => (
              <div className="mini" key={label}>
                <div className="lbl" style={{ marginBottom: 4 }}>{label}</div>
                <div className={'vsm ' + cls}>{sym || '—'}</div>
                <div className={'sub ' + (pct != null ? cl(pct) : '')}>{pct != null ? pctS(pct) : (sub || 'live')}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="ctitle" style={{ marginBottom: 14 }}>Sector &amp; Cap Mix</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <SunburstMix
              sectors={usStats.sectors} caps={usStats.caps} total={usStats.value}
              secColors={SECTOR_PALETTE}
              capColor={{ Mega: 'var(--blu)', Large: 'var(--pur)', Mid: 'var(--cyn)', Small: 'var(--pnk)' }}
              currency="usd" othersColor={OTHERS_COLOR}
            />
          </div>
          <div style={{ height: 1, background: 'var(--brd)', margin: '18px 0 12px' }} />
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', textAlign: 'center', lineHeight: 1.5 }}>ETF look-through aligns with Vested (equity only); direct stocks by GICS.</div>
        </div>
      </div>

      <div className="card sec">
        <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="ctitle">Holdings</div>
          <div className="sub" style={{ margin: 0 }}>
            {usData.val ? <><UsdF n={usData.inv} /> → <UsdF n={usData.val} /> · </> : 'loading… '}
            <span className={cl(usData.pl)}>{usData.val ? <><UsdF n={usData.pl} /> ({pctS(usData.pct)})</> : ''}</span>
          </div>
        </div>
        <div className="ovx" style={{ maxHeight: 460, overflowY: 'auto' }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                {US_COLS.map((c) => (
                  <th key={c.key} className={c.num ? 'ra' : ''} scope="col" tabIndex={0} role="button"
                    aria-sort={usSort.col === c.key ? (usSort.dir < 0 ? 'descending' : 'ascending') : 'none'}
                    onClick={() => sortUs(c.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortUs(c.key); } }}>
                    {c.label} {usSort.col === c.key ? (usSort.dir < 0 ? '↓' : '↑') : '↕'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usSorted.map((s) => (
                <tr key={s.sym}>
                  <td style={{ color: 'var(--txt)', fontWeight: 600 }} className="mono">
                    {s.sym}
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', fontWeight: 400, marginTop: 2, fontFamily: 'var(--body)' }}>{s.name} · {s.cat}</div>
                  </td>
                  <td><span className="mf-pill" style={{ background: 'var(--sur2)', color: 'var(--txt2)' }}>{s.cat}</span></td>
                  <td className="ra mono">
                    {s.livePrice != null
                      ? <span key={s.sym + '-' + s.livePrice} className={flash[s.sym] ? 'flash-' + flash[s.sym] : ''}><UsdF n={s.livePrice} /></span>
                      : <Skel w={40} h={11} />}
                  </td>
                  <td className="ra mono">{s.liveVal != null ? <UsdF n={s.liveVal} /> : '—'}</td>
                  <td className="ra mono mut"><UsdF n={s.inv} /></td>
                  <td className={'ra mono ' + (s.livePl != null ? cl(s.livePl) : 'mut')}>{s.livePl != null ? <UsdF n={s.livePl} /> : '—'}</td>
                  <td className={'ra mono ' + (s.livePct != null ? cl(s.livePct) : 'mut')}>{s.livePct != null ? pctS(s.livePct) : '—'}</td>
                  <td className={'ra mono ' + (s.dayPct != null ? cl(s.dayPct) : 'mut')}>{s.dayPct != null ? pctS(s.dayPct) : '—'}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={3}>Total — {US.length} holdings</td>
                <td className="ra">{usData.val ? <UsdF n={usData.val} /> : '…'}</td>
                <td className="ra"><UsdF n={usData.inv} /></td>
                <td className={'ra ' + cl(usData.pl)}>{usData.val ? <UsdF n={usData.pl} /> : '…'}</td>
                <td className={'ra ' + cl(usData.pl)}>{usData.val ? pctS(usData.pct) : '…'}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 10 }}>click headers to sort · live Yahoo quotes, flash on each tick · converted at live USD/INR</div>
      </div>

      <div className="g2 sec">
        <RealizedPanel data={US_REALIZED} currency="usd" fxRate={fxRate} note="Realised gains from Vested's lot-level P&L report (split/lot-adjusted)." />
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="fxc" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div className="ctitle">Dividend Income</div>
              <div className="sub" style={{ margin: 0 }}>Vested statement · as of {US_DIVIDENDS.asOf}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="vt2 grn"><UsdF n={US_DIVIDENDS.netAllTime} /></div>
              <div className="sub" style={{ margin: 0 }}>net all-time (≈<InrC n={US_DIVIDENDS.netAllTime * fxRate} />)</div>
            </div>
          </div>
          <div className="g2" style={{ flex: 1, margin: '0 0 14px', alignItems: 'stretch' }}>
            <div className="csm" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div className="lbl">gross all-time</div>
              <div className="vt2 grn"><UsdF n={US_DIVIDENDS.grossAllTime} /></div>
            </div>
            <div className="csm" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div className="lbl">tax withheld</div>
              <div className="vt2 red"><UsdF n={US_DIVIDENDS.taxAllTime} /></div>
            </div>
            <div className="csm" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div className="lbl">last 12 months</div>
              <div className="vt2 grn"><UsdF n={US_DIVIDENDS.last12Gross} /></div>
            </div>
            <div className="csm" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div className="lbl">this FY ({US_DIVIDENDS.fy[US_DIVIDENDS.fy.length - 1]?.label.replace('FY', '') || '—'})</div>
              <div className="vt2"><UsdF n={US_DIVIDENDS.fy[US_DIVIDENDS.fy.length - 1]?.amt || 0} /></div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignContent: 'flex-start', flex: 1 }}>
            {US_DIVIDENDS.top.map((t, i) => (
              <span key={t.sym} className="mf-chip"><span className="mf-dot" style={{ background: SECTOR_PALETTE[i % SECTOR_PALETTE.length] }} />{t.sym} <UsdF n={t.amt} /></span>
            ))}
          </div>
          <div className="sub" style={{ marginTop: 'auto', paddingTop: 12, color: 'var(--txt3)' }}>25% US withholding at source; creditable against Indian tax via the DTAA.</div>
        </div>
      </div>

      <CFMemo
        title={`Foreign Equity Tax — ${FY.labels.verified} Capital Gains`}
        rows={[
          { label: `${FY.labels.verified} foreign STCG`, val: '+₹' + FY.cf.cgVerified.foreignStcg.toLocaleString('en-IN'), color: 'var(--grn)', sub: FY.cf.cgVerified.foreignStcgNote },
          { label: `STCG loss carried into ${FY.labels.current}`, val: '₹' + FY.cf.stcgCarried.toLocaleString('en-IN'), color: 'var(--grn)', sub: FY.cf.stcgNote },
        ]}
        foot="Foreign equity gains are taxed at slab (STCG <24m) or 12.5% (LTCG ≥24m) — no Sec 112A exemption; US withholding on dividends is creditable via DTAA."
      />
    </div>
  );
}
