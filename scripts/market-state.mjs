// Tiny CLI over marketHours.mjs — prints the CURRENT India + US session state as
// one line of JSON, so shell tools (the daemon watchdog) can read the DST-aware
// window from the daemons' OWN source of truth instead of re-encoding it.
//
//   node scripts/market-state.mjs   ->  {"us":"open","in":"post","t":"22:58"}
//
// us : 'open' | 'closed'                 (usMarketState — the 18:45→02:30 IST window)
// in : 'weekend' | 'pre' | 'open' | 'post'  (marketState — the 09:13→15:32 IST window)

import { usMarketState, marketState, istParts } from './lib/marketHours.mjs';

const t = Date.now();
process.stdout.write(JSON.stringify({
  us: usMarketState(t),
  in: marketState(t),
  t: istParts(t).hhmm,
}));
