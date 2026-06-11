'use client';

// Forward net-worth model, shared by the Projected Outlook card and the
// trajectory chart so the two can never disagree. Monthly compounding on a
// live base, PROJECTION.monthly contributions stepping up annually.

import { PROJECTION } from '../portfolio';

// Monthly series for one rate: corpus[m] / invested[m], m = 0 … months.
export function simMonthly(rate, base, inv0, months) {
  const mr = rate / 12;
  let c = base, inv = inv0;
  const corpus = [c], invested = [inv];
  for (let m = 1; m <= months; m++) {
    const x = PROJECTION.monthly * Math.pow(1 + PROJECTION.stepUp, Math.floor((m - 1) / 12));
    c = c * (1 + mr) + x; inv += x;
    corpus.push(c); invested.push(inv);
  }
  return { corpus, invested };
}
