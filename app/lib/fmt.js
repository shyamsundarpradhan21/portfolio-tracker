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
export const sFull   = (n) => (n >= 0 ? '+' : '-') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');

export function fmtNavDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]} ${MON[+m[2] - 1]} ${m[1]}` : null;
}

export function fmtDateObj(d) {
  return `${String(d.getDate()).padStart(2, '0')} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

export const isoOf = (d) => d.toISOString().slice(0, 10);

// JSX helpers — need 'use client' context
export const Rs = () => <span className="rs">₹</span>;

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
