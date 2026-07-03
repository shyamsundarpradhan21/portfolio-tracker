# Business-entity model — trading as a business, one book-valued equity line

Status: **DESIGN LOCKED 2026-07-04 · ADOPTED · NO WIRING.** The equity-LINE build (builder +
page.js) is a separate gated pass. Siblings: `tasks/eod-book-design.md` (the durable book),
`tasks/realised-design.md` (the P&L flow), `tasks/resilience-benchmark.md` (why book-valued holds).

## The model — two clean separations
Treat the F&O / algo trading operation as a **separate business entity**, not an investment sleeve.

**1. Balance sheet — personal net worth** = personal sleeves + ONE book-valued line for the owner's
stake in the business:
```
Personal NW = (equity + US + MF + FD + PF − loan)                 ← personal sleeves, LIVE-marked
            + Trading business equity                              ← ONE book-valued line, "at close · DATE"

Trading business equity = own account value + open MTM
                          − client capital − business liabilities  (as-of-last-sync)
```

**2. Income statement — business P&L** = realised − charges − expenses = **the Trading tab.** This is
**NOT** mixed into personal investment returns: the personal sleeves' XIRR / CAGR / benchmarks measure
*investing*; the business P&L measures the *trading operation*. Blending them (e.g. adding F&O realised
into the Indian-equity return) corrupts both.

### Why ONE book-valued line, not a live sleeve
The business's account value is broker-sourced (laptop sync), so **live-marking it makes it silently
stale during absence** → resilience fails (see `resilience-benchmark.md`). A **book-valued** line,
labeled "at close · DATE" and self-correcting on return via the notes, is honestly stale and
return-reconciles like the personal sleeves. **This is the adopted resolution.**

## The figures (2026-07-04)
| Component | ₹ | Source | Auto / Manual |
|---|---|---|---|
| Own account value (trading-account cash) | 9.70L | `broker-state.funds` (available + utilized) | **AUTO** (broker sync, laptop) |
| + Open MTM | 0.02L | `broker-state` positions unrealized | **AUTO** |
| − Client capital (liability) | 2.50L | `ALGO.s01.split.client` | **MANUAL** (hand-set) |
| − Business liabilities (accrued client profit-share owed + any borrowing) | ~0 (TBD) | derived / manual | **SEMI / MANUAL** |
| **= Trading business equity** | **≈ 7.22L** | | the book-valued line |

Trading business equity ≈ **₹7.22L ≈ ~27% of true personal NW** (₹19.4L personal + ₹7.22L = ₹26.6L;
or ~37% of the current F&O-excluded ₹19.4L). Cross-check: `STATIC.algo` ₹7.3L = the *allocated* own
capital (s01.own 390k + s02.own 340k) — close to the account-derived equity, so the two reconcile.

**Client capital (₹2.5L) is a LIABILITY** — the business owes it back to clients. It is NOT owner
equity and NOT in personal NW. Neither is the notional (~₹40.6L exposure) or the margin (collateral
inside the cash balance) — only `balance + MTM − liabilities` is owner wealth.

## Bookkeeping the equity line depends on
| Item | What it is | Recorded / sourced | Auto / Manual |
|---|---|---|---|
| **Account value** | cash in the trading accounts | `broker-state.funds` → the EOD book | **AUTO** (laptop, as-of-last-sync) |
| **Open MTM** | unrealized on open positions | `broker-state` positions → the book | **AUTO** |
| **Client capital** | clients' principal (liability) | `ALGO.split.client` (`portfolio:v1`) | **MANUAL** — update when a client adds/withdraws |
| **Capital contributions** | owner money INTO the business (personal→trading transfer) | a NEW manual contributions/drawings ledger (or broker deposit records) | **MANUAL (new artifact)** — raises equity + cash |
| **Drawings** | owner money OUT (trading→personal withdrawal) | same ledger (or broker withdrawal records) | **MANUAL** — lowers equity + cash |
| **Business liabilities** | accrued client profit-share owed (client's % of client-attributable profit) + any business borrowing | profit-share derived from business P&L × `clientProfitShare`; borrowings manual | **SEMI** — the app's `algoOwnFactor` already splits own vs client |
| **Business expenses** | brokerage/charges + data/software/other | charges **AUTO** (notes → `ledger:fno:overlay`); other **MANUAL** | **SEMI** |

**The one NEW artifact the model requires — a contributions/drawings ledger.** Today the account
value drifts with BOTH business P&L *and* owner capital moves, and they're indistinguishable: a ₹X
transfer INTO the account looks like a ₹X "gain." The equity line needs a contributions/drawings
ledger to separate capital moves from earned P&L (else the business P&L and the equity growth are both
wrong). This is manual (or derived from broker deposit/withdrawal records if the broker exposes them).
Everything else is already sourced (account value + MTM auto; client capital + the own/client split
already in `ALGO`).

## Income statement (the Trading tab = business P&L)
Business P&L = **realised − charges − expenses**, per FY / month / day — already the Trading tab:
- **Realised** = `fno-ledger` `grossRealised` (broker) — see `realised-design.md`.
- **Charges** = est → real via `ledger:fno:overlay` (notes) — the ~6% EOD refinement.
- **Expenses** = brokerage (in charges) + other business expenses (data/software — MANUAL, not yet tracked).
- **Own vs client** = `algoOwnFactor` (`ALGO.split`) — the owner keeps own-P&L + the client-profit-share cut.

Stays separate from personal investment returns by construction.

## Tax note — confirm with CA, do NOT rely on this
F&O in India is *generally* treated as **non-speculative business income** (not capital gains): taxed
at slab rates, filed under **ITR-3** as business income, with business expenses (brokerage, data,
etc.) deductible and losses carried forward 8 years / set off against non-speculative income. This
aligns with the business-entity treatment (income statement + business equity + expense tracking).
**⚠ Unverified flag — confirm the exact treatment (turnover computation, tax-audit u/s 44AB
thresholds, presumptive 44AD options, client-money/PMS implications) with a CA before relying on it.**
The bookkeeping above (P&L, expenses, contributions/drawings, client liability) is the prerequisite
for whatever the CA confirms — the model produces the records; it does not decide the tax.

## How F&O enters NW — ONE book-valued rollup line (SUPERSEDES the old a/b)
The earlier a/b (live-mark F&O sleeve) is **superseded**. F&O enters personal NW as a SINGLE
book-valued line:
- The EOD-book build (`scripts/build-eod-book.mjs`) computes a `TRADING_EQUITY` value
  = own account value + MTM − client capital − business liabilities → stored as a book line.
- The book's `netWorth` = personal sleeves − loan **+ TRADING_EQUITY** (the one line).
- `page.js` renders it as a labeled **"Trading business equity · at close DATE"** line in the NW
  breakdown — **book-valued, NOT live-marked** — sitting beside the Sub-step B personal-sleeves
  fallback (forward-compatible foundation).

**DESIGN ONLY this pass.** The builder change (add `TRADING_EQUITY`) + the page.js NW change (add the
line) is a **separate gated build** — value-check (equity vs broker) + `certify.mjs` normal+stress +
screenshots, held for read before main, exactly like Sub-step B.

## Status
Design locked + adopted. Builder + `page.js` untouched. The equity-LINE build is a separate
design→build→gate pass. Sub-step B (personal-sleeves close-fallback) ships independently as the
foundation this line sits beside.
