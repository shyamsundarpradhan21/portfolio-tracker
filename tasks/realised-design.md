# Realised P&L — instant-on-close design

Status: **DESIGN ONLY 2026-07-03 · WIRING HELD** (no behavior change). Sibling of
`tasks/eod-book-design.md` — the **same live-overlay / durable-anchor architecture**, applied
to the realised-P&L *flow* instead of the composition *snapshot*.

## Current path (confirmed)
- **F&O realised *value* = broker sync.** `sync-brokers.mjs` reads broker positions
  `realizedProfit` / `realised` / `realized_profit` (`brokers.mjs:106/130/154`) → writes
  `grossRealised` into `data/fno-ledger.json` (+ `broker-state.positions.realized`). Cadence:
  **BrokerSyncEvening, weekday 18:30 IST**. 18:30 because the broker resets `realisedProfit` the
  next day — 18:30 captures today's before the reset.
- **App reads the DAILY ledger** (not live): `deriveFY` / `pnlDaily.js` / `fnoLedger.js` sum
  `grossRealised`; `fnoLive().realisedToday` (`brokerState.js:49`) reads the 18:30
  `broker-state.json` snapshot. → the realised figure updates **once/day at 18:30**.
- **NOT gmail-gated.** `applyFnoOverlay` (`fnoOverlay.js:13`) overrides only
  `estCharges`→`realCharge` and recomputes `net = grossRealised − realCharge`. **`grossRealised`
  is never touched by a note** — realised value never waits on gmail.
- **Equity realised = seeded** `INDIAN_REALIZED` / `US_REALIZED` (offline tradebook / Vested,
  asOf dates) — manual, not live.

## Instant-on-close design
The broker is **already polled every 10s** by the capture-daemon — the F&O tape carries `realised`
on every point since 2026-06-25 (verified: 380/380 points/day). So this is a **repoint, not a new poll.**

### F&O — TRUTH (broker-reported)
Repoint `fnoLive().realisedToday` from the 18:30 `broker-state.json` snapshot to the daemon's
**live** realised — KV `intraday:<date>` `realised` / per-broker `dhanRealised`… — on the
**existing 12s client poll** (the Day-curve cadence). Realised jumps the instant a leg closes.
**~0 marginal cost:** the poll already runs; this reads what it already writes. **This value is
TRUTH** — the broker reports realised directly; no derivation.

### Equity sell — PROVISIONAL (until EOD reconcile)
The daemon already fetches order fills (`withOrders`, ~1/min). On a SELL fill, derive realised =
`(sellPrice − avgCost) × qty` and surface instantly, **marked PROVISIONAL**. Why provisional:
`avgCost` comes from composition, which has **3 known gaps** (ZYDUSLIFE / PRICOLLTD / BANKBARODA —
see `eod-book-design.md`), so a wrong cost basis yields a wrong realised. **Settle at the EOD
reconcile** against the broker/tradebook. Exposure is small + short-lived: equity delivery sells
are rare (**~8 sell-days/yr, ~4.6 fills those days**).

### Charges
Show **est-charges instantly** (modeled `estCharges`, already in the ledger / derivable per-fill).
Refine to the **real note-charge at EOD** via the overlay (`ledger:fno:overlay`, the ~6%
correction). Realised value **never waits on the note** — only the charge trails, and charges are
a small fraction of gross, so **net realised is ~99%+ accurate instantly**.

## Two-layer (same shape as the EOD book)
| Layer | Source | Dependency |
|---|---|---|
| **Instant — live overlay** | daemon tape `realised` (F&O, truth) + fill-derived (equity, provisional) | daemon + **laptop** + market hours |
| **Durable — book of record** | 18:30 `fno-ledger.json` `grossRealised` | **laptop** (see confirmation ↓) |

### CONFIRMATION — is the durable anchor laptop-independent? **No.**
BrokerSyncEvening (18:30) is a **Windows Task Scheduler job on the laptop**, *not* a cloud cron.
F&O realised **cannot** trivially move to a Vercel cron: the broker poll needs the auth tokens in
`mcp/*/.token.json`, minted by interactive laptop logins and kept **laptop-local by design**. The
`/api/snapshot` cloud cron explicitly **excludes F&O** for exactly this reason ("business income —
the fno-ledger pipeline"). So **both** layers of F&O realised are laptop-bound — the durable
anchor included. Making it laptop-independent would require broker tokens in the cloud (KV / Vercel
env), which the current security posture deliberately avoids.

This is a **known limitation, not a blocker**: the laptop already runs the 18:30 job today, and the
instant overlay adds **no new dependency** the daemon doesn't already have (same laptop, same
market-hours window, same tokens). Contrast the **equity / MF / FD** EOD book, which *can* be a
cloud cron (Yahoo / AMFI / formula, no broker token) — **F&O realised is the exception** that keeps
the realised anchor on the laptop.

## Guardrails
### Guardrail 1 — post-close handoff check
At 18:30, assert the **last intraday tape realised (the 15:32 close point) == the 18:30 ledger
`grossRealised`, to the rupee**, per broker. Both read the same broker `realizedProfit`, so a
mismatch means the daemon missed the close tick OR the broker reset early → **flag it**. This is
the seam where the live overlay hands off to the durable anchor; it must be continuous. (Reuses the
"un-noted drift → flag" discipline from `eod-book-design.md`.)

### Guardrail 2 — provisional vs truth labelling
- **F&O realised = TRUTH** — broker-reported; surface without qualification.
- **Equity realised = PROVISIONAL until reconcile** — depends on `avgCost` composition, which has
  gaps; label it as provisional and settle at EOD. **Never present provisional equity realised as
  final.**

## Cross-link
Same **live-overlay / durable-anchor** architecture as `tasks/eod-book-design.md`:
- EOD book = composition + close *values* (snapshot); this = realised-P&L *flow*.
- Instant tape = live mark · 18:30 ledger = durable record · note = the ~6% charge refinement.
- The EOD-book **reconcile step** is exactly where provisional equity realised settles against the
  broker checkpoint — one reconcile, both concerns.

## Status
Design only. **All wiring HELD** for review. No code changed.
