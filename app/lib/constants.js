export const SECTOR_PALETTE = ['var(--blu)','var(--pur)','var(--cyn)','var(--grn)','var(--pnk)','var(--acc)','#7A8CA8'];
export const OTHERS_COLOR  = 'var(--txt3)';

export const US_SECTOR = {
  ETF: 'Diversified ETF', Crypto: 'Crypto', Bond: 'Fixed Income',
  Commodity: 'Commodity', Tech: 'Information Technology', Financial: 'Financials',
  Fintech: 'Financials', Consumer: 'Consumer Staples', Industrial: 'Industrials',
  Healthcare: 'Health Care',
};

export const US_SECTOR_OVERRIDE = {
  SHW: 'Materials', AMZN: 'Consumer Discretionary',
  GOOG: 'Communication Services', META: 'Communication Services', DIS: 'Communication Services',
};

export const usSectorOf = (s) => US_SECTOR_OVERRIDE[s.sym] || US_SECTOR[s.cat] || s.cat;

export const ETF_LOOKTHROUGH = {
  QQQM: { 'Information Technology': 0.50, 'Communication Services': 0.16, 'Consumer Discretionary': 0.14, 'Health Care': 0.06, 'Consumer Staples': 0.04, 'Industrials': 0.05, 'Financials': 0.01, 'All Others': 0.04 },
  IVV:  { 'Information Technology': 0.33, 'Financials': 0.14, 'Communication Services': 0.09, 'Health Care': 0.10, 'Consumer Discretionary': 0.10, 'Consumer Staples': 0.06, 'Industrials': 0.08, 'Materials': 0.02, 'All Others': 0.08 },
  SCHD: { 'Financials': 0.19, 'Consumer Staples': 0.19, 'Health Care': 0.16, 'Industrials': 0.13, 'Information Technology': 0.10, 'Consumer Discretionary': 0.08, 'Communication Services': 0.05, 'Materials': 0.04, 'All Others': 0.06 },
  EFA:  { 'Financials': 0.21, 'Industrials': 0.17, 'Health Care': 0.12, 'Consumer Discretionary': 0.11, 'Information Technology': 0.09, 'Consumer Staples': 0.09, 'Materials': 0.07, 'Communication Services': 0.04, 'All Others': 0.10 },
  EEM:  { 'Information Technology': 0.24, 'Financials': 0.23, 'Consumer Discretionary': 0.13, 'Communication Services': 0.09, 'Materials': 0.07, 'Consumer Staples': 0.05, 'Industrials': 0.06, 'All Others': 0.13 },
};

export const US_CAP = {
  AAPL: 'Mega', MSFT: 'Mega', NVDA: 'Mega', GOOG: 'Mega', AMZN: 'Mega', META: 'Mega', AVGO: 'Mega',
  TSM: 'Mega', JPM: 'Mega', V: 'Mega', MA: 'Mega', ASML: 'Mega', CRM: 'Mega', ADBE: 'Mega',
  KO: 'Mega', PG: 'Mega', PEP: 'Mega', TMO: 'Mega',
  MCO: 'Large', INTU: 'Large', DE: 'Large', DIS: 'Large', COIN: 'Large', HOOD: 'Large',
  FTNT: 'Large', CPRT: 'Large', SHW: 'Large', PYPL: 'Large',
  MARA: 'Mid', RIOT: 'Mid', CORZ: 'Mid', CLSK: 'Mid', IREN: 'Mid',
  HUT: 'Small', KEEL: 'Small', CIFR: 'Small', WULF: 'Small', APLD: 'Small', BTDR: 'Small', GLXY: 'Small',
};

export const ETF_CAP = {
  QQQM: { Mega: 0.62, Large: 0.30, Mid: 0.08 },
  IVV:  { Mega: 0.50, Large: 0.38, Mid: 0.12 },
  SCHD: { Mega: 0.38, Large: 0.47, Mid: 0.15 },
  EFA:  { Mega: 0.28, Large: 0.52, Mid: 0.20 },
  EEM:  { Mega: 0.22, Large: 0.48, Mid: 0.25, Small: 0.05 },
};

export const US_COLS = [
  { key: 'sym',       label: 'Ticker',     num: false },
  { key: 'cat',       label: 'Category',   num: false },
  { key: 'livePrice', label: 'Live $',     num: true  },
  { key: 'liveVal',   label: 'Value $',    num: true  },
  { key: 'inv',       label: 'Invested $', num: true  },
  { key: 'livePl',    label: 'P&L $',      num: true  },
  { key: 'livePct',   label: 'P&L %',      num: true  },
  { key: 'dayPct',    label: 'Day %',      num: true  },
];
