'use client';

// Scalable, scope-aware Realized P&L panel. Replaces the old per-FY mini-tiles +
// wall of winner/loser chips (which grew unbounded over the years). One slim bar
// per financial year — click a bar to scope the headline + context to that year,
// "Overall" to reset. Stays the same height whether it's 3 years or 30.
//
// Data-driven: reads the realized object as-is. Per-year mover chips light up
// automatically if a year carries `winners`/`losers` (a future tradebook
// enrichment); until then they show at the overall scope where the data exists.

import { useState } from 'react';

const compactInr = (n) => {
  const a = Math.abs(n);
  if (a >= 1e7) return (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return (a / 1e5).toFixed(2) + ' L';
  return Math.round(a).toLocaleString('en-IN');
};
const cl = (n) => (n >= 0 ? 'grn' : 'red');

export default function RealizedPanel({ data, currency = 'inr', fxRate = 0, className = '', note }) {
  const [sel, setSel] = useState(null); // null = overall, else FY index

  const fy = data.fy || [];
  const vals = fy.map((b) => b.amt);
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const winYears = vals.filter((v) => v >= 0).length;
  const bestIdx = vals.length ? vals.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0) : -1;
  const worstIdx = vals.length ? vals.reduce((wi, v, i, a) => (v < a[wi] ? i : wi), 0) : -1;
  const ytd = currency === 'usd' ? data.ytdUsd : data.ytd;

  // money renderer (unsigned — colour conveys sign), currency-aware
  const Money = ({ n }) => currency === 'usd'
    ? <>${Math.abs(n).toFixed(2)}</>
    : <><span className="rs">₹</span>{compactInr(n)}</>;

  const scopeTotal = sel == null ? data.total : fy[sel].amt;
  const scopeLabel = sel == null
    ? (ytd != null ? <>overall · <span className={cl(ytd)}><Money n={ytd} /></span> {data.ytdLabel} YTD</> : 'overall, all years')
    : <>{fy[sel].label} realised</>;

  // movers for the active scope: per-FY if present, else overall (honest fallback)
  const selMovers = sel != null && (fy[sel].winners || fy[sel].losers);
  const winners = selMovers ? (fy[sel].winners || []) : data.winners || [];
  const losers = selMovers ? (fy[sel].losers || []) : data.losers || [];
  const moversScopeNote = sel != null && !selMovers && (winners.length || losers.length);

  return (
    <div className={'card ' + className}>
      <div className="fxc" style={{ marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="ctitle">Realized P&amp;L</div>
          <div className="sub" style={{ margin: 0 }}>{data.source || 'avg-cost'} · as on {data.asOf}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={'vmd ' + cl(scopeTotal)}><Money n={scopeTotal} />
            {currency === 'usd' && fxRate ? <span className="sub" style={{ fontWeight: 400 }}> ≈<span className="rs">₹</span>{compactInr(Math.abs(scopeTotal) * fxRate)}</span> : null}
          </div>
          <div className="sub" style={{ margin: 0 }}>{scopeLabel}</div>
        </div>
      </div>

      {/* per-FY bar chart — scales to any number of years */}
      <div className="rz-bars">
        {fy.map((b, i) => {
          const h = Math.max(2, Math.round(Math.abs(b.amt) / maxAbs * 44));
          const up = b.amt >= 0;
          const cls = 'rz-col' + (sel === i ? ' sel' : '') + (sel != null && sel !== i ? ' dim' : '');
          return (
            <div key={b.label} className={cls} title={`${b.label}  ${up ? '+' : '−'}${currency === 'usd' ? '$' + Math.abs(b.amt).toFixed(2) : '₹' + compactInr(b.amt)}`}
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

      <div className="rz-scope">
        <button className={'rz-tab' + (sel == null ? ' on' : '')} onClick={() => setSel(null)}>Overall</button>
        <span className="sub" style={{ margin: 0 }}>{sel == null ? '· click a bar to drill into a year' : `· showing ${fy[sel].label}`}</span>
      </div>

      {/* scope-aware context tiles */}
      <div className="g3 sec">
        {sel == null ? (
          <>
            <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>Best year</div>
              <div className={'vsm ' + (bestIdx >= 0 ? cl(vals[bestIdx]) : '')}>{bestIdx >= 0 ? <Money n={vals[bestIdx]} /> : '—'}</div>
              <div className="sub">{bestIdx >= 0 ? fy[bestIdx].label : ''}</div></div>
            <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>Worst year</div>
              <div className={'vsm ' + (worstIdx >= 0 ? cl(vals[worstIdx]) : '')}>{worstIdx >= 0 ? <Money n={vals[worstIdx]} /> : '—'}</div>
              <div className="sub">{worstIdx >= 0 ? fy[worstIdx].label : ''}</div></div>
            <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>Profitable years</div>
              <div className="vsm">{winYears} / {fy.length}</div><div className="sub">of total</div></div>
          </>
        ) : (
          <>
            <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>{fy[sel].label} realised</div>
              <div className={'vsm ' + cl(fy[sel].amt)}><Money n={fy[sel].amt} /></div></div>
            <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>vs best year</div>
              <div className="vsm mono">{bestIdx >= 0 ? <Money n={fy[sel].amt - vals[bestIdx]} /> : '—'}</div>
              <div className="sub">{bestIdx >= 0 ? fy[bestIdx].label : ''}</div></div>
            <div className="mini"><div className="lbl" style={{ marginBottom: 4 }}>Rank</div>
              <div className="vsm">#{[...vals].sort((a, b) => b - a).indexOf(fy[sel].amt) + 1} / {fy.length}</div><div className="sub">by realised</div></div>
          </>
        )}
      </div>

      {/* mover chips */}
      {(winners.length || losers.length) ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {[...winners, ...losers].map((m, i) => (
            <span key={m.sym + i} className="mf-chip">
              <span className="mf-dot" style={{ background: PALETTE[i % PALETTE.length] }} />{m.sym}{' '}
              <span className={cl(m.amt)}><Money n={m.amt} /></span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="sub" style={{ marginTop: 12, color: 'var(--txt3)', lineHeight: 1.6 }}>
        {moversScopeNote ? 'Top movers shown at the overall scope (per-year stock detail pending a tradebook import). ' : ''}
        {note}
      </div>
    </div>
  );
}

// categorical palette for the mover dots (matches SECTOR_PALETTE in page.js)
const PALETTE = ['var(--blu)', 'var(--pur)', '#06B6D4', 'var(--grn)', '#E85F8F', 'var(--acc)'];
