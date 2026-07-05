# Implementation prompt — duplicate Day-view curve + F&O charge overlay automation (approved 2026-07-05)

Two independent fixes. Both are bug-class (no re-mock needed); fix 1 changes what renders in
one view, so verify visually in both themes + a green `node audit/responsive/certify.mjs`.

## 1. Duplicate intraday curve on Trading Journal → Day view

`app/components/shared/PnlDashboard.js`: `LivePnlGlance` always renders the latest session's
intraday curve; `DayPanel` (Day view, defaults to the newest day) renders the same session
again — identical chart twice on the default Day view.

Fix (approved scope — exactly this, not broader):
- Suppress the GLANCE'S CHART ONLY when `view === 'day'` AND the DayPanel's selected date
  equals the glance's resolved `curveDate`. The Net realised / Charges / Live MTM pills stay
  in all views. Day view on a PAST date still shows both charts (different sessions).
- Implementation: lift/derive the glance's `curveDate` so the parent can compare (e.g. pass
  `suppressCurveFor={view === 'day' ? periodKey : null}` into `LivePnlGlance` and skip the
  chart when it equals its resolved `curveDate`). Don't move the polling logic.

## 2. Charges stuck at ₹0 — automate the overlay rebuild

Root cause: parsing a contract note writes `ledger:cn:*` (ingest daemon), but the app reads
real charges from `ledger:fno:overlay`, which only refreshes via the MANUAL
`scripts/contract-parser/build-fno-overlay.mjs --write`. Not run since the July notes parsed →
July 1–3 Dhan rows read `estCharges: 0` (`source:'positions'`, turnover 0 → modeled fallback 0).

Changes:
a) **Backfill now:** run `node scripts/contract-parser/build-fno-overlay.mjs` (verify), then
   `--write`. NOTE the hardcoded `EXPECT` reconciliation table in that script is dated
   (FY totals move as new notes land) — treat a mismatch that is EXPLAINED by the new July
   notes as fine, and convert `EXPECT` from a hard table to a logged comparison against
   `scripts/ingest-reconcile.mjs` output, or derive it from the recon at runtime. Don't
   let a stale hardcoded table block the write.
b) **Chain it:** in the ingest daemon, after any batch that produces ≥1 successful
   contract-note PASS (`parser === 'contract-note'`, status PASS, tax_entity self), spawn
   `build-fno-overlay.mjs --write` once at the END of the batch (not per file). Log one
   porcelain line (written/skipped + matched counts) into the daemon log; failures are
   non-fatal (warn, don't kill the daemon).
c) **Belt & braces:** also fold the same rebuild into the 03:00 EOD checkpoint script/task
   if one exists today (see tasks/eod-book-design.md — if the EOD build is still HELD, add
   a TODO marker there instead of wiring a new scheduled task).
d) After the write, verify in the LIVE app (not just KV): Trading Journal → Day → 3 Jul 2026
   should show non-zero Charges and Net = Gross − real charges; the all-time Charges pill
   should move. Cross-check one day's charge against the parsed note's NCLFO total.

## Constraints
- tasks/feedback.md rules apply (read it first): atomic writes for any state file touched,
  never hand-edit KV outside the sanctioned writer, charges render NEUTRAL (cost, not P&L).
- Certify green (6 widths × both themes, normal + stress) for fix 1.
- `command -v graphify >/dev/null && graphify hook-rebuild` after code changes.
- Commit to current branch; no push unless told. Append any new lesson to tasks/feedback.md.
