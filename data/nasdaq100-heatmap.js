// GICS-style granular taxonomy + market-cap weights for the Nasdaq-100 heatmap
// treemap (Nasdaq100Heatmap). Keyed by the SAME US tickers as data/nasdaq100.js so
// it joins directly onto the /api/nasdaq100 live feed (which carries name + pct).
//
//   HEATMAP_META[sym] = { sector, industry, cap }
//
// - `sector`   : top-level block (Technology, Communication Services, Healthcare …)
//                — the treemap's coarse grouping, a fixed ~10-name set.
// - `industry` : the sub-group nested inside the sector (Semiconductors vs Software
//                vs Hardware, Biotech vs Medical Devices, Beverages vs Packaged Food …).
// - `cap`      : approximate Nasdaq-100 index weight in % — drives tile SIZE. The
//                index is cap-weighted and very top-heavy, so a handful of megacaps
//                dwarf a long <0.5% tail. These are hand-set approximations (weights
//                drift); refresh at reconstitution (same cadence as nasdaq100.js).
//                Only relative size matters, so exact precision isn't required.
//
// Static reference data, like nasdaq100.js / portfolio.js. If the index reconstitutes,
// edit both files together; the treemap follows with zero UI changes. Any symbol the
// live feed returns that's missing here falls back to an "Other" bucket in the UI.

export const HEATMAP_META = {
  // TECHNOLOGY — Semiconductors
  NVDA: { sector: 'Technology', industry: 'Semiconductors', cap: 8.5 },
  AVGO: { sector: 'Technology', industry: 'Semiconductors', cap: 5.0 },
  AMD:  { sector: 'Technology', industry: 'Semiconductors', cap: 1.5 },
  QCOM: { sector: 'Technology', industry: 'Semiconductors', cap: 1.1 },
  TXN:  { sector: 'Technology', industry: 'Semiconductors', cap: 1.1 },
  MU:   { sector: 'Technology', industry: 'Semiconductors', cap: 1.0 },
  AMAT: { sector: 'Technology', industry: 'Semiconductors', cap: 1.0 },
  LRCX: { sector: 'Technology', industry: 'Semiconductors', cap: 0.9 },
  KLAC: { sector: 'Technology', industry: 'Semiconductors', cap: 0.8 },
  ADI:  { sector: 'Technology', industry: 'Semiconductors', cap: 0.7 },
  INTC: { sector: 'Technology', industry: 'Semiconductors', cap: 0.7 },
  ARM:  { sector: 'Technology', industry: 'Semiconductors', cap: 0.6 },
  ASML: { sector: 'Technology', industry: 'Semiconductors', cap: 0.5 },
  MRVL: { sector: 'Technology', industry: 'Semiconductors', cap: 0.5 },
  NXPI: { sector: 'Technology', industry: 'Semiconductors', cap: 0.4 },
  MCHP: { sector: 'Technology', industry: 'Semiconductors', cap: 0.3 },
  TER:  { sector: 'Technology', industry: 'Semiconductors', cap: 0.2 },
  MPWR: { sector: 'Technology', industry: 'Semiconductors', cap: 0.2 },
  ALAB: { sector: 'Technology', industry: 'Semiconductors', cap: 0.2 },
  // TECHNOLOGY — Software
  MSFT: { sector: 'Technology', industry: 'Software', cap: 8.0 },
  PLTR: { sector: 'Technology', industry: 'Software', cap: 1.8 },
  INTU: { sector: 'Technology', industry: 'Software', cap: 1.3 },
  ADBE: { sector: 'Technology', industry: 'Software', cap: 1.0 },
  APP:  { sector: 'Technology', industry: 'Software', cap: 1.0 },
  PANW: { sector: 'Technology', industry: 'Software', cap: 0.9 },
  CRWD: { sector: 'Technology', industry: 'Software', cap: 0.8 },
  SHOP: { sector: 'Technology', industry: 'Software', cap: 0.8 },
  MSTR: { sector: 'Technology', industry: 'Software', cap: 0.7 },
  CDNS: { sector: 'Technology', industry: 'Software', cap: 0.7 },
  SNPS: { sector: 'Technology', industry: 'Software', cap: 0.6 },
  FTNT: { sector: 'Technology', industry: 'Software', cap: 0.5 },
  ROP:  { sector: 'Technology', industry: 'Software', cap: 0.5 },
  WDAY: { sector: 'Technology', industry: 'Software', cap: 0.4 },
  ADSK: { sector: 'Technology', industry: 'Software', cap: 0.4 },
  DDOG: { sector: 'Technology', industry: 'Software', cap: 0.4 },
  // TECHNOLOGY — Hardware
  AAPL: { sector: 'Technology', industry: 'Hardware', cap: 7.5 },
  STX:  { sector: 'Technology', industry: 'Hardware', cap: 0.2 },
  WDC:  { sector: 'Technology', industry: 'Hardware', cap: 0.2 },
  SNDK: { sector: 'Technology', industry: 'Hardware', cap: 0.2 },
  // TECHNOLOGY — Networking
  CSCO: { sector: 'Technology', industry: 'Networking', cap: 1.4 },
  LITE: { sector: 'Technology', industry: 'Networking', cap: 0.2 },
  // TECHNOLOGY — IT Services
  CRWV: { sector: 'Technology', industry: 'IT Services', cap: 0.3 },
  NBIS: { sector: 'Technology', industry: 'IT Services', cap: 0.2 },
  // COMMUNICATION SERVICES — Interactive Media
  META:  { sector: 'Communication Services', industry: 'Interactive Media', cap: 4.0 },
  GOOGL: { sector: 'Communication Services', industry: 'Interactive Media', cap: 2.6 },
  GOOG:  { sector: 'Communication Services', industry: 'Interactive Media', cap: 2.5 },
  // COMMUNICATION SERVICES — Entertainment
  NFLX:  { sector: 'Communication Services', industry: 'Entertainment', cap: 2.0 },
  CMCSA: { sector: 'Communication Services', industry: 'Entertainment', cap: 0.9 },
  WBD:   { sector: 'Communication Services', industry: 'Entertainment', cap: 0.3 },
  EA:    { sector: 'Communication Services', industry: 'Entertainment', cap: 0.3 },
  TTWO:  { sector: 'Communication Services', industry: 'Entertainment', cap: 0.3 },
  // COMMUNICATION SERVICES — Telecom
  TMUS:  { sector: 'Communication Services', industry: 'Telecom', cap: 1.6 },
  // CONSUMER DISCRETIONARY — Internet Retail
  AMZN: { sector: 'Consumer Discretionary', industry: 'Internet Retail', cap: 5.5 },
  MELI: { sector: 'Consumer Discretionary', industry: 'Internet Retail', cap: 0.8 },
  DASH: { sector: 'Consumer Discretionary', industry: 'Internet Retail', cap: 0.7 },
  PDD:  { sector: 'Consumer Discretionary', industry: 'Internet Retail', cap: 0.6 },
  // CONSUMER DISCRETIONARY — Autos
  TSLA: { sector: 'Consumer Discretionary', industry: 'Autos', cap: 2.5 },
  // CONSUMER DISCRETIONARY — Travel & Leisure
  BKNG: { sector: 'Consumer Discretionary', industry: 'Travel & Leisure', cap: 1.2 },
  ABNB: { sector: 'Consumer Discretionary', industry: 'Travel & Leisure', cap: 0.5 },
  MAR:  { sector: 'Consumer Discretionary', industry: 'Travel & Leisure', cap: 0.5 },
  // CONSUMER DISCRETIONARY — Restaurants
  SBUX: { sector: 'Consumer Discretionary', industry: 'Restaurants', cap: 0.7 },
  // CONSUMER DISCRETIONARY — Specialty Retail
  ORLY: { sector: 'Consumer Discretionary', industry: 'Specialty Retail', cap: 0.6 },
  // CONSUMER DISCRETIONARY — Apparel
  ROST: { sector: 'Consumer Discretionary', industry: 'Apparel', cap: 0.3 },
  // CONSUMER STAPLES — Staples Retail
  COST: { sector: 'Consumer Staples', industry: 'Staples Retail', cap: 2.2 },
  WMT:  { sector: 'Consumer Staples', industry: 'Staples Retail', cap: 0.5 },
  // CONSUMER STAPLES — Beverages
  PEP:  { sector: 'Consumer Staples', industry: 'Beverages', cap: 1.3 },
  KDP:  { sector: 'Consumer Staples', industry: 'Beverages', cap: 0.3 },
  MNST: { sector: 'Consumer Staples', industry: 'Beverages', cap: 0.3 },
  CCEP: { sector: 'Consumer Staples', industry: 'Beverages', cap: 0.2 },
  // CONSUMER STAPLES — Packaged Food
  MDLZ: { sector: 'Consumer Staples', industry: 'Packaged Food', cap: 0.5 },
  KHC:  { sector: 'Consumer Staples', industry: 'Packaged Food', cap: 0.2 },
  // HEALTHCARE — Biotech
  AMGN: { sector: 'Healthcare', industry: 'Biotech', cap: 1.0 },
  GILD: { sector: 'Healthcare', industry: 'Biotech', cap: 0.8 },
  VRTX: { sector: 'Healthcare', industry: 'Biotech', cap: 0.8 },
  REGN: { sector: 'Healthcare', industry: 'Biotech', cap: 0.4 },
  ALNY: { sector: 'Healthcare', industry: 'Biotech', cap: 0.2 },
  // HEALTHCARE — Medical Devices
  ISRG: { sector: 'Healthcare', industry: 'Medical Devices', cap: 1.2 },
  GEHC: { sector: 'Healthcare', industry: 'Medical Devices', cap: 0.3 },
  IDXX: { sector: 'Healthcare', industry: 'Medical Devices', cap: 0.3 },
  DXCM: { sector: 'Healthcare', industry: 'Medical Devices', cap: 0.3 },
  // INDUSTRIALS — Business Services
  ADP:  { sector: 'Industrials', industry: 'Business Services', cap: 0.9 },
  CTAS: { sector: 'Industrials', industry: 'Business Services', cap: 0.6 },
  PAYX: { sector: 'Industrials', industry: 'Business Services', cap: 0.4 },
  CPRT: { sector: 'Industrials', industry: 'Business Services', cap: 0.3 },
  TRI:  { sector: 'Industrials', industry: 'Business Services', cap: 0.3 },
  // INDUSTRIALS — Machinery
  HON:  { sector: 'Industrials', industry: 'Machinery', cap: 0.9 },
  PCAR: { sector: 'Industrials', industry: 'Machinery', cap: 0.3 },
  // INDUSTRIALS — Aerospace & Defense
  AXON: { sector: 'Industrials', industry: 'Aerospace & Defense', cap: 0.5 },
  RKLB: { sector: 'Industrials', industry: 'Aerospace & Defense', cap: 0.2 },
  // INDUSTRIALS — Transportation
  CSX:  { sector: 'Industrials', industry: 'Transportation', cap: 0.4 },
  ODFL: { sector: 'Industrials', industry: 'Transportation', cap: 0.3 },
  FER:  { sector: 'Industrials', industry: 'Transportation', cap: 0.2 },
  // INDUSTRIALS — Distribution
  FAST: { sector: 'Industrials', industry: 'Distribution', cap: 0.3 },
  // UTILITIES — Electric
  CEG:  { sector: 'Utilities', industry: 'Electric', cap: 0.8 },
  AEP:  { sector: 'Utilities', industry: 'Electric', cap: 0.4 },
  EXC:  { sector: 'Utilities', industry: 'Electric', cap: 0.3 },
  XEL:  { sector: 'Utilities', industry: 'Electric', cap: 0.3 },
  // ENERGY
  BKR:  { sector: 'Energy', industry: 'Equipment & Services', cap: 0.3 },
  FANG: { sector: 'Energy', industry: 'E&P', cap: 0.3 },
  // MATERIALS
  LIN:  { sector: 'Materials', industry: 'Chemicals', cap: 1.3 },
  // FINANCIALS
  PYPL: { sector: 'Financials', industry: 'Payments', cap: 0.5 },
};

// Fallback for any live symbol not mapped above (e.g. a fresh index inclusion
// before this table is updated) — keeps it visible instead of silently dropped.
export const HEATMAP_FALLBACK = { sector: 'Other', industry: 'Other', cap: 0.3 };
