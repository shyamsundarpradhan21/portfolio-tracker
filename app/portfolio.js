// Portfolio data module. The private cost-basis data (holdings, salary, loans,
// contributions) NO LONGER lives here — it is pulled out of the client bundle and
// served at runtime from /api/portfolio (Vercel KV `portfolio:v1`, local-dev
// fallback to the gitignored data/portfolio.private.json; seeded by
// scripts/seed-portfolio-kv.mjs). This file ships EMPTY containers; page.js
// fetches the data and calls hydratePortfolio() to fill them in place BEFORE it
// renders the dashboard, so every consumer keeps importing these bindings
// unchanged and reads the filled values at call/render time.

// ── Private data containers (empty in the bundle; filled by hydratePortfolio) ──
export const INDIAN = [];
export const TRANSACTIONS = [];
export const CORPORATE_ACTIONS = [];
export const INDIAN_BENCHMARKS = [];
export const INDIAN_REALIZED = {};
export const US_CASHFLOWS = [];
export const US_REALIZED = {};
export const US_DIVIDENDS = {};
export const US_CORP_ACTIONS = [];
export const US_BENCHMARKS = [];
export const US = [];
export const FDS = [];
export const STATIC = {};
export const LOAN = {};
export const MF_FUNDS = [];
export const MF_CASHFLOWS = [];
export const MF_SIP = {};
export const MF_BENCHMARK = {};
export const ALGO = {};
export const SWING = [];
export const CMPF_CONTRIBUTIONS = [];
export const CMPF_RATES = {};
export const CMPS_CONTRIBUTIONS = [];
export const PAYSLIPS = [];
export const BASIC_PAY = [];   // [{month, basic}] — actual basic pay from payslips (pensionable salary)
export const PROJECTION = {};

// ── Non-private scalars + presentation constants (safe to ship) ───────────────
// UNITS_AS_OF — CAS units freshness date (display only).
export const UNITS_AS_OF = '05-Jun-2026';
// Legacy aggregate realised P&L (kept for backward compat; unused outside this file).
export const REALIZED_PNL = -27862;
// CMPF's signature fill: grey/black diagonal hatch (see the deployment card).
// HTML backgrounds use it directly; SunburstMix maps it to an SVG pattern.
export const CMPF_HATCH = 'repeating-linear-gradient(45deg, #9e9e9e 0, #9e9e9e 2.5px, #161616 2.5px, #161616 6.5px)';
export const ALLOC_COLORS = {
  // Each sleeve coloured by its LINKED TAB's accent (the global --tab-* palette in
  // globals.css), so the allocation bar matches the Overview header cards. Indian
  // (blue) and US (indigo) read close, so the sleeve ORDER keeps them non-adjacent
  // (Indian leads, FD sits between it and US) rather than recolouring either. ELSS
  // keeps its magenta; CMPF (pension) stays the diagonal hatch.
  indian: 'var(--tab-indian)', us: 'var(--tab-us)', fd: 'var(--tab-fd)',
  mf: 'var(--tab-mf)', elss: 'var(--pnk)', pf: CMPF_HATCH,
  algo: 'var(--tab-algo)', // the Trading-business slice (now IN net worth, book-valued)
};
export const CAT_COLORS = {
  ETF: '#4F8FE8', Crypto: '#F59E0B', Bond: '#9090A8', Tech: '#8F7FE8',
  Financial: '#2DB87F', Fintech: '#06B6D4', Consumer: '#E85F8F',
  Healthcare: '#10B981', Industrial: '#6B7280', Commodity: '#D97706',
};

// ── Logic (reads the containers at call time, so it works after hydration) ────

// FD cashflows: deployments (newMoney, never pipeline; closed rows kept so history
// survives redemption).
export const fdFlows = () =>
  FDS.filter((f) => f.status !== 'pipeline').map((f) => ({ date: f.open, amount: f.newMoney ?? f.principal }));
const fdMaturityValue = (f) => {
  const yrs = (new Date(f.matures) - new Date(f.open)) / (365.25 * 24 * 3600 * 1000);
  return f.principal * Math.pow(1 + f.rate / 400, 4 * yrs);
};
// Redemptions = cash leaving the FD sleeve: explicitly closed rows (payout/principal)
// + active rows past maturity (auto-matured to full quarterly-compounded value).
export const fdRedemptions = (now = new Date()) => [
  ...FDS.filter((f) => f.status === 'closed' && f.closedOn)
    .map((f) => ({ date: f.closedOn, amount: f.payout ?? f.principal })),
  ...FDS.filter((f) => f.status === 'active' && new Date(f.matures) <= now)
    .map((f) => ({ date: f.matures, amount: Math.round(fdMaturityValue(f)) })),
];

// Outstanding loan balance on any date: 0 before disbursement, the actual statement
// balance through the recorded window, then a projected EMI/interest simulation.
export function loanOutstanding(date = new Date()) {
  const d = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  if (!LOAN.open || d < LOAN.open) return 0;
  const B = LOAN.balances || [];
  let bal = null, lastD = null;
  for (const [bd, bv] of B) { if (bd <= d) { bal = bv; lastD = bd; } else break; }
  if (bal == null) return 0;
  // Project past the statement window: daily accrual capitalised monthly, EMI on the 5th.
  let cur = new Date(lastD + 'T00:00:00Z');
  const end = new Date(d + 'T00:00:00Z');
  let accr = 0;
  while (cur < end && bal > 0) {
    cur = new Date(cur.getTime() + 86400000);
    accr += (bal * LOAN.rate) / 36500;
    if (cur.getUTCDate() === 5) bal = Math.max(0, bal - LOAN.emi);
    const next = new Date(cur.getTime() + 86400000);
    if (next.getUTCMonth() !== cur.getUTCMonth()) { bal += accr; accr = 0; }
  }
  return Math.round(bal);
}

// ── Runtime hydration ─────────────────────────────────────────────────────────
// Fills the containers IN PLACE from the /api/portfolio payload. Idempotent
// (clear-then-fill / assign), so a re-render or HMR re-run never duplicates rows.
// The captured payload holds FINAL values (e.g. STATIC.algo, SWING's mapped rows),
// so nothing is re-derived here.
const _fill = (arr, src) => { arr.length = 0; if (Array.isArray(src)) arr.push(...src); };
const _assign = (obj, src) => { for (const k of Object.keys(obj)) delete obj[k]; if (src && typeof src === 'object') Object.assign(obj, src); };

const _ARRAYS = { INDIAN, TRANSACTIONS, CORPORATE_ACTIONS, INDIAN_BENCHMARKS, US_CASHFLOWS, US_CORP_ACTIONS, US_BENCHMARKS, US, FDS, MF_FUNDS, MF_CASHFLOWS, CMPF_CONTRIBUTIONS, CMPS_CONTRIBUTIONS, PAYSLIPS, BASIC_PAY, SWING };
const _OBJECTS = { INDIAN_REALIZED, US_REALIZED, US_DIVIDENDS, STATIC, LOAN, MF_SIP, MF_BENCHMARK, ALGO, CMPF_RATES, PROJECTION };

let _hydrated = false;
export function hydratePortfolio(d) {
  if (!d) return false;
  for (const k in _ARRAYS) _fill(_ARRAYS[k], d[k]);
  for (const k in _OBJECTS) _assign(_OBJECTS[k], d[k]);
  _hydrated = true;
  return true;
}
export const isPortfolioHydrated = () => _hydrated;
