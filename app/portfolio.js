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

// Indian realised equity P&L — avg-cost from the Zerodha tradebook (GWS919EQ),
// same method as the US side. `ytd` = current FY; the window shows all-time +
// per-FY + top winners/losers. The bottom tax card carries the ITR figure.
export const INDIAN_REALIZED = {
  asOf: '08 Jun 2026',
  ytdLabel: 'FY26-27',
  ytd: 3996,
  total: -22491,
  fy: [
    { label: 'FY24-25', amt: 1370, n: 65,
      winners: [{ sym: 'ARE&M', amt: 1728 }, { sym: 'GOLDBEES', amt: 1416 }, { sym: 'NATIONALUM', amt: 1386 }],
      losers:  [{ sym: 'EMAMILTD', amt: -1546 }, { sym: 'CROMPTON', amt: -1291 }, { sym: 'MOTHERSON', amt: -1167 }] },
    { label: 'FY25-26', amt: -27966, n: 64,
      winners: [{ sym: 'GOLDBEES', amt: 5843 }, { sym: 'LAURUSLABS', amt: 1260 }, { sym: 'LTF', amt: 916 }],
      losers:  [{ sym: 'TINNARUBR', amt: -7984 }, { sym: 'ZYDUSLIFE', amt: -2870 }, { sym: 'TECHNOE', amt: -2820 }] },
    { label: 'FY26-27', amt: 3996, n: 6,
      winners: [{ sym: 'SUPRIYA', amt: 6045 }, { sym: 'NATCOPHARM', amt: 4025 }, { sym: 'FIEMIND', amt: 1456 }],
      losers:  [{ sym: 'HDFCBANK', amt: -3985 }, { sym: 'VSTTILLERS', amt: -1974 }, { sym: 'TCS', amt: -1572 }] },
  ],
  winners: [{ sym: 'GOLDBEES', amt: 7259 }, { sym: 'NATCOPHARM', amt: 4099 }, { sym: 'SUPRIYA', amt: 4010 }],
  losers: [{ sym: 'TINNARUBR', amt: -7984 }, { sym: 'HDFCBANK', amt: -6228 }, { sym: 'TECHNOE', amt: -2820 }],
  source: 'Zerodha tradebook · avg-cost',
};

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

// Realised US equity P&L — avg-cost from the Vested trade ledger (overall, as on
// date). `ytdUsd` is the current-FY figure for the summary card; the window
// shows the all-time number + per-FY + winners/losers. The filed foreign STCG
// (ITR) lives only in the bottom tax card.
export const US_REALIZED = {
  asOf: '08 Jun 2026',
  source: 'Vested realized P&L · lot-level',
  total: 343.56,
  ytdLabel: 'FY26-27',
  ytdUsd: 14.24,
  fy: [
    { label: 'FY24-25', amt: 11.13, n: 44,
      winners: [{ sym: 'SCHD', amt: 7.48 }, { sym: 'VGT', amt: 7.06 }, { sym: 'VOO', amt: 1.79 }],
      losers:  [{ sym: 'BITO', amt: -2.78 }, { sym: 'MSTR', amt: -2.17 }, { sym: 'ASML', amt: -1.84 }] },
    { label: 'FY25-26', amt: 318.19, n: 66,
      winners: [{ sym: 'MSTR', amt: 76.91 }, { sym: 'HOOD', amt: 66.41 }, { sym: 'IREN', amt: 36.58 }],
      losers:  [{ sym: 'BTBT', amt: -21.04 }, { sym: 'NOW', amt: -11.72 }, { sym: 'IRDM', amt: -11.52 }] },
    { label: 'FY26-27', amt: 14.24, n: 5,
      winners: [{ sym: 'EEM', amt: 13.31 }, { sym: 'IVV', amt: 0.62 }, { sym: 'IUSB', amt: 0.30 }],
      losers:  [] },
  ],
  winners: [{ sym: 'MSTR', amt: 74.74 }, { sym: 'HOOD', amt: 66.39 }, { sym: 'IREN', amt: 36.58 }],
  losers: [{ sym: 'BTBT', amt: -21.04 }, { sym: 'NOW', amt: -11.72 }, { sym: 'IRDM', amt: -11.52 }],
};

// US dividend income from the Vested/DriveWealth statement (Income sheet).
// All-time and FY breakdowns in USD; tax is the withholding deducted at source.
// Refresh from the monthly Vested export.
export const US_DIVIDENDS = {
  asOf: '08 Jun 2026',
  grossAllTime: 61.52,
  taxAllTime: 15.89,
  netAllTime: 45.63,
  last12Gross: 43.21,
  top: [
    { sym: 'SCHD', amt: 26.34 }, { sym: 'BITO', amt: 5.43 }, { sym: 'EFA', amt: 3.85 },
    { sym: 'QQQM', amt: 3.79 }, { sym: 'IUSB', amt: 3.03 }, { sym: 'IVV', amt: 2.64 },
  ],
  fy: [
    { label: 'FY24-25', amt: 13.02 }, { label: 'FY25-26', amt: 45.46 }, { label: 'FY26-27', amt: 2.86 },
  ],
};

// Upcoming US corporate actions on current holdings. ETF distributions are
// clockwork, so these ex-dates are PROJECTED from each fund's payout history in
// the Vested statement (last ex-date + its typical interval); perShare is the
// last distribution ÷ current units. Refresh / confirm against the Nasdaq
// dividend calendar at the monthly update. `projected: true` flags the estimate.
export const US_CORP_ACTIONS = [
  { type: 'dividend', sym: 'IVV',  name: 'iShares Core S&P 500',   ex: '2026-06-19', perShare: 1.63, projected: true },
  { type: 'dividend', sym: 'EFA',  name: 'iShares MSCI EAFE',      ex: '2026-06-19', perShare: 1.24, projected: true },
  { type: 'dividend', sym: 'EEM',  name: 'iShares MSCI Em Mkts',   ex: '2026-06-19', perShare: 0.93, projected: true },
  { type: 'dividend', sym: 'QQQM', name: 'Invesco NASDAQ 100',     ex: '2026-06-26', perShare: 0.30, projected: true },
  { type: 'dividend', sym: 'SCHD', name: 'Schwab US Dividend',     ex: '2026-06-29', perShare: 0.23, projected: true },
  { type: 'dividend', sym: 'IUSB', name: 'iShares Core USD Bond',  ex: '2026-07-04', perShare: 0.15, projected: true },
  { type: 'dividend', sym: 'HYDB', name: 'iShares Hi-Yld Bond',    ex: '2026-07-04', perShare: 0.26, projected: true },
];

// US benchmark set (USD), valued as same-dated-dollars counterfactuals: broad
// market / growth tilt / low-correlation gold. Yahoo carries these reliably.
// Global benchmark set, valued same-dated-dollars. Mirrors the world-indices
// board (US / Germany / UK / France / Japan / Hong Kong / China / Taiwan /
// Korea / India) plus Gold. Uses USD-denominated country ETFs (not local-
// currency indices) so every return is FX-inclusive and comparable to the USD
// portfolio. Spanning many markets keeps the set decorrelated.
// Nine benchmarks for a USD tech-tilted book held by an Indian investor: broad
// US + the tech-heavy index, the major tech-exporting regions (Japan, China,
// Taiwan, Korea), Europe's largest market, the home-market opportunity cost, and
// an uncorrelated store of value. (Dropped UK/France/Hong Kong as redundant.)
export const US_BENCHMARKS = [
  { key: 'sp500',   label: 'S&P 500 · US',    color: 'var(--blu)', yahooSyms: ['IVV', '^GSPC'] },
  { key: 'nasdaq',  label: 'Nasdaq 100 · US', color: 'var(--pur)', yahooSyms: ['QQQ', '^NDX'] },
  { key: 'germany', label: 'Germany · DAX',   color: 'var(--cyn)', yahooSyms: ['EWG'] },
  { key: 'japan',   label: 'Japan · Nikkei',  color: '#7A8CA8',    yahooSyms: ['EWJ'] },
  { key: 'china',   label: 'China · SSE',      color: 'var(--pnk)', yahooSyms: ['FXI', 'MCHI'] },
  { key: 'taiwan',  label: 'Taiwan · TAIEX',   color: 'var(--grn)', yahooSyms: ['EWT'] },
  { key: 'korea',   label: 'Korea · KOSPI',    color: 'var(--blu)', yahooSyms: ['EWY'] },
  { key: 'india',   label: 'India · Nifty',    color: 'var(--pur)', yahooSyms: ['INDA', 'EPI'] },
  { key: 'gold',    label: 'Gold',             color: 'var(--acc)', yahooSyms: ['GLD', 'GC=F'] },
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
// One row per deposit covering its WHOLE lifecycle:
//   status   — 'pipeline' (committed, cash not yet out) → 'active' (earning,
//              in net worth) → 'closed' (redeemed; kept for history, out of
//              all live totals).
//   newMoney — the slice of principal that is FRESH cash, used by the
//              deployment calendar. Defaults to principal. On a rollover set
//              it to whatever wasn't recycled from the matured FD (usually
//              just the capitalised interest) and point `rolledFrom` at the
//              matured row's id — this is what stops double-counting.
//   closedOn — set when status flips to 'closed' (redemption date).
// `open`/`matures` are ISO dates; accrued interest, value-at-maturity and
// progress are derived live from the system clock (see deriveFds in page.js —
// quarterly compounding only, simple interest is never used).
export const FDS = [
  { id: 'slice-1', bank: 'Slice', label: 'I', status: 'active', principal: 125000, rate: 7.75, open: '2025-12-08', matures: '2027-06-09' },
  { id: 'icici-1', bank: 'ICICI', label: 'I', status: 'active', principal: 135000, rate: 6.60, open: '2025-12-09', matures: '2027-12-10' },
  { id: 'hdfc-1',  bank: 'HDFC',  label: 'I', status: 'active', principal: 235000, rate: 6.45, open: '2026-03-08', matures: '2027-09-09' },
  { id: 'sbi-1',   bank: 'SBI',   label: 'I', status: 'active', principal: 150000, rate: 6.40, open: '2026-06-09', matures: '2028-06-10' },
  // Pipeline — maturities laddered quarterly across 4 banks; rates set on booking.
  { id: 'slice-2', bank: 'Slice', label: 'II',  status: 'pipeline', principal: 275000, tenure: '18m+1d', open: '2026-09-08', matures: '2028-03-09' },
  { id: 'icici-2', bank: 'ICICI', label: 'II',  status: 'pipeline', principal: 165000, tenure: '2y+1d',  open: '2026-12-09', matures: '2028-12-10' },
  { id: 'hdfc-2',  bank: 'HDFC',  label: 'II',  status: 'pipeline', principal: 245000, tenure: '18m+1d', open: '2027-03-08', matures: '2028-09-09' },
  { id: 'sbi-2',   bank: 'SBI',   label: 'II',  status: 'pipeline', principal: 155000, tenure: '2y+1d',  open: '2027-06-09', matures: '2029-06-10' },
  { id: 'icici-3', bank: 'ICICI', label: 'III', status: 'pipeline', principal: 170000, tenure: '2y+1d',  open: '2027-09-08', matures: '2029-09-10' },
  { id: 'sbi-3',   bank: 'SBI',   label: 'III', status: 'pipeline', principal: 165000, tenure: '2y+1d',  open: '2027-12-09', matures: '2029-12-10' },
];

// Dated deployment flows for the Capital Deployment calendar: fresh cash only
// (newMoney), never pipeline (cash hasn't left yet), closed rows included so
// history survives redemption. Redemptions = closed rows' principal on closedOn.
export const fdFlows = () =>
  FDS.filter((f) => f.status !== 'pipeline').map((f) => ({ date: f.open, amount: f.newMoney ?? f.principal }));
// Redemptions = cash leaving the FD sleeve. Two sources:
//   1. Explicitly closed rows — payout if recorded, else principal.
//   2. AUTO-MATURED rows: an 'active' FD past its maturity date is treated as
//      cash-in on the maturity date (full maturity value, quarterly
//      compounding) with NO ledger edit needed. The ledger is only touched
//      when the cash is redeployed (new row; old one → 'closed').
const fdMaturityValue = (f) => {
  const yrs = (new Date(f.matures) - new Date(f.open)) / (365.25 * 24 * 3600 * 1000);
  return f.principal * Math.pow(1 + f.rate / 400, 4 * yrs);
};
export const fdRedemptions = (now = new Date()) => [
  ...FDS.filter((f) => f.status === 'closed' && f.closedOn)
    .map((f) => ({ date: f.closedOn, amount: f.payout ?? f.principal })),
  ...FDS.filter((f) => f.status === 'active' && new Date(f.matures) <= now)
    .map((f) => ({ date: f.matures, amount: Math.round(fdMaturityValue(f)) })),
];

// Other static assets and liabilities (INR).
export const STATIC = {
  algo: 730000,        // own algo capital = S01 ₹3.9L + S02 ₹3.4L — EXCLUDED from net worth (no daily mark-to-market); tracked on the Algo tab + header card only
  loan: 750000,        // DEPRECATED — superseded by LOAN below (kept as last-resort fallback)
  // Mutual-fund value is now computed live from MF_FUNDS × NAV (see /api/mf-nav).
  // FD value (principal + accrued interest) is now computed live — see deriveFds.
};

// (FD pipeline now lives inside FDS as status: 'pipeline' — single lifecycle,
// promotion to active is a one-word edit on booking day.)

// ── SBI personal loan — from the account statement (11-06-2026) ──────────────
// `balances` are the ACTUAL ledger balances after every statement event
// (EMI on the 5th, interest capitalised at month-end). Past dates read straight
// off this series; dates beyond the last entry are projected with the same
// EMI/daily-interest mechanics. Refresh `balances` from a new statement
// occasionally to re-anchor the projection.
export const LOAN = {
  sanctioned: 800000,
  open: '2025-09-08',
  rate: 13.55,       // % p.a., accrues daily, capitalised at month-end
  emi: 14794,        // debited on the 5th
  termMonths: 84,
  balances: [
    ['2025-09-08', 800000], ['2025-09-30', 806831], ['2025-10-05', 777243],
    ['2025-10-31', 786232], ['2025-11-05', 771438], ['2025-11-30', 780051],
    ['2025-12-05', 765257], ['2025-12-31', 774086], ['2026-01-05', 759292],
    ['2026-01-31', 768052], ['2026-02-05', 753258], ['2026-02-28', 761110],
    ['2026-03-05', 746316], ['2026-03-31', 754927], ['2026-04-05', 740133],
    ['2026-04-30', 748398], ['2026-05-05', 733604], ['2026-05-31', 742069],
    ['2026-06-05', 727275],
  ],
};

// Outstanding loan balance on any date: 0 before disbursement, the actual
// statement balance through the recorded window, then a projected EMI/interest
// simulation beyond it (down to 0 when the schedule pays off).
export function loanOutstanding(date = new Date()) {
  const d = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  if (d < LOAN.open) return 0;
  const B = LOAN.balances;
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

// `mcap` = market-cap weights (fractions). Index funds are EXACT by mandate —
// not estimates: a Nifty 50 fund is 100% large, Midcap 150 is 100% mid, etc.
// Zerodha ELSS tracks the Nifty LargeMidcap 250 (50% large / 50% mid by index
// construction). Flexi Cap is actively managed, so its internal split is unknown
// without a factsheet — it carries no `mcap` and sits in the honest "Multi"
// bucket. To show Flexi's real breakup, paste its latest Morningstar/factsheet
// allocation here as e.g. mcap: { large: .55, mid: .30, small: .15 }.
// `bought` = purchase date, matched to MF_CASHFLOWS: ELSS is the 2024-02-26
// seed; Flexi alone is the 2026-01-13 ₹20K lumpsum; the five index/arbitrage
// funds (11+8+5+3+3 = ₹30K) are the 2026-03-20 lumpsum. Used by the history
// backfill to value each fund as units × NAV(t) from its own start date.
export const MF_FUNDS = [
  // JioBlackRock — Folio 2088065, Direct Growth
  { id: 'flexi',   platform: 'JioBLK',  name: 'Flexi Cap',          cat: 'Multi Cap',         units: 2097.894, cost: 20000, bought: '2026-01-13', casNav: 9.5724,  q: 'JioBlackRock Flexi Cap',          inc: ['flexi cap', 'direct', 'growth'],      exc: [] },
  { id: 'nifty50', platform: 'JioBLK',  name: 'Nifty 50 Index',     cat: 'Large Cap · Index', units: 1134.852, cost: 11000, bought: '2026-03-20', casNav: 9.4283,  q: 'JioBlackRock Nifty 50 Index',     inc: ['nifty 50 index', 'direct', 'growth'], exc: ['next', 'value', 'midcap', 'smallcap'], mcap: { large: 1 } },
  { id: 'midcap',  platform: 'JioBLK',  name: 'Nifty Midcap 150',   cat: 'Mid Cap · Index',   units: 815.370,  cost: 8000,  bought: '2026-03-20', casNav: 10.4744, q: 'JioBlackRock Nifty Midcap 150',   inc: ['midcap 150', 'direct', 'growth'],     exc: [], mcap: { mid: 1 } },
  { id: 'arb',     platform: 'JioBLK',  name: 'Arbitrage',          cat: 'Arbitrage · Hedged',units: 493.038,  cost: 5000,  bought: '2026-03-20', casNav: 10.3087, q: 'JioBlackRock Arbitrage',          inc: ['arbitrage', 'direct', 'growth'],      exc: [], mcap: { hedged: 1 } },
  { id: 'next50',  platform: 'JioBLK',  name: 'Nifty Next 50',      cat: 'Large Cap · Index', units: 307.856,  cost: 3000,  bought: '2026-03-20', casNav: 10.4525, q: 'JioBlackRock Nifty Next 50',      inc: ['next 50', 'direct', 'growth'],        exc: [], mcap: { large: 1 } },
  { id: 'small',   platform: 'JioBLK',  name: 'Nifty Smallcap 250', cat: 'Small Cap · Index', units: 330.775,  cost: 3000,  bought: '2026-03-20', casNav: 10.0992, q: 'JioBlackRock Nifty Smallcap 250', inc: ['smallcap 250', 'direct', 'growth'],   exc: [], mcap: { small: 1 } },
  // Zerodha — ELSS tracks Nifty LargeMidcap 250 (50/50 large/mid by index)
  { id: 'elss',    platform: 'Zerodha', name: 'ELSS Tax Saver',     cat: 'ELSS · LargeMid 250', units: 42.390,   cost: 500,   bought: '2024-02-26', casNav: 13.9096, q: 'Zerodha ELSS Tax Saver',          inc: ['elss', 'direct', 'growth'],           exc: [], mcap: { large: 0.5, mid: 0.5 } },
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

// Algo trading strategies. FY financials live in data/fy2526_verified.json
// (static, ITR-verified). Swing positions below carry live NSE prices.
export const ALGO = {
  summary: {
    deployed: '₹7.30L',
    deployedNote: 'S01 ₹3.9L + S02 ₹3.4L · own capital · excluded from net worth',
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

// Forward net-worth projection inputs (rolling horizons — no fixed target year).
// Compounds the live net worth + monthly contribution at each scenario rate.
// EVERYTHING here is a tunable assumption — nothing in the chart is hardcoded:
// the starting net worth, sleeve values and FD ceiling are read live; only the
// forward assumptions below need a periodic (annual) revisit. See MONTHLY_UPDATE.md.
export const PROJECTION = {
  monthly: 39000,        // year-1 monthly contribution (SIP + recurring) — revisit yearly
  stepUp: 0.10,          // annual step-up applied to the monthly contribution
  inflation: 0.06,       // for the "today's money" real-value deflator
  horizonYears: 30,      // max rolling horizon; the tab offers 1/5/10/30Y within it
  scenarios: [
    { key: 'cons', label: 'Conservative', rate: 0.09 },
    { key: 'base', label: 'Base case',    rate: 0.12 },
    { key: 'opt',  label: 'Optimistic',   rate: 0.15 },
  ],
  // Allocation-drift rules, keyed by sleeve key (see the Overview donut keys).
  // FUTURE-PROOF: add a sleeve here and the projection just absorbs it.
  //   scale  — grows with the residual (absorbs the SIP), share rises
  //   capped — nominal ceiling (e.g. the FD ladder), share falls over time
  //   target — held at a % of total assets
  // The FD ceiling itself is derived live from FDS + FD_PIPELINE (not typed in).
  // Note: algo capital is excluded from net worth, so it has no sleeve here.
  allocRules: {
    indian: { rule: 'scale' },
    us:     { rule: 'scale' },
    mf:     { rule: 'scale' },
    elss:   { rule: 'scale' },
    fd:     { rule: 'capped', rampYears: 2.5 },
  },
};

export const CAT_COLORS = {
  ETF: '#4F8FE8', Crypto: '#F59E0B', Bond: '#9090A8', Tech: '#8F7FE8',
  Financial: '#2DB87F', Fintech: '#06B6D4', Consumer: '#E85F8F',
  Healthcare: '#10B981', Industrial: '#6B7280', Commodity: '#D97706',
};
