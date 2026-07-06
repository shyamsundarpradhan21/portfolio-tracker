// Fyers-style granular taxonomy + market-cap weights for the Nifty 50 heatmap
// treemap (NiftyHeatmap). Keyed by the SAME base tickers as data/nifty50.js so it
// joins directly onto the /api/nifty50 live feed (which carries name + pct).
//
//   HEATMAP_META[sym] = { sector, industry, cap }
//
// - `sector`   : top-level block (BANK, FINANCE, IT, OIL & GAS …) — finer than
//                nifty50.js's coarse `sector`, matching Fyers' sector column.
// - `industry` : the sub-group nested inside the sector (Bank Private vs Public,
//                Refineries vs Oil Exploration, Passenger Cars vs Two-Wheelers …).
// - `cap`      : approximate Nifty-50 index weight in % — drives tile SIZE. These
//                are hand-set approximations (index weights drift); refresh from the
//                NSE factsheet when the index rebalances (same cadence as nifty50.js).
//                Only relative size matters, so exact precision isn't required.
//
// Static reference data, like nifty50.js / portfolio.js. If the index reconstitutes,
// edit both files together; the treemap follows with zero UI changes. Any symbol the
// live feed returns that's missing here falls back to an "Other" bucket in the UI.

export const HEATMAP_META = {
  // BANK
  HDFCBANK:   { sector: 'Bank', industry: 'Bank Private', cap: 13.0 },
  ICICIBANK:  { sector: 'Bank', industry: 'Bank Private', cap: 8.3 },
  AXISBANK:   { sector: 'Bank', industry: 'Bank Private', cap: 3.0 },
  KOTAKBANK:  { sector: 'Bank', industry: 'Bank Private', cap: 2.4 },
  INDUSINDBK: { sector: 'Bank', industry: 'Bank Private', cap: 0.6 },
  SBIN:       { sector: 'Bank', industry: 'Bank Public', cap: 3.0 },
  // FINANCE
  BAJFINANCE: { sector: 'Finance', industry: 'Finance NBFC', cap: 2.3 },
  JIOFIN:     { sector: 'Finance', industry: 'Finance NBFC', cap: 0.9 },
  SHRIRAMFIN: { sector: 'Finance', industry: 'Finance NBFC', cap: 0.7 },
  BAJAJFINSV: { sector: 'Finance', industry: 'Finance Holding', cap: 1.1 },
  // INSURANCE
  SBILIFE:    { sector: 'Insurance', industry: 'Life Insurance', cap: 0.7 },
  HDFCLIFE:   { sector: 'Insurance', industry: 'Life Insurance', cap: 0.7 },
  // IT
  INFY:       { sector: 'IT', industry: 'IT Software', cap: 5.0 },
  TCS:        { sector: 'IT', industry: 'IT Software', cap: 3.9 },
  HCLTECH:    { sector: 'IT', industry: 'IT Software', cap: 1.6 },
  WIPRO:      { sector: 'IT', industry: 'IT Software', cap: 0.8 },
  TECHM:      { sector: 'IT', industry: 'IT Software', cap: 0.8 },
  // OIL & GAS
  RELIANCE:   { sector: 'Oil & Gas', industry: 'Refineries', cap: 9.0 },
  BPCL:       { sector: 'Oil & Gas', industry: 'Refineries', cap: 0.5 },
  ONGC:       { sector: 'Oil & Gas', industry: 'Oil Exploration', cap: 1.0 },
  // MINING
  COALINDIA:  { sector: 'Mining', industry: 'Mining & Minerals', cap: 1.0 },
  // AUTOMOBILE
  TATAMOTORS: { sector: 'Automobile', industry: 'Passenger Cars', cap: 2.2 },
  'M&M':      { sector: 'Automobile', industry: 'Passenger Cars', cap: 2.1 },
  MARUTI:     { sector: 'Automobile', industry: 'Passenger Cars', cap: 1.9 },
  'BAJAJ-AUTO': { sector: 'Automobile', industry: 'Two Wheelers', cap: 1.0 },
  EICHERMOT:  { sector: 'Automobile', industry: 'Two Wheelers', cap: 0.7 },
  HEROMOTOCO: { sector: 'Automobile', industry: 'Two Wheelers', cap: 0.5 },
  // FMCG
  ITC:        { sector: 'FMCG', industry: 'Cigarettes / Tobacco', cap: 3.9 },
  HINDUNILVR: { sector: 'FMCG', industry: 'Household & Personal', cap: 2.3 },
  NESTLEIND:  { sector: 'FMCG', industry: 'Consumer Food', cap: 0.9 },
  TATACONSUM: { sector: 'FMCG', industry: 'Consumer Food', cap: 0.6 },
  BRITANNIA:  { sector: 'FMCG', industry: 'Consumer Food', cap: 0.5 },
  // HEALTHCARE
  SUNPHARMA:  { sector: 'Healthcare', industry: 'Pharmaceuticals & Drugs', cap: 1.7 },
  CIPLA:      { sector: 'Healthcare', industry: 'Pharmaceuticals & Drugs', cap: 0.8 },
  DRREDDY:    { sector: 'Healthcare', industry: 'Pharmaceuticals & Drugs', cap: 0.7 },
  APOLLOHOSP: { sector: 'Healthcare', industry: 'Hospital & Healthcare', cap: 0.7 },
  // TELECOM
  BHARTIARTL: { sector: 'Telecom', industry: 'Telecom Services', cap: 3.2 },
  // INFRASTRUCTURE
  LT:         { sector: 'Infrastructure', industry: 'Engineering & Construction', cap: 4.0 },
  // TRADING
  ADANIENT:   { sector: 'Trading', industry: 'Trading', cap: 0.9 },
  // LOGISTICS
  ADANIPORTS: { sector: 'Logistics', industry: 'Port', cap: 1.0 },
  // IRON & STEEL
  TATASTEEL:  { sector: 'Iron & Steel', industry: 'Steel & Iron Products', cap: 1.0 },
  JSWSTEEL:   { sector: 'Iron & Steel', industry: 'Steel & Iron Products', cap: 0.9 },
  // NON-FERROUS METALS
  HINDALCO:   { sector: 'Non-Ferrous Metals', industry: 'Metal - Non Ferrous', cap: 0.9 },
  // POWER
  NTPC:       { sector: 'Power', industry: 'Power Generation / Distribution', cap: 1.3 },
  POWERGRID:  { sector: 'Power', industry: 'Power Generation / Distribution', cap: 1.2 },
  // RETAILING
  TRENT:      { sector: 'Retailing', industry: 'Retailing', cap: 0.9 },
  // DIAMOND & JEWELLERY
  TITAN:      { sector: 'Diamond & Jewellery', industry: 'Diamond & Jewellery', cap: 1.3 },
  // CHEMICALS
  ASIANPAINT: { sector: 'Chemicals', industry: 'Paints', cap: 1.3 },
  // CONSTRUCTION MATERIALS
  ULTRACEMCO: { sector: 'Construction Materials', industry: 'Cement & Construction', cap: 1.2 },
  // DIVERSIFIED
  GRASIM:     { sector: 'Diversified', industry: 'Diversified', cap: 0.9 },
};

// Fallback for any live symbol not mapped above (e.g. a fresh index inclusion
// before this table is updated) — keeps it visible instead of silently dropped.
export const HEATMAP_FALLBACK = { sector: 'Other', industry: 'Other', cap: 0.5 };
