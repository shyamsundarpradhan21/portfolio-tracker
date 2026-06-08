// Static cost basis for the portfolio. Live prices are layered on top at
// runtime via /api/quotes. `inv` = invested amount (qty * avg cost) in the
// holding's native currency (INR for NSE, USD for US).

// Indian equities — NSE. Yahoo symbols use the ".NS" suffix. Holdings are
// reconciled against the Zerodha tradebook (14 positions; SUPRIYA 36 post-
// booking; POWERGRID held; TCS/NATCOPHARM exited). GVT&D/GVTD (net-zero closed,
// dual-spelling) and any net-negative/exited symbol (OIL, FORTIS) are
// deliberately absent — do not reintroduce them anywhere.
export const INDIAN = [
  { sym: 'COFORGE',    name: 'Coforge Ltd',              qty: 21,  cost: 1398.14, sector: 'Technology',  cap: 'Large' },
  { sym: 'CUB',        name: 'City Union Bank',          qty: 141, cost: 212.12,  sector: 'Banking',     cap: 'Small' },
  { sym: 'FEDERALBNK', name: 'Federal Bank',             qty: 155, cost: 193.69,  sector: 'Banking',     cap: 'Mid'   },
  { sym: 'GODREJCP',   name: 'Godrej Consumer Products', qty: 30,  cost: 999.00,  sector: 'FMCG',        cap: 'Large' },
  { sym: 'LT',         name: 'Larsen & Toubro',          qty: 8,   cost: 3616.60, sector: 'Industrials', cap: 'Large' },
  { sym: 'MARKSANS',   name: 'Marksans Pharma',          qty: 135, cost: 217.80,  sector: 'Pharma',      cap: 'Small' },
  { sym: 'NH',         name: 'Narayana Hrudayalaya',     qty: 17,  cost: 1743.33, sector: 'Healthcare',  cap: 'Mid'   },
  { sym: 'PITTIENG',   name: 'Pitti Engineering',        qty: 38,  cost: 772.26,  sector: 'Industrials', cap: 'Small' },
  { sym: 'POWERGRID',  name: 'Power Grid Corp',          qty: 102, cost: 289.45,  sector: 'Utilities',   cap: 'Large' },
  { sym: 'PRICOLLTD',  name: 'Pricol Ltd',               qty: 56,  cost: 503.48,  sector: 'Auto',        cap: 'Mid'   },
  { sym: 'STYRENIX',   name: 'Styrenix Performance',     qty: 15,  cost: 1927.00, sector: 'Materials',   cap: 'Small' },
  { sym: 'SUPRIYA',    name: 'Supriya Lifescience',      qty: 36,  cost: 586.97,  sector: 'Pharma',      cap: 'Small' },
  { sym: 'TECHNOE',    name: 'Techno Electric & Engg',   qty: 33,  cost: 907.80,  sector: 'Industrials', cap: 'Mid'   },
  { sym: 'ZYDUSLIFE',  name: 'Zydus Lifesciences',       qty: 33,  cost: 894.25,  sector: 'Pharma',      cap: 'Large' },
].map((s) => ({ ...s, ns: `${s.sym}.NS`, inv: +(s.qty * s.cost).toFixed(2) }));

// Per-stock invested capital at each stock's buy-amount-weighted average date
// (from the Zerodha tradebook). Drives XIRR/CAGR — one outflow per row on its
// date, one inflow today (+current value). Σinvested ties to ~₹4.04L.
export const TRANSACTIONS = [
  { sym: 'COFORGE',    date: '2026-05-25', invested: 29361 },
  { sym: 'CUB',        date: '2025-09-28', invested: 29909 },
  { sym: 'FEDERALBNK', date: '2025-10-01', invested: 30022 },
  { sym: 'GODREJCP',   date: '2025-11-25', invested: 29970 },
  { sym: 'LT',         date: '2026-04-06', invested: 28933 },
  { sym: 'MARKSANS',   date: '2026-05-25', invested: 29403 },
  { sym: 'NH',         date: '2026-03-05', invested: 29637 },
  { sym: 'PITTIENG',   date: '2026-01-30', invested: 29346 },
  { sym: 'POWERGRID',  date: '2026-02-04', invested: 29524 },
  { sym: 'PRICOLLTD',  date: '2025-10-03', invested: 28195 },
  { sym: 'STYRENIX',   date: '2026-01-14', invested: 28905 },
  { sym: 'SUPRIYA',    date: '2026-03-09', invested: 21131 },
  { sym: 'TECHNOE',    date: '2026-01-21', invested: 29957 },
  { sym: 'ZYDUSLIFE',  date: '2025-09-22', invested: 29510 },
];

// Realised equity P&L — authoritative constant from the Zerodha tax P&L
// statement (NOT reconstructed from the tradebook: a FORTIS corporate-action
// artifact makes raw reconstruction wrong). Σ FY22→FY27 equity realised:
// short-term −25,786 + intraday −4,864 + long-term +2,789. Update after exits.
export const REALIZED_PNL = -27862;

// Corporate actions on CURRENT holdings (manual array, maintained like the FD
// tab until a broker/market feed is wired). Upcoming (ex ≥ today) populate the
// panel; executed (ex < today) move to the footline. Bonus ratios are applied
// to holdings automatically once the ex-date passes (see applyCorpActions).
export const CORPORATE_ACTIONS = [
  { type: 'bonus',    sym: 'CUB',      name: 'City Union Bank',          ex: '2026-06-12', ratio: '1:3' },
  { type: 'dividend', sym: 'LT',       name: 'Larsen & Toubro',          ex: '2026-05-22', perShare: 38 },
  { type: 'dividend', sym: 'GODREJCP', name: 'Godrej Consumer Products', ex: '2026-05-12', perShare: 5 },
];

// Less-correlated benchmark set. The portfolio carries a mid/small tilt, so we
// keep Mid and Small as SEPARATE benchmarks (the single MidSmall-400 index is
// flaky on Yahoo), plus large-cap market and a low-correlation opportunity-cost
// asset (gold). Each benchmark lists candidate Yahoo tickers tried in order —
// the first that resolves wins; if none do, the UI shows "—". Indian index
// tickers are flaky, so liquid ETF proxies are included as fallbacks.
export const INDIAN_BENCHMARKS = [
  { key: 'nifty50',  label: 'Nifty 50',          color: 'var(--blu)', yahooSyms: ['^NSEI', 'NIFTYBEES.NS'] },
  { key: 'midcap',   label: 'Nifty Midcap 150',  color: 'var(--pur)', yahooSyms: ['NIFTYMIDCAP150.NS', 'MIDCAPIETF.NS', 'MID150BEES.NS'] },
  { key: 'smallcap', label: 'Nifty Smallcap',     color: 'var(--grn)', yahooSyms: ['^CNXSC', 'NIFTYSMLCAP250.NS', 'NIFTYSMALLCAP250.NS', 'MOSMALL250.NS', 'HDFCSML250.NS'] },
  { key: 'gold',     label: 'Gold',              color: 'var(--acc)', yahooSyms: ['GOLDBEES.NS', 'GOLD.NS'] },
];

// US external cashflows from the Vested/DriveWealth statement (Transfers sheet):
// deposits are capital in (+invested), the lone withdrawal is capital out
// (−invested), all in USD. Drives the US tab's money-weighted XIRR/CAGR and the
// same-dated-dollars benchmark counterfactuals. Net deployed ≈ $3,565.
export const US_CASHFLOWS = [
  { date: '2024-03-08', invested: 120 },
  { date: '2024-03-25', invested: 120 },
  { date: '2024-04-15', invested: 50 },
  { date: '2024-05-03', invested: 90 },
  { date: '2024-06-05', invested: 90 },
  { date: '2024-08-07', invested: 100 },
  { date: '2024-09-12', invested: 189.1 },
  { date: '2024-10-16', invested: 60 },
  { date: '2024-11-04', invested: 200 },
  { date: '2024-12-03', invested: 200 },
  { date: '2025-02-03', invested: 200 },
  { date: '2025-03-12', invested: 200 },
  { date: '2025-06-12', invested: 200 },
  { date: '2025-06-30', invested: 170 },
  { date: '2025-07-31', invested: 151.2 },
  { date: '2025-08-04', invested: 151.2 },
  { date: '2025-09-02', invested: 154.22 },
  { date: '2025-09-26', invested: 201.15 },
  { date: '2025-10-30', invested: 202.11 },
  { date: '2025-12-03', invested: 198.49 },
  { date: '2026-01-05', invested: 198.35 },
  { date: '2026-02-05', invested: 208.47 },
  { date: '2026-04-27', invested: 104.74 },
  { date: '2026-05-11', invested: 146.46 },
  { date: '2026-02-17', invested: -140 }, // withdrawal
];

// US benchmark set (USD), valued as same-dated-dollars counterfactuals: broad
// market / growth tilt / low-correlation gold. Yahoo carries these reliably.
export const US_BENCHMARKS = [
  { key: 'sp500',  label: 'S&P 500',     color: 'var(--blu)', yahooSyms: ['^GSPC', 'IVV'] },
  { key: 'nasdaq', label: 'NASDAQ 100',  color: 'var(--pur)', yahooSyms: ['^NDX', 'QQQ'] },
  { key: 'gold',   label: 'Gold',        color: 'var(--acc)', yahooSyms: ['GLD', 'GC=F'] },
];
export const US = [
  { sym: 'QQQM', name: 'Invesco NASDAQ 100',   cat: 'ETF',        qty: 3.21393889,  cost: 227.36 },
  { sym: 'SCHD', name: 'Schwab US Dividend',    cat: 'ETF',        qty: 26.89079465, cost: 28.16 },
  { sym: 'IVV',  name: 'iShares Core S&P 500',  cat: 'ETF',        qty: 0.48455983,  cost: 629.13 },
  { sym: 'EFA',  name: 'iShares MSCI EAFE',     cat: 'ETF',        qty: 2.04028110,  cost: 92.21 },
  { sym: 'HUT',  name: 'Hut 8 Mining',          cat: 'Crypto',     qty: 0.97740869,  cost: 31.03 },
  { sym: 'IREN', name: 'IREN Ltd',              cat: 'Crypto',     qty: 1.65238383,  cost: 28.22 },
  { sym: 'KEEL', name: 'Bitfarms Ltd',          cat: 'Crypto',     qty: 17.58263430, cost: 2.79 },
  { sym: 'CIFR', name: 'Cipher Mining',         cat: 'Crypto',     qty: 3.62880571,  cost: 10.45 },
  { sym: 'WULF', name: 'TeraWulf Inc',          cat: 'Crypto',     qty: 3.29782732,  cost: 13.91 },
  { sym: 'RIOT', name: 'Riot Platforms',        cat: 'Crypto',     qty: 3.04895251,  cost: 13.54 },
  { sym: 'APLD', name: 'Applied Digital',       cat: 'Crypto',     qty: 1.88542408,  cost: 17.91 },
  { sym: 'BTDR', name: 'Bitdeer Technologies',  cat: 'Crypto',     qty: 4.03060064,  cost: 12.33 },
  { sym: 'CORZ', name: 'Core Scientific',       cat: 'Crypto',     qty: 2.59271899,  cost: 15.57 },
  { sym: 'CLSK', name: 'CleanSpark Inc',        cat: 'Crypto',     qty: 4.30472224,  cost: 11.92 },
  { sym: 'MARA', name: 'MARA Holdings',         cat: 'Crypto',     qty: 5.11992148,  cost: 12.62 },
  { sym: 'COIN', name: 'Coinbase Global',       cat: 'Fintech',    qty: 0.37779574,  cost: 237.90 },
  { sym: 'TSM',  name: 'Taiwan Semiconductor',  cat: 'Tech',       qty: 0.13178518,  cost: 239.95 },
  { sym: 'ASML', name: 'ASML Holding',          cat: 'Tech',       qty: 0.03142779,  cost: 897.97 },
  { sym: 'FTNT', name: 'Fortinet Inc',          cat: 'Tech',       qty: 0.34589848,  cost: 83.41 },
  { sym: 'GOOG', name: 'Alphabet Inc C',        cat: 'Tech',       qty: 0.12058721,  cost: 231.71 },
  { sym: 'DE',   name: 'Deere & Company',       cat: 'Industrial', qty: 0.07249718,  cost: 487.47 },
  { sym: 'MA',   name: 'Mastercard Inc',        cat: 'Financial',  qty: 0.07927226,  cost: 533.22 },
  { sym: 'AMZN', name: 'Amazon.com',            cat: 'Tech',       qty: 0.14984346,  cost: 231.47 },
  { sym: 'MSFT', name: 'Microsoft Corp',        cat: 'Tech',       qty: 0.08946783,  cost: 477.59 },
  { sym: 'AAPL', name: 'Apple Inc',             cat: 'Tech',       qty: 0.12021394,  cost: 250.62 },
  { sym: 'META', name: 'Meta Platforms',        cat: 'Tech',       qty: 0.05739645,  cost: 698.74 },
  { sym: 'NVDA', name: 'NVIDIA Corp',           cat: 'Tech',       qty: 0.15944901,  cost: 185.78 },
  { sym: 'AVGO', name: 'Broadcom Inc',          cat: 'Tech',       qty: 0.08579665,  cost: 373.70 },
  { sym: 'JPM',  name: 'JPMorgan Chase',        cat: 'Financial',  qty: 0.10946482,  cost: 272.86 },
  { sym: 'V',    name: 'Visa Inc',              cat: 'Financial',  qty: 0.10467968,  cost: 321.45 },
  { sym: 'KO',   name: 'Coca-Cola Co',          cat: 'Consumer',   qty: 0.42763267,  cost: 71.49 },
  { sym: 'HOOD', name: 'Robinhood Markets',     cat: 'Fintech',    qty: 0.39344900,  cost: 75.83 },
  { sym: 'ADBE', name: 'Adobe Inc',             cat: 'Tech',       qty: 0.11263521,  cost: 329.83 },
  { sym: 'CRM',  name: 'Salesforce Inc',        cat: 'Tech',       qty: 0.15097611,  cost: 239.42 },
  { sym: 'PYPL', name: 'PayPal Holdings',       cat: 'Fintech',    qty: 0.44433619,  cost: 58.22 },
  { sym: 'INTU', name: 'Intuit Inc',            cat: 'Tech',       qty: 0.06385697,  cost: 612.49 },
  { sym: 'TMO',  name: 'Thermo Fisher',         cat: 'Healthcare', qty: 0.06009584,  cost: 562.27 },
  { sym: 'CPRT', name: 'Copart Inc',            cat: 'Industrial', qty: 0.88763169,  cost: 37.95 },
  { sym: 'DIS',  name: 'Walt Disney Co',        cat: 'Consumer',   qty: 0.22168688,  cost: 103.83 },
  { sym: 'MCO',  name: "Moody's Corp",          cat: 'Financial',  qty: 0.04477301,  cost: 486.90 },
  { sym: 'PEP',  name: 'PepsiCo Inc',           cat: 'Consumer',   qty: 0.24577938,  cost: 146.51 },
  { sym: 'PG',   name: 'Procter & Gamble',      cat: 'Consumer',   qty: 0.24194700,  cost: 142.01 },
  { sym: 'SHW',  name: 'Sherwin-Williams',      cat: 'Consumer',   qty: 0.10338465,  cost: 325.39 },
  { sym: 'GLXY', name: 'Galaxy Digital',        cat: 'Crypto',     qty: 2.20669882,  cost: 22.11 },
  { sym: 'EEM',  name: 'iShares MSCI Em Mkts',  cat: 'ETF',        qty: 1.40223367,  cost: 54.11 },
  { sym: 'IUSB', name: 'iShares Core USD Bond', cat: 'Bond',       qty: 1.67829979,  cost: 46.32 },
  { sym: 'HYDB', name: 'iShares Hi-Yld Bond',   cat: 'Bond',       qty: 0.84219937,  cost: 46.84 },
  { sym: 'GLDM', name: 'SPDR Gold MiniShares',  cat: 'Commodity',  qty: 0.42969398,  cost: 93.49 },
  { sym: 'PDBC', name: 'Invesco Optm Commodity',cat: 'Commodity',  qty: 2.19651956,  cost: 17.43 },
].map((s) => ({ ...s, inv: +(s.qty * s.cost).toFixed(2) }));

// Fixed deposits — quarterly-compounding cumulative FDs, no external feed.
// `open`/`matures` are ISO dates; accrued interest, value-at-maturity and
// progress are derived live from the system clock (see deriveFds in page.js —
// quarterly compounding only, simple interest is never used).
export const FDS = [
  { bank: 'Slice', label: 'I', principal: 125000, rate: 7.75, open: '2025-12-08', matures: '2027-06-09' },
  { bank: 'ICICI', label: 'I', principal: 135000, rate: 6.60, open: '2025-12-09', matures: '2027-12-10' },
  { bank: 'HDFC',  label: 'I', principal: 235000, rate: 6.45, open: '2026-03-08', matures: '2027-09-09' },
];

// Other static assets and liabilities (INR).
export const STATIC = {
  algo: 604000,        // active algo trading capital deployed
  loan: 750000,        // personal loan liability
  // Mutual-fund value is now computed live from MF_FUNDS × NAV (see /api/mf-nav).
  // FD value (principal + accrued interest) is now computed live — see deriveFds.
};

// FD pipeline — committed but not yet deployed; excluded from net worth and
// "deployed" totals until the deploy date arrives. The countdown badge on the
// nearest upcoming deploy is derived live (see deriveFds).
export const FD_PIPELINE = [
  { bank: 'SBI',   label: 'I',   deploy: '2026-06-09', maturity: '2028-06-10', tenure: '2y+1d',  amount: 150000 },
  { bank: 'Slice', label: 'II',  deploy: '2026-09-08', maturity: '2028-03-09', tenure: '18m+1d', amount: 275000 },
  { bank: 'ICICI', label: 'II',  deploy: '2026-12-09', maturity: '2028-12-10', tenure: '2y+1d',  amount: 165000 },
  { bank: 'HDFC',  label: 'II',  deploy: '2027-03-08', maturity: '2028-09-09', tenure: '18m+1d', amount: 245000 },
  { bank: 'SBI',   label: 'II',  deploy: '2027-06-09', maturity: '2029-06-10', tenure: '2y+1d',  amount: 155000 },
  { bank: 'ICICI', label: 'III', deploy: '2027-09-08', maturity: '2029-09-10', tenure: '2y+1d',  amount: 170000 },
  { bank: 'SBI',   label: 'III', deploy: '2027-12-09', maturity: '2029-12-10', tenure: '2y+1d',  amount: 165000 },
];

// Mutual funds. Units / cost / casNav are AUTHORITATIVE from the CAS statement
// (consolidated account statement) dated 05-Jun-2026. NAV is fetched live once
// daily via /api/mf-nav; casNav is the last-known fallback. AMFI scheme codes
// are resolved at runtime by name (inc = required terms, exc = rejected terms),
// so no brittle hardcoded codes.
//
// UNITS_AS_OF — units go stale the moment a new SIP installment executes; update
// them from the next CAS.
export const UNITS_AS_OF = '05-Jun-2026';

// Always resolve to the Direct-Growth plan, never Regular / IDCW / dividend.
const MF_EXC_BASE = ['regular', 'idcw', 'dividend'];

export const MF_FUNDS = [
  // JioBlackRock — Folio 2088065, Direct Growth
  { id: 'flexi',   platform: 'JioBLK',  name: 'Flexi Cap',          cat: 'Multi Cap',         units: 2097.894, cost: 20000, casNav: 9.5724,  q: 'JioBlackRock Flexi Cap',          inc: ['flexi cap', 'direct', 'growth'],      exc: [] },
  { id: 'nifty50', platform: 'JioBLK',  name: 'Nifty 50 Index',     cat: 'Large Cap · Index', units: 1134.852, cost: 11000, casNav: 9.4283,  q: 'JioBlackRock Nifty 50 Index',     inc: ['nifty 50 index', 'direct', 'growth'], exc: ['next', 'value', 'midcap', 'smallcap'] },
  { id: 'midcap',  platform: 'JioBLK',  name: 'Nifty Midcap 150',   cat: 'Mid Cap · Index',   units: 815.370,  cost: 8000,  casNav: 10.4744, q: 'JioBlackRock Nifty Midcap 150',   inc: ['midcap 150', 'direct', 'growth'],     exc: [] },
  { id: 'arb',     platform: 'JioBLK',  name: 'Arbitrage',          cat: 'Arbitrage · Hedged',units: 493.038,  cost: 5000,  casNav: 10.3087, q: 'JioBlackRock Arbitrage',          inc: ['arbitrage', 'direct', 'growth'],      exc: [] },
  { id: 'next50',  platform: 'JioBLK',  name: 'Nifty Next 50',      cat: 'Large Cap · Index', units: 307.856,  cost: 3000,  casNav: 10.4525, q: 'JioBlackRock Nifty Next 50',      inc: ['next 50', 'direct', 'growth'],        exc: [] },
  { id: 'small',   platform: 'JioBLK',  name: 'Nifty Smallcap 250', cat: 'Small Cap · Index', units: 330.775,  cost: 3000,  casNav: 10.0992, q: 'JioBlackRock Nifty Smallcap 250', inc: ['smallcap 250', 'direct', 'growth'],   exc: [] },
  // Zerodha
  { id: 'elss',    platform: 'Zerodha', name: 'ELSS Tax Saver',     cat: 'ELSS',              units: 42.390,   cost: 500,   casNav: 13.9096, q: 'Zerodha ELSS Tax Saver',          inc: ['elss', 'direct', 'growth'],           exc: [] },
].map((f) => ({ ...f, exc: [...MF_EXC_BASE, ...f.exc] }));

// Dated cashflows for XIRR (rupees out are negative). ELSS seed, then the two
// JioBlackRock lumpsum contributions. Today's cashflow (+current value) is
// appended at render time.
export const MF_CASHFLOWS = [
  { date: '2024-02-26', amount: -500 },
  { date: '2026-01-13', amount: -20000 },
  { date: '2026-03-20', amount: -30000 },
];

// Long-history Nifty 50 index fund used as the XIRR benchmark counterfactual.
export const MF_BENCHMARK = {
  name: 'Nifty 50 Index',
  q: 'UTI Nifty 50 Index Fund',
  inc: ['uti', 'nifty 50 index', 'direct', 'growth'],
  exc: ['next', 'value', 'regular', 'idcw'],
  // Proxy NAVs used only when the live history fetch fails.
  proxy: { '2024-02-26': 10.3449, '2026-01-13': 10.3449, '2026-03-20': 9.3013 },
};

// SIP commitments shown on the Overview tab.
export const MF = {
  sip: {
    items: [
      { label: 'JioBLK SIP',  val: '₹20,000/mo' },
      { label: 'Vested US',   val: '$200/mo (~₹19K)' },
      { label: 'Stock picks', val: '₹30K/trigger' },
    ],
    total: '₹39,000+/mo',
  },
};

// Algo trading strategies. FY financials live in data/fy2526_verified.json
// (static, ITR-verified). Swing positions below carry live NSE prices.
export const ALGO = {
  summary: {
    deployed: '₹7.30L',
    deployedNote: 'S01 ₹3.9L + S02 ₹3.4L · own capital, live',
  },
  s01: {
    title: 'S01 — Credit Spreads',
    broker: 'Dhan · Zerodha',
    badge: 'Steady income',
    deployed: '₹3.9L',
    pool: 'Total ₹6.4L · Own ₹3.9L · Client ₹2.5L · 100% own + 50% client profit',
  },
  s02: {
    title: 'S02 — Active F&O + Swing',
    broker: 'Upstox · Fyers',
    badge: 'Profitable',
    deployed: '₹3.4L',
    capital: 'Own ₹3.4L · F&O ₹3L + Swing ₹40K · user keeps 70%',
  },
  poolNote: 'Own capital ₹7.30L (S01 ₹3.9L · S02 ₹3.4L)',
};

// S02 swing book — live NSE prices via /api/quotes (.NS suffix), refreshed on
// the same 15-min cycle. `cost` = average buy price.
export const SWING = [
  { sym: 'TDPOWERSYS', qty: 10, cost: 796.43 },
  { sym: 'LAURUSLABS', qty: 8,  cost: 986.86 },
  { sym: 'AVANTEL',    qty: 52, cost: 153.04 },
  { sym: 'HAPPSTMNDS', qty: 20, cost: 393.50 },
  { sym: 'BANKBARODA', qty: 28, cost: 291.80 },
].map((s) => ({ ...s, ns: `${s.sym}.NS`, inv: +(s.qty * s.cost).toFixed(2) }));

// Donut allocation colors (Overview) — aligned to the shared theme palette.
export const ALLOC_COLORS = {
  algo: '#E8A857', fd: '#5B9BE8', indian: '#34D399',
  us: '#F87171', mf: '#9B8AFB', elss: '#E85F8F',
};

// Retirement projections for 2055 (nominal future rupees, not in net worth).
export const RETIREMENT = [
  { key: 'conservative', corpus: '₹8.70Cr',  pension: '₹2.37L/mo', color: 'var(--blu)' },
  { key: 'base case',    corpus: '₹11.20Cr', pension: '₹4.08L/mo', color: 'var(--acc)' },
  { key: 'optimistic',   corpus: '₹14.80Cr', pension: '₹6.94L/mo', color: 'var(--grn)' },
];

export const CAT_COLORS = {
  ETF: '#4F8FE8', Crypto: '#F59E0B', Bond: '#9090A8', Tech: '#8F7FE8',
  Financial: '#2DB87F', Fintech: '#06B6D4', Consumer: '#E85F8F',
  Healthcare: '#10B981', Industrial: '#6B7280', Commodity: '#D97706',
};
