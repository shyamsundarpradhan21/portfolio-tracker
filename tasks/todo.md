# Task (DONE) — make the Vested (US) fetcher CUMULATIVE

**Why:** `parse-vested.py --write` rebuilds `us_trades.json` + `US_DIVIDENDS` + `US_CASHFLOWS` ENTIRELY from
ONE canonical `Vested_Transactions.xlsx` (no merge with prior state). It assumes every upload is the full
cumulative history. The user uploads only the MONTH → a month-only export would wipe all prior history.
Fix: accumulate uploads (append-corpus, like payslips) and rebuild from the UNION of all rows, deduped —
so month-only uploads accumulate and full/overlapping uploads stay idempotent.

**Design (append-corpus + union-parse):**
- `vested.mjs`: save each upload to `data/reports/vested/<naturalKey>.xlsx` (KEEP all; dir is gitignored),
  instead of replacing the single canonical file. naturalKey stays the export's latest activity date.
- `parse-vested.py`: read EVERY `*.xlsx` in `data/reports/vested/`; per sheet (Trades / All Transactions /
  Transfers / Income) UNION the rows with a full-row content fingerprint dedup (identical row across
  overlapping uploads = the SAME txn → collapse; distinct rows accumulate); THEN run the existing
  flows/cash/dividends/cashflows reduction over the union. Cash EOD per date = latest (time, newest-upload)
  balance. `asOf` = max date across the corpus. Back-compat: single-file corpus → byte-identical output.
- Idempotent: re-dropping the same/overlapping export changes nothing (dedup). Month-only adds its rows.

**Migration wrinkle (canonical xlsx is GONE; only the aggregated `us_trades.json` survives):** the new corpus
starts EMPTY, so the FIRST upload after the change seeds it. If that first upload is month-only, history is
lost. → the first upload must be the FULL history (Vested exports are cumulative by default), which seeds the
corpus; month-only uploads thereafter accumulate. (Alt: baseline off the current us_trades.json — rejected:
dividends' allTime/FY can't re-aggregate without raw rows, so it would drift.)

## Steps
- [x] V1. `parse-vested.py`: `collect(paths)` unions+dedups rows across N exports (full-row fingerprint,
      per-file multiplicity=max); `_reduce()` runs the same reduction; `parse()` kept back-compat. `corpus_paths()`
      = VESTED_DIR/*.xlsx PLUS the VESTED_XLSX baseline (always). `--write`/review use the corpus; empty-guard added.
- [x] V2. `vested.mjs`: append each upload to `data/reports/vested/<asOf>-<sha8>.xlsx` (keep all); `--write` unions.
- [x] V3. `scripts/parse-vested.test.py` (18 asserts): single-file baseline; overlap dedup (no double-count);
      non-overlap union; within-file multiplicity kept + re-upload doesn't inflate; cash newest-file-wins.
- [x] V4. Verify: rebuild from the real canonical == committed `us_trades.json` BYTE-IDENTICAL (asOf/cash/flows/
      other) with held frozen — faithful no-op, zero regression. E2E `--write` over a synthetic corpus OK; empty
      guard refuses. No live data files touched (temp outputs only).
- [x] V5. Docs: vested.mjs header + parse-vested.py docstring rewritten (append-corpus, no seed step needed).

## Review
**What shipped:** the Vested/US fetcher is now CUMULATIVE. `parse-vested.py` keeps every uploaded export in an
append-corpus (`data/reports/vested/`) and rebuilds `us_trades.json` + `US_DIVIDENDS` + `US_CASHFLOWS` from the
UNION of all rows — deduped by full-row fingerprint (identical row across overlapping exports = ONE txn; a
genuinely repeated row within one export is preserved). So month-only uploads accumulate; a month-only drop can
no longer wipe history. Cash EOD per date = the newest export's balance.

**Migration (corrected mid-task):** the canonical `Vested_Transactions.xlsx` (full history, 1695 trades,
2024-03→2026-07) is STILL on disk (my earlier "it's gone" was a truncated-`ls` mistake). `corpus_paths()` always
unions it as the permanent baseline, so **no re-upload / seed step is needed** — the next month-only upload just
accumulates on top of it. (Told the user "re-upload full history once" earlier — that turned out unnecessary.)

**Verification:** rebuild from the real canonical is byte-identical to the committed `us_trades.json` (held frozen)
→ faithful no-op. 18 new unit tests green. Live `us_trades.json` / `portfolio.private.json` untouched (all runs to
temp). The pending BMNR `other`→`flows` move (BMNR added to US[] since the file was last generated) is a correct,
independent latent change — NOT triggered here; it'll apply on the next real Vested upload/regen.

**Note:** a real Vested upload now also writes `data/reports/vested/<asOf>-<sha8>.xlsx` (kept; dir is gitignored).

---

# Task (DONE) — ViewTrade/Dhan-GIFT US trade-confirmation parser + merge into the US book

**Built (data model: MERGE into the combined us_trades.json + US[], per user):**
- `us_viewtrade.py`: parse a decrypted ViewTrade/Raise-IFSC "US Stocks Segment" note → trades
  (positional last-9-numbers rule, robust to wrapped security names; per-row reconcile: qty×price≈
  net-before, net-before±fees=net-after). PII-safe (tickers + USD only). 10 unit tests.
- Route: `engine.build_ledger` detects a US note → returns `kind:us_viewtrade`; `run.py` books the
  trades into `data/dhan-us-trades.json` (append + dedup by trade fingerprint) → status `USTRADES`.
- `contract-note.mjs`: `USTRADES` → PASS + rebuild the combined US book — `--holdings --write` (US[]
  gets the 9 Dhan names w/ user-confirmed cats + GOOG combined across custodians) THEN `--write`
  (us_trades.json flows, so the 9 are HELD → land in `flows` not `other`) THEN KV reseed.
- `parse-vested.py`: `dhan_us_flows()` folds Dhan into us_trades.json flows; `dhan_us_holdings()` +
  `merge_holdings()` fold Dhan positions into US[]; NEW_META carries the 9 categories. The Dhan store
  is unioned on EVERY rebuild, so a Vested upload can't clobber it (same guarantee as the corpus).

**Verified end-to-end (to temp, live data untouched):** real note → 10 trades reconciled ($200.66);
store idempotent (re-drop = 0 new); us_trades.json → GOOG buy in flows + all 9 in flows (other 22/07
empty); US[] 50→59 holdings, invested +$200.66, GOOG combined (qty 0.186231, blended cost). 311 engine +
10 US + 18 vested tests green.

**Pending:** trigger the LIVE capture (re-drop the note → daemon books it) + commit the data.

---

# (superseded plan) — ViewTrade/Dhan-GIFT US trade-confirmation parser

**Why:** Dhan's GIFT-City US sleeve went live (first SIP 22/07/2026). Its trade confirmations arrive by
email — a ViewTrade/Raise-IFSC "TRADE CONFIRMATION / CUM Tax Invoice" (USD, fractional qty, US fee columns,
no Indian ISIN/STT/CN-no). The Indian engine can't read it; it's currently quarantined UNPARSED in
inbox/failed (safety fix already prevents silent loss). The DhanHQ API does NOT expose this book (verified
live 2026-07-23), so the email note is the only automated feed. These ~$200 of holdings are captured NOWHERE.

**Format (confirmed from the real PDF):** clean tabular/text. Columns: TradeDate | SettleDate | Symbol |
SecurityName | B/S | Qty | PricePerUnit($) | NetBeforeLevies($) | Commission($) | TxnFee($) | TurnoverFee($) |
OtherFee($) | IGST($) | NetAfterLevies($). 10 BUYs 22/07/2026. Reconciles: qty×price ≈ net-before; +fees ≈ after.

**Data model (DECISION 1 — recommend NEW sleeve):** the existing `data/us_trades.json` is the Vested/
DriveWealth book (`{cash, flows:{SYM:[[date,qtyΔ]]}, other}`), owned+overwritten by the `vested` parser.
Dhan-GIFT is a SEPARATE custodian (ViewTrade IFSC) per the locked stance → write to a NEW
`data/dhan-us-trades.json` (own file, can't be clobbered by the vested rewrite). Merge = mixes custodians +
fights the vested parser. Recommend NEW sleeve.

**Architecture (DECISION 2 — recommend reuse-decrypt):** the note decrypts with the SAME Dhan PAN via the
existing contract-parser probe, and is claimed by contract-note (filename has "Contract_Note"). Two ways:
 (a) REUSE: `run.py`/`engine.build_ledger` detects a ViewTrade US note (text: "US Stocks Segment"/"ViewTrade"/
     "TRADE CONFIRMATION") and routes to a new `us_viewtrade.py` adapter; emits porcelain status `USTRADES`
     with the parsed trades → contract-note.mjs writes `data/dhan-us-trades.json`. Reuses decrypt+probe+
     manifest+PII discipline; keeps US logic in its own module (Indian engine untouched). ← recommend
 (b) SEPARATE registry parser `dhan-us` ordered before contract-note (claims by filename /us.?stocks/i),
     duplicating the decrypt. More separation, more duplication.

## Steps (Phase 1–2 = the "parser build"; Phase 3 display = follow-on)
- [ ] P1. `us_viewtrade.py`: parse decrypted ViewTrade note → trades [{date,symbol,name,side,qty,priceUsd,
      fees{commission,txn,turnover,other,igst},netBefore,netAfter}]; reconcile per-row (qty×price≈netBefore;
      +fees≈netAfter) + a note-total checksum. PII-safe masked summary (no name/PAN/address).
- [ ] P2. Route in `run.py`: detect US note → us_viewtrade; porcelain status `USTRADES` (trades, PII-free).
- [ ] P3. `contract-note.mjs mapCnStatus`: `USTRADES` → PASS, writes/append `data/dhan-us-trades.json`
      (idempotent, keyed on date+symbol+qty), naturalKey = the note's settlement/date signature.
- [ ] P4. Tests: synthetic ViewTrade note (fake tickers/amounts, no PII) → 10 trades parsed + reconciled;
      idempotent re-ingest = no dupes; a genuine Indian note still routes to the Indian engine (no regression).
- [ ] P5. Verify: re-drop the real note → PASS → `data/dhan-us-trades.json` has the 10 buys; full suite green.
- [ ] P6 (FOLLOW-ON, separate approval). App wiring: show the Dhan-GIFT US sleeve (appData/portfolio route/
      US components), separate from Vested. certify green. NOT in this build unless you say so.

## Review
(to fill in)

---

# Task (DONE) — reconcile BF/CF carry MTM in contract-note engine

## Problem
Upstox note `CW_T_7BB93B_20260722_FON` (2026-07-22) fails reconciliation with a clean
−₹21,500 residual. HYBRID note: a carried futures position (FUTSTK ANGEL ONE, shown as
BF/CF legs netting to qty 0 = daily MTM, not a trade) PLUS one executed trade (OPTSTK
ANGEL ONE PE 280 BUY). Fills-based checksum `net_amount == Σfills + Σcharges` can't include
the futures MTM, so it's left over → REFUSED → quarantined to inbox/failed. `is_carry_note`
only catches PURE carry notes (no fill + no levy), so the mixed case slips through.

## Plan (Option 1 — fold carry MTM into the reconciliation obligation)
- [x] Read engine: checksum(), per_segment_checksum(), summary/WAP table detection, build_ledger()
- [x] Extract BF/CF carry MTM from the WAP summary table (`carry_from_tables`), keyed by fill-segment
- [x] Fold carry MTM into the obligation so Σfills + carryMTM + Σcharges == net_amount
- [x] Keep carry legs OUT of fills (not trades); surfaced in masked_summary + net_total["carry"]
- [x] Per-segment checksum accounts for the carry MTM too
- [x] Add test (synthetic PII-free tables mirroring this note): 11 new asserts, was FAIL now reconciles
- [x] Full test_engine.py green (293/293); re-ran run.py on the real note → OK (residual 0.0)

## Review
**Fix (engine.py):** BF/CF carry-forward MTM (an F&O position held overnight, shown in the WAP
summary table as a Brought-Forward + Carried-Forward pair netting to qty 0 — a daily mark-to-market,
not a trade) is now folded into the reconciliation obligation.
- `carry_from_tables()` sums the BF/CF Net-Totals per fill-segment (note convention). Returns `{}`
  for every note with no BF/CF rows → **zero impact on non-carry notes** (regression-free by construction).
- `build_ledger()` injects the carry into `charges` (net_total + per clearing-segment) BEFORE the
  Upstox client→cashflow sign-flip, so it inherits the same sign-normalisation as the charges.
- `checksum()` / `per_segment_checksum()` add a `carry` term to the obligation (defaults 0.0).
- `masked_summary()` surfaces "carry folded" + adds carry/margin to the FAIL component breakdown.

**Verification:** target note `CW_T_7BB93B_20260722_FON` (cn 6335550) went REFUSED → **OK, total &
per-segment residual 0.0**. 293/293 unit tests pass (11 new). On other historical carry notes,
`fills + carry` matches the note's own PAY-IN/PAY-OUT obligation line to the paisa (carry is exact).

**Blast radius (carry fix):** 3 more quarantined Upstox notes fully reconcile. NO regression (every
affected note was already in inbox/failed; nothing that previously PASSed changed).

---

## Follow-on (APPROVED) — split-charges-block brokerage-capture bug + re-ingest

**Bug:** older Upstox F&O layout — pdfplumber splits ONE ruled charges block into two consecutive
fragments sharing the identical `<blank>|FO-EQ|TOTAL` header: fragment A = PAY-IN + Brokerage +
IGST-on-brokerage, fragment B = remaining levies + Net Amount. Fragment A isn't recognised as a
charges table (no Net-Amount row, <3 charge rows), so **brokerage + its IGST are dropped** →
residual == brokerage + its GST (−₹35.40 etc.). Distinct from carry.

**Fix (engine.py):**
- `_merge_split_charge_tables()` concatenates adjacent charge fragments with an identical header so
  the split rows rejoin ONE table — within-table accumulation then SUMS the two IGST lines and no
  charge is lost. Anchor must carry a real charge row, so a pay-in/net-amount-ONLY obligation table
  is never pulled in (keeps the fills+carry path for non-split notes untouched).
- Rejoining also captures the note's own PAY-IN obligation, so `checksum()`/`per_segment_checksum()`
  now **gate the carry term to pay_in-absent** (pay_in already includes the carry → no double-count).

**Verification:** 304/304 tests (11 new split/gate). Yesterday's note stays OK (residual 0.0, uses the
fills+carry path — its obligation table is pay-in-only, not merged). Upstox FON backlog: **30/36 unique
notes now reconcile** (was ~0). Remaining 6 are `N/A` (resid None) — a *different* 2023-era layout where
`net_amount` itself isn't extracted; unchanged by this fix. Full inbox/failed dry-run tally: 57 OK +
5 CARRY (inert) + 17 REFUSED (mostly other brokers) + 2 SKIP, from ~all-REFUSED before.

**Re-ingest yesterday's note:** DONE (see below) — moved back to inbox root, live ingest → PASS → KV.

---

# PLAN (PROPOSED — awaiting approval) — heatmap stock click → full snapshot detail panel

**Goal:** clicking a stock tile in the market heatmap opens a detail panel replicating the
provided snapshot (Google-Finance-style): header (name/exchange/sector · price · change ·
market state), day range + 52-wk range bars, key-stats grid, dividends donut, income
statement (annual/quarterly), performance bars, optional AI key-facts blurb. Works for BOTH
India (Nifty-50) and US (Nasdaq-100).

**Existing (half-built) — REUSE, don't rebuild:**
- `MarketHeatmap.js` — market-agnostic treemap (sector→industry→stock drill, `onSelect`/`selected`).
- India wired: `MacroTab.js:534` fires `setSelSym`; `NiftyOverview` = detail panel; `/api/nifty50-detail`
  (perf 1W/1M/3M/6M/YTD/1Y, 52wk, dividends, keyless) + `nifty50-fundamentals.json` (mcap).
- US GAP: `MacroTab.js:542` renders Nasdaq map but NO `onSelect`/`selected`, no detail feed, no fundamentals.

**Decisions locked (2026-07):** drill-down (already exists) · FULL replica · metrics via quoteSummary
in a **LIVE `/api/stock` route** (user chose live over laptop-capture — always-fresh) · **BOTH** India +
US · **AI key-facts blurb DEFERRED** to a follow-up.
**Live-route de-risking (mandatory given the choice):** crumb+cookie fetch with `AbortSignal.timeout`,
CDN cache (`s-maxage`+SWR, fundamentals are slow-moving), and a **graceful fallback to committed
`*-fundamentals.json`** so a crumb failure blanks ONE field, never breaks the panel. Do NOT server-side
self-fetch a sibling route (feedback.md: protection blocks it) — call Yahoo directly via a shared lib.
**House rules to honor:** direction = COLOUR only (no +/− glyph, unlike the snapshot) · `--fs-*`
type tiers · theme tokens (no hex) · both themes · certify green.

- [ ] **P3a. Panel render-mock (FIRST — approval gate).** Standalone HTML mock of the full snapshot
      panel (NVDA + an Indian example), day+night, house-styled (direction=colour, --fs tiers, tokens).
      Get approval BEFORE any app code.
- [ ] **P0. quoteSummary spike (de-risk).** Confirm crumb+cookie flow returns the needed modules
      (summaryDetail, defaultKeyStatistics, calendarEvents, financialData, price,
      incomeStatementHistory{,Quarterly}) for NVDA + RELIANCE. GATE the route build on this.
- [ ] **P1. Live `/api/stock?symbol=` route.** Shared `lib/yahooSummary.js` (crumb+cookie, timeout,
      shape-validate, optional-chain). Returns normalized: header (name/exch/sector, price, prevClose,
      state, currency), ranges (dayHi/Lo, 52wHi/Lo), key stats (nextEarnings, volume, avgVol30, marketCap,
      divYieldInd, peTTM, basicEpsTTM, sharesFloat, beta1y), dividends (yieldTTM, lastAmt, lastDate,
      exDate, payDate, payoutRatio), income statement (annual+quarterly: revenue, netIncome, netMargin).
      Cache s-maxage+SWR; **fallback to committed `*-fundamentals.json`** on crumb failure.
- [ ] **P2. Fundamentals fallback JSON.** Extend `nifty50-fundamentals.json` + add
      `nasdaq100-fundamentals.json` (laptop capture) so the live route degrades gracefully, not blank.
- [ ] **P3b. Panel UI (build the approved mock).** New shared `StockDetail` (or grow `NiftyOverview`):
      header, range bars, key-stats grid, dividends donut, income-statement annual/quarterly chart,
      performance bars. Theme-tokened, type-tiered, direction=colour. Serves both markets.
- [ ] **P4. Wire selection (both maps).** India already fires `setSelSym`; add `onSelect`/`selected`
      for the Nasdaq map (`MacroTab.js:542`); route the shared panel off `/api/stock?symbol=` per active
      market. Keep the keyless `/api/nifty50-detail` for the fast perf/dividend bits if cheaper.
- [ ] **P5. Verify.** certify.mjs green (macro surfaces, normal+stress, both themes, 001/002/004=0,
      docOverflow=0) · render-verify both themes · commit to main (laptop-side; sandbox git mangles CRLF).

**STATUS (code-complete, verification pending on laptop):** P0 spike PASSED both markets (crumb
works). Built: `app/lib/yahooSummary.mjs`, `app/api/stock/route.js`, `app/components/shared/StockDetail.js`
(+`.sd-*` CSS), wired both maps in `MacroTab.js`. **Correction applied:** the panel is an in-RAIL
replacement of the side tab (not a modal — user clarified) — reuses `.nov-panel` flex; ‹ back returns to
index; US now gets a rail beside its map. Remaining: user runs dev render (both themes) + certify + commits.
P2 committed-fundamentals fallback still deferred (live path passed the spike).

---

# DONE — daily corp-actions scan (IND + US) → evening schedule

**Shipped (full build A–D):** India NSE capture widened to dividend/bonus/split/rights (typed +
ratio, 11 unit tests green); new `capture-corp-actions-us.mjs` (Yahoo calendarEvents → announced
upcoming ex-dates + chart last-payout, 3/50 in-window: MSFT/TMO/TSM); both folded into
`DailyEvening` (18:40) via `corp-actions.cmd` (KV live + committed JSON, commit+push); `/api/dividends`
merges IND+US filtered to holdings with `type`+`market`; card renamed "Upcoming corp actions" with
IN/US badge + $/₹ per market. Live-verified (MSFT [US] $0.91/share showing); certify normal+stress green.
Caveat: US coverage partial by design (only announced future ex-dates; ETFs/splits not sourced).

---

# (original plan) — daily corp-actions scan (IND + US) → evening schedule

**Goal:** daily post-close scan of upcoming corp actions (dividend / bonus / split / other)
for BOTH Indian (INDIAN+SWING) and US holdings, folded into **DailyEvening** (18:40 IST),
feeding the "Upcoming dividends" card (→ "Upcoming corp actions").

**Found:** India capture is dividends-only (`corpActions.isDividend` drops bonus/split) and
**not scheduled**. US has no auto corp-action fetch (`US_DIVIDENDS` is hand-maintained; 50 US
holdings). Evening entry = `DailyEvening` → `scripts/evening.cmd` (F&O capture) — a `.cmd`
chain I can extend, no new Task Scheduler entry needed.

- [ ] **A. India — widen capture** (`corpActions.mjs classify()` → dividend|bonus|split|rights|other
      + ratio parse; `mapCorpActions` emits all types; capture writes them to KV/committed).
- [ ] **B. US — new fetch** (`capture-corp-actions-us.mjs`: Yahoo quoteSummary `calendarEvents`
      per US holding → next ex-div + amount, crumb-gated laptop-side like seed-nifty-fundamentals;
      splits best-effort via chart events=split). Gate: verify calendarEvents coverage first.
- [ ] **C. Schedule** — append both captures to `scripts/evening.cmd` (daily 18:40, post-close).
- [ ] **D. UI** — `/api/dividends` merges IND+US, adds `type`+market; `UpcomingDividends` shows
      type (Dividend ₹X · Bonus 1:1 · Split) + IN/US badge; rename "Upcoming corp actions". certify.

**Open decisions:** (1) full A–D now vs scan-only A–C (UI later); (2) US splits are spottier than
dividends on Yahoo (dividends solid, splits best-effort).

---

## Prior shipped — regional index rail + Commod·FX additions (04edefd, 372455e, 15ac084 · 2026-07-14)
Divider style A (accent chip) · GIFT Nifty dropped (not on Yahoo). Wired FTSE/CAC/DAX/KOSPI via
`railRegion()` + `.tkdiv`; added **Nat Gas** `NG=F` + **Bitcoin/Ethereum** `BTC-USD`/`ETH-USD`
(group 'crypto', wrap rail only) to the Commod·FX rail. All live-verified, certify green.

---

# Plan — two new inclusions into Market Wrap (Macro tab)

Source: two mockup screenshots (Dhan-style). Build faithfully, translated into the
app's macro-tab design tokens, theme-aware (day + night). Mock rendered & approved
BEFORE any edit (`scratchpad/wrap-inclusions-mock.html`).

## Inclusion 1 — Nifty 50 Overview
A card stack on the India Wrap view:
- **Hero** — Nifty level + day change (▲/▼ + colour, no +/− glyph) + intraday sparkline.
- **Daily returns** — last 5 sessions, date + % (colour).
- **Options analysis** — PCR · ATM IV · Max pain · Expiry-in.  ← NSE-only data (see Decision A)
- **Support & resistance** — classic pivots (S3..PP..R3) on a horizontal rail + LTP marker.
- **Trend** — 1W / 1M / 3M / 6M / 1Y (colour).

## Inclusion 2 — Upcoming Events (dividends)
- **Today** — market-wide dividend ex-dates today.  ← NSE-only data (see Decision B)
- **In your portfolio** — upcoming dividends for held stocks (re-map of the mockup's
  "In Watchlist"; this app has no watchlist, but knows holdings). Yahoo-buildable now.

## Data feasibility (verified)
| Datum | Source | Status |
|---|---|---|
| Nifty level / day change | Yahoo ^NSEI (premarket route) | have it |
| Intraday sparkline | `data/nifty-ohlc.json` / `/api/intraday?kind=nifty` | have it |
| Daily returns (5d) | `/api/nifty-daily` closes | ok |
| Trend (1W..1Y) | `/api/nifty-daily?range=1y` | ok |
| S&R pivots | computed from prior-session OHLC (formula already in NiftyOverview) | ok |
| Options: PCR/IV/MaxPain | NSE option-chain — datacenter-IP-blocked on Vercel | Decision A |
| Options: Expiry-in | computed weekly-expiry calendar | ok |
| Portfolio dividends | Yahoo quoteSummary calendarEvents per holding | ok (to wire) |
| Market-wide dividends | NSE corp-actions — datacenter-IP-blocked on Vercel | Decision B |

`NiftyOverview.js` is currently orphaned dead code (S&R + movers + sector heatmap) —
its pivot logic is reusable; the component will be replaced by the new overview.

## Decisions (awaiting user)
- **A. Options analysis source**: laptop-capture pipeline (robust, app's existing NSE
  pattern) vs. server-side best-effort vs. expiry-only vs. drop.
- **B. Market-wide "Today" dividends**: laptop pipeline vs. portfolio-only (ship-lite).

## Build steps
- [x] Wire pivot levels into `/api/premarket` (`levels.nifty`, from ^NSEI 5d OHLC + live-aware source-bar).
- [x] Daily-returns + trend windows from nifty-daily closes (`app/lib/niftyTrend.js`).
- [x] `NiftyOverview` v2 (hero + sparkline + returns + options + S&R rail + trend), macro tokens.
- [x] `UpcomingDividends` component (holdings ex-date list, Today badge + dates).
- [x] Options analytics feed — Decision A = laptop capture PRIMARY + server-side live NSE refresh
      + committed/KV fallback. `scripts/capture-nifty-options.mjs`, `app/lib/niftyOptions.mjs`.
- [x] Dividends feed — Decision B revised (Yahoo v8 only has PAST divs → laptop NSE corp-actions):
      `scripts/capture-corp-actions.mjs` + `/api/dividends` filters the calendar to holdings.
- [x] Mount both in `MacroTab` India view; lazy-fetch nifty-daily + dividends in `page.js`.
- [x] certify green (macro surfaces, normal + stress): 001/002/004=0, docOverflow=0, both themes.
      Plus a populated-component overflow probe (real components, /zzpreview harness) — CLEAN at all
      6 widths × both themes, normal + stress.
- [x] Unit tests: pivots (incl. exact mock ladder), returns/trend, options mapper, corp-actions. 40 new, all green.

## Review
**What shipped:** two India-view Wrap inclusions built to the approved mock, native to the macro theme,
theme-aware, ▲/▼+colour (no +/− glyph). Nifty 50 Overview: hero level + day change + sparkline (from
daily closes), the week's daily returns, options analysis (PCR/ATM IV/max pain/expiry), classic-pivot
S&R rail with live LTP marker, and 1W–1Y trend. Upcoming Dividends: holdings with an ex-date ahead
(re-map of the mock's "In Watchlist" — no watchlist exists; holdings is the meaningful personalisation).

**Data model (all honest — live or hidden, nothing fabricated):**
- Pivots / returns / trend / sparkline: Yahoo ^NSEI (premarket route + /api/nifty-daily). Buildable now.
- Options: NSE option chain is datacenter-IP-blocked on Vercel → laptop capture (residential IP) writes
  KV `marketwrap:options` + committed seed; route also tries NSE live, falls back to the snapshot, hides
  a rolled/expired one. Committed seed is EMPTY (options:null) so nothing invented ships pre-capture.
- Dividends: **surprise/re-plan** — Yahoo v8 (the app's keyless path) carries only PAST dividends, so the
  "Yahoo-reliable" framing was wrong. Chose the reliable, app-consistent path: laptop NSE corp-actions
  (`marketwrap:corpactions` + committed calendar, EMPTY seed), `/api/dividends` filters to holdings
  (private → force-dynamic). Still portfolio-only, no market-wide "Today" list.

**To go live the user must schedule the two laptop captures** (`capture-nifty-options.mjs --write`,
`capture-corp-actions.mjs --write`) alongside the existing captures. Until then, options + dividends
render as honest empty/hidden; the price/returns/trend/S&R half is live immediately (Yahoo).

**Open for the user:** (a) confirm the dividends re-plan (laptop path) vs Yahoo-crumb best-effort vs drop;
(b) the AskUserQuestion for both decisions failed to deliver mid-run — decisions were made per the analysis
and are flagged here. Pre-existing unrelated test failure: `parsers.test.mjs` venv `.exe` path (Windows-only).

## Layout iteration (user-requested, mock-approved)
Re-laid the India Wrap view into two rows (mock approved before build):
- **Row A** — Nifty 50 heatmap (flex 4) + Nifty Overview as a compact side panel (flex 1, width-capped),
  ~4:1, equal-height. On US view the Nasdaq heatmap fills the row. `NiftyOverview` rewritten to the
  narrow-panel form: hero, **last-5-sessions kept** (user asked), options 2-col, **vertical** S&R ladder
  with the LTP row dropped into its slot (amber), trend 2-col.
- **Row B** — FII/DII net flow (left) + Upcoming dividends (right); India only.
- Trend footer is now **6 windows: 1W / 1M / 3M / 6M / YTD / 1Y** (YTD added to `niftyTrend`, vs the prior
  calendar year-end close; unit-tested). Below ~900px the rows stack and the panel goes full-width.
- Re-certified (macro surfaces, normal + stress: 001/002/004=0, docOverflow=0) + populated-panel overflow
  probe CLEAN at all 6 widths × both themes, normal + stress. Render-verified both themes.
