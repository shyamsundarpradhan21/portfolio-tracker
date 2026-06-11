---
last_mapped_commit: f327769e7739847e5a4fcf5cf032f6f21df3dc7a
---

# Codebase Concerns

**Analysis Date:** 2026-06-11

---

## Privacy & Data Sensitivity — CRITICAL

**Personal financial ledger data committed to source control:**
- Risk: `app/portfolio.js` contains the owner's full investment holdings including exact quantities, average cost basis, broker account references ("Zerodha tradebook GWS919EQ"), F&O P&L, loan balance schedule, and personal name embedded in a committed Excel file (`Shyam_Pradhan_3yr_tax_model_updated.xlsx`).
- Files: `app/portfolio.js`, `data/fy2526_verified.json`, `data/indian_exits.json`, `data/us_trades.json`, `Shyam_Pradhan_3yr_tax_model_updated.xlsx`
- Specific exposures:
  - `app/portfolio.js` lines 10–25: Indian equity holdings (14 stocks, qty + cost basis)
  - `app/portfolio.js` lines 212–262: US holdings (48 positions, fractional qty + cost basis)
  - `app/portfolio.js` lines 278–312: FD ledger (4 active FDs with principals ₹1.25L–₹2.35L, rates, bank names)
  - `app/portfolio.js` lines 331–346: SBI loan schedule with actual monthly balances up to Jun 2026
  - `data/fy2526_verified.json`: ITR-level F&O figures with broker-level gross/net/charges split
  - `data/indian_exits.json`: ~190 completed trade lots (entry date, exit date, buy value, sell value)
  - `data/us_trades.json`: Vested/DriveWealth complete per-ticker trade flows
  - `Shyam_Pradhan_3yr_tax_model_updated.xlsx`: Tax model with owner's name in the filename
- Current mitigation: `vercel.json` disables deployment on the `claude/wonderful-wright-lyx1nd` branch. The `.gitignore` correctly omits `.env` files. No other access controls are in place.
- Recommendations:
  1. If the repository is or could become public, move all ledger data to a private gitignored JSON store or a server-side database (Vercel KV or Blob).
  2. Rename or remove `Shyam_Pradhan_3yr_tax_model_updated.xlsx` from the repo root; it is not imported by any code.
  3. Consider whether `data/indian_exits.json` and `data/us_trades.json` should be gitignored since they contain full trade histories.
  4. Add a `README` disclaimer if intentionally keeping the repo private.

---

## Tech Debt

**Deprecated `STATIC.loan` shadow field:**
- Issue: `app/portfolio.js` line 317 retains `STATIC.loan = 750000` marked `// DEPRECATED — superseded by LOAN below (kept as last-resort fallback)`. The `LOAN` export (lines 331–346) with real amortisation is the authoritative source, but `STATIC.loan` is never removed. Any future code that accidentally reads `STATIC.loan` instead of `loanOutstanding()` will show a stale ₹7.5L flat figure.
- Files: `app/portfolio.js`
- Impact: Silent wrong net worth if `STATIC.loan` is referenced.
- Fix approach: Remove the deprecated `loan` key from `STATIC` entirely. Search codebase for `STATIC.loan` to confirm no active references remain before deleting.

**`MF` import referenced in `page.js` but not exported from `portfolio.js`:**
- Issue: `app/page.js` line 4 imports `MF` from `./portfolio` but `portfolio.js` exports `MF_FUNDS`, not `MF`. This appears to be a dead import or a leftover from a rename. The build may succeed if `MF` is undefined and unused, but it is a latent breakage risk if any code path tries to use it.
- Files: `app/page.js` line 4, `app/portfolio.js`
- Impact: Silent `undefined` in scope; would throw at runtime if dereferenced.
- Fix approach: Remove `MF` from the import destructuring in `app/page.js` line 4, or confirm it is intentional and add the export to `portfolio.js`.

**Hardcoded FX fallback of `84` INR/USD:**
- Issue: `app/lib/backfill.js` line 54 falls back to `84` INR/USD when no historical FX data is available (`fxAt(fxRates, d) ?? fxLive ?? 84`). The live rate as of Jun 2026 is approximately 84–86, so this is close but will become wrong as the rate moves over time.
- Files: `app/lib/backfill.js` line 54, `app/page.js` line 227 (similar fallback of `88`)
- Impact: Slightly inaccurate backfilled INR values for US sleeve when FX history fetch fails.
- Fix approach: Remove the magic number; fail gracefully (return 0 or skip the data point) or source the fallback from a maintained constant in `app/lib/constants.js`.

**`ETF_LOOKTHROUGH` and `ETF_CAP` sector/cap weights are static snapshots:**
- Issue: `app/lib/constants.js` lines 18–42 contain manually-maintained sector and cap-weight tables for ETFs (QQQM, IVV, SCHD, EFA, EEM). These drift as ETFs rebalance (QQQM rebalances quarterly). There is no freshness indicator or update reminder.
- Files: `app/lib/constants.js`
- Impact: Sector and cap-tier breakdowns on the US tab silently become inaccurate as time passes.
- Fix approach: Add a `// last updated: YYYY-MM-DD` comment per table. Add an item to `MONTHLY_UPDATE.md` prompting quarterly verification against the fund provider's website.

**`MF_BENCHMARK.proxy` NAVs are stale placeholders:**
- Issue: `app/portfolio.js` lines 419–421 define `proxy` NAVs for the Nifty 50 benchmark used when the live `mfapi.in` fetch fails. The proxy values (`10.3449`, `10.3449`, `9.3013`) reference dates in early 2026 and will diverge from reality as the fund's NAV continues to grow. A stale proxy overstates or understates the benchmark XIRR.
- Files: `app/portfolio.js` lines 419–421
- Impact: Incorrect MF vs benchmark XIRR comparison in the MF tab when the live feed is down.
- Fix approach: Update proxy NAVs monthly alongside the `UNITS_AS_OF` update, or remove the proxy and show `null` when the live feed is unavailable.

**`UNITS_AS_OF` staleness is not machine-enforced:**
- Issue: `app/portfolio.js` line 380 sets `UNITS_AS_OF = '05-Jun-2026'`. MF units go stale the moment a new SIP installment executes (monthly). There is no runtime assertion or UI warning that flags the dashboard when `UNITS_AS_OF` is more than ~35 days old.
- Files: `app/portfolio.js` line 380, `app/components/tabs/MFTab.js`
- Impact: MF value and XIRR silently use outdated unit counts after each SIP cycle.
- Fix approach: Add a `FreshnessTag` or console warning in `MFTab.js` when `new Date() - new Date(UNITS_AS_OF) > 40 days`.

---

## Security Considerations

**Yahoo Finance API scraping via spoofed User-Agent:**
- Risk: All four API routes (`/api/quotes`, `/api/history`, `/api/fx-history`) use a hardcoded Chrome `User-Agent` string to avoid Yahoo rate limiting (`app/api/quotes/route.js` line 18). This is against Yahoo's ToS and could be blocked without notice, taking down the entire live price layer.
- Files: `app/api/quotes/route.js`, `app/api/history/route.js`, `app/api/fx-history/route.js`
- Current mitigation: Two-host fallback (`query1`/`query2`). 8-second timeout per request.
- Recommendations: No official Yahoo Finance API key is used. If Yahoo blocks the endpoint, the dashboard silently falls back to cached/stale prices. Monitor for HTTP 429/403 response codes and add an alerting mechanism or migrate to a paid data provider.

**`ANTHROPIC_API_KEY` exposure risk via server-side logs:**
- Risk: `app/api/insights/route.js` line 133 checks `process.env.ANTHROPIC_API_KEY`. If an error response from the Anthropic SDK is logged verbosely (e.g., in a Vercel function log), the key could appear in log output. The current error path at line 163 logs `e?.message`, which is generally safe, but future changes could accidentally log the full error object.
- Files: `app/api/insights/route.js`
- Current mitigation: Key is in Vercel environment variables (not in code). Response errors are caught and degraded to `EMPTY`.
- Recommendations: Add a `redactHeaders` step or confirm the SDK does not include the key in error messages.

**No authentication on any API route:**
- Risk: All five API routes (`/api/quotes`, `/api/history`, `/api/fx-history`, `/api/mf-nav`, `/api/insights`) are publicly accessible with no authentication. While the routes only proxy public market data or call the Anthropic API, the `/api/insights` route will spend `ANTHROPIC_API_KEY` credits for any unauthenticated caller who knows the endpoint.
- Files: `app/api/insights/route.js`
- Impact: API credit abuse / cost amplification if the URL is discovered.
- Fix approach: Add an `x-api-secret` header check against a Vercel environment variable, or use Next.js middleware to restrict the `/api/insights` route to same-origin requests only.

**`symbols` parameter in `/api/quotes` and `/api/history` is not sanitised beyond length:**
- Risk: `app/api/quotes/route.js` line 73 splits on commas and trims but passes each symbol directly into a Yahoo Finance URL path via `encodeURIComponent`. The `encodeURIComponent` call provides basic safety, but symbols are fully user-controlled. The `/api/history` route applies the same pattern with an additional `range` allowlist (`ALLOWED` set at line 78) — that is good. `/api/fx-history` validates the `start` parameter with a date regex (line 24) — also good.
- Files: `app/api/quotes/route.js`, `app/api/history/route.js`
- Current mitigation: `encodeURIComponent` prevents path traversal. Symbol length cap (60 and 70 respectively) limits amplification.
- Recommendations: Low severity given `encodeURIComponent`. No immediate action required.

---

## Performance Bottlenecks

**Single `doRefresh` call fetches all symbols in parallel but blocks rendering until all resolve:**
- Problem: `app/page.js` line 264 calls `Promise.all([fetchBatch(inSyms), fetchBatch(US), fetchMfNav(), fetchHistory()])`. The `fetchHistory` call requests weekly 5-year series for all Indian + US symbols (~80+ tickers) and takes significantly longer than the quotes batch. The entire UI waits for all four to complete before prices appear.
- Files: `app/page.js` lines 260–284
- Cause: `Promise.all` resolves when the slowest promise finishes.
- Improvement path: Split into two render phases — show quote prices as soon as `fetchBatch` resolves; update history-dependent stats (benchmarks, beta, XIRR counterfactuals) when `fetchHistory` resolves independently.

**`buildBackfill` runs on every `doRefresh` call and iterates O(weeks × holdings):**
- Problem: `app/lib/backfill.js` `buildBackfill()` is called client-side and reconstructs a full weekly history grid (potentially ~250 weeks × 14+ holdings) on each 15-minute refresh cycle. The output is deterministic given the same `hist` data, so recomputing it on every refresh is wasteful.
- Files: `app/lib/backfill.js`, `app/page.js`
- Cause: No memoisation beyond React's `useMemo` on `hist` state.
- Improvement path: The result is already memoised via `useMemo` keyed to `hist` — this is acceptable if `hist` only changes on a full history refetch. Confirm the dependency array is correct.

**`/api/history` fetches up to 80 symbols in a single request, fanning out to Yahoo:**
- Problem: `app/page.js` line 254 constructs a symbols list including all `INDIAN_BENCHMARKS` Yahoo fallbacks, all `US_BENCHMARKS` fallbacks, all 14 Indian holdings (`.NS`), and all 48 US holdings — potentially 80+ symbols in one call. Each symbol is a separate `fetch` to Yahoo in the server route (`Promise.all` at line 88 of `app/api/history/route.js`). With the 8-second per-symbol timeout, a slow batch can approach the Vercel function timeout.
- Files: `app/api/history/route.js`, `app/page.js`
- Cause: No symbol batching or caching at the route level; `dynamic = 'force-dynamic'` disables ISR.
- Improvement path: Consider adding an LRU server-side cache (e.g., a module-level `Map` with a 1-hour TTL) to avoid re-fetching weekly series on every client refresh.

---

## Fragile Areas

**`applyCorpActions` bonus ratio parsing assumes exact `"N:M"` string format:**
- Files: `app/lib/calc.js` lines 139–153
- Why fragile: Line 146 uses `a.ratio.split(':').map(Number)` with no validation. A typo in `CORPORATE_ACTIONS` (e.g., `'1/3'` instead of `'1:3'`) silently produces `NaN` bonus shares and corrupts `qty` and `cost` for that stock on every render after the ex-date.
- Safe modification: Add a guard: `if (!isFinite(num) || !isFinite(den) || den === 0) return;` before applying the bonus.
- Test coverage: No tests exist for `applyCorpActions`.

**`loanOutstanding` projection loop uses calendar arithmetic with daily iteration:**
- Files: `app/portfolio.js` lines 351–370
- Why fragile: The projection loop at line 358 iterates one day at a time from `lastD` to `date`. For a date far in the future (e.g., the loan's 7-year maturity in 2032), this loop runs ~2,500 iterations per call. The function is called on every render cycle (`ov` useMemo in `page.js` line 480 and in `buildBackfill`). Performance degrades as the gap between `lastD` and `date` grows.
- Safe modification: Replace the daily loop with closed-form monthly amortisation math, or cache the result keyed to the date string.

**Indian index benchmark tickers are known-flaky:**
- Files: `app/portfolio.js` lines 93–98, `app/api/history/route.js` line 71
- Why fragile: Comments throughout the codebase acknowledge that `^NSEI`, `NIFTYMIDSML400.NS`, and `^CNXSC` are unreliable on Yahoo Finance. When they fail, the UI shows `—` for benchmark comparisons. Multiple fallback arrays are maintained manually; if Yahoo changes ticker symbols again, silent failures occur.
- Safe modification: The existing fallback chain is a reasonable mitigation. Add a `FreshnessTag`-style indicator in the IndianTab when all benchmark candidates for a given benchmark fail.

**`fdRedemptions` auto-maturity logic could double-count if `closedOn` is not set:**
- Files: `app/portfolio.js` lines 307–312
- Why fragile: `fdRedemptions` includes both explicitly `closed` FDs with `closedOn` dates AND `active` FDs past their maturity date. If an operator forgets to flip a matured FD's `status` to `'closed'` when redeploying, the same deposit appears in both the `fdRedemptions` cash-in list (as auto-matured) and continues to accrue in `deriveFds` (as still active — but past maturity it is frozen at maturity value, not accruing). The deployment calendar would then show a spurious cash inflow.
- Safe modification: Add a comment to `MONTHLY_UPDATE.md` explicitly stating: "When booking the rollover FD, set the old row's `status` to `'closed'` and `closedOn` to the maturity date on the same day."

---

## Scaling Limits

**localStorage snapshot cap of 800 records:**
- Current capacity: `app/lib/snapshots.js` line 7 caps daily net-worth snapshots at 800 entries (~2.2 years).
- Limit: After 800 days of daily use (~late 2028), the oldest history is silently dropped. The growth chart will lose early history.
- Scaling path: Persist snapshots to Vercel KV or Blob (the comment in `snapshots.js` line 9 already identifies this as the migration seam).

**sessionStorage history cache has no size guard:**
- Current capacity: `app/page.js` line 274 stores the full `/api/history` response (weekly closes for 80+ tickers over 5 years) into `sessionStorage`. This can exceed 2–5 MB per browser tab, which approaches the typical 5–10 MB `sessionStorage` quota.
- Limit: On storage quota exceeded, the `try/catch` block silently swallows the error; the cache is not written and every page load refetches the full history.
- Scaling path: Compress the stored object or only cache the benchmark series (not individual holding histories).

---

## Missing Critical Features

**No automated staleness enforcement for `INDIAN[]` holdings after exits:**
- Problem: When a stock is fully exited, it must be manually removed from `INDIAN[]` in `portfolio.js`. The comment on lines 7–9 warns against reintroducing specific symbols but there is no runtime assertion or lint rule to enforce this. A developer (or AI assistant) could accidentally re-add an exited symbol.
- Blocks: Correct P&L, correct sector/cap allocations.

**No CI/CD pipeline or automated build check:**
- Problem: `package.json` defines only `dev`, `build`, `start`, and `lint` scripts. There is no `.github/workflows/` directory or equivalent. The `MONTHLY_UPDATE.md` says to run `npm run build` manually before committing, but this is not enforced.
- Blocks: Catching import errors (like the `MF` import issue above) before they reach production.

---

## Test Coverage Gaps

**Zero test files exist in the entire codebase:**
- What's not tested: All financial calculation functions in `app/lib/calc.js` (`xirr`, `weightedCagr`, `benchCounterfactual`, `computeBetaVol`, `applyCorpActions`, `compound`), the `loanOutstanding` projection in `app/portfolio.js`, `buildBackfill` in `app/lib/backfill.js`, and all API route handlers.
- Files: `app/lib/calc.js`, `app/portfolio.js`, `app/lib/backfill.js`, `app/api/quotes/route.js`, `app/api/mf-nav/route.js`, `app/api/insights/route.js`
- Risk: A bug in `xirr` or `loanOutstanding` would silently show wrong net worth, wrong XIRR, or wrong tax carryforward numbers with no automated detection.
- Priority: **High** for `xirr`, `applyCorpActions`, and `loanOutstanding`; these are financial computations with real tax and P&L implications.
- Note: `devDependencies` includes `puppeteer` (for `scripts/snapshot-tabs.js`), but no test framework (Jest, Vitest, etc.) is installed. Adding Vitest would have near-zero configuration cost in a Next.js 14 project.

**`applyCorpActions` bonus logic is untested but affects real holdings:**
- What's not tested: Bonus ratio application, post-bonus cost-basis dilution, and ex-date boundary conditions (ex-date = today, ex-date in future).
- Files: `app/lib/calc.js` lines 139–153
- Risk: Wrong quantity or cost after a bonus event misprices the holding and all downstream XIRR/P&L figures.
- Priority: **High** — CUB bonus ex-date is 2026-06-12, one day after this audit.

**`loanOutstanding` projection is untested:**
- What's not tested: Date before disbursement (should return 0), date within the statement window (should match the ledger), date beyond the last statement entry (projection), date at/after full payoff.
- Files: `app/portfolio.js` lines 351–370
- Risk: A projection bug silently overstates or understates net worth by up to ₹7.5L.
- Priority: **High**.

---

## Data Freshness / Staleness Risks

**`asOf` dates in `INDIAN_REALIZED` and `US_REALIZED` are static strings:**
- Files: `app/portfolio.js` lines 56 (`asOf: '08 Jun 2026'`) and 137 (`asOf: '08 Jun 2026'`).
- Risk: After exits or dividends are booked, the `asOf` date must be manually updated. A stale `asOf` date on the Realized P&L panel gives the impression of current data when the figures are months old.
- Recommendation: Add a `FreshnessTag` in `RealizedPanel.js` that turns amber when `asOf` is more than 45 days old relative to `new Date()`.

**`US_CORP_ACTIONS` projected ex-dates are estimates (`projected: true`):**
- Files: `app/portfolio.js` lines 180–188
- Risk: All seven upcoming US corporate action entries carry `projected: true`. These are estimated from historical payout intervals and could be off by days or weeks. The dashboard displays them as upcoming events without a clear visual distinction from confirmed dates.
- Recommendation: Ensure the `FreshnessTag` or similar badge shown for `projected: true` is visually distinct enough to prevent misinterpretation.

**`LOAN.balances` last entry is 2026-06-05; projection diverges from reality over time:**
- Files: `app/portfolio.js` lines 337–346
- Risk: `loanOutstanding` projects daily interest accrual and EMI deductions beyond the last known balance. Small rounding differences accumulate over months. Without refreshing `balances` from a new bank statement, the projected loan balance (and therefore net worth) will drift from the actual figure.
- Recommendation: `MONTHLY_UPDATE.md` should explicitly list "Refresh `LOAN.balances` from the SBI statement" as a monthly task.

---

*Concerns audit: 2026-06-11*
