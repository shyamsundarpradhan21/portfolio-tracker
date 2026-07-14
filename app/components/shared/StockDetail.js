'use client';

// Stock detail RAIL — the heatmap click-through panel. Replaces the NiftyOverview panel in
// the side rail (and appears beside the Nasdaq map) when a stock tile is clicked; clicking the
// selected tile again returns to the index overview. Replicates the provided snapshot (header · day/52wk
// ranges · key-stats grid · dividends donut · income statement annual/quarterly · performance)
// for ANY symbol, India or US. Fed by /api/stock?symbol=. House rules: direction = COLOUR only
// (no +/− glyph) · --fs-* tiers · theme tokens · both themes. AI key-facts blurb deferred (v1).

import { useState } from 'react';
import { cl } from '../../lib/direction';

const isINR = (cur) => cur === 'INR' || cur === '₹' || cur === 'Rs';
const sym = (cur) => (isINR(cur) ? '₹' : '$');

// native-currency price (a stock shows in its own ccy, NOT the app display-currency toggle)
const price = (n, cur) =>
  n == null || !isFinite(n) ? '—'
    : n.toLocaleString(isINR(cur) ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// compact market cap / income — crore system for INR, T/B/M for USD
function compact(n, cur) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (isINR(cur)) {
    const cr = a / 1e7;
    if (cr >= 1e5) return (cr / 1e5).toFixed(2) + ' L Cr';
    if (cr >= 1e3) return (cr / 1e3).toFixed(2) + ' K Cr';
    if (cr >= 1) return Math.round(cr).toLocaleString('en-IN') + ' Cr';
    return a.toLocaleString('en-IN');
  }
  if (a >= 1e12) return (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (a / 1e3).toFixed(2) + 'K';
  return a.toFixed(0);
}
const vol = (n) => (n == null || !isFinite(n) ? '—' : compact(n, 'USD')); // shares, no ccy
const pctv = (n) => (n == null || !isFinite(n) ? '—' : Math.abs(n).toFixed(2) + '%'); // magnitude; direction = colour
const fracPct = (n) => (n == null || !isFinite(n) ? '—' : (n * 100).toFixed(2) + '%'); // Yahoo yields/payout are fractions
const num = (n, d = 2) => (n == null || !isFinite(n) ? '—' : n.toFixed(d));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLbl = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const inDays = (iso) => { if (!iso) return null; const d = Math.round((new Date(iso) - Date.now()) / 864e5); return isNaN(d) ? null : d; };
const stateLbl = (s) => ({ REGULAR: 'Market open', PRE: 'Pre-market', PREPRE: 'Pre-market', POST: 'After hours', POSTPOST: 'After hours', CLOSED: 'Market closed' }[s] || (s ? 'Market closed' : ''));
const stateOpen = (s) => s === 'REGULAR';

const Ccy = ({ cur }) => <span className="rs">{sym(cur)}</span>;

function Donut({ payout }) {
  const R = 26, C = 2 * Math.PI * R;
  const p = payout == null || !isFinite(payout) ? 0 : Math.max(0, Math.min(1, payout));
  const paid = p * C;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden>
      <circle cx="36" cy="36" r={R} fill="none" stroke="var(--sur2)" strokeWidth="10" />
      <circle cx="36" cy="36" r={R} fill="none" stroke="var(--grn)" strokeWidth="10"
        strokeDasharray={`${paid} ${C - paid}`} transform="rotate(-90 36 36)" strokeLinecap="round" />
      <text x="36" y="39.5" textAnchor="middle" className="mono" fontSize="10" fill="var(--acc)">
        {payout == null ? '—' : (p * 100).toFixed(2) + '%'}
      </text>
    </svg>
  );
}


function RangeBar({ label, lo, hi, at, cur }) {
  const pos = lo != null && hi != null && hi > lo && at != null ? Math.max(0, Math.min(1, (at - lo) / (hi - lo))) : null;
  return (
    <div className="sd-rng">
      <div className="sd-rng-lbl">{label}</div>
      <div className="sd-rng-track">{pos != null && <span className="sd-rng-mark" style={{ left: (pos * 100).toFixed(1) + '%' }} />}</div>
      <div className="sd-rng-ends"><span className="mono"><Ccy cur={cur} />{price(lo, cur)}</span><span className="mono"><Ccy cur={cur} />{price(hi, cur)}</span></div>
    </div>
  );
}

// Rail panel. `onClose` = back-to-index (‹). Matches the NiftyOverview rail slot (.nov-panel).
export default function StockDetail({ stock, live, loading, onClose, backLabel }) {
  const [statsOpen, setStatsOpen] = useState(false);
  const s = stock || {};
  const cur = s.currency || (live && live.cur) || 'USD';
  const px = (live && live.price != null) ? live.price : s.price;
  const chgPct = (live && live.pct != null) ? live.pct : s.changePct;
  const chg = (live && live.change != null) ? live.change : s.change;
  const nd = inDays(s.nextEarnings);

  const stats = [
    ['Next earnings report', nd != null ? (nd >= 0 ? `In ${nd} days` : dateLbl(s.nextEarnings)) : dateLbl(s.nextEarnings)],
    ['Volume', vol(s.volume)],
    ['Average Volume (30D)', vol(s.avgVolume30)],
    ['Market capitalization', s.marketCapFmt || compact(s.marketCap, cur)],
    ['Dividend yield (indicated)', fracPct(s.dividendYieldIndicated)],
    ['Price to earnings (TTM)', num(s.peTTM)],
    ['Basic EPS (TTM)', s.basicEpsTTM == null ? '—' : <><Ccy cur={cur} />{num(s.basicEpsTTM)}</>],
    ['Shares float', s.sharesFloatFmt || compact(s.sharesFloat, 'USD')],
    ['Beta (1Y)', num(s.beta)],
  ];

  return (
    <div className="card sec nov-panel sd-rail">
      <div className="sd-scroll">
      {onClose && <button type="button" className="sd-back" onClick={onClose}>‹ {backLabel || 'Overview'}</button>}
      <div className="sd-head">
        <div style={{ minWidth: 0 }}>
          <div className="sd-tk">{s.symbol}{s.exchange && <span className="sd-exch">{s.exchange}</span>}</div>
          <div className="sd-nm">{s.name || (loading ? 'Loading…' : s.symbol)}</div>
          {(s.sector || s.industry) && <div className="sd-sect">{[s.sector, s.industry].filter(Boolean).join(' · ')}</div>}
        </div>
      </div>

      <div className="sd-px-row">
        <span className="sd-px"><Ccy cur={cur} />{price(px, cur)}</span>
        <span className={'sd-chg ' + cl(chgPct)}>
          {chg != null && <><Ccy cur={cur} />{price(Math.abs(chg), cur)} · </>}{pctv(chgPct)}
        </span>
      </div>
      {stateLbl(s.marketState) && <div className="sd-state"><i className={stateOpen(s.marketState) ? 'on' : ''} /> {stateLbl(s.marketState)}</div>}

      <RangeBar label="Day's range" lo={s.dayLow} hi={s.dayHigh} at={px} cur={cur} />
      <RangeBar label="52-week range" lo={s.week52Low} hi={s.week52High} at={px} cur={cur} />

      <div className="sd-sec-h">Key stats</div>
      <div className="sd-kv-list">
        {(statsOpen ? stats : stats.slice(0, 5)).map(([k, v]) => (
          <div className="sd-kv" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
        ))}
      </div>
      {stats.length > 5 && (
        <button type="button" className="sd-kv-more" onClick={() => setStatsOpen((o) => !o)} aria-expanded={statsOpen}>
          {statsOpen ? 'Show less' : `Show ${stats.length - 5} more`}<span className={'sd-chev' + (statsOpen ? ' up' : '')} aria-hidden>▾</span>
        </button>
      )}

      <div className="sd-sec-h">Dividends</div>
      <div className="sd-div-wrap">
        <Donut payout={s.payoutRatio} />
        <div className="sd-donut-lab">
          <span><i style={{ background: 'var(--sur2)' }} />Earnings retained</span>
          <span><i style={{ background: 'var(--grn)' }} />Payout ratio (TTM)</span>
        </div>
      </div>
      <div className="sd-kv-list" style={{ marginTop: 6 }}>
        <div className="sd-kv"><span className="k">Dividend yield TTM</span><span className="v">{fracPct(s.dividendYieldTTM)}</span></div>
        <div className="sd-kv"><span className="k">Last payment</span><span className="v">{s.lastDividend == null ? '—' : <><Ccy cur={cur} />{num(s.lastDividend)}</>}</span></div>
        <div className="sd-kv"><span className="k">Last ex-dividend date</span><span className="v">{dateLbl(s.exDividendDate || s.lastDivDate)}</span></div>
        <div className="sd-kv"><span className="k">Last payment date</span><span className="v">{dateLbl(s.dividendPayDate)}</span></div>
      </div>

      <div className="sd-sec-h">Performance</div>
      <div className="sd-perf">
        {[['1W', 'w1'], ['1M', 'm1'], ['3M', 'm3'], ['6M', 'm6'], ['YTD', 'ytd'], ['1Y', 'y1']].map(([w, k]) => {
          const v = s.perf ? s.perf[k] : null;
          return <div className="cell" key={k}><div className={'p ' + cl(v)}>{pctv(v)}</div><div className="w">{w}</div></div>;
        })}
      </div>

      {s.fundamentals === 'unavailable' && <div className="sd-hint" style={{ marginTop: 10 }}>Fundamentals feed unavailable this load — price, ranges and performance are live.</div>}
      </div>
    </div>
  );
}
