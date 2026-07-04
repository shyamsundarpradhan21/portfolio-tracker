'use client';

import { Fragment, createContext, useContext } from 'react';

// cl() lives in ./direction.js (JSX-free, so it unit-tests directly) and is re-exported
// here — every call site still imports `cl` from '../lib/fmt'. See direction.js for the
// sign→colour contract; fmt.test.js locks it.
export { cl } from './direction.js';

// ── App-wide display currency (₹ ↔ $) ─────────────────────────────────────────
// The app's data is ₹-native; US holdings are the exception (passed to UsdF in $).
// A single global toggle (topbar) flips EVERY money figure between ₹ and $ via the
// live USD/INR. Two channels, both fed by CurrencyProvider so they never diverge:
//   • CurrencyCtx — React context the money COMPONENTS consume (re-renders every
//     consumer on toggle, even through React.memo).
//   • module mirror (_CUR/_FX) — read by the glyph-carrying STRING helpers
//     (inrFull/inrC/sFull/usd) used in titles/tooltips; the provider is an ancestor,
//     so its render sets the mirror before any descendant string helper runs.
// Default 'inr' so the app reads in ₹ exactly as before until the user toggles.
export const CurrencyCtx = createContext({ mode: 'inr', fx: 88 });
let _CUR = 'inr', _FX = 88;
export function setDisplayCurrency(mode, fx) { _CUR = mode === 'usd' ? 'usd' : 'inr'; if (fx > 0) _FX = fx; }
export const displayCurrency = () => _CUR;
export const displayFx = () => _FX;
export function CurrencyProvider({ mode, fx, children }) {
  const m = mode === 'usd' ? 'usd' : 'inr';
  const f = fx > 0 ? fx : 88;
  setDisplayCurrency(m, f);
  return <CurrencyCtx.Provider value={{ mode: m, fx: f }}>{children}</CurrencyCtx.Provider>;
}
export const useDisplayCurrency = () => useContext(CurrencyCtx);
export const sg  = (n) => (n >= 0 ? '+' : '-');
//   = narrow no-break space, the typographic separator before a % sign so
// it doesn't jam against the digits.
export const NNBSP = ' ';
export const pctS = (n) => Math.abs(n).toFixed(2) + NNBSP + '%';
// 1-decimal percent (CAGR/XIRR style); returns an em-dash for null.
export const pct1 = (n) => (n == null ? '—' : Math.abs(n).toFixed(1) + NNBSP + '%');

export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── number cores (glyph-free) ─────────────────────────────────────────────────
// ₹ compact (Cr/L/K) and grouped; $ compact (M/K) and grouped. inrCd/inrFd stay the
// ₹ cores (used by callers that add their own literal glyph); the display components
// pick a ₹ or $ core off the live currency.
export function inrCd(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return '' + Math.round(n);
}
export const inrFd = (n) => Math.round(n).toLocaleString('en-IN');
const usdCd = (n) => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  return s + Math.round(a);
};
const usdFd = (n) => Math.round(n).toLocaleString('en-US');

// glyph-carrying STRING helpers (titles/tooltips) — mode-aware off the module mirror.
export function inrC(n)  { return _CUR === 'usd' ? '$' + usdCd(n / _FX) : '₹' + inrCd(n); }
export const inrFull = (n) => (_CUR === 'usd' ? '$' + usdFd(n / _FX) : '₹' + inrFd(n));
export const usd     = (n) => (_CUR === 'usd' ? '$' + Math.abs(n).toFixed(2) : '₹' + inrFd(Math.abs(n) * _FX)); // base-$ amount
// Sign dropped — colour (grn/red) carries direction everywhere this is shown.
export const sFull   = (n) => (_CUR === 'usd' ? '$' + usdFd(Math.abs(n) / _FX) : '₹' + inrFd(Math.abs(n)));
// grouped ₹ number, glyph-free — left ₹-native (callers show no glyph; a bare $ number
// with a silently-divided magnitude would mislead). Currency-flipped figures use InrF.
export const numC    = (n) => Math.round(n).toLocaleString('en-IN');

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
// currency glyph sized via .rs — $ in usd-mode, ₹ otherwise.
const Glyph = ({ usd: u }) => <span className="rs">{u ? '$' : '₹'}</span>;

// The money components read the live display currency (CurrencyCtx). Base-₹ figures
// (InrC/InrF/SInrC/SInrF) convert to $ by ÷fx in usd-mode; the base-$ figure (UsdF)
// converts to ₹ by ×fx in inr-mode. Glyph + number are chosen together so they never
// disagree. Direction stays colour-only — magnitudes here are unsigned (S*) or carry
// the raw sign (InrC/InrF), exactly as before.

// UsdF — a DOLLAR-base amount. usd-mode: $ (d decimals). inr-mode: ₹ (×fx, grouped).
export const UsdF = ({ n, d = 2 }) => {
  const { mode, fx } = useContext(CurrencyCtx); const a = Math.abs(n);
  return mode === 'usd'
    ? <span style={{ whiteSpace: 'nowrap' }}><Glyph usd />{a.toFixed(d)}</span>
    : <span style={{ whiteSpace: 'nowrap' }}><Glyph />{inrFd(a * fx)}</span>;
};

export const InrC  = ({ n }) => { const { mode, fx } = useContext(CurrencyCtx); const u = mode === 'usd';
  return <span style={{ whiteSpace: 'nowrap' }}><Glyph usd={u} />{u ? usdCd(n / fx) : inrCd(n)}</span>; };
export const InrF  = ({ n }) => { const { mode, fx } = useContext(CurrencyCtx); const u = mode === 'usd';
  return <span style={{ whiteSpace: 'nowrap' }}><Glyph usd={u} />{u ? usdFd(n / fx) : inrFd(n)}</span>; };
export const SInrC = ({ n }) => { const { mode, fx } = useContext(CurrencyCtx); const u = mode === 'usd'; const a = Math.abs(n);
  return <span style={{ whiteSpace: 'nowrap' }}><Glyph usd={u} />{u ? usdCd(a / fx) : inrCd(a)}</span>; };
export const SInrF = ({ n }) => { const { mode, fx } = useContext(CurrencyCtx); const u = mode === 'usd'; const a = Math.abs(n);
  return <span style={{ whiteSpace: 'nowrap' }}><Glyph usd={u} />{u ? usdFd(a / fx) : inrFd(a)}</span>; };

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
