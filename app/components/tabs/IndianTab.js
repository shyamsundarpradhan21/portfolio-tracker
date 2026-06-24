'use client';
import { cl, pctS, pct1, InrC, InrF, SInrC, SInrF, Rs, inrCd, sFull, fmtNavDate } from '../../lib/fmt';
import { LiveInrC, LiveSInrC } from '../shared/Live';
import { SECTOR_PALETTE } from '../../lib/constants';
import AnalysisCard from '../shared/AnalysisCard';
import FreshnessTag from '../shared/FreshnessTag';
import SyncBadge from '../shared/SyncBadge';
import BenchmarkBars from '../shared/BenchmarkBars';
import CFMemo from '../shared/CFMemo';
import Skel from '../shared/Skel';
import SunburstMix from '../SunburstMix';
import RealizedPanel from '../RealizedPanel';
import InsightsCard from '../InsightsCard';
import EquityDayCurve from '../shared/EquityDayCurve';

const IN_COLS = [
  { key: 'sym',  label: 'Stock',    num: false },
  { key: 'qty',  label: 'Qty',      num: true  },
  { key: 'cost', label: 'Avg cost', num: true  },
  { key: 'ltp',  label: 'LTP',      num: true  },
  { key: 'inv',  label: 'Invested', num: true  },
  { key: 'val',  label: 'Value',    num: true  },
  { key: 'pl',   label: 'P&L',      num: true  },
  { key: 'pct',  label: 'Return %', num: true  },
  { key: 'day',  label: 'Day %',    num: true  },
];
const capColor = { Large: 'var(--blu)', Mid: 'var(--pur)', Small: 'var(--cyn)' };

export default function IndianTab({
  indian, inStats, indianRisk, inSorted, inSort, sortIn,
  flash, markets, lastUpdate, insights, insightsOn, insightsFirstLoad,
  INDIAN, INDIAN_REALIZED, CORPORATE_ACTIONS, FY, indianRec,
  swing, swingSorted, swSort, sortSw, swingRec,
}) {
  // Combined Indian-equity book = Zerodha holdings (mom) + Upstox swing (me),
  // tracked together for accounting. The value/P&L summary cards and the merged
  // Holdings table run off this; the performance analytics (CAGR / benchmarks /
  // sector mix) still run off the core Zerodha book until the swing cashflows +
  // sector tags land.
  const eqValued = indian.valued && swing.valued;
  const eqInv = indian.inv + swing.inv;
  const eqVal = (indian.val || 0) + (swing.val || 0);
  const eqPl = eqVal - eqInv;
  const eqPct = eqInv ? (eqPl / eqInv) * 100 : 0;
  const _eqDay = [...indian.rows, ...swing.rows].reduce((a, r) => {
    if (r.val == null || r.day == null) return a;
    const prev = r.val / (1 + r.day / 100);
    return { dayPl: a.dayPl + (r.val - prev), prevTot: a.prevTot + prev };
  }, { dayPl: 0, prevTot: 0 });
  const eqDayPl = _eqDay.dayPl, eqDayPct = _eqDay.prevTot ? (_eqDay.dayPl / _eqDay.prevTot) * 100 : 0;
  const DIV_STYLE = { background: 'var(--sur2)', color: 'var(--txt3)', fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, padding: '8px 10px' };
  return (
    <div>
      <AnalysisCard data={insights?.indian} on={insightsOn} loading={insightsOn && insightsFirstLoad} accent="var(--blu)" />
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <SyncBadge rec={indianRec} />
        <FreshnessTag mode="live" marketState={{ open: markets.nse, label: `NSE ${markets.nse ? 'OPEN' : 'CLOSED'} · ${lastUpdate}` }} />
      </div>

      {/* Live intraday equity day-change curve (holdings × keyless quotes; daemon → KV) */}
      <EquityDayCurve />

      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">Invested (cost)</div>
          <div className="vmd"><InrC n={eqInv} /></div>
          <div className="sub">{INDIAN.length} core + {swing.rows.length} swing · 2 accounts</div>
        </div>
        <div className="csm">
          <div className="lbl">Current value</div>
          <div className="vmd">{eqValued ? <LiveInrC n={eqVal} /> : <Skel w={90} h={20} />}</div>
          <div className="sub">marked live · NSE LTP</div>
        </div>
        <div className="csm">
          <div className="lbl">Unrealized P&amp;L</div>
          <div className={'vmd ' + (eqValued ? cl(eqPl) : '')}>
            {eqValued ? <LiveSInrC n={eqPl} /> : <Skel w={80} h={20} />}
          </div>
          <div className="sub">{eqValued ? pctS(eqPct) + ' on cost' : 'value − invested'}</div>
        </div>
      </div>
      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">Day change</div>
          <div className={'vmd ' + (eqValued ? cl(eqDayPl) : '')}>
            {eqValued ? <LiveSInrC n={eqDayPl} /> : <Skel w={80} h={20} />}
          </div>
          <div className="sub">{eqValued ? `${pctS(eqDayPct)} vs prev close` : 'intraday move'}</div>
        </div>
        <div className="csm">
          <div className="lbl">CAGR (annualised)</div>
          <div className={'vmd ' + (inStats.cagr != null ? cl(inStats.cagr) : '')}>
            {inStats.cagr != null ? pct1(inStats.cagr) : <Skel w={70} h={20} />}
          </div>
          <div className="sub">money-weighted · {inStats.years != null ? `~${Math.max(1, Math.round(inStats.years * 12))}-month history` : 'building history'}</div>
        </div>
        <div className="csm">
          <div className="lbl">Realized P&amp;L (YTD)</div>
          <div className={'vmd ' + cl(INDIAN_REALIZED.ytd)}><SInrF n={INDIAN_REALIZED.ytd} /></div>
          <div className="sub">{INDIAN_REALIZED.ytdLabel} · full history below</div>
        </div>
      </div>

      <div className="g2 sec">
        <div className="card">
          <div className="ctitle" style={{ marginBottom: 4 }}>vs Benchmarks</div>
          <div className="sub" style={{ marginBottom: 14 }}>Same dated rupees — your <Rs />{inrCd(inStats.totalInvested)} deployed into each instead.</div>
          <BenchmarkBars you={inStats.portXirr} rows={inStats.benchmarks.map((b) => ({ label: b.label, val: b.xirr }))} />
          <div className="sub" style={{ marginTop: 12 }}>
            CAGR {pct1(inStats.cagr)}
            {inStats.years != null ? ` over a ${inStats.years.toFixed(1)}-yr weighted holding` : ''} · price-only (ex-dividend) index returns.
          </div>
          <div className="sub" style={{ marginTop: 8, color: 'var(--txt3)', lineHeight: 1.6 }}>
            Annualised over a {inStats.years != null ? `~${Math.max(1, Math.round(inStats.years * 12))}-month` : 'short'} average holding — a short window; indicative, not proven edge.
          </div>
          <div style={{ height: 1, background: 'var(--brd)', margin: '16px 0 14px' }} />
          <div className="g3">
            {[
              { label: 'Winner',  cls: 'grn', sym: inStats.winner?.sym,  pct: inStats.winner?.pct },
              { label: 'Drag',    cls: 'red', sym: inStats.laggard?.sym, pct: inStats.laggard?.pct },
              { label: 'Largest', cls: '',    sym: inStats.topPos?.sym,
                sub: inStats.topPos && inStats.value ? ((inStats.topPos.val / inStats.value)*100).toFixed(0) + '% of book' : 'by value' },
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
            <SunburstMix sectors={inStats.sectors} caps={inStats.caps} total={inStats.value} secColors={SECTOR_PALETTE} capColor={capColor} />
          </div>
          <div className="sub" style={{ marginTop: 10, lineHeight: 1.6 }}>
            Equal-weight construction — sector tilt follows stock count, not deliberate sizing. Inner ring is NSE-classified market cap. Hover a wedge for weight and live value.
          </div>
        </div>
      </div>

      <div className="card sec">
        <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="ctitle">Holdings</div>
          <div className="sub" style={{ margin: 0 }}>
            {eqValued
              ? <><InrC n={eqInv} /> → <InrC n={eqVal} /> · <span className={cl(eqPl)}><SInrC n={eqPl} /> ({pctS(eqPct)})</span></>
              : 'loading live prices…'}
          </div>
        </div>
        <div className="ovx" style={{ maxHeight: 460, overflowY: 'auto' }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                {IN_COLS.map((c) => (
                  <th key={c.key} className={c.num ? 'ra' : ''} scope="col" tabIndex={0} role="button"
                    aria-sort={inSort.key === c.key ? (inSort.dir < 0 ? 'descending' : 'ascending') : 'none'}
                    onClick={() => sortIn(c.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortIn(c.key); } }}>
                    {c.label} {inSort.key === c.key ? (inSort.dir < 0 ? '↓' : '↑') : '↕'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Zerodha · mom — the core delivery book */}
              <tr><td colSpan={9} style={DIV_STYLE}>{(indianRec?.source || 'Zerodha')} · mom · {INDIAN.length} holdings</td></tr>
              {inSorted.map((s) => (
                <tr key={s.sym}>
                  <td style={{ color: 'var(--txt)', fontWeight: 600 }} className="mono">
                    {s.sym}
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', fontWeight: 400, marginTop: 2, fontFamily: 'var(--body)' }}>
                      {s.name} · {s.sector} · {s.cap}
                    </div>
                  </td>
                  <td className="ra mut mono">{s.qty}</td>
                  <td className="ra mut mono"><InrF n={s.cost} /></td>
                  <td className="ra mono">
                    {s.ltp != null
                      ? <span key={s.sym + '-' + s.ltp} className={flash[s.ns] ? 'flash-' + flash[s.ns] : ''}><InrF n={s.ltp} /></span>
                      : <Skel w={48} h={11} />}
                  </td>
                  <td className="ra mono"><InrC n={s.inv} /></td>
                  <td className="ra mono">{s.val != null ? <InrC n={s.val} /> : '—'}</td>
                  <td className={'ra mono ' + (s.pl != null ? cl(s.pl) : 'mut')}>{s.pl != null ? <SInrF n={s.pl} /> : '—'}</td>
                  <td className={'ra mono ' + (s.pct != null ? cl(s.pct) : 'mut')}>{s.pct != null ? pctS(s.pct) : '—'}</td>
                  <td className={'ra mono ' + (s.day != null ? cl(s.day) : 'mut')}>{s.day != null ? pctS(s.day) : '—'}</td>
                </tr>
              ))}
              <tr className="subtot">
                <td colSpan={4}>{(indianRec?.source || 'Zerodha')} · mom — {INDIAN.length} holdings</td>
                <td className="ra"><InrC n={indian.inv} /></td>
                <td className="ra">{indian.valued ? <InrC n={indian.val} /> : '…'}</td>
                <td className={'ra ' + cl(indian.pl)}>{indian.valued ? <SInrC n={indian.pl} /> : '…'}</td>
                <td className={'ra ' + cl(indian.pl)}>{indian.valued ? pctS(indian.pct) : '…'}</td>
                <td />
              </tr>
              {/* Upstox · me — swing positions: different account, same equity book */}
              <tr><td colSpan={9} style={DIV_STYLE}>{(swingRec?.source || 'Upstox')} · me · swing · {swing.rows.length}</td></tr>
              {swingSorted.map((s) => (
                <tr key={'sw-' + s.sym}>
                  <td style={{ color: 'var(--txt)', fontWeight: 600 }} className="mono">
                    {s.sym}
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', fontWeight: 400, marginTop: 2, fontFamily: 'var(--body)' }}>
                      {[s.name, s.sector, s.cap].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="ra mut mono">{s.qty}</td>
                  <td className="ra mut mono"><InrF n={s.cost} /></td>
                  <td className="ra mono">
                    {s.ltp != null
                      ? <span key={'sw-' + s.sym + '-' + s.ltp} className={flash[s.ns] ? 'flash-' + flash[s.ns] : ''}><InrF n={s.ltp} /></span>
                      : <Skel w={48} h={11} />}
                  </td>
                  <td className="ra mono"><InrC n={s.inv} /></td>
                  <td className="ra mono">{s.val != null ? <InrC n={s.val} /> : '—'}</td>
                  <td className={'ra mono ' + (s.pl != null ? cl(s.pl) : 'mut')}>{s.pl != null ? <SInrF n={s.pl} /> : '—'}</td>
                  <td className={'ra mono ' + (s.pct != null ? cl(s.pct) : 'mut')}>{s.pct != null ? pctS(s.pct) : '—'}</td>
                  <td className={'ra mono ' + (s.day != null ? cl(s.day) : 'mut')}>{s.day != null ? pctS(s.day) : '—'}</td>
                </tr>
              ))}
              <tr className="subtot">
                <td colSpan={4}>{(swingRec?.source || 'Upstox')} · me — {swing.rows.length} swing</td>
                <td className="ra"><InrC n={swing.inv} /></td>
                <td className="ra">{swing.valued ? <InrC n={swing.val} /> : '…'}</td>
                <td className={'ra ' + cl(swing.pl)}>{swing.valued ? <SInrC n={swing.pl} /> : '…'}</td>
                <td className={'ra ' + cl(swing.pl)}>{swing.valued ? pctS(swing.pct) : '…'}</td>
                <td />
              </tr>
              <tr className="tot">
                <td colSpan={4}>Grand total — {INDIAN.length + swing.rows.length} holdings · 2 accounts</td>
                <td className="ra"><InrC n={eqInv} /></td>
                <td className="ra">{eqValued ? <InrC n={eqVal} /> : '…'}</td>
                <td className={'ra ' + cl(eqPl)}>{eqValued ? <SInrC n={eqPl} /> : '…'}</td>
                <td className={'ra ' + cl(eqPl)}>{eqValued ? pctS(eqPct) : '…'}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 10 }}>
          click headers to sort · live NSE LTP · <b>Zerodha</b> (mom) + <b>Upstox</b> (me) combined for accounting · swing held overnight (STCG/LTCG, not F&amp;O income)
        </div>
      </div>

      <div className="g2 sec">
        <RealizedPanel data={INDIAN_REALIZED} currency="inr" note="Avg-cost realised gains/losses booked across all exits." />
        <InsightsCard stats={indianRisk} />
      </div>

      <CFMemo
        title="Equity Tax — FY24-25 Capital Gains"
        lead="Last filed year's equity capital gains in this account (ITR):"
        rows={[
          { label: 'FY24-25 LTCG (Sec 112A)', val: '₹2,789', color: 'var(--grn)', sub: 'equity shares held >12m · within ₹1.25L exemption → nil tax' },
          { label: 'FY24-25 STCG (equity MF)', val: '₹1,083', color: 'var(--red)', sub: 'short-term loss, set off against LTCG' },
        ]}
        foot="Equity LTCG up to ₹1.25L/yr is exempt (Sec 112A) — booking gains within the limit each FY resets cost basis tax-free."
      />
    </div>
  );
}
