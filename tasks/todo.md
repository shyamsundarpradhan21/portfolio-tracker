# Growth Card — Net worth ↔ Growth toggle (per spec)

Replace the `ProjectionTab` Value/Return toggle with **Net worth ↔ Growth**. "Net worth"
= existing value path, byte-for-byte. "Growth" = new ₹ curve (money made, deposits
stripped, re-baselined to 0 per window) + a ₹-counterfactual benchmark overlay.

## Phase 0 — Recon (DONE — reported, awaiting go-ahead for Phase 1)
- [x] Locate the ₹-counterfactual → `benchCounterfactual()` in `app/lib/calc.js:52`.
- [x] Confirm `loadPortfolio()` returns deposit arrays (TRANSACTIONS / MF_CASHFLOWS /
      US_CASHFLOWS / FDS) — yes, keyed exactly so in the private object.
- [x] Confirm server-reachable NW series — `snapshots:nw:<owner>` KV (api/snapshots),
      points {d, nw, invested, sl}; `invested` = cumulative net deposits.
- [x] Surface the nuances that shape Phase 1 (see report) — STOP before writing.

## Phase 1 — Server (commit 1, revertible) — DONE
- [x] `app/api/growth/route.js`: new mode `?view=growth&range=<1D|1M|6M|1Y|max>`.
- [x] Own growth line (₹) = (nw(t)−nw(winStart)) − (deposits(t)−deposits(winStart)),
      deposits from the loadPortfolio ledger (snapshot-`invested` fallback in degraded mode).
- [x] Benchmark counterfactual (₹): lifted the unit-replication core from
      `benchCounterfactual` (`levelOnOrBefore` + `units += amt/lvl`), extended to a per-date
      ₹ series (units×close(t) − deposits), re-baselined to 0 at window start. Whole-book
      dated deposit stream (Indian + MF + US×fx + FD). Flat-fx → currency-agnostic ratio.
- [x] range=max → Yahoo `5y`/`max`; non-max bumped to 5y if inception predates 2y.
- [x] 1D special: bench from `/api/intraday?kind=nifty` (Nifty only, scaled to ₹ on the
      investable base); own line null (client-supplied live P&L). Others null on 1D.
- [x] Returns `{view, range, points:[{d, growth_inr, bench:{…}}], available:[…]}`.
      No private ledger in the response; force-dynamic + no-store kept.

### Phase 1 verification
- Existing modes (`?days=N`, single-date) unaffected — `?days=30` still serves.
- New endpoint returns valid shape, no 500, at all ranges (empty points locally — KV
  snapshots are empty in dev; computes live in prod where KV is populated).
- Pure math proven by a 17-assertion synthetic harness: deposit-ledger signs,
  cumulative deposits, the counterfactual (100@idx100 + 100@idx200 → ₹250 @idx300),
  per-window re-baseline to 0, and deposit-stripping (mid-window 10k deposit excluded).

## Phase 2 — Client (commit 2, revertible)
- [ ] `ProjectionTab.js`: relabel toggle → "Net worth" (value, untouched) / "Growth"
      (new). Delete the old NAV footnote. Scrubber stays value-only.
- [ ] New `app/components/shared/GrowthView.js` — fetches the route, renders two ₹ lines
      (yours solid `--acc`, benchmarks dashed), window selector `1D·1M·6M·1Y·Max`, reuses
      PerformanceCurve chrome (pjx-cmp chips, smoothPath, seam dashing, pjx-perf-legend
      showing ₹ delta not %), zero-baseline emphasised. Owns zero private data.
- [ ] 1D: own line vs Nifty intraday only; hide non-Nifty chips. Honest blanks otherwise.
- [ ] `certify.mjs` passes at all breakpoints × both themes before merge.

## Open decisions (flagged in the report — confirm before Phase 1)
1. Max bench span → 5y (recommended; route already allows it).
2. 1D own-line "live P&L" source: client-supplied (it already has dayGain) vs server
   re-derive from eq/us intraday + fx. Recommend client-supplied to stay truly live.
3. Bench deposit source: raw cross-sleeve ledger (accurate) vs snapshot invested-deltas
   (simpler). Recommend raw ledger.

## Constraints
- --fs-* tokens only; private data server-side only (no deposit ledger in client bundle);
  two revertible commits (server then client); commit to current branch; no footnote;
  don't touch the certified Net-worth/value path; lift the counterfactual, don't reinvent.
