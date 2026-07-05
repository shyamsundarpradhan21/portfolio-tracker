# Plan — Unify "book value return" across the growth chart line and the period tiles (AWAITING APPROVAL, 2026-07-06)

## Problem (verified against the data)
- Chart "Your book" line (`/api/growth?view=growth`, `route.js:209–252`) = cumulative daily
  net of `{eq,us,fd,mf}` from the `growth:<date>` archive — CMPF-excluded, deposit-free,
  365d deep — BUT that archive has sleeve-coverage holes (measured: US 16/30, eq 22/30, mf
  20/30 days in the last month), so it UNDERCOUNTS. That's the ₹22,406.
- Period tiles (`ProjectionTab.growth`, `:373–403`) = whole-NW delta minus deposits vs a
  back-dated `hist` snapshot — INCLUDES CMPF/pension, different basis → different number
  (1M ₹2.14L). Deep history is mostly synthetic ledger-replay backfill (SNAPSHOT.md has 2
  real rows: 06-12, 06-19).
- The two never reconcile: different sleeve set, different method, different data source.

## Why the "just build it from EOD sleeve capture" answer is data-gated (measured 2026-07-06)
- `snapshot-sleeves.json` (per-sleeve {v,i}) = **1 date: 2026-06-19**. `eod-book.json` absent.
- The `attribution` useMemo (`:438–472`) ALREADY computes the per-sleeve, deposit-adjusted
  windowed gain `(v_now−v_start)−(i_now−i_start)` — it's just gated on a window-start `.sl`.
- => Today only MAX is honestly buildable (needs only today's v−i). 1M ≈ +2wk, 3M/6M/1Y months
  out, UNLESS we backfill the per-sleeve history we never captured.

## Target — one deposit-free, CMPF-excluded, investment-book series drives BOTH
- gain(window) = Σ over {eq,us,mf,fd} of (v_now − v_start) − (i_now − i_start)
- MAX = Σ over {eq,us,mf,fd} of (v_now − i_now)   (all-time; needs no history)

## Approach — per-sleeve historical backfill (mirrors the existing whole-NW synthetic backfill)
- [ ] Reconstruct per-sleeve `{v,i}` for past dates:
      eq/swing = contract notes + `applyCorpActions` (≈17/20) × Yahoo closes;
      us = US cashflows/vests × Yahoo × usdInr history; mf = MF_CASHFLOWS × AMFI NAV history;
      fd = `compound()` (no fetch); exclude pf (CMPF).
- [ ] Emit committed per-sleeve series (`snapshot-sleeves.json` / fold into eod-book) ≥ 365d.
- [ ] Server endpoint: windowed investment-book gain per {1M,3M,6M,1Y,MAX} from that series.
- [ ] Tiles read the endpoint (headline + existing `<Waffle>` from one source).
- [ ] Rebuild the chart "Your book" line from the SAME series (replaces the holey daily-net path).
- [ ] Decide the tile % denominator: investment-book value at window start (proposed).

## Verification
- [ ] Chart end value for window X == tile value for window X (exact tie-out).
- [ ] MAX == Σ(v−i) over investment sleeves == existing `totalGains` (₹2.80L).
- [ ] Reconstructed sleeve values render-verified in the LIVE app (raw API is pre-corp-action).
- [ ] `audit/responsive/certify.mjs` green if any tile/chart layout changes.

## Open decision (blocking)
- Backfill now (unlocks all windows immediately) vs let the live capture accrue (MAX now, 1M
  in ~2wk, 1Y next June, zero backfill risk). Awaiting your call before writing code.

## RESOLUTION (2026-07-06) — BUILT, uncommitted, awaiting eyeball
Decisions: Option 1 (accrue, no backfill) + **exclude CMPF everywhere** (user: CMPF lives in
the Allocation + Projection views, not the money-made story). This flipped the fix: no
per-sleeve series needed — the chart own line just moves to the SAME `(nw − invested)` basis
the tiles already use (deep, gap-free, and by construction `nw − invested` = non-CMPF gains).

Changes (3 spots, 2 files):
- `ProjectionTab`: new `ownByDate = {d: nw − invested}` memo from `hist`; passed to `GrowthView`.
- `GrowthView`: non-1D own line drawn from `ownByDate` (date-based x, re-baselined per window),
  benchmarks still server-sourced; falls back to server `growth_inr` if no client series.
- `ProjectionTab`: `MONEYMADE_EXCLUDE = {pf, trading}` applied to `totalGains` (MAX tile) and
  `attribution` (waffles) so CMPF/trading never leak into any money-made metric. MAX drops
  ₹2.80L → ~₹1.9L. Net worth / allocation / projection model / CMPS pension line untouched.

### UPDATE 2 (2026-07-06) — REAL EOD ONLY (no synthetic backfill in the money-made story)
User call: "stick to the ~17 days we have; no regression-fabricated data; let the curve build."
So the money-made surfaces now use REAL EOD snapshots only (`!s.synth`), never the ledger-replay
backfill. This removed the seam risk entirely (no synth = no seam).
- `ownByDate` filters `!s.synth` → chart own line is real-capture only.
- `GrowthView`: window starts at the first REAL in-window date; benchmark clipped + re-based to
  that same date (fair "same rupees over the span we actually have"); bench only drawn beside a
  real own line. Curve is honest-short now (~17d), grows forward.
- Tiles: ref must be a REAL snapshot old enough for the window; else `chg:null` → renders
  "building" (new muted state). With ~17d data: 1M/3M/6M/1Y show "building"; MAX still shows the
  real all-time basis gain (`totalGains`, ~₹1.9L, not regression). They light up as history accrues.

### VERIFIED + COMMITTED (2026-07-06, Claude Code)
Verified against a FRESH `next build` + `next start` (own port — a stale pre-existing server was
silently answering on 3000/3007 with OLD code; see feedback.md "confirm the server actually bound"):
- Build clean (compiled + typechecked). Vitest: main tree green (2 fails are an unrelated
  `.claude/worktrees` cas-parser venv test, not this change).
- Render, BOTH themes: own line starts **12 Jun** (first real/non-synth SNAPSHOT.md date, NOT the
  26-Jun-2025 synthetic-archive start) → real-capture-only confirmed; Nifty benchmark re-based to the
  same 12-Jun start; "Your book" endpoint = **₹16,079** (= ownByDate gain, not the ₹1.33L server
  daily-net). 1M/3M/6M/1Y = **"building"**; MAX = **₹1.93L** (was ₹2.80L with CMPF).
- MAX waffle **excludes CMPF**: Indian ₹1,05,266 · US ₹68,220 · FD ₹16,479 · MF ₹2,791 · ELSS ₹110
  = ₹1,92,866 → headline **₹1.93L == Σ waffle**. ✓
- `certify.mjs` GREEN on the fresh build: `001/002/004 = 0`, `docOverflow = 0` across all 6 widths ×
  both themes, NORMAL and STRESS. Zero growth-tile clips; the new "building" tile text does not overflow.
- Known/accepted: MAX tile (all-time basis ₹1.93L) ≠ MAX curve endpoint (real-window gain ₹16,079) —
  different spans, both real, not a regression artifact. In local dev the real window is just the 2
  SNAPSHOT.md rows (KV dailies are prod-only); prod shows the ~17-day curve from ~18 Jun.
Committed to branch `shell-6region` (current checkout; not `main` per the no-switch rule). Not pushed.

---

# Plan — Duplicate Day-curve + F&O charge overlay automation (approved 2026-07-05)

Spec: `tasks/fno-overlay-and-daycurve-prompt.md`. Two independent bug-class fixes.

## Fix 1 — duplicate intraday curve on Day view (`PnlDashboard.js`)
- [x] `LivePnlGlance` takes `suppressCurveFor`; skips ITS chart (pills stay) when
      `suppressCurveFor === curveDate` (glance's RESOLVED date). Parent passes
      `suppressCurveFor={view==='day' ? periodKey : null}`. Verified live: Day@3-Jul (=curveDate)
      → 1 chart, glance suppressed; Day@2-Jul (≠curveDate) → 2 charts (both render, correct).

## Fix 2 — charges stuck at ₹0 (overlay rebuild automation)
- [x] (a) `build-fno-overlay.mjs`: retired the stale `EXPECT` MATCH/MISMATCH → informational
      FY·broker totals + a machine `OVERLAY …` porcelain line. Ran verify then `--write`:
      wrote KV `ledger:fno:overlay` (384 matched + 32 opening-only, 747 self notes).
- [x] (b) `ingest-daemon.mjs`: `onOverlayDirty` on `makeIngest`, set on ANY `contract-note`
      PASS (no tax_entity plumbing), fired ONCE on queue-idle; `main()` spawns
      `build-fno-overlay --write` (non-fatal, porcelain log line). Test-safe (93 ingest tests green).
- [x] (c) EOD build is WIRING-HELD → TODO marker added in `eod-book-design.md`; NO new task.
- [x] (d) Verified via the app's `applyFnoOverlay` on real KV overlay + committed ledger:
      Jul 1/2/3 Dhan → ₹229.26 / ₹233.68 / ₹261.29, Net = Gross − charge. (overlay realCharge
      IS the note's deduped NCLFO total.) Prod reads the same KV (no-store route) → serves live.

## Finish
- [x] vitest green (1345 main-repo tests; 2 failures are pre-existing worktree-only venv issues),
      certify green (day view, both themes, normal + stress), graphify skipped (not on PATH),
      lesson appended to feedback.md. Daemon needs a RESTART to activate (b). Commit; no push.

---

# Plan — Analytics revamp: Stratzy-style 4-card build (mock approved 2026-07-05)

Spec: `tasks/analytics-revamp-prompt.md`. Mock: `public/mock-analytics-revamp.html` (delete in final commit).
Render-layer only, inside `app/components/shared/AnalyticsTab.js`. No `globals.css` edit (swatch/legend
variants inline; SVG gradient stops resolved at runtime, `ProjectionTab.useScHex` pattern). Key Metrics +
Efficiency Ratios tables stay UNTOUCHED.

## Shared helpers
- [x] `axes()` JSX helper — month labels derived from the date range (not hardcoded) + 3 %-ticks left.
- [x] `monthTicks(t0,t1)`, `plotScales()`, `NoData`, `useGrnHex()` (resolve `--grn` for the gradient stops).
- [x] Extend `MultiLine` with optional `axes` prop + per-line `sw` (existing Cumulative-Perf call unchanged).

## Cards
- [x] Card 1 — Best Vs Worst Duration: selected-strat cum TWR curve `var(--txt)` 2.4 + worst `--red-bg`/best
      `--grn-bg` bands from `bestWorstWindows`, dashed `--txt3` edges, dashed legend chips, axes.
- [x] Card 2 — Underwater Plot: `cur.dd.curve` gold fill .22 + stroke 2, red avg rule at `cur.dd.avgDD`, axes.
- [x] Card 3 — Worst 5 Drawdown Periods (replaces the Worst-5 TABLE): green curve 2.2 + runtime-resolved green
      gradient under-fill, `--red-bg` bands per `episodes.slice(0,5)` (peak→recovery/last), hover tooltip
      (labels = `--acc`, depth = red) + `<title>` fallback.
- [x] Card 4 — Returns Comparison (NEW, after Efficiency Ratios): 4-line chart (S01/S02/Overall/NIFTY) + table
      rows Overall/S01/S02/NIFTY × 1M/3M/6M/1Y/Max DD, fixed-horizon anchored on latest ledger day REGARDLESS
      of the period pill, direction=colour only, Max DD unsigned red, '—' when a horizon is uncovered.

## Finish
- [x] Real-data verify (dev server: committed fno-ledger + /api/nifty-daily) — cards show real numbers, day + night.
- [x] `node audit/responsive/certify.mjs` green — full 8 surfaces normal + algo stress (6 widths × both themes):
      docOverflow=0, RSP-001/002/004=0, SYMMETRY/DIRECTION/VALUE-SIZE PASS. (The 28 "other" clips are the
      `agentation` dev-toolbar overlay, a devDependency absent in prod — none of the new elements clip.)
- [x] `command -v graphify >/dev/null && graphify hook-rebuild` — not on PATH locally, skipped.
- [x] Delete `public/mock-analytics-revamp.html`.
- [ ] Commit to current branch `main` (no push).

## Review
- All four cards built inside `app/components/shared/AnalyticsTab.js` only — **no `globals.css` change** (swatch/
  legend-band variants inline; the frosted hover tip reuses the app's `.iq-tip` class from IntradayChart).
- **Axis decision reversed mid-build (re-plan on surprise):** started with UNSIGNED y-ticks per the binding
  "no +/- glyph" constraint, but real Overall/S02 return curves cross zero, so an unsigned scale read
  non-monotonic garbage (12% / 5% / 22%). Reverted to SIGNED ticks (matches the mock): a chart SCALE marker is
  not a value/direction figure, so the no-glyph rule (which governs card values + table cells) is unaffected.
  The Returns Comparison TABLE and all card values stay strictly glyph-free (colour = direction), as specced.
- **Gradient theme-follow:** `--card` in the mock isn't an app token (resolved to "" → black box); the green
  gradient stops resolve `--grn` at runtime via `useGrnHex()` (ProjectionTab.useScHex pattern, MutationObserver
  on `data-time`/`data-tab`) so the fill re-tints on theme flip — verified live in both themes.
- **Tooltip:** converted from in-SVG to the app's frosted `.iq-tip` HTML overlay; compact 3-line layout
  (Depth / Recovery + muted peak→trough caption) capped at 240px + flip-at-0.5 so it never overflows; `<title>`
  kept as the always-safe fallback.
- **Flagged, NOT fixed (out of scope — Key Metrics stays untouched):** the untouched Key Metrics "Net P&L" row
  renders a DOUBLE `₹₹` (JSX `.rs` ₹ + `inrC()` which also prepends ₹). Pre-existing; needs a one-line fix but
  the spec locked that table as untouched.

---

# Plan — Unified ingestion: ONE inbox folder → dispatcher → parsers → tiered stores (v2)

Status: **BUILT — all code phases + all parsers landed (b→j + d2 Astha/Groww + cas-mf +
eCAS); 442 vitest green**. Poll-only Gmail mode (no billing) + MULTI-ACCOUNT support (mom's
Kite equity is a separate mailbox → `--auth mom`, auto-discovered, poll-only). GCP: project
`portfolio-ingest-80416` created + Gmail API enabled via gcloud. REMAINING, gated on the user:
create the OAuth Desktop client (`mcp/gmail/.client_secret.json`) + `portfolio/tx` label/filter
per `mcp/gmail/README.md` §3–4/§8 → `--auth` (self) + `--auth mom` → verify. Then re-run
`ingest-reconcile` after backfill. Doc-source findings (2026-07-03): PAYSLIPS are NOT emailed
(COALNET portal → stays a manual inbox/ drop; parser+seed works). VESTED (US) emails the P&L
Statement (xlsx → broker-tax parser → US_REALIZED) + "Year End Tax Documents" (dividends →
US_DIVIDENDS, no parser yet) — auto-capture needs a filter clause for the xlsx + broker-tax
stays manual-seed by design; a Vested-dividends parser is a follow-up. ⚠ Re-download the
May-2023 payslip from COALNET before any `parse-payslip --write` (see step i incident).
Originally: APPROVED — building (locked 2026-07-02; Cowork-specced via
`tasks/ingest-handoff.md`). v2 ABSORBS the earlier Gmail-pipeline plan — one pipeline.
Background: `tasks/value-lineage-audit.md` (capture families F1–F6, source registry).

**Design answer to "why not a single file/folder":** ONE folder for source DOCUMENTS — yes,
this plan (`inbox/`). ONE store for parsed DATA — no: the lineage audit shows the stores are
split by privacy tier DELIBERATELY (PII/PANs local-only `.env` · private book KV
`portfolio:v1` · committed generated JSON). Collapsing them leaks. What unifies: the ENTRY
POINT (`inbox/`) + the LEDGER of ingestion (`ingest-manifest`), not the storage.

## Locked decisions (user, 2026-07-02)
- Originals in Gmail untouched; only downloaded clones destroyed after checksum PASS.
- Gmail push (Pub/Sub) → LOCAL streaming-pull daemon (no public webhook; PANs stay local).
- Mail scope: broker contract notes + MF/CAS. Bank/card/UPI alerts OUT.
- **NEW: `inbox/` (gitignored) is the SINGLE intake for ALL source docs** — auto-captured
  (Gmail daemon downloads there) AND manually dropped (payslips, Vested statements, broker
  tax reports). Same pipeline regardless of how a doc arrived.

## Architecture decisions (flag for sign-off)
1. **Layout:** `inbox/` (drop) · `inbox/failed/` (parse FAIL quarantine) ·
   `inbox/unrecognized/` (no parser claimed it — parked, never silently dropped).
   PASS → file DELETED (manifest keeps hash + provenance; raw docs never persisted —
   contract-parser's discipline goes global).
2. **ONE daemon `scripts/ingest-daemon.mjs`** (replaces the v1 gmail-tx-daemon; capture-daemon
   patterns: in-flight guard, keepAwake, `scripts/ingest.log`). Two INTAKES, one QUEUE:
   (a) Pub/Sub streaming pull → `history.list` since lastHistoryId (startup catch-up covers
   sleep; gap → full label re-query) → download PDF attachments into `inbox/`;
   (b) fs-watcher on `inbox/` (manual drops land in the same queue). Single processing path =
   no task duplicacy by construction.
3. **Parser registry `scripts/ingest/registry.mjs`** — each parser declares
   `{id, canHandle(file) [filename pattern + content sniff], run(file) → {naturalKey, target,
   status}, expects (cadence spec)}`. Initial registry (existing scripts WRAPPED, not rewritten):
   - `contract-note` → `scripts/contract-parser/run.py` (naturalKey = note number → KV `ledger:cn:*`).
     **EXTEND: Groww + Rupeezy adapters (NEW — existing engine covered only Zerodha/Fyers/
     Upstox/Dhan).**
     - **Rupeezy/Astha — DONE + VERIFIED (2026-07-02).** Real note
       `NSEFUTURES_CONTRACT_20230601_AG4907_0125557.pdf` (unencrypted) now PASSes → KV
       `ledger:cn:0125557` (broker astha, 4 F&O fills, total checksum PASS residual 0.0, GST
       PASS). Engine adapter: `detect_broker` recognises astha/asthatrade/rupeezy (BEFORE the
       loose "dhan" substring); `extract_tables_for` uses the text-position row strategy
       (Astha rules columns, not rows, like Upstox); `parse_charges_from_text` reads the
       FREE-TEXT charges block (Astha has no ruled charges table) via the SHARED `label_key`,
       negating unsigned charge magnitudes to the debit convention; "Sub Total" added to the
       phantom-fill trap. 19 synthetic fixtures; 247 contract-parser tests green. Registry
       wrapper `contract-note.mjs` canHandle broadened to claim bare-"CONTRACT" filenames.
     - **Groww — DONE + VERIFIED (2026-07-03).** The "provisionally covered as a carry note"
       state was a SILENT TRADE LOSS: detect_broker's loose "dhan" substring matched the
       client name "Pra-dhan", mis-tagging Groww (and Astha) notes as dhan → 0 fills → looked
       inert. Fixed: \bdhan\b word-boundary (also hardens Astha); Groww tagged by its
       attachment name "CONTRACT NOTE <clientcode>.pdf" (no broker text — brand is a logo);
       per-contract "Total" subtotal rows trapped (they carry "Total" in the ORDER-NO cell +
       ISIN in the security cell); UTT→other_tax. Real note `CONTRACT NOTE 0258131546.pdf`:
       broker groww, 13 trades, total+per-segment(Equity/F&O)+GST checksums PASS →
       KV ledger:cn:CN-23-24-0023441090 corrected from 0-fill carry to 13 trades. 15
       fixtures; 262 contract-parser tests. NOTE: the other ~10 Groww notes (2023) reprocess
       once the backfill delivers them.
     User provides real samples via `inbox/`; passwords as new `CN_PW_*` entries in the
     existing gitignored `.env`.
   - `cas-mf` → NEW `scripts/cas-parser/` (naturalKey = statement period + folio-set hash → KV
     `ledger:mf:*`; casparser-first, `CAS_PW_*` gitignored, PII-redacted, refuse-on-fail;
     [Likely] casparser covers CAMS/KFintech — verify on real samples)
   - `payslip` → existing `scripts/parse-payslip.py` (naturalKey = salary month → PAYSLIPS in
     `data/portfolio.private.json`, then AUTO-CHAIN `seed-portfolio-kv.mjs` — existing guard stands)
   - `broker-tax` → existing `scripts/parse-broker-tax.py` (naturalKey = FY+broker → `broker-tax.json`)
   - `itr-json` → NEW (user uploads the filed ITR JSON per AY; naturalKey = AY + form type;
     expects = annual). Extracts FY-level anchors: CG schedules (equity/MF/foreign STCG-LTCG),
     F&O business income, Schedule CFL carry-forwards, Schedule S salary. Target: a DERIVED
     CANDIDATE for `fno-verified.json` + verified-CG fields — diffed against the current
     hand-curated seed, applied only on user sign-off (never auto-overwrite the anchor).
     Most PII-dense doc in the pipeline (PAN/address/bank accounts) — local-only parse,
     redacted output, clone destroyed on PASS. [Likely] schema shifts per AY/form (ITR-2/3) —
     validate per-AY, fail loudly on unknown shapes.
   - `vested-statement` → backlog (currently manual curation → US_REALIZED/US_DIVIDENDS)
   - `cdsl-demat-cas` (CDSL/NSDL eCAS) → **DONE + VERIFIED (2026-07-03).** Folded into
     cas-parser (not a separate parser): run.py routes on casparser `file_type` — CAMS/
     KFintech folios → `ledger:mf:*`; CDSL/NSDL `NSDLCASData.accounts` → `ledger:demat:*`.
     casparser 1.2.1 parses it natively BUT only via the TYPED parse (`output='dict'` leaves
     accounts empty — the gotcha). Refuse-on-fail = per-account balance == Σ holding values.
     PII redacted (investor_info/owners/dp_id/client_id/folios). Real SEP2025 eCAS: 6
     accounts, 9 MF holdings (₹1.75L), reconciles → KV `ledger:demat:2025-09-01_2025-09-30-
     demat-1ae94325`; full pipeline PASS via the decrypt-probe (was the "out of scope" FAIL).
     12 fixtures; 52 cas-parser python + 440 vitest green. The monthly auto-mailed THIRD
     reconciliation source is now live. (Equities showed 0 in this sample — either NSDL-held
     or genuinely none in CDSL; MF holdings are the value. `ecas_redact` keeps equities/bonds
     for when they appear.) Reconcile wiring (ledger:demat vs INDIAN/SWING/MF) = separate task.
4. **Dedup = TWO layers.** (i) sha256 content hash — same bytes dropped/mailed twice;
   (ii) parser naturalKey — same document as different bytes (re-downloaded CAS, re-sent note).
   Duplicate → skip, manifest row `DUP(of=…)`. Contract-parser's note-number keying already
   works this way; the registry generalizes it.
5. **Manifest `data/ingest-manifest.json`** (gitignored; the lineage ledger): one row per doc —
   `{sha256, naturalKey, parser, source: gmail:<msgId> | manual, status: PASS|FAIL|DUP|
   UNRECOGNIZED, target, ts, parserVersion}`. INVARIANT: every file that ever touches `inbox/`
   ends as exactly one manifest row — nothing vanishes unaccounted (the "to a T" guarantee).
6. **Completeness report `scripts/ingest-report.mjs`**: expectation model from registry
   `expects` (contract note per F&O trading day per active broker · payslip monthly · CAS
   monthly) diffed against the manifest → gap list + staleness warnings. On-demand + weekly
   scheduled run. Gaps are REPORTED, not discovered at ITR time.
7. **Gmail specifics (unchanged from v1):** `gmail.readonly` ONLY (pipeline physically cannot
   mutate the mailbox); filter → label `portfolio/tx`; `users.watch` re-armed startup + 6d;
   idempotency via `data/gmail-state.json` not labels; secrets gitignored
   (`mcp/gmail/.token.json`, `.sa.json` Subscriber-role SA). [Unconfirmed — verify at build:]
   GCP OAuth app in "Testing" mode expires refresh tokens weekly → publish consent screen.
8. **Hands-free:** `scripts/ingest.cmd` + `scripts/register-ingest-daemon.ps1` (at-logon,
   repo-relative — no path rot).

## Steps
- [ ] (a) One-time GCP setup (user-assisted; documented `mcp/gmail/README.md`): project, Gmail
      API + Pub/Sub, OAuth desktop client (`gmail.readonly`), topic `gmail-tx` (+ grant
      `gmail-api-push@system.gserviceaccount.com` publisher), pull subscription, SA key.
      Gmail filter → label `portfolio/tx` (broker + CAMS/KFintech senders).
- [x] (b) Pure libs `scripts/ingest/` (unit-tested): registry, manifest read/write, sha256 +
      naturalKey dedup, router/queue; gmail lib (history-gap detection, PDF attachment selection).
      DONE: registry.mjs (interface + first-claim classify), manifest.mjs (event-log ledger,
      atomic writes, strict-read guard), dedup.mjs (sha256 + naturalKey vs PASS rows only —
      FAIL never establishes dedup, retry-after-fix is first-class), router.mjs (single path,
      4 dispositions, dry mode writes NOTHING), gmail.mjs (pure: pdfAttachments/history-delta/
      404-gap/safeName/state; lazy googleapis for daemon-only fns). 27 tests; 373 total green.
- [x] (c) `scripts/ingest-daemon.mjs`: Pub/Sub pull + inbox fs-watcher → single queue → classify
      → parse → PASS delete clone / FAIL quarantine / UNRECOGNIZED park → manifest + state.
      `--dry` (parse, no KV/store writes, no deletes). Watch re-arm.
      DONE: two intakes → makeIngest's one serial queue; gmail intake optional (creds absent →
      fs-watch only, logged); startup catch-up + 6h poll + 6d watch re-arm; --auth loopback
      OAuth; --once sweep; --dry proven on empty inbox with zero GCP. keepAwake is WORK-SCOPED
      (held only while the queue is busy, released 30s after idle) — a 24/7 daemon must not
      block laptop sleep, unlike the session-scoped capture daemon. 5 tests; 378 total green.
- [x] (d) `scripts/cas-parser/` (casparser-first; live-sample discovery for per-transaction
      confirmation formats; regression tests mirroring `test_engine.py` discipline).
      DONE (code): venv + casparser==1.2.1 pinned; engine.py = pure post-processing (validate
      refuse-on-fail via close vs close_calculated reconciliation, natural_key = period +
      folio-set hash, redact drops name/email/mobile/PAN/nominees + hashes folio numbers);
      run.py mirrors contract-parser (CAS_PW_* .env, KV ledger:mf:<key> + index, --dry-run,
      --porcelain for the registry wrapper); registry wrapper cas-mf.mjs + shared py.mjs.
      37 python regression tests + 6 vitest; 384 total green.
      PENDING (user sample): verify casparser handles the real CAMS/KFintech CAS before
      trusting coverage — refuse-on-fail protects until then.
      CORRECTION (P2, 2026-07-02 late): the first REAL CAS crashed run.py — casparser
      returns a pydantic CASData even with output='dict', engine's .get() threw, and the
      traceback surfaced only as "no porcelain status". The phase's synthetic-green state
      was NOT runtime verification (lesson filed in feedback.md). Fixed: normalize_cas()
      (model_dump(mode='json')), crash-to-FAIL porcelain in evaluate(), venvPythonStrict
      (no PATH-python fallback on fresh clones), test_run.py regression. Pins RE-VERIFIED
      live against PyPI (1.2.1/2026.6.9 ARE current; the sandbox that read them as
      fabricated had a stale package index resolving 0.8.1/2025.3.1).
- [x] (e) Wrap existing `parse-payslip.py` + `parse-broker-tax.py` as registry parsers
      (payslip PASS auto-chains the guarded KV seed). No rewrite of proven engines.
      DONE: additive-only python entry points (--one/--porcelain probes; contract-parser
      run.py --porcelain) + wrappers payslip.mjs (probe month → copy as next Form (N).pdf
      into data/reports/ corpus → --write BASIC_PAY → auto-chain guarded seed; seed refusal
      = FAIL), broker-tax.mjs (probe broker+FY-set key → copy → full corpus re-run),
      contract-note.mjs (PUSHED/OK/CARRY→PASS, REFUSED/HELD/SKIP→FAIL; key = CN number).
      Probes verified on REAL files (Form slip → 2023-02; taxpnl → zerodha_mom FY22-23).
      Fixed en route: PATH python had lost pymupdf (payslip engine was dead) — reinstalled.
      Registry roster now 4 parsers, classification proven mutually exclusive. 393 green.
- [x] (e2) NEW `itr-json` parser (per-AY schema validation; FY-anchor extraction; derived
      `fno-verified.json` candidate + verified-CG diff, sign-off gated; PII discipline as (3)).
      DONE + VERIFIED ON THE REAL FILED ITR-3s the user pre-dropped in inbox/ (AY2024-25 +
      AY2025-26): 10/10 anchors extract, fail-loud on unknown form/AY/shape, candidate is
      PII-free by construction (PersonalInfo never read), NEVER writes fno-verified.json.
      Schema paths corrected against the real shape (ScheduleBP signed net P&L first —
      PartB-TI heads floor losses at 0). Real finding for reconcile: AY2025-26 CFL
      speculative = 84,268 vs seed 84,307 (₹39 gap to sign off); CFL non-spec MATCHES
      exactly (5,13,011). 12 tests; 405 total green.
- [x] (f) `scripts/ingest-report.mjs` + `expects` cadences; weekly scheduled run.
      DONE (report; weekly task registers in step g): contract notes expected per (broker,
      traded day) FROM THE LEDGER (fno-ledger.json — holidays/idle days excluded by
      construction, stricter than a calendar sweep); payslip/CAS monthly from baseline;
      ITR per closed AY; per-parser staleness vs cadence. Manifest rows gained a PII-free
      `meta` field (contract-note carries {date, broker}) to join against the ledger.
      Live smoke vs the real ledger flagged all 5 recent Dhan traded days as missing notes.
      The "deliberately-missing month/day is caught" phase-(i) proof is encoded as unit
      tests. 11 tests; 416 total green.
- [x] (g) Windows wrappers + registration; `.gitignore`: `inbox/`, `data/ingest-manifest.json`,
      `data/gmail-state.json`, `mcp/gmail/.token.json`, `.sa.json`, parser `.env`s.
      DONE: ingest.cmd (daemon / `report` arg, appends scripts/ingest.log) +
      register-ingest-daemon.ps1 — IngestDaemon at-logon (no exec limit, IgnoreNew,
      work-scoped keepAwake inside) + IngestWeeklyReport Sun 10:00. REGISTERED, both Ready.
      Gitignore entries landed back in the prep commit (before any secret could exist).
      Daemon NOT started yet — its startup sweep would live-consume the user's pre-dropped
      inbox/ samples; phase (i) does the controlled first live run.
- [x] (h) Historical backfill (`--backfill --from <date> [--to <date>]`): date-ranged
      `messages.list` sweep over the same senders → downloads into the SAME `inbox/` → identical
      pipeline; resumable (state per message); polite rate-limit. NOT via QR codes ([Likely] doc
      QRs are verification links; [Certain] ~3KB QR capacity can't hold a multi-fill note or a
      multi-folio CAS). MF history: ONE since-inception detailed CAS through `cas-parser`.
      DONE (code; live run needs GCP + token): backfillQuery pure+tested (inclusive window,
      fail-loud dates); sweep pages messages.list under the label, skips state.backfill +
      state.done + manifest gmail:/backfill: sources (live and backfill can never
      double-ingest), records resume state only after a full download, 250ms/message
      politeness, progress every 100. 3 tests; 419 total green.
- [~] (i) Verify end-to-end: vitest green on (b); `--dry` on a real sample of EACH doc type;
      live run proving — dedup (same payslip dropped twice → 1 PASS + 1 DUP), forced-FAIL
      quarantine, unknown-file park, clone deleted on PASS, original mail untouched, manifest
      row for every intake, gap report flags a deliberately-missing month.
      PROVEN LIVE (2026-07-02): clone-deleted-on-PASS + candidates (2 real ITRs), sha-DUP
      (re-dropped bytes), naturalKey-DUP (same AY re-encoded), forced-FAIL → failed/,
      unknown → unrecognized/ (2 real user files parked), manifest = exactly 1 row per
      intake (10 rows), gap report catches missing months (unit-locked + live), payslip →
      --write → guarded-seed → KV chain PASS (real slip copy; found+fixed cp1252
      PYTHONIOENCODING crash en route). IngestDaemon task STARTED (fs-watch mode).
      GATED on GCP/user: --auth, Pub/Sub push, original-mail-untouched, live backfill,
      real-CAS parse (needs CAS_PW + sample; forced-FAIL path proven).
      ⚠ INCIDENT during proofs: cleanup rm of an ASSUMED "Form (34).pdf" deleted the real
      May-2023 slip PDF; BASIC_PAY restored from backup + KV re-seeded (correct again) —
      the PDF itself needs a COALNET re-download; until re-dropped, do NOT run
      parse-payslip --write (it would re-drop 2023-05). Lesson filed in feedback.md;
      wrapper now records meta.savedAs so cleanup is never guesswork.
- [x] (j) — BUILT + first live run 2026-07-02 (report-only; re-run after the Gmail backfill).
      scripts/ingest-reconcile.mjs + pure reconcile.mjs (9 tests; 428 total green). First
      report: F&O FY23-24/24-25 DRIFT vs ITR (−1.92L vs −1.31L, −4.58L vs −4.04L — ledger
      coverage starts 2023-08 + modeled charges; backfill will close); CFL latest-AY
      non-spec MATCHES seed exactly, spec ₹39 NEAR, stcg 4,700 timing item; overlay = 5
      real notes; MF PENDING first CAS; Vested/Indian stores staleness-only (untouched).
- [ ] (j-orig) **Old-figures reconciliation (one-time, after backfill h) — diff, don't re-enter.**
      `scripts/ingest-reconcile.mjs`, REPORT-ONLY (no auto-overwrite; corrections go through
      the normal edit-private-JSON → guarded-seed path after user sign-off).
      Authority order (top wins): **parsed ITR JSON** (the filed return itself; supersedes the
      hand-transcribed seed as anchor once uploaded — `fno-verified.json` becomes derived+
      sign-off-verified from it) → checksum-PASS parsed docs → broker API state → hand-curated
      entries. A contradiction with the ITR anchor = suspect parser/coverage first.
      Cross-granularity invariant: trade-level (contract notes) must SUM to FY-level (ITR CG/
      F&O schedules); Schedule S annually cross-checks parsed PAYSLIPS.
      - F&O charges: automatic — backfilled notes extend KV `ledger:fno:overlay` via existing
        `build-fno-overlay.mjs`, replacing estimated charges; report coverage % before/after.
      - MF: diff since-inception CAS vs curated `MF_FUNDS`/`MF_CASHFLOWS` (units, cost,
        folios, dates); tolerance-banded; apply corp-action/dividend-reinvest adjustments
        BEFORE flagging drift (CUB lesson — a raw mismatch is not drift).
      - US_REALIZED / INDIAN_REALIZED / US_DIVIDENDS: out of reconcile scope until the
        Vested/tradebook parsers exist (registry-ready backlog) — mark as-of dates stale in
        the report, don't touch the figures.
      - §11.1 hardcoded-literal fixes (audit findings) stay a SEPARATE task — reconcile
        feeds them data, doesn't fix JSX.

## Out of scope
- Bank/card/UPI alerts; Vested-statement parser (backlogged, registry-ready).
- Dashboard wiring of `ledger:mf:*` / manifest surfaces (separate task — "ends at KV/manifest").
- Any Gmail mutation — readonly by design.
- Rewriting existing parsers (wrapped as-is; their tests remain the guard).

---

# Plan — Monthly algo decision-maker: regime/short-vol gate + capital allocator + self-learning review

Status: **APPROVED — building.** Decisions locked (2026-07-02): allocation caps = proposed defaults;
capital basis = **parameter each run** (`--capital`); cadence = **scheduled reminder** to re-harvest + run.
Supersedes the ad-hoc recommendation flow. Turns the screen from a data-review into a repeatable **monthly decision
engine** that runs the full pipeline and emits an allocation **with written justification**, then
**reviews last month's picks against realised performance and learns**.

Context / why: the /council review found the screen's foundation sound (transparent metrics,
gate-on-risk/rank-on-quality, the young-algo guard) but flagged three structural gaps — (1) the
book is ~short-vol and **none of it has survived a stress regime** (stressed buckets all THIN:
6–20 days), so the low correlations are regime-conditional and converge to ~1 in a vol spike;
(2) **Sortino isn't frequency-normalised** (√ppy gives a daily algo a ~×13 vs weekly ~×7 boost),
distorting the ranking; (3) precise ₹ backtests invite return-anchoring on a survivorship-biased
bull sample. This plan closes (1) and (2) and reframes (3), and adds the monthly loop the user wants.

## Design decisions (flag for sign-off before building)

1. **Regime/short-vol gate lives in the SCREEN + the ALLOCATOR, not just a hidden bucket.**
   - Screen: add `stressTested` (stressed-bucket dayCount ≥ `THIN_DAYS`) + `downRegime` health to each
     row; expose in the payload. An algo untested in stress is admitted but **flagged in the headline**,
     not buried.
   - Allocator: treat **all short-vol structures (defined credit-spreads + option-selling) as ONE
     correlated cluster in a stress regime** (calm-regime pairwise corr is not trusted for sizing).
2. **New pure module `scripts/lib/algoAllocate.mjs`** (unit-tested) = the capital-allocation gate.
   Inputs: ranked survivors + capital + per-algo min/max + structure + gateMaxDD + stressTested +
   correlation. Constraints (all tunable, values below are proposals to confirm):
   - short-vol cluster ≤ **60%** of capital; single-algo ≤ **30%**; ≥ **1 long-vol** (naked buying) sleeve if available.
   - drawdown-scaled cap: max weight shrinks as `gateMaxDD` deepens (e.g. −20%→full, −45%→half, −60%→¼).
   - stress-untested algos capped at a **smaller** max weight than stress-tested peers.
   - respect each algo's real `minAmount`/`maxCapital`; start from the user's "max-out then move on"
     rank order but **bounded by every cap above** (concentration is opt-in, not the default).
   Output: per-algo ₹ + the binding reason for each size.
3. **Frequency-normalise Sortino** for the ranking (report trades/yr alongside), so cross-frequency
   ranks are honest. Additive CAGR annualisation left as-is (already `shortLive`-flagged; council agreed
   it's not worth a rewrite this cycle).
4. **Monthly artifacts + KV.** `data/algo-monthly/<YYYY-MM>.json` (picks + metrics-at-decision +
   justification), `data/algo-monthly/reviews/<YYYY-MM>.json` (retrospective). KV `algo-monthly:latest`.
   Gitignored (derived from gitignored harvest), like `algo-screen.json`.
5. **Self-learning = surfaced suggestions, NOT auto-tuning.** The review computes realised vs
   expected and proposes threshold tweaks for the user to accept — we do NOT let the machine silently
   refit parameters to a handful of months (overfitting risk). Confirmed lessons graduate to
   `tasks/feedback.md`.
6. **Harvest stays semi-manual** (browser + logged-in Stratzy) — the monthly run is "re-harvest →
   then fully automated screen→allocate→justify." The complete process is one command after the pull.

## Steps

### Phase 1 — Regime/short-vol gate + trade-frequency exposure (`algoScreen.mjs`) ✅ DONE (commit e68e646)
- [x] (a) `volSide` (short/long/neutral), `stressTested`, `downTested`, `downSortino` on each row; threaded into
      `buildScreenPayload` held/survivors/parked + a book-level `regimeRisk` block (shortVolShare, stressUntested, caveat).
- [x] (b) Exposed `tradesPerYear` on live metrics (makes the √ppy annualisation visible). NOTE: deferred the
      deeper frequency-*normalised* ranking rewrite — visibility first; revisit if it distorts real picks.
- [x] (c) Auto-generated headline caveat in `regimeRisk.caveat`.
- [x] (d) Tests: `volSideOf`, `tradesPerYear`, `regimeRisk` block. 313 green.
- **Calibration finding:** 2023–26 is a low-vol era (40/736 stressed days, ~5%; VIX max 27.9), so `stressTested`
  is near-uniformly FALSE and non-discriminating. The book-level "42/42 untested" caveat is the useful output;
  the **allocator's operative regime defence is the short-vol cap + DOWN-regime health** (`downTested` 15/42,
  down-Sortino spread 0.9–17 — genuinely discriminating), NOT a stress-tested preference. Kept stressTested for
  when vol returns.

### Phase 2 — Capital allocation gate (`scripts/lib/algoAllocate.mjs`, new, pure + tested) ✅ DONE (commits dd25343 + 5d10039)
- [x] (e) `allocate(candidates, { capital, caps })` — capped variant (single ≤30%, short-vol ≤60%, DD/down scaling).
      KEPT but NOT the default (superseded by conviction mode per user).
- [x] (e2) **`allocateConviction(candidates, { capital, minLongVolShare })`** — the LOCKED default: max-out to
      Stratzy `maximumCapital` by rank, no caps, no DD scaling, with the mandatory long-vol hedge ≥20% (earmark
      that non-long picks can't touch; released if too few long-vol candidates, with a warning). Deterministic.
- [x] (f) `justify(book, { regimeCaveat })` — headline + per-pick "why this size" lines + vol mix + caveat passthrough.
- [x] 17 allocator tests; 330 total green. Validated on real data: ₹10L → hedge 36%, ₹25L → hedge 40% (holds as it scales).
- **Handoff finding for Phase 3:** the allocator faithfully fills whatever ORDER it's given, and the raw
  `runScreen` survivor order (established-first by annualised Sortino) is NOT a pick-quality rank — the real-data
  preview funded mediocre names (Ignitor/IIFL/TejNiti) and the long-vol guarantee grabbed a −67%-DD Fixed RR.
  **Phase 3 must build a composite candidate rank** (user's persistence signal + Sortino + down-regime health,
  held-pinned) and feed THAT to `allocate`. The allocator is correct; the ranking is the lever.

### Phase 3 — Monthly orchestrator (`scripts/build-monthly-reco.mjs`, new) ✅ DONE (commit pending)
- [x] (g) Pipeline: `runScreen` → `convictionCandidates` (pool + 2nd-worst persistence rank, Stratzy min/max,
      −100 catastrophic floor) → `allocateConviction` (long-vol hedge) → `justify` + `labelBook`. `--capital`
      REQUIRED, `--dry` skips KV. Writes `data/algo-monthly/<YYYY-MM>.json` + KV `algo-monthly:latest`;
      refuse-on-empty guard. `data/algo-monthly/` gitignored.
- [x] (h) Emits KEEP/EXIT/ADD + justification + regime caveat to stdout, structure-first; backtest only as a
      survivorship-caveated aside. Persistence rank + convictionCandidates + labelBook are PURE + tested
      (6 new tests, 336 total green). Validated at ₹10L: book = IV-Imbalance → Zen → SkewHunter (matches the
      approved mock); −100 floor excludes 16 catastrophic algos (Index Scalper −307, etc.).

### Phase 4 — Monthly review + self-learning (`scripts/review-monthly.mjs`, new) ✅ DONE (commit pending)
- [x] (i) `scripts/lib/algoReview.mjs` (pure, fixture-tested): `reviewMonth(artifact, freshRecords, {regimeCal})`
      → per-pick forward return (SUM of in-window per-day returns), realised vs gated DD (breach flag), worst day,
      days observed; calibration = rank→forward Spearman + hit rate + DD breaches + stressed-regime-forward;
      counterfactual = EXITed + top-unfunded-NEW value-add; thin-window guard (<15 fwd days → LOW-CONFIDENCE).
- [x] (j) `scripts/review-monthly.mjs`: picks the latest artifact STRICTLY older than this month (none → clean
      "nothing to review yet" exit 0); warns HARD if `stratzy-daily.json` is stale; writes
      `data/algo-monthly/reviews/<YYYY-MM>.json`; prints calibration + **proposed** tweaks (`proposeTweaks`,
      suggestions ONLY — never auto-applied; confirmed lessons graduate to feedback.md by hand). 10 new tests,
      346 total green. Smoke-tested on real data (backdated artifact → Spearman 0.68, 100% hit, +26% KEEP/EXIT value-add).

### Phase 5 — Surface in app (Trading→Review) ✅ DONE (commit pending)
- [x] (k) `AlgoMonthlyReco` (app/components/shared) renders the month's decision ABOVE `AlgoScreenReview`
      (decision = headline, data-review = background). Built from the approved mock: capital input (live,
      re-runs the CLIENT allocator on the artifact's precomputed candidates → relabels KEEP/EXIT/ADD),
      pick cards with KEEP/EXIT/ADD, chips, regime caveat, collapsible all-candidates, + a last-month review
      block (calibration; "nothing to review yet" until Aug). Read path: `loadAlgoMonthly` (KV
      `algo-monthly:latest` + local fallback) + `loadAlgoReview`; `/api/algo-monthly` (force-dynamic, no-store,
      no sibling self-fetch). `algoAllocate.mjs` moved scripts/lib → app/lib (regime.mjs pattern) so the client
      allocator is bundler-importable; heavy screen still never runs at render.
      **Verified:** 346 vitest green · certify normal+stress PASS (001/002/004=0, docOverflow=0, DIRECTION +
      VALUE-SIZE + SYMMETRY pass, 6 widths × both themes) · render-verified live both themes · 6 shots in
      audit/algo-review-shots/ (gitignored). **Mock deviations (flagged):** amounts use the house `inrCd`
      abbreviation (₹3.20L) + `.rs` not the mock's full ₹3,20,000; the EXIT block + the review-calibration
      section are new (Phase-5 additions the mock didn't cover); slider stays a live NUMBER input per Daksh's scope call.

## ✅ PLAN COMPLETE (2026-07-02) — all phases landed
Phase 1 `e68e646` · Phase 2 `dd25343`+`5d10039` · Phase 3 `337e8d7` · Phase 3.5 (Cowork task) · Phase 4 `dd3537f` · Phase 5 (this commit).

## Out of scope (this plan)
- Auto-parameter-tuning / ML (deliberately — suggestions only).
- Fully headless harvest (Stratzy auth stays browser-based).
- Any broker order placement (brokers remain READ-ONLY).

## Decisions (locked 2026-07-02) — REVISED to CONVICTION mode (user chose returns)
- **Posture = CHASE RETURNS** (explicit: "we need to chase returns; risk capital; can take 40-60% but not a
  complete wipeout of 1-3 months of gains"). So the capped `allocate` is NOT the default — `allocateConviction` is:
  - Rank: **2nd-worst-horizon persistence → live Sortino** (skew/worst-day display-only). Held ranked by method
    → KEEP (funded) / EXIT (not funded); new → ADD.
  - Sizing: **max-out to each algo's Stratzy `maximumCapital`** in rank order. NO single-algo cap, NO short-vol
    cluster cap, NO DD scaling (drawdown is a VISIBLE per-pick flag, not a limit).
  - Pool: quality-OK F&O (defined+undefined), **DD-park removed**, **−100% catastrophic-DD floor** (kills
    wiped-out algos; a quality kill, not the structure-relative park).
  - **The ONE enforced safety element = mandatory LONG-VOL hedge ≥20% of capital** (`CONVICTION_MIN_LONGVOL_SHARE`).
    Long-vol (premium-BUYING) GAINS in a vol spike → caps the short-vol cluster's correlated give-back. This is the
    specific defence against the "single event wipes out months of gains" the user won't accept. Nearly free here
    (long-vol names rank high on merit; ₹10L book already holds SkewHunter as the hedge).
  - Data source: **Stratzy only** (Dhan numbers are inflated — dropped). `minimumCapital`/`maximumCapital` +
    live/backtest series all from Stratzy (148/148 coverage).
- (superseded) Caps = proposed defaults (short-vol ≤60%, single-algo ≤30%, DD-scaled sizing, ≥1 long-vol).
- Capital basis = **parameter each run** (`--capital <rupees>`; no fixed default baked in).
- Cadence = **scheduled reminder** (Phase 3.5): a cron/routine nudges at month-start to re-harvest (browser) + run.

### Phase 3.5 — Schedule the monthly nudge ✅ DONE (external)
- [x] (g2) Lives in the Cowork scheduled task `monthly-algo-reco` (1st of month 09:00), NOT in `scripts/` —
      it prompts the re-harvest + runs `build-monthly-reco.mjs` (then `review-monthly.mjs` for the prior month).

---

# Plan — Wire the algo screen into the app (computed data-review in Review sub-tab)

Status: **BUILT — awaiting user eyeball before commit.** All steps (a)–(f) done; 34
vitest green; certify normal+stress PASS (001/002/004=0, docOverflow=0, symmetry/
direction/value-size PASS); 6 shots saved to `audit/algo-review-shots/` (gitignored).

### Review (what shipped)
- `app/lib/regime.mjs` — shared classifier (moved from scripts/lib; market-wrap will reuse).
- `buildScreenPayload()` in `scripts/lib/algoScreen.mjs` + 4 shape tests.
- `scripts/build-algo-screen.mjs` — writes `data/algo-screen.json` (gitignored) + seeds KV `algo-screen:v1`.
- `app/api/algo-screen/route.js` + `loadAlgoScreen()` (KV+local, edge-protected like /api/portfolio).
- `app/components/shared/AlgoScreenReview.js` — lazy-fetched in AlgoTab Review sub-tab, below the AI prose.
- Render: held + per-regime tables (caveats visible) → confront w/ regime caveat → tier line → survivors-by-style (collapsible) → parked + tally + legend (collapsible). Tokens only, direction=colour.
- **NOT committed yet** (per instruction). Excludes daemon-written data/*.json + the public/*-mock.html scratch.

---

# (superseded) Plan — Wire the algo screen — original AWAITING-APPROVAL draft below
Status: **AWAITING APPROVAL** (discovery done; no build code written yet).

Goal: surface the COMPUTED screen result BESIDE the AI prose in the AlgoTab → Review
sub-tab. Precompute → KV → render; the frontend never runs `algoScreen` at render.

### Architecture decisions (flagged for sign-off)
1. **Shared regime lib → `app/lib/regime.mjs`** (move from `scripts/lib/regime.mjs`).
   `.mjs`, not `.js`: package.json has no `"type":"module"`, so Node would parse a
   `app/lib/regime.js` as CommonJS and throw on `export` in the precompute script.
   `.mjs` is unambiguously ESM for BOTH the Node precompute AND the Next bundler (the
   upcoming market-wrap imports it too). `scripts/lib/algoScreen.mjs` + the tests
   re-point to `../../app/lib/regime.mjs`. No logic change → 30 tests stay green.
2. **Screen JSON rides the PRIVATE payload, not a new route.** Held names + capital
   tier are private-ish → route through `/api/portfolio` (`force-dynamic`, `no-store`)
   so it never ships in the static client bundle. Add `loadAlgoScreen()` to
   `serverPortfolio.js` (KV `algo-screen:v1` + local `data/algo-screen.json` fallback,
   mirroring `loadFnoOverlay`); include as `_app.algoScreen`. No sibling self-fetch
   (per feedback.md). `data/algo-screen.json` gitignored (derived from gitignored
   held-algos.json).

### Steps
- [ ] **(a) Move regime lib** → `app/lib/regime.mjs`; re-point `algoScreen.mjs`,
      `regime.test.mjs`, `algoScreen.test.mjs`, `screen-gutcheck.mjs`. Run vitest (30 green).
- [ ] **(b) Payload serializer** `buildScreenPayload(screenResult)` in `algoScreen.mjs`
      (pure) → the exact spec shape: `{asOf, capitalTier, thresholds, counts, held[],
      confront{dominatedBy,supplementary}, survivorsByStyle, parked[], flaggedOutTally}`.
      Add a vitest case locking the shape (figures-from-calc guarantee).
- [ ] **(c) Build script** `scripts/build-algo-screen.mjs` → runs `runScreen` with
      `regimeCal` + `capital` (like gut-check), serializes, writes `data/algo-screen.json`
      + seeds KV `algo-screen:v1` (KV REST POST, like seed-portfolio-kv). Note: hook into
      the monthly routine.
- [ ] **(d) Read path**: `loadAlgoScreen()` in `serverPortfolio.js`; `_app.algoScreen`
      in `/api/portfolio`; thread the prop page.js → AlgoTab.
- [ ] **(e) Render** `app/components/shared/AlgoScreenReview.js`, in Review sub-tab
      BELOW the AnalysisCard prose (distinct block). Prioritized:
      1. HELD — live metrics + per-regime `.ovx` table (up/down/chop/stressed:
         days·sortino·maxDD·tested); honest flags VISIBLE (thin/untested, IV's thin
         -39% up bucket, park-reason "wouldn't clear conservative gate today").
      2. CONFRONT (dominatedBy + supplementary) WITH regime caveat (e.g. Ratio-Fluxer
         EMPTY chop bucket beside its -4.2%).
      3. Capital tier + thresholds line.
      4. SURVIVORS by style — collapsible per style (`<details>`).
      5. PARKED + flagged-out tally + legend — collapsible footer.
      Tokens only: `.card/.csm/.statgrid/.ovx`, direction=colour (no +/- glyph),
      `--fs-*`, both themes.
- [ ] **(f) Verify**: vitest green · `certify.mjs` normal+stress · render-verify live ·
      SAVE shots (Review sub-tab, 768/1920/2560 × day+night). **Hold commit** until shots
      saved + user confirms.

### Out of scope (this task)
- The market-wrap consumer of `regime.mjs` (future).
- Styling/figures in the AI prose card (unchanged — LLM writes prose only).

---

# Plan — Algo data, two tracks behind isolated adapters (PRIOR — superseded context)

Status: **AWAITING APPROVAL** (discovery done; no build code written yet).

Two distinct goals, two adapters, no conflation:
- **Track A — Stratzy = live per-algo P&L** (attribution; reconciled to broker sleeve net).
- **Track B — Dhan all-algos = monthly research feed** for capital-allocation optimisation (maths).

---

## Discovery (DONE, captured live 2026-06-30, read-only)

### Track A source — Stratzy web app (`stratzy.in`, P&L tab → `/portfolio`)
Auth = httpOnly session cookie + AWS WAF token (same-origin GET; no JS-readable bearer).
- **`/api/algo/portfolio`** → `{success,message, activeAlgos:{<algoId>:{…}}}` (map, 46 algos):
  name=`algoData.name` · sleeve/"Kind"=`algoData.category` · net=`overallPnL`
  (=`realizedPnl`+`unrealizedPnL`; split `overallPnlOrders`/`overallPnlPositions`) ·
  per-day=`dailyPnL` · deployed=`amountDeployed`/`investedAmount` ·
  trades=`activeTrades`/`tradesExecuted` · state=`automationEnabled`/`isManual`/`isDisabled` ·
  ids=`_id`/`advisorId`/`userId`/`broker`. No charges field (net only).
- **`/api/algo/liveReturns`** → `data.returns{<algoId>:number}` (sum = headline) — cross-check.

### Track B source — Dhan Algos (`algos.dhan.co`, API host `algo-api.dhan.co`)
User has **0 deployed on Dhan** (My Algos ₹0; `getSubscribedAlgos` empty) — so Dhan is NOT a P&L
source. It is the **catalog/universe** of all algos (published by `/managers/stratzy/…`), with
research metrics. Endpoints:
- **`/algo/sub/UniversalAlgoSearch`** (POST) — catalog search/list (the all-algos grid).
- `/algo/sub/getSubscribedAlgos` (POST), `/algo/sub/GetStrategyWisePosition` — user-side (empty).
- detail page `/managers/stratzy/<slug>/<id>` — per-algo backtest metrics + past trades.
- Visible research fields: name, category, min capital, **1Y returns**; detail adds backtest
  drawdown/sharpe/recovery/rank/score (cf. Stratzy `/api/web/algo/list` which has the same family).
- TODO at build time: capture full `UniversalAlgoSearch` response schema (needs cross-origin
  auth replication — token, not the same httpOnly cookie as Stratzy).

---

## Track A — Stratzy per-algo P&L  (propose; primary)
- [ ] `scripts/lib/stratzy-adapter.mjs` — ONE interface, two sources, same normalized row
      `{id,name,sleeve,deployed,net,daily,realized,unrealized,activeTrades,tradesExecuted,state}`:
      - `fromEndpoint({cookie})` → `/api/algo/portfolio` (+ `liveReturns`); timeout, validate, null on WAF/expiry
      - `fromPaste(text|csv)` → manual paste/CSV → same shape (durable fallback, first-class)
- [ ] `scripts/import-stratzy.mjs`: normalize → **reconcile** (scale ACTIVE algos' net to the broker
      F&O sleeve net — broker=truth for total, Stratzy=split; keep raw alongside scaled; stopped algos'
      realized P&L kept labeled-historical/unreconciled) → write `data/algos.private.json`
      (+`.example.json`) → publish KV `algos:v1` (`kvSetJSON`) → near-empty sanity guard.
- [ ] Cookie in gitignored `mcp/.stratzy.env` (mirror `.kv.env`); document paste format + cookie export.

## Track B — Dhan all-algos monthly research  (DONE 2026-06-30)
- [x] `scripts/lib/dhan-algos-adapter.mjs` — ONE interface, two sources, one normalized row:
      `fromHarvest()` (browser-harvested plaintext JSON) + `fromPaste()` (CSV fallback). Parses
      `ALGO_RETURNS` horizon map, preserves `correlations{overall,category}` matrices, coerces
      strings/"--"→null. (`fromEndpoint` is NOT a Node call — request body is AES-encrypted; see below.)
- [x] `scripts/lib/dhan-harvest.snippet.js` — console harvester: hooks fetch on algos.dhan.co,
      accumulates plaintext `UniversalAlgoSearch` responses, `__dumpCatalog()` downloads raw JSON.
- [x] `scripts/import-dhan-catalog.mjs` — source precedence (harvest file → paste/CSV), sanity guard
      (refuse <5 rows / missing metrics), writes `data/algo-catalog.json`, pushes KV `algo-catalog:v1`.
      Flags: `--harvest`/`--paste`/`--dry`.
- [x] `.gitignore`: catalog files (raw/paste/json) — reproducible + KV-backed, large (correlation matrices).
- [ ] Allocation optimiser = its own later task (consumes `algo-catalog:v1`).

### Track B review — SCOPED to Hedged Options + Naked Option Buying (final)
- **Better harvest mechanism found:** the page caches the FULL catalog (79 algos, rich fields incl.
  per-algo correlation matrices) in sessionStorage `dhan_all_algos_cache_v2`. Read it directly — no
  fetch/XHR interception (the agent's JS tool guardrail blocks XHR hooks anyway), no AES request to
  reproduce, COMPLETE in one shot. This supersedes the earlier UniversalAlgoSearch browser-harvest.
- **Trading style = `tags`, not `category`:** tag `Hedged`→Hedged Options (29), tag `Buying`→Naked
  Option Buying (12). Confirmed against both filtered grids (Hedged=all Credit Spreads; Buying=RR/TSL/GRID
  /SkewHunter). category is coarser (Index Strategies/Options/Investing/Swing).
- VERIFIED on REAL data: harvested 41 scoped algos via `dhan-harvest.snippet.js` → importer mapped the
  camelCase cache schema (algoReturns→returns horizon map, sharpeRatio, maxDrawdown, hitRatio, minAmount→
  minCapital, deployedCount, AlgoScore→score) → style derived (29 Hedged + 12 Naked, 0 missing) → 102-peer
  correlation matrices kept (0 missing) → wrote `data/algo-catalog.json` (356KB) → pushed `algo-catalog:v1`.
  Sanity guard (1 row → REFUSE, exit 1) and scalar paste/CSV fallback tested green.
- Importer scopes by `--styles` (default `Hedged Options,Naked Option Buying`); snippet pre-filters too.
- Data-layer only — nothing in the app reads `algo-catalog:v1` yet (next: the allocation optimiser).

## Out of scope / unchanged
- Sleeve-level totals unchanged. Brokers READ-ONLY, no order writes.
- ToS: user's own data, gentle/occasional polling. AWS-WAF/httpOnly → manual cookie refresh expected;
  paste/CSV is the durable backstop for both tracks.

## Open questions
1. Build order: Track A first (live attribution), then Track B (monthly research)? (recommended)
2. KV keys `algos:v1` (A) and `algo-catalog:v1` (B) ok? App reads now, or data-layer only for now?
3. Track A reconcile target = F&O sleeve net, stopped algos labeled-historical — confirm?

---

## Stratzy daily capture + Dhan join (DONE 2026-06-30) — data only, no screen yet
B+C built behind the same adapter pattern (paste fallback intact). Discovery in feedback.md.
- [x] `scripts/lib/stratzy-adapter.mjs` — pure normalizer + the LIVE/BACKTEST SPLIT at `liveSince`
      (date < liveSince = backtest, ≥ = live); `hasBacktestSegment` only at ≥5 backtest days (off-by-one
      excluded); `liveDays`; headline + backtest metrics. `fromHarvest`/`fromPaste`.
- [x] `scripts/lib/stratzy-adapter.test.mjs` — 10 tests: backtest-head, fully-live, <5-day-head fixtures
      assert every point labeled + the ≥5 threshold. Green.
- [x] `scripts/lib/stratzy-harvest.snippet.js` — one `GET /api/web/algo/list` (credentials:include) → download.
- [x] `scripts/import-stratzy-daily.mjs` — normalize 148 → JOIN Dhan on `_id==id` (prefers full-79
      `data/dhan-full.raw.json`, falls back to scoped-41 `algo-catalog.raw.json`) → `record.dhan` |
      `correlationAvailable` → `data/stratzy-daily.json` → KV `stratzy-daily:v1`.
- [x] gitignore the Stratzy/dhan-full data files.

### Review (verified on real data)
- 148 algos: 140 with curve, **62 with ≥5-day backtest segment**, 41/148 correlation-joined (scoped Dhan).
- Split verified: Wave-Return 78 backtest + 52 live (overfit case: clean backtest, live −50% mdd); held
  IV-Imbalance/Damper fully-live (0 backtest); BTST split fine despite empty `liveSinceBacktested`.
- KV push 1.43 MB OK. DATA ONLY — no scores computed (next step: the screen).
- **GAP:** Dhan-full 79 download was blocked by Chrome's multi-download prompt → join used scoped 41.
  Drop `data/dhan-full.raw.json` (79) in and re-run → coverage jumps to ~79 (importer already prefers it).
- SKIPPED per instruction: per-algo `advisorMetrics` loop (per-range winRatio/avgProfit/booksizes).

---

## Follow-up — close the 3 equity-composition gaps at source (deferred, do NOT fix now)

Opened 2026-07-03 from the composition-reconstruction analysis (see the CLAUDE.md source-of-truth
table + `tasks/eod-book-design.md`). Contract notes + `applyCorpActions` reconstruct **17/20**
equity holdings; **3 delivery buys have no captured note**, so the broker sync stays required to
cover them (they surface as `reconcile.drift[]` "un-noted (broker)" in the EOD book):

- [ ] **ZYDUSLIFE** (Zerodha/INDIAN) — broker 33, notes ~1 (residual ~32). Chase the missing
      delivery contract note(s) into `inbox/`.
- [ ] **PRICOLLTD** (Zerodha/INDIAN) — broker 56, notes ~6 (residual ~50). Same.
- [ ] **BANKBARODA** (Upstox/SWING) — broker 28, notes 0 (only Fyers F&O options on the name,
      no delivery note). Chase the Upstox delivery note into `inbox/`.

Root cause: these buys pre-date the note-capture window OR their delivery notes were never
fetched/parsed (Upstox emails F&O notes but delivery/holdings notes are barely in the corpus).
Goal: land the notes so the pipeline reconstructs them at source and the EOD-book drift clears —
NOT to hand-edit composition. Verify after backfill by re-running the reconstruction (residual → 0).

---

# Plan — 6-region responsive app shell (PROPOSED — awaiting approval, 2026-07-05)

Source mock: `mock-shell-responsive.html` (uploaded, approved layout). Branch: `shell-6region`
(commit here, no push; leave stray `.claude/*` edits out of scope). Region content map LOCKED
this session — see decisions below. This is an architectural redesign → propose-and-wait; do NOT
enter implementation until this section is greenlit.

## Locked decisions
- **Header (global):** net-worth hero ONLY + the 3 Market-Wrap ticker rails (`TickerLine`:
  Indices · Commod·FX · News) moved up from `MacroTab`. Asset summary cards leave the header.
- **Sidebar (global, ≥1024):** the 7-tab nav rail; top pills < 1024. Single active-tab source
  feeds both renderings.
- **Footer (global):** freshness · sync badge · data-as-of · AI refresh · tax memos (`CFMemo`) ·
  disclaimer — pulled out of the tabs.
- **Statistics:** the AI `AnalysisCard` lives here on EVERY tab (fixed slot).
- **FD widget:** synthesize a NEW maturity-timeline widget (FD had no native 2nd visual).
- Per-tab main/widget/stats per the locked map (Overview/Indian/FD/MF/US/Trading/Wrap).
- US: dividend income stays in statistics (keeps widget symmetric with other sleeve tabs).

## Phase 0 — Grid scaffolding + tokens (`app/globals.css`)  ✅ DONE (partial, by design)
- [x] Add `.shell` grid — the `.main` column doubles as the shell grid. REDUCED to the
      header/sidebar/main areas for now (base 1-col → ≥1024 `12rem minmax(0,1fr)`); the full
      4-tier `grid-template-areas` with widget/stats/footer land verbatim in Phases 3–4, when
      those regions have content (an empty widget/stats row would be a broken intermediate).
- [x] Region children carry `min-width:0` (`.shell > *`, STRESSHARD-safe).
- [x] `main` capped + centered — reused `.main`'s existing 1760px cap (unchanged); revisit the
      exact cap in Phase 4 when the 16rem widget/stats rail lands.
- [x] Header rails clip (`.hdr-rails{overflow:hidden}` + `.tkv`/`.tkw` clip) — docOverflow=0 verified.

## Phase 1 — Header rebuild (`app/page.js`, new shared header component)  ✅ DONE
- [x] Strip header to net-worth hero (asset-card strip removed in Phase 2, once the sidebar/pills replaced its nav).
- [x] Extract `TickerLine` into `app/components/shared/TickerRails.js`; render the 3 rails in the header; removed from `MacroTab`.
- [~] Relocate the asset summary cards into Overview (statistics) — DEFERRED to Phase 4 (`headerCards` array kept computed for the move).

## Phase 2 — Sidebar / nav rail  ✅ DONE
- [x] Vertical tab rail (`.shell-sidebar`, `.snav-*`) ≥1024 + top pills (`.tab-pills`, `.tpill-*`) <1024,
      both driven by the SAME `tab`/`selectTab`. Sidebar sticky under the frosted header (`--snav-top`
      = measured header height). certify repointed to `.snav-*` (hash nav is primary; click is fallback).
- [x] User refinement (2026-07-06): the 3 ticker rails run INLINE beside the NW hero — the `.hdr-rails`
      wrapper spans the hero row behind the hero (z-1), which floats on a masking gradient panel (z-2)
      so each marquee dissolves under the NW figure; labels anchor on the right (`.tkw` row-reverse).
- Verify: render-verified (sidebar ≥1024 / pills <1024 / nav both ways / asset cards gone) + certify
  GREEN — docOverflow=0, RSP-001/002/004=0, SYMMETRY/DIRECTION/VALUE-SIZE PASS, 6 widths × both themes ×
  normal + STRESSHARD.

## Phase 3 — Global footer  ✅ DONE
- [x] New `app/components/shared/ShellFooter.js` — one persistent footer driven by the active
      tab: per-tab `FreshnessTag`/`SyncBadge` provenance + the ITR-verified `CFMemo` tax memo +
      the app-wide disclaimer. Removed the standalone `.sec` freshness rows from Indian/FD/US/Algo
      and the `CFMemo` blocks from Overview/Indian/US/MF (data via `FY.cf.*` + `MF_SIP.elssLockYears`,
      all already in page.js). MF's NAV tag stays contextual in its value card (not duplicated).
- [x] User refinement: the WHOLE footer is persistent — a fixed, frosted panel pinned to the
      viewport bottom (mirrors the sticky header), including the tax memo. `--foot-h` (ResizeObserver
      on the panel) reserves matching `.shell` bottom padding; capped at 46vh w/ internal scroll.
- [x] certify GREEN (docOverflow=0, RSP-001/002/004=0, SYMMETRY/DIRECTION/VALUE-SIZE PASS) across
      6 widths × both themes × normal + STRESSHARD; render-verified all 7 tabs.
- [ ] OPEN (design): the persistent memo panel is ~300px tall on Overview/Indian/US/MF (≈⅓ viewport)
      — decide keep-as-is vs condense/collapsible per user annotation feedback.

## Phase 4 — Per-tab region wiring (7 tabs)
- [ ] Overview · Indian · FD (build maturity widget) · MF · US · Trading · Wrap slotted per map.
- [ ] `AnalysisCard` → statistics slot everywhere.

## Phase 5 — Verify (blocking)
- [ ] `audit/responsive/certify.mjs` green: 001/002/004 = 0 + docOverflow = 0 across all 6 widths ×
      both themes × normal AND stress; `STRESSHARD=1` clean. Header rails are the risk area.
- [ ] Render-verify each tab in the live app (not just API payload).

## Phase 6 — Commit
- [ ] Commit to `shell-6region` (scoped to shell files; exclude `.claude/*`). No push unless told.
