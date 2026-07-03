# Business-entity model — trading as a business, one book-valued equity line

Status: **DESIGN LOCKED 2026-07-04 · ADOPTED · NO WIRING.** The equity-LINE build (builder +
page.js) is a separate gated pass. Siblings: `tasks/eod-book-design.md` (the durable book),
`tasks/realised-design.md` (the P&L flow), `tasks/resilience-benchmark.md` (why book-valued holds).

**100% OWNER CAPITAL** — the trading account is wholly owned; owner equity = the full account value.

## The model — two clean separations
Treat the F&O / algo trading operation as a **separate business entity**, not an investment sleeve.

**1. Balance sheet — personal net worth** = personal sleeves + ONE book-valued line for the owner's
stake in the business:
```
Personal NW = (equity + US + MF + FD + PF − loan)          ← personal sleeves, LIVE-marked
            + Trading business equity                       ← ONE book-valued line, "at close · DATE"

Trading business equity = account value + open MTM          (as-of-last-sync; 100% owner)
```

**2. Income statement — business P&L** = realised − charges − expenses = **the Trading tab.** This is
**NOT** mixed into personal investment returns: the personal sleeves' XIRR / CAGR / benchmarks measure
*investing*; the business P&L measures the *trading operation*. Blending them corrupts both.

### Why ONE book-valued line, not a live sleeve
The business's account value is broker-sourced (laptop sync), so **live-marking it makes it silently
stale during absence** → resilience fails (see `resilience-benchmark.md`). A **book-valued** line,
labeled "at close · DATE" and self-correcting on return via the notes, is honestly stale and
return-reconciles like the personal sleeves. **This is the adopted resolution.**

## The figures (2026-07-04)
| Component | ₹ | Source | Auto / Manual |
|---|---|---|---|
| Account value (trading-account cash) | 9.70L | `broker-state.funds` (available + utilized) | **AUTO** (broker sync, laptop) |
| + Open MTM | 0.02L | `broker-state` positions unrealized | **AUTO** |
| **= Trading business equity** | **≈ 9.72L** | | the book-valued line |

Trading business equity ≈ **₹9.72L ≈ ~33% of true personal NW** (₹19.4L personal + ₹9.72L = ₹29.1L;
or ~50% of the current F&O-excluded ₹19.4L). The Mar-2026 ₹2.5L deposit is **owner capital** (was
mislabelled "client"), so it sits inside this equity, not as a deduction. The notional (~₹40.6L
exposure) and the margin (collateral inside the cash balance) are **not** wealth — only `balance + MTM` is.

## Bookkeeping the equity line depends on
| Item | What it is | Recorded / sourced | Auto / Manual |
|---|---|---|---|
| **Account value** | cash in the trading account | `broker-state.funds` → the EOD book | **AUTO** (laptop, as-of-last-sync) |
| **Open MTM** | unrealized on open positions | `broker-state` positions → the book | **AUTO** |
| **Capital contributions** | owner money INTO the business (personal→trading transfer) | broker fund-ledger — Dhan `/v2/ledger` credits + Upstox **Get Payins** | **SEMI-AUTO** — broker-fed |
| **Drawings** | owner money OUT (trading→personal withdrawal) | broker fund-ledger — Dhan `/v2/ledger` debits + Upstox **Get Payouts** | **SEMI-AUTO** — broker-fed |
| **Business expenses** | account-level charges (DP/margin-interest/…) + brokerage + data/software | Dhan ledger charge narrations **AUTO** + fno-ledger charges; other **MANUAL** | **SEMI** |

**The one NEW artifact the model requires — a contributions/drawings ledger (SEMI-AUTO).** The account
value drifts with BOTH business P&L *and* owner capital moves, indistinguishably: a ₹X transfer INTO the
account looks like a ₹X "gain." A contributions/drawings ledger separates capital moves from earned P&L
(else both the business P&L and the equity growth are wrong). The broker exposes the fund-transfer events
via API, so this ledger is **SEMI-AUTO**: fund-ins → contributions, fund-outs → drawings; no owner/client
ambiguity (100% owner). Built by `scripts/build-trading-ledger.mjs`.

### Broker fund-ledger sources — LIVE-VERIFIED 2026-07-04
| Broker | Endpoint (verified) | Response fields (verified) |
|---|---|---|
| **Dhan** (s01) | `GET https://api.dhan.co/v2/ledger?from-date=&to-date=` — **YYYY-MM-DD, ≤1-month chunks** (wider → HTTP 500), retry per month | `dhanClientId, narration, voucherdate, exchange, voucherdesc, vouchernumber, debit, credit, runbal` |
| **Upstox** (s02) | `GET https://api.upstox.com/v2/user/payments/payin` and `…/payout` — last 20 txns; **funds-service window 5:30 AM–12:00 AM IST** | `amount, mode, status, currency, bank_name, transaction_id, created_at` |
| **Fyers** (s02) | funds/statement API — only if it ever holds capital (₹0 today) | — |

**Dhan classification — verified against the FULL 2024→ history (the 3a build):**
| `narration` | → ledger type |
|---|---|
| `Funds Deposited` | **contribution** (credit) |
| `Funds Withdrawal` | **drawing** (debit) |
| `Monthly Settlement` · `Quarterly Settlement` | **drawing** (SEBI running-account auto-sweep to bank) |
| `Trades Executed` | **realised** — *not summed* (F&O-margin-polluted); realised is DERIVED from the balance identity |
| `DP Transaction Charges` · `Delayed Payment Charges` · `Margin Interest` · `Auto square off/Call & Trade Charges` · `Bank Update Charges` · `Intraday Square Off Charges` · `SLB Fees` | business **expense** (account-level) |
| `Other Debit` / `Other Credit` | tiny broker adjustments (net +₹88 over the whole history); surfaced |
| `OPENING BALANCE` / `CLOSING BALANCE` | **the `credit` field = the cash balance** — opening + latest closing are the reconciliation ground-truth |

The recent-month verify only saw `Monthly Settlement` + two charge types; the full-history pull surfaced
`Quarterly Settlement`, five more charge narrations, and `Other Debit/Credit` — **why the classifier is
verified over the whole history, and why unrecognised narrations are surfaced, not dropped.**

### Reconciliation (cash tie-out → drift flag)
The Dhan `CLOSING BALANCE` credit is the **authoritative cash balance** (verified = live `fundlimit`
within ₹1,730). Realised can't be summed from `Trades Executed` (daily F&O-margin block/release pollutes
the credit/debit); instead it is **DERIVED**:
```
realised            = ledgerCash − opening − netCapital + expenses          (complete, full-history)
owner equity        = account value (dhanFunds) + open MTM                  (100% owner, no client)
cash tie-out drift  = dhanFunds − ledgerCash  →  snapshot-timing only (~₹1,730)
```
A drift beyond a few ₹k flags a broker-state/ledger inconsistency (a missed event) — surfaced, never
absorbed. (Earlier a naïve `Σ Trades Executed` undercounted realised by ~₹49k → a false ₹51k "drift";
anchoring on the CLOSING BALANCE collapses it to the ~₹1,730 timing residual.)

## Income statement (the Trading tab = business P&L)
Business P&L = **realised − charges − expenses**, per FY / month / day — already the Trading tab:
- **Realised** = `fno-ledger` `grossRealised` (broker) — see `realised-design.md`. 100% owner.
- **Charges** = est → real via `ledger:fno:overlay` (notes) — the ~6% EOD refinement.
- **Expenses** = brokerage (in charges) + account-level Dhan-ledger charges + data/software (MANUAL).

Stays separate from personal investment returns by construction.

## Tax note — confirm with CA, do NOT rely on this
F&O in India is *generally* treated as **non-speculative business income** (not capital gains): slab
rates, **ITR-3**, business expenses deductible, losses carried forward 8 years. Aligns with the
business-entity treatment. **⚠ Unverified — confirm the exact treatment (turnover computation, tax-audit
u/s 44AB thresholds, presumptive 44AD options) with a CA before relying on it.** The bookkeeping above
is the prerequisite for whatever the CA confirms — the model produces the records; it does not decide the tax.

## How F&O enters NW — ONE book-valued rollup line (SUPERSEDES the old a/b)
F&O enters personal NW as a SINGLE book-valued line:
- The EOD-book build (`scripts/build-eod-book.mjs`) computes `TRADING_EQUITY = account value + open MTM`
  → stored as a book line.
- The book's `netWorth` = personal sleeves − loan **+ TRADING_EQUITY**.
- `page.js` renders it as a labeled **"Trading business equity · at close DATE"** line — **book-valued,
  NOT live-marked** — beside the Sub-step B personal-sleeves fallback.

**DESIGN ONLY this pass.** The builder change (add `TRADING_EQUITY`) + the page.js NW change is a
**separate gated build** — value-check (equity vs hand-computed account value + MTM) + `certify.mjs`
normal+stress + screenshots, held for read before main, exactly like Sub-step B.

## Status
Design locked + adopted. Builder + `page.js` untouched for the equity line. The 3a contributions/drawings
ledger is built (dormant). The equity-LINE build (3c) is a separate design→build→gate pass.
