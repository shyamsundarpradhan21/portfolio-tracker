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
