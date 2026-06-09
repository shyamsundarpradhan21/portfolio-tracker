'use client';
import { cl, pctS, pct1, InrC, InrF, SInrC, SInrF, Rs, inrCd, sFull, fmtNavDate } from '../../lib/fmt';
import { SECTOR_PALETTE } from '../../lib/constants';
import InsightBanner from '../shared/InsightBanner';
import FreshnessTag from '../shared/FreshnessTag';
import CFMemo from '../shared/CFMemo';
import Skel from '../shared/Skel';
import SunburstMix from '../SunburstMix';
import RealizedPanel from '../RealizedPanel';
import InsightsCard from '../InsightsCard';

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
const fmtX = pct1;

export default function IndianTab({
  indian, indianDayPl, indianDayPct, inStats, indianRisk, inSorted, inSort, sortIn,
  flash, markets, insights, insightsOn, insightsFirstLoad,
  INDIAN, INDIAN_REALIZED, CORPORATE_ACTIONS, FY,
}) {
  return (
    <div>
      <InsightBanner text={insightsOn ? insights?.indian_stocks : null} loading={insightsOn && insightsFirstLoad} />
      <div className="sec" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FreshnessTag mode="live" marketState={{ open: markets.nse, label: `NSE ${markets.nse ? 'OPEN' : 'CLOSED'} · Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` }} />
      </div>

      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">Invested (cost)</div>
          <div className="vmd"><InrC n={indian.inv} /></div>
          <div className="sub">{INDIAN.length} positions · ~<Rs />30K equal-weight</div>
        </div>
        <div className="csm">
          <div className="lbl">Current value</div>
          <div className="vmd">{indian.valued ? <InrC n={indian.val} /> : <Skel w={90} h={20} />}</div>
          <div className="sub">live NSE · LTP × qty</div>
        </div>
        <div className="csm">
          <div className="lbl">Unrealized P&amp;L</div>
          <div className={'vmd ' + (indian.valued ? cl(indian.pl) : '')}>
            {indian.valued ? <SInrC n={indian.pl} /> : <Skel w={80} h={20} />}
          </div>
          <div className="sub">{indian.valued ? pctS(indian.pct) + ' · value − invested' : 'value − invested'}</div>
        </div>
      </div>
      <div className="g3 sec">
        <div className="csm">
          <div className="lbl">Day change</div>
          <div className={'vmd ' + (indian.valued ? cl(indianDayPl) : '')}>
            {indian.valued ? <SInrC n={indianDayPl} /> : <Skel w={80} h={20} />}
          </div>
          <div className="sub">{indian.valued ? `${pctS(indianDayPct)} since prev close` : 'intraday move'}</div>
        </div>
        <div className="csm">
          <div className="lbl">CAGR (annualised)</div>
          <div className={'vmd ' + (inStats.cagr != null ? cl(inStats.cagr) : '')}>
            {inStats.cagr != null ? fmtX(inStats.cagr) : <Skel w={70} h={20} />}
          </div>
          <div className="sub">money-weighted · ~5mo window</div>
        </div>
        <div className="csm">
          <div className="lbl">Realized P&amp;L (YTD)</div>
          <div className={'vmd ' + cl(INDIAN_REALIZED.ytd)}><SInrF n={INDIAN_REALIZED.ytd} /></div>
          <div className="sub">{INDIAN_REALIZED.ytdLabel} · overall below</div>
        </div>
      </div>

      <div className="g2 sec">
        <div className="card">
          <div className="ctitle" style={{ marginBottom: 4 }}>vs Benchmarks</div>
          <div className="sub" style={{ marginBottom: 14 }}>Same dated rupees — your <Rs />{inrCd(inStats.totalInvested)} deployed into each instead.</div>
          <table className="tbl">
            <thead>
              <tr><th>Instrument</th><th className="ra">XIRR</th><th className="ra">Value</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ color: 'var(--txt)', fontWeight: 600 }}>Your portfolio</td>
                <td className={'ra mono ' + (inStats.portXirr != null ? cl(inStats.portXirr) : 'mut')}>{fmtX(inStats.portXirr)}</td>
                <td className="ra mono">{indian.valued ? <InrC n={indian.val} /> : '—'}</td>
              </tr>
              {inStats.benchmarks.map((b) => (
                <tr key={b.key}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                      {b.label}
                    </span>
                  </td>
                  <td className={'ra mono ' + (b.xirr != null ? cl(b.xirr) : 'mut')}>{fmtX(b.xirr)}</td>
                  <td className="ra mono mut">{b.value != null ? <InrC n={b.value} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sub" style={{ marginTop: 12 }}>
            CAGR {pct1(inStats.cagr)}
            {inStats.years != null ? ` over a ${inStats.years.toFixed(1)}-yr weighted holding` : ''} · price-only (ex-dividend) index returns.
          </div>
          <div className="sub" style={{ marginTop: 8, color: 'var(--txt3)', lineHeight: 1.6 }}>
            Annualised over a ~5-month average holding — a short window; indicative, not proven edge.
          </div>
          <div style={{ height: 1, background: 'var(--brd)', margin: '16px 0 14px' }} />
          <div className="g3">
            {[
              { label: 'Winner',  cls: 'grn', sym: inStats.winner?.sym,  pct: inStats.winner?.pct },
              { label: 'Drag',    cls: 'red', sym: inStats.laggard?.sym, pct: inStats.laggard?.pct },
              { label: 'Largest', cls: '',    sym: inStats.topPos?.sym,
                sub: inStats.topPos && indian.val ? ((inStats.topPos.val / indian.val)*100).toFixed(0) + '% of book' : 'by value' },
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
        </div>
      </div>

      <div className="card sec">
        <div className="fxc" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="ctitle">Holdings</div>
          <div className="sub" style={{ margin: 0 }}>
            {indian.valued
              ? <><InrC n={indian.inv} /> → <InrC n={indian.val} /> · <span className={cl(indian.pl)}><SInrC n={indian.pl} /> ({pctS(indian.pct)})</span></>
              : 'loading live prices…'}
          </div>
        </div>
        <div className="ovx">
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                {IN_COLS.map((c) => (
                  <th key={c.key} className={c.num ? 'ra' : ''} onClick={() => sortIn(c.key)}>
                    {c.label} {inSort.key === c.key ? (inSort.dir < 0 ? '↓' : '↑') : '↕'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inSorted.map((s) => (
                <tr key={s.sym}>
                  <td style={{ color: 'var(--txt)', fontWeight: 600 }} className="mono">
                    {s.sym}
                    <div style={{ fontSize: 11, color: 'var(--txt3)', fontWeight: 400, marginTop: 2, fontFamily: 'var(--body)' }}>
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
              <tr className="tot">
                <td colSpan={4}>Total — {INDIAN.length} positions</td>
                <td className="ra"><InrC n={indian.inv} /></td>
                <td className="ra">{indian.valued ? <InrC n={indian.val} /> : '…'}</td>
                <td className={'ra ' + cl(indian.pl)}>{indian.valued ? <SInrC n={indian.pl} /> : '…'}</td>
                <td className={'ra ' + cl(indian.pl)}>{indian.valued ? pctS(indian.pct) : '…'}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="sub" style={{ marginTop: 10 }}>Click headers to sort · live LTP from NSE, flashes on each tick.</div>
      </div>

      <div className="g2 sec">
        <RealizedPanel data={INDIAN_REALIZED} currency="inr" note="Avg-cost realised gains/losses booked across all exits." />
        <InsightsCard stats={indianRisk} swot={insights && insights.indian_swot} loading={insightsFirstLoad} />
      </div>

      <CFMemo
        title="Equity Tax — FY24-25 Capital Gains"
        lead="Last filed year's equity capital gains in this account (ITR):"
        rows={[
          { label: 'FY24-25 LTCG (Sec 112A)', val: '₹2,789', color: 'var(--grn)', sub: 'equity shares held >12m · within ₹1.25L exemption → nil tax' },
          { label: 'FY24-25 STCG (equity MF)', val: '₹1,083', color: 'var(--red)', sub: 'short-term loss, set off against LTCG' },
        ]}
      />
    </div>
  );
}
