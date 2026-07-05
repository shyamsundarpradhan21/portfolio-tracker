# EOD-book design — the durable, reconciled daily anchor

Status: **DESIGN LOCKED 2026-07-03 · WIRING HELD (no behavior change yet).**
Prereqs already landed: dead `broker-state.ltp` retired (Yahoo is the sole live equity pricer;
the broker never prices). Background: `tasks/value-lineage-audit.md` (capture families F1–F6),
and the CLAUDE.md "Source of truth per datum" table (the settled roles this doc implements).

## Why this exists
Today the app re-fetches live every render — **nothing persists a per-holding close**, so
there is no durable, reconcilable anchor and no laptop-off net-worth base. The EOD book is
that anchor: the single **reconciled daily record** (composition + close values + the day's
contract-note charges/trades), durable in a gitignored private JSON, diffable against broker
statements.

## The settled two-layer model this implements
- **Book of record (this doc):** EOD close, durable, reconcilable — the anchor.
- **Live overlay (unchanged):** `/api/quotes` (Yahoo) is the **sole** live pricer, marking the
  book's holdings for a *labeled* "live" net-worth. Book = reconcilable close; overlay = intraday mark.

Source-of-truth roles (locked): equity composition PRIMARY = contract notes + `applyCorpActions`
(reconstructs 17/20); **broker sync = periodic checkpoint** folded into this build, with three
jobs — (a) sole source of F&O open positions, (b) catch un-noted equity delivery buys,
(c) reconcile the note-covered ~85% and FLAG drift. MF = AMFI, FD = formula, US = private/vests.

## Artifact — `data/eod-book.json` (gitignored, private-JSON pattern, NOT KV)
Durable + diffable against statements. One record per trading day.

```
{ version, days: { "<date>": {
  asOf,                                   // ISO+05:30 of the build
  sleeves: {
    INDIAN:[{sym, qty, cost, close, value, src:"yahoo"}], SWING:[…],
    US:[{sym, qty, cost, closeUsd, fx, value, src:"yahoo"}],
    MF:[{id, units, cost, nav, navDate, value, src:"amfi"}],
    FD:[{id, principal, rate, value, src:"formula"}], CMPF:[{value, src:"accrual"}],
  },
  netWorth,
  reconcile: {                            // the day's gmail-parsed notes, folded in
    notes:[{cn, broker, charges, trades, confidence:"clean|partial"}],  // ledger:cn:* trade_date==date
    chargesReal, tradesCount,
    unreconciled:[{broker, reason}],      // that day's DEFERRED (checksum-fail) notes — kept visible
    drift:[{sleeve, sym, brokerQty, noteReconQty, delta, kind:"un-noted (broker)"}]  // ← broker-reconcile step
  }
}}}
```

## Build job — `scripts/build-eod-book.mjs` (or folded into `/api/snapshot`)
Trigger: **03:00 IST** (after the US close) — the existing growth-cron window; one job captures
the whole day. Per-instrument close cadence (levels, not day-deltas):
- **equity** = Yahoo close × qty · **MF** = AMFI daily NAV · **FD** = formula · **CMPF** = accrual
  — the same sources `equity.mjs` / `mf.mjs` / `fd.mjs` / `cmpf.mjs` already use.
- **composition** = contract-note reconstruction (`ledger:cn:*` + `applyCorpActions`) for equity,
  private JSON for US/MF/FD.

### The reconcile fold (single reconciled daily record)
Pull the day's contract notes (`ledger:cn:*`, `trade_date==date`) → charges/trades into
`reconcile.notes`; surface that day's **deferred** (checksum-fail) notes as `reconcile.unreconciled`
— so the book carries what didn't reconcile, visible (same discipline as the unresolved report).

> **TODO (fold in when this build is un-HELD — belt & braces for the F&O charge overlay):**
> the 03:00 build already reads the day's `ledger:cn:*`, so it should also refresh
> `ledger:fno:overlay` — run `scripts/contract-parser/build-fno-overlay.mjs --write` (or inline
> `emitOverlay`) as the final reconcile step, so real charges are never stale even if the ingest
> daemon missed the note (the daemon already chains this after each contract-note PASS as of
> 2026-07-05; this is the scheduled backstop). NOT wired now — the EOD build itself is HELD, so
> no new scheduled task; this marker is the reminder. See `tasks/fno-overlay-and-daycurve-prompt.md`.

### The broker-reconcile step (the checkpoint)  ← ADDED
After the note-reconstructed composition is built, **snapshot the broker truth**
(`broker-state.json` holdings + F&O positions) and **diff it against the note-reconstructed
composition**. Any per-holding delta is written into `reconcile.drift[]` as
`kind:"un-noted (broker)"` — the broker qty the notes couldn't explain. This is where the
broker's three jobs land:
- (a) **F&O open positions** are copied wholesale from the broker (notes can't derive point-in-time opens);
- (b) **un-noted equity delivery buys** appear as `drift` (the checkpoint catches what the note pipeline missed);
- (c) the note-covered ~85% shows **zero drift**; any non-zero drift is FLAGGED for a chase.

**The 3 current gaps MUST appear in `drift[]`**: `ZYDUSLIFE` (~32) + `PRICOLLTD` (~50) on
Zerodha (INDIAN) and `BANKBARODA` (28) on Upstox (SWING) — the delivery buys with no captured
note. If they don't surface, the reconcile step is broken.

## Live overlay — unchanged
`/api/quotes` stays the sole live pricer. Market-open ⇒ net-worth = book holdings × live quote
(labeled "live"); market-closed / quotes-stale / laptop-off ⇒ net-worth = the book's close (the
durable anchor — also fixes the current "unvalued when Yahoo fails"). No new pricer; the broker
still never prices.

## prevClose unification (the deferred (c)) — NOT warranted
Measured: `/api/quotes` and `equity.mjs` share the identical Yahoo endpoint + `chartPreviousClose`;
the two curve tiers matched to ₹0.01 every day; the only qty diff (CUB 141→188) is the bonus corp
action. **No day% drift exists to fix**, so deriving `prevClose` from the book's prior close is
unnecessary. (If ever wanted for single-source cleanliness, the book's prior close could serve —
cosmetic, not a fix.)

## Blast radius / rollback
- **Building the book: additive + DORMANT** — new script + gitignored artifact + (optional) cron;
  **nothing reads it until wired** (the "dormant Phase 2c overlay" pattern). Zero effect on the live app.
- **Wiring it** (labeled-live + close-fallback in `page.js` + a book loader in `serverPortfolio`):
  the HELD step — net-worth is the headline, so it needs a value re-check + `certify.mjs` (data change).
- **Rollback:** delete the artifact + script (dormant → nothing depends on it) or revert the cron. Trivial.
- **Untouched:** `/api/quotes`, composition inputs, MF/FD sources.

## Future sleeve — `TRADING_EQUITY` (business-entity model, ADOPTED 2026-07-04)
A future book line will carry the owner's stake in the trading business as a SINGLE **book-valued**
value: `account value + open MTM` (from `broker-state.funds` + positions; 100% owner — no client). The
book's `netWorth` then becomes `personal sleeves − loan + TRADING_EQUITY`. This is the F&O-into-NW
resolution — a book-valued rollup, **NOT** a live-marked sleeve (which would break long-absence
resilience). It **supersedes** the earlier a/b live-mark follow-on. Full spec + bookkeeping
(contributions/drawings ledger): `tasks/business-entity-model.md`.
**DESIGN ONLY — not in the builder or `page.js` yet; a separate gated build.**

## Resilience benchmark
The long-absence (6-month-vacation) stress test lives in `tasks/resilience-benchmark.md`: value
survives on cloud pricing, composition is static except corp-action drift (caught here on return),
and the broker-reconcile step below **is** the return-reconcile that heals the note/realised backlog.
The `TRADING_EQUITY` line above is book-valued precisely so it return-reconciles the same way.

## Open follow-up (not part of this design)
Close the 3 equity gaps at source — chase the missing delivery notes (ZYDUSLIFE/PRICOLLTD on
Zerodha, BANKBARODA on Upstox) into `inbox/` so the note pipeline reconstructs them and the
drift clears. Tracked in `tasks/todo.md`.
