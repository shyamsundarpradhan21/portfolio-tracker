'use client';

import { Fragment } from 'react';

export const cl  = (n) => (n >= 0 ? 'grn' : 'red');
export const sg  = (n) => (n >= 0 ? '+' : '-');
//   = narrow no-break space, the typographic separator before a % sign so
// it doesn't jam against the digits.
export const NNBSP = ' ';
export const pctS = (n) => Math.abs(n).toFixed(2) + NNBSP + '%';
// 1-decimal percent (CAGR/XIRR style); returns an em-dash for null.
export const pct1 = (n) => (n == null ? '—' : Math.abs(n).toFixed(1) + NNBSP + '%');

export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function inrC(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return '₹' + (n / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K';
  return '₹' + Math.round(n);
}

export function inrCd(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return '' + Math.round(n);
}

export const inrFd  = (n) => Math.round(n).toLocaleString('en-IN');
export const inrFull = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
export const usd     = (n) => '$' + Math.abs(n).toFixed(2);
export const numC    = (n) => Math.round(n).toLocaleString('en-IN');
// Sign dropped — colour (grn/red) carries direction everywhere this is shown.
export const sFull   = (n) => '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

export function fmtNavDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]} ${MON[+m[2] - 1]} ${m[1]}` : null;
}

export function fmtDateObj(d) {
  return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

export const isoOf = (d) => d.toISOString().slice(0, 10);

// Compact "time since" for the AI-card countdown: now / 3m / 4h / 4d / 5w / 2mo.
export const agoShort = (ts) => {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  const m = s / 60; if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60; if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24; if (d < 7) return `${Math.round(d)}d`;
  const w = d / 7; if (w < 4.5) return `${Math.round(w)}w`;
  return `${Math.round(d / 30)}mo`;
};

// JSX helpers — need 'use client' context
export const Rs  = () => <span className="rs">₹</span>;
export const Usd = () => <span className="rs">$</span>;

// UsdF — renders a dollar amount with the $ symbol sized via .rs so it sits flush
// against the numerals. `d` controls decimal places (default 2).
export const UsdF = ({ n, d = 2 }) => (
  <span style={{ whiteSpace: 'nowrap' }}><Usd />{Math.abs(n).toFixed(d)}</span>
);

export const InrC  = ({ n }) => <span style={{ whiteSpace: 'nowrap' }}><Rs />{inrCd(n)}</span>;
export const InrF  = ({ n }) => <span style={{ whiteSpace: 'nowrap' }}><Rs />{inrFd(n)}</span>;
export const SInrC = ({ n }) => <span style={{ whiteSpace: 'nowrap' }}><Rs />{inrCd(Math.abs(n))}</span>;
export const SInrF = ({ n }) => <span style={{ whiteSpace: 'nowrap' }}><Rs />{inrFd(Math.abs(n))}</span>;

// Percent with a hair of breathing room before the % glyph so it doesn't jam
// against the digits. `d` = decimal places (default 2).
export const Pct = ({ n, d = 2 }) => (
  <span style={{ whiteSpace: 'nowrap' }}>{Number(n).toFixed(d)}<span className="pct">%</span></span>
);

export function RsText({ children }) {
  const s = String(children ?? '');
  if (!s.includes('₹')) return <>{s}</>;
  return (
    <>{s.split('₹').map((p, i) =>
      i === 0
        ? <Fragment key={i}>{p}</Fragment>
        : <Fragment key={i}><Rs />{p}</Fragment>
    )}</>
  );
}
