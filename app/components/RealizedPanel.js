'use client';

// Scalable, scope-aware Realized P&L panel — mirrors the approved drill mockup.
// One slim bar per financial year; click a bar to drill into that year (the
// headline total, the Top-gainer/Top-loser tiles and the winner/loser chips all
// switch), "Overall" to reset. Fixed height whether it's 3 years or 30.
//
// Data-driven: per-year winners/losers/n come from the realized dataset
// (Zerodha tradebook for India, Vested lot-level P&L for US).

import { useState } from 'react';

const compactInr = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return (a / 1e5).toFixed(2) + ' L';
  return Math.round(a).toLocaleString('en-IN');
};
const cl = (n) => (n >= 0 ? 'grn' : 'red');
const PALETTE = ['var(--blu)', 'var(--pur)', 'var(--cyn)', 'var(--grn)', 'var(--pnk)', 'var(--acc)'];

export default function RealizedPanel({ data, currency = 'inr', fxRate = 0, className = '', note }) {
  const [sel, setSel] = useState(null); // null = overall, else FY index

  const fy = data.fy || [];
  const vals = fy.map((b) => b.amt);
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const winYears = vals.filter((v) => v > 0).length;
  const bestIdx = vals.length ? vals.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0) : -1;
  const worstIdx = vals.length ? vals.reduce((wi, v, i, a) => (v < a[wi] ? i : wi), 0) : -1;
  const ytd = currency === 'usd' ? data.ytdUsd : data.ytd;

  const Money = ({ n }) => currency === 'usd'
    ? <><span className="rs">$</span>{Math.abs(n).toFixed(2)}</>
    : <><span className="rs">₹</span>{compactInr(n)}</>;

  // active scope
  const total = sel == null ? data.total : fy[sel].amt;
  const winners = sel == null ? (data.winners || []) : (fy[sel].winners || []);
  const losers = sel == null ? (data.losers || []) : (fy[sel].losers || []);
  const topG = winners[0];
  const topL = losers[0];

  return (
    <div className={'card ' + className}>
      {/* header */}
      <div className="fxc" style={{ marginBottom: 6, flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
        <div>
          <div className="ctitle">Realized P&amp;L</div>
          <div className="sub" style={{ margin: 0 }}>{data.source || 'avg-cost'} · as on {data.asOf}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={'vmd ' + cl(total)}><Money n={total} />
            {currency === 'usd' && fxRate ? <span className="sub" style={{ fontWeight: 400 }}> ≈<span className="rs">₹</span>{compactInr(Math.abs(total) * fxRate)}</span> : null}
          </div>
          <div className="sub" style={{ margin: 0 }}>
            {sel == null
              ? (ytd != null ? <>overall, all years<br /><span className={cl(ytd)}><Money n={ytd} /></span> {data.ytdLabel} YTD</> : 'overall, all years')
              : <>{fy[sel].label} realised</>}
          </div>
        </div>
      </div>

      {/* scope reset */}
      <div className="rz-scope">
        <button className={'rz-tab' + (sel == null ? ' on' : '')} onClick={() => setSel(null)}>Overall</button>
        <span className="sub" style={{ margin: 0 }}>{sel == null ? '· click a bar to drill into a year' : `· showing ${fy[sel].label}`}</span>
      </div>

      {/* per-FY bar chart */}
      <div className="rz-bars">
        {fy.map((b, i) => {
          const h = Math.max(2, Math.round(Math.abs(b.amt) / maxAbs * 44));
          const up = b.amt >= 0;
          const cls = 'rz-col' + (sel === i ? ' sel' : '') + (sel != null && sel !== i ? ' dim' : '');
          return (
            <div key={b.label} className={cls}
              title={`${b.label}  ${currency === 'usd' ? '$' + Math.abs(b.amt).toFixed(2) : '₹' + compactInr(b.amt)}`}
              onClick={() => setSel(sel === i ? null : i)}>
              <div className="rz-half t"><div className="rz-up" style={{ height: up ? h : 0 }} /></div>
              <div className="rz-zero" />
              <div className="rz-half b"><div className="rz-dn" style={{ height: up ? 0 : h }} /></div>
            </div>
          );
        })}
      </div>
      <div className="rz-axis">
        {fy.length > 0 && [0, fy.length >> 1, fy.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => <span key={i}>{fy[i].label}</span>)}
      </div>

      {/* Top gainer / Top loser / Profitable-years ↔ Trades-booked */}
      <div className="g3 sec">
        <div className="mini">
          <div className="lbl" style={{ marginBottom: 4 }}>Top gainer</div>
          <div className="vsm grn">{topG ? topG.sym : '—'}</div>
          <div className="sub">{topG ? <Money n={topG.amt} /> : ''}</div>
        </div>
        <div className="mini">
          <div className="lbl" style={{ marginBottom: 4 }}>Top loser</div>
          <div className="vsm red">{topL ? topL.sym : '—'}</div>
          <div className="sub">{topL ? <Money n={topL.amt} /> : ''}</div>
        </div>
        <div className="mini">
          {sel == null ? (
            <>
              <div className="lbl" style={{ marginBottom: 4 }}>Profitable years</div>
              <div className="vsm">{winYears} / {fy.length}</div><div className="sub">FYs ended green</div>
            </>
          ) : (
            <>
              <div className="lbl" style={{ marginBottom: 4 }}>Trades booked</div>
              <div className="vsm">{fy[sel].n != null ? fy[sel].n : '—'}</div><div className="sub">positions closed</div>
            </>
          )}
        </div>
      </div>

      {/* mover chips for the active scope */}
      {(winners.length || losers.length) ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {[...winners, ...losers].map((m, i) => (
            <span key={m.sym + i} className="mf-chip">
              <span className="mf-dot" style={{ background: PALETTE[i % PALETTE.length] }} />{m.sym}{' '}
              <span className={cl(m.amt)}><Money n={m.amt} /></span>
            </span>
          ))}
        </div>
      ) : null}

      {/* footer: best/worst year (overall) or scope hint (drill) + note */}
      <div className="sub" style={{ marginTop: 12, color: 'var(--txt3)', lineHeight: 1.6, paddingTop: 10, borderTop: '.5px solid var(--brd)' }}>
        {sel == null
          ? (bestIdx >= 0 ? <>Best year <b style={{ color: 'var(--txt)' }}>{fy[bestIdx].label}</b> <span className={cl(vals[bestIdx])}><Money n={vals[bestIdx]} /></span> · Worst year <b style={{ color: 'var(--txt)' }}>{fy[worstIdx].label}</b> <span className={cl(vals[worstIdx])}><Money n={vals[worstIdx]} /></span>. </> : null)
          : <>Showing <b style={{ color: 'var(--txt)' }}>{fy[sel].label}</b> only — click <b style={{ color: 'var(--txt)' }}>Overall</b> or the bar again to reset. </>}
        {note}
      </div>
    </div>
  );
}
