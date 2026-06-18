// Nifty 50 constituents — reference membership for the pre-market heatmap and
// gainers/losers board. Base NSE tickers (the route appends the Yahoo `.NS`
// suffix); `name` is the short display label, `sector` groups the heatmap.
//
// Membership as-of 2026-06 (NSE reconstitutes semi-annually). This is static
// reference data, like the holdings in app/portfolio.js — if the index rebalances
// the list is edited here and the heatmap follows with zero UI changes.

export const NIFTY50_ASOF = '2026-06';

export const NIFTY50 = [
  { sym: 'RELIANCE',   name: 'Reliance',    sector: 'Energy' },
  { sym: 'HDFCBANK',   name: 'HDFC Bank',   sector: 'Financials' },
  { sym: 'ICICIBANK',  name: 'ICICI Bank',  sector: 'Financials' },
  { sym: 'INFY',       name: 'Infosys',     sector: 'IT' },
  { sym: 'TCS',        name: 'TCS',         sector: 'IT' },
  { sym: 'ITC',        name: 'ITC',         sector: 'FMCG' },
  { sym: 'LT',         name: 'L&T',         sector: 'Industrials' },
  { sym: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom' },
  { sym: 'SBIN',       name: 'SBI',         sector: 'Financials' },
  { sym: 'AXISBANK',   name: 'Axis Bank',   sector: 'Financials' },
  { sym: 'KOTAKBANK',  name: 'Kotak Bank',  sector: 'Financials' },
  { sym: 'HINDUNILVR', name: 'HUL',         sector: 'FMCG' },
  { sym: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'Financials' },
  { sym: 'HCLTECH',    name: 'HCL Tech',    sector: 'IT' },
  { sym: 'MARUTI',     name: 'Maruti',      sector: 'Auto' },
  { sym: 'SUNPHARMA',  name: 'Sun Pharma',  sector: 'Pharma' },
  { sym: 'M&M',        name: 'M&M',         sector: 'Auto' },
  { sym: 'NTPC',       name: 'NTPC',        sector: 'Power' },
  { sym: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto' },
  { sym: 'TITAN',      name: 'Titan',       sector: 'Consumer' },
  { sym: 'ULTRACEMCO', name: 'UltraTech',   sector: 'Materials' },
  { sym: 'ASIANPAINT', name: 'Asian Paints', sector: 'Materials' },
  { sym: 'POWERGRID',  name: 'Power Grid',  sector: 'Power' },
  { sym: 'ADANIENT',   name: 'Adani Ent',   sector: 'Industrials' },
  { sym: 'ADANIPORTS', name: 'Adani Ports', sector: 'Industrials' },
  { sym: 'WIPRO',      name: 'Wipro',       sector: 'IT' },
  { sym: 'ONGC',       name: 'ONGC',        sector: 'Energy' },
  { sym: 'COALINDIA',  name: 'Coal India',  sector: 'Energy' },
  { sym: 'NESTLEIND',  name: 'Nestlé',      sector: 'FMCG' },
  { sym: 'JSWSTEEL',   name: 'JSW Steel',   sector: 'Materials' },
  { sym: 'TATASTEEL',  name: 'Tata Steel',  sector: 'Materials' },
  { sym: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'Financials' },
  { sym: 'GRASIM',     name: 'Grasim',      sector: 'Materials' },
  { sym: 'TECHM',      name: 'Tech Mahindra', sector: 'IT' },
  { sym: 'HINDALCO',   name: 'Hindalco',    sector: 'Materials' },
  { sym: 'CIPLA',      name: 'Cipla',       sector: 'Pharma' },
  { sym: 'DRREDDY',    name: "Dr Reddy's",  sector: 'Pharma' },
  { sym: 'BRITANNIA',  name: 'Britannia',   sector: 'FMCG' },
  { sym: 'EICHERMOT',  name: 'Eicher',      sector: 'Auto' },
  { sym: 'APOLLOHOSP', name: 'Apollo Hosp', sector: 'Pharma' },
  { sym: 'BPCL',       name: 'BPCL',        sector: 'Energy' },
  { sym: 'HEROMOTOCO', name: 'Hero Moto',   sector: 'Auto' },
  { sym: 'INDUSINDBK', name: 'IndusInd',    sector: 'Financials' },
  { sym: 'BAJAJ-AUTO', name: 'Bajaj Auto',  sector: 'Auto' },
  { sym: 'TATACONSUM', name: 'Tata Consumer', sector: 'FMCG' },
  { sym: 'SBILIFE',    name: 'SBI Life',    sector: 'Financials' },
  { sym: 'HDFCLIFE',   name: 'HDFC Life',   sector: 'Financials' },
  { sym: 'SHRIRAMFIN', name: 'Shriram Fin', sector: 'Financials' },
  { sym: 'TRENT',      name: 'Trent',       sector: 'Consumer' },
  { sym: 'JIOFIN',     name: 'Jio Finance', sector: 'Financials' },
];
