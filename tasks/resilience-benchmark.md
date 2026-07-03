# Long-absence resilience benchmark — the 6-month-vacation test

Status: **ANALYSIS + DESIGN 2026-07-03 · WIRING HELD.** The stress test the two-layer model
(`tasks/eod-book-design.md`, `tasks/realised-design.md`) must survive: *laptop off for 6 months,
you open the app from a beach.* What's live, what's stale, what self-heals.

## 1. Where the ingest runs — CLOUD vs LAPTOP (the deciding fact)
**Gmail ingest = LAPTOP. Fetch AND parse both die with the laptop.**

| Job | Location | Trigger |
|---|---|---|
| `IngestDaemon` (Gmail Pub/Sub pull + `inbox/` watch → parser → manifest) | **LAPTOP** | Task Scheduler, at-logon, always-on |
| `IngestWeeklyReport` (completeness/gap report) | **LAPTOP** | Task Scheduler, Sun 10:00 |
| `contract-parser/run.py` (the parse) | **LAPTOP** | invoked by the ingest daemon; **Python** |
| `CaptureIntraday*` (10s realised/price tapes) | **LAPTOP** | Task Scheduler, market hours |
| `BrokerSyncEvening` (18:30 realised ledger) | **LAPTOP** | Task Scheduler, 18:30 |
| **`/api/snapshot` (growth day-change)** | **CLOUD** (Vercel cron) | `vercel.json` `30 21 * * *` (03:00 IST) — the **only** cloud cron |
| **`/api/quotes`, `/api/mf-nav`, `/api/portfolio`** | **CLOUD** (Vercel serverless) | per request |

Why laptop: the ingest needs the Gmail OAuth token (`mcp/gmail/.client_secret.json`) + broker
tokens, kept local by the **locked privacy posture** ("LOCAL streaming-pull daemon; no public
webhook; PANs stay local"). The parser is Python with PDF deps. Nothing about the note pipeline
touches the cloud today.

## 2. Per-sleeve vacation behavior (laptop off 6 months)

### Value (equity / US / MF / FD) — **SURVIVES (cloud)**
The app is on Vercel; opening it hits serverless routes, no laptop needed:
- Equity/US price: `/api/quotes` (Yahoo) — cloud ✓
- MF NAV: `/api/mf-nav` (AMFI) — cloud ✓
- FD: `compound()` formula, in-app — cloud (no fetch) ✓
- Growth chart: `/api/snapshot` cron keeps writing `growth:<date>` for equity/MF/FD from **static
  composition × live prices** ✓ (reads committed `broker-state.json` via static import + KV
  `portfolio:v1` — both frozen but present).

Net worth renders live off cloud pricing × the last-seeded composition. **The headline number is
trustworthy on the beach.** (Caveat: intraday/Day-curve views go stale — KV tapes are TTL-3d so
they expire, and the committed archives are frozen at the last laptop commit. Value ≠ intraday.)

**Why the F&O staleness doesn't matter — the LOAD-BEARING reason.** Value survives not merely
because pricing is cloud, but because **deployed algo (F&O) capital is <1% of net worth.** The
99%+ that moves the headline — equity, US, MF, FD — is priced cloud-side off static composition;
the one sleeve that *does* go stale during absence (F&O positions + realised) is a **rounding error**
on net worth. Cloud pricing carries the 99%; the <1% F&O staleness is immaterial. **This — not the
resilience of the ingest pipeline — is the real reason the beach number holds.** The pipeline being
laptop-side would matter if F&O were a material fraction; it isn't (see the revisit trigger below).

### Composition — **STATIC, one drift source**
KV `portfolio:v1` is frozen at the last seed. If not trading manually, composition holds.
**The one drift source during absence = corporate actions** (a bonus/split changes the broker qty;
`CORPORATE_ACTIONS` in the frozen book can't record it, so `applyCorpActions` can't reconstruct it →
the app's qty silently lags the broker). **Caught on return** by the broker-reconcile step
(`eod-book-design.md` → `reconcile.drift[]`; `reconcileSleeve` drift flag) — the return checkpoint
snapshots broker truth and flags the un-recorded action. Algo F&O *positions* also drift (algos keep
trading broker-side) but `broker-state.json` is frozen → the app shows stale positions until the
laptop resyncs.

### Realised + charges — **FROZEN during, RECOVERED on return (return-reconcile)**
Algos keep trading (broker-side automation) → realised accrues, and the broker **emails a contract
note per trade** (permanent, in Gmail). But every capture path is laptop (10s tape, 18:30 ledger,
IngestDaemon) → all dead. The broker's `realizedProfit` **resets daily**, so the live realised is
lost each day it isn't captured. **The contract notes in Gmail are the only durable record of the
6 months of trading** — and because ingest is laptop, they are recovered **on return, not
continuously**: laptop boots → IngestDaemon fetches the backlog → parser reconstructs realised
(from fills) + charges → `fno-ledger` / overlay backfilled → the 6-month hole fills in one
reconcile. **Nothing is lost — it's deferred.** During the vacation the app's realised shows the
last pre-departure value.

**So, per the question:** realised recovery is a **return-reconcile** (laptop ingest), not
continuous — because the ingest is laptop-side.

**Return-reconcile, quantified.** It is a **single automated batch run**, not a manual slog: the
laptop boots → `IngestDaemon` fetches the accumulated Gmail backlog → the parser reconciles it into
`ledger:cn` + the charge overlay in one pass (the same engine that cleared 821 notes; no per-note
hand-holding). At the current algo cadence (**~19.6 notes/month** over the 45.7-month history,
**8.2% checksum-deferred**), a **6-month gap accumulates ~117 notes → ~108 auto-reconcile, ~10 land
in deferral-triage** (the F&O-margin / small-delta cluster — carried visible, not blocking). The
batch parse itself is minutes; the only human cost is reviewing the deferrals, which **scales
~linearly with absence** (~1.6 deferred/month → ~10 for six months, ~20 for a year). **A 6-month
absence costs one automated run + a ~10-note triage** — trivial against zero data loss.

## 3. Recommendation — ingest location

The note pipeline is **already the durable spine**: Gmail holds every contract note forever, so a
6-month (or 2-year) absence loses *nothing* — the return-reconcile reconstructs composition,
realised, and charges from the fills. The only question is *when* it heals: continuously (cloud) or
on return (laptop). Weigh the two:

| | Continuous (move ingest cloud) | Return-reconcile (keep laptop) — **recommended** |
|---|---|---|
| Realised during vacation | live | frozen (recovered on return) |
| Value/net-worth during vacation | live | **live either way** (cloud pricing) |
| Data loss risk | none | **none** (notes durable in Gmail) |
| Lift | **HIGH** | **ZERO** (already the design) |
| Privacy | **breaks the locked posture** | preserved |

**Lift to move ingest cloud-side (HIGH, ~weeks + a posture change):**
- **Gmail fetch → cloud:** a Vercel cron with a stored OAuth refresh token (a Gmail credential in
  Vercel env) or Pub/Sub → public webhook. Medium — but puts a Gmail token in the cloud.
- **Parser → cloud:** `run.py` is **Python with PDF deps (pdfplumber, …)** — Vercel's Python runtime
  is size/dep-constrained, so this is fragile, or a full Node port (large). High.
- **Privacy:** contract notes carry **PANs**; parsing them in the cloud means PANs transit + land in
  Vercel logs/KV — this **directly violates the locked "PANs stay local"** decision. Needs a
  redaction-before-store redesign + security review. High.

**Recommendation: accept the return-reconcile.** Rationale: (a) the notes are already the durable
spine — zero loss for any absence length; (b) **net worth already survives** on the beach via cloud
pricing, so only the *trading/realised* view is stale, which is low-stakes while away; (c) the cloud
move is weeks of work **and** breaks the privacy posture, for the marginal benefit of live realised
during a vacation you're presumably not day-trading through; (d) one return-reconcile (the same
EOD-book reconcile step) recovers everything.

**If live-realised-during-absence is later deemed a hard requirement,** the privacy-preserving
minimum is **archive-only in the cloud** (a Vercel Gmail poll that just *counts/stores the raw note*
so you can see trading is happening remotely) while the **PAN-parsing stays laptop-side** on return
— you learn "algos traded N times" remotely without decrypting PANs in the cloud. Full realised
still return-reconciles. That's a fraction of the full-cloud lift with no posture change.

## REVISIT TRIGGER
This recommendation is load-bearing on **deployed algo (F&O) capital being <1% of net worth** — the
reason F&O staleness is a rounding error today. **When that fraction becomes material** (the algo
book is scaled up, or net worth otherwise concentrates in F&O), the stale-F&O sleeve **stops being
a rounding error**: a multi-month blind spot on live realised/positions turns into a real mismark on
the headline. **At that point, revisit the ingest location:**
- First step up to **cloud archive-only** (remote visibility that the algos are trading; PANs still
  parsed on return) — the privacy-preserving minimum.
- Escalate to **full cloud-ingest** only if live realised *during* absence becomes a hard
  requirement, accepting the Python-parser-on-Vercel lift + the PANs-in-cloud posture change.

**Tripwire:** when the F&O sleeve's plausible absence-drift could move headline net worth beyond
your acceptable error band (today: immaterial at <1%). Re-run this benchmark whenever the algo
capital allocation is increased.

## Cross-link
This is the resilience benchmark for the same live-overlay / durable-anchor architecture in
`tasks/eod-book-design.md` (composition + close values) and `tasks/realised-design.md` (realised
flow). The **return-reconcile** here *is* the EOD-book reconcile step — one mechanism heals
composition drift (corp actions), provisional equity realised, and the realised/charge backlog
together.

## Status
Analysis + design only. All wiring HELD. No code changed.
