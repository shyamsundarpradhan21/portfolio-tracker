# Plan — FY24-25 Dhan realised from trade-history CSV (note→realised "to the dot") — 2026-07-13

## Context
User dropped `TRADE_HISTORY_CSV_1100893433_2024-04-01_2025-03-31_0_.csv` (Dhan FY24-25 trade
history, 3184 fills). Ingest daemon parked it UNRECOGNIZED (no parser). This is the "2024-25 Dhan
CSV" the note→realised system was WAITING for (`app/lib/fnoRealised.js` comment + memory): the
FY24-25 Dhan realised was fragmented because ~125 split-row contract notes are excluded from FIFO,
so the live gap-fill is scoped to `NOTE_REALISED_FROM='2026-04-01'`. The CSV bypasses the fragmented
notes with actual fills. Goal (user-confirmed): reconstruct realised to the dot, F&O + equity.

## Feasibility — VERIFIED against the real CSV + real fnoFifo engine (scratchpad)
- **F&O: PASS.** 1394 fills, 0 unparsed, 0 incomplete keys, 426 contracts, `residualLots=0` (every
  position opens+closes in-file). Reconstructed gross **−183,337 vs broker-tax −183,353 → diff ₹16**
  (0.009%). Names normalise cleanly: `NIFTY 13 FEB 23500 CALL` → `NIFTY13FEB2523500CE` (expiry YEAR
  inferred from trade date; CALL/PUT→CE/PE; all options, no futures).
- **Equity: PARTIAL — cannot be "to the dot" from a single-FY file.** 1791 rows (880 buy/911 sell);
  **27.4% of sell value (₹64.0L) references buys made BEFORE FY24-25** (cost basis absent) → in-file
  FIFO −76,343 vs broker-tax truth −55,960 (~₹20k off). Needs full multi-year history OR FY24-25
  opening holdings+cost to seed the books.

## Phase 1 — F&O (build now; proven)
- [ ] `scripts/import-dhan-tradehistory.mjs` — parse CSV → F&O fills → `fifoRealisedByDay` → per-day
      (date, Dhan) realised; reconcile FY totals vs broker-tax (gate: within a small tolerance of
      −183,353); DRY-RUN by default, `--write` to persist.
- [ ] Merge FY24-25 Dhan rows into `data/fno-realised-notes.json` (+ KV `ledger:fno:realised`),
      `source:'tradehistory-fifo'`. Additive; never override a broker-captured row.
- [ ] Cutover so it DISPLAYS: make `applyFnoRealised` honour tradehistory rows below
      `NOTE_REALISED_FROM` (per-source allow, or a per-broker/date floor) — Dhan FY24-25 only, so
      other brokers' fragmented pre-2026 stays broker-sourced. Keep the additive gap-fill semantics.
- [ ] Verify: reconcile print; render-verify the trading-journal FY24-25 Dhan daily curve appears;
      confirm no change to FY26-27 (already covered) or other brokers.
- [ ] Ingest hygiene: move the CSV out of `inbox/unrecognized/` into a tracked source location; add
      a `trade-history` parser (or document the manual script) so a future drop doesn't silently park.

## Phase 2 — Equity (DECIDE given the caveat; not to-the-dot from this file)
Options: (a) SKIP realised reconstruction — broker-tax already gives FY24-25 Dhan equity total
(−55,960) and ITR gives STCG/LTCG; (b) populate FY24-25 equity EXITS into `indian_exits.json`
(sell events, no cost basis needed) for the deployment/withdrawal ledger, flagging per-trade
realised as ~73% complete; (c) user provides full multi-year equity history / FY24-25 opening
holdings → complete FIFO. AWAIT user's pick before building.

## Review — RESOLVED as VALIDATION (no reconstruction built) 2026-07-13
Mid-build discovery (re-plan on surprise): the FY24-25 Dhan realised was ALREADY complete and
displayed. The tax report dropped earlier today flowed `parse-broker-tax.py` → `fno_daily` →
`backfill-fno-ledger.mjs` → `data/fno-ledger.json` as 176 per-day `source:'report'` rows summing
to −183,353 WITH real charges; `broker-tax.json` carries the same FY total. So Phase 1's premise
("fix a visible gap / extend the daily curve") was already satisfied — building the merge+display
cutover would change no displayed number and add no charges.
- **Delivered instead:** the CSV→FIFO reconstruction (scratchpad feasibility) independently
  VALIDATED the displayed figure to **₹16** (CSV gross −183,337 vs report −183,353, residualLots=0).
  User chose "Done — validated." No repo code written.
- **Equity:** SKIPPED per user (single-FY CSV is 27.4% short on cross-year cost basis; broker-tax
  −55,960 + ITR STCG/LTCG already cover it).
- **CSV filed** as source-of-record in gitignored `data/reports/` (safely ignored by
  parse-broker-tax.py — verified broker-tax.json regenerates byte-identical). Preserved for a future
  full-history equity reconstruction if ever wanted.
- **Left as-is (optional):** the dormant note→realised backup (`fno-realised-notes.json`) stays
  fragmented for FY24-25 Dhan (+19,658 from 42 partial notes); nothing displays it. The CSV could
  complete it later for laptop-off resilience — reconstruction proven, not wired.
- **Ingest gap noted:** a `TRADE_HISTORY_CSV_*.csv` drop parks as UNRECOGNIZED (no parser). If
  trade-history drops become routine, add a recognizer so they don't silently park.

---

# Plan — broker-token freshness self-heals on the open window (late laptop-open) — 2026-07-13

## Why
The only fixed token minter is `DailyMorning` (08:55). If the laptop is asleep at 08:55 — or the
SEBI pre-open cycle kills the evening token before the daemon relaunches at 09:13 — the F&O capture
reads dead tokens and logs `F&O no-tokens` all session, with no recovery. Happened 2026-07-13: opened
late, F&O tape blank 09:13→manual-mint. Equity was fine (keyless Yahoo). The Supervisor healed dead
*daemons* every 5 min but never refreshed *tokens*.

## Approach (confirmed with user: Supervisor home + "minted since today's pre-open" freshness)
- [x] `scripts/ensure-tokens.mjs` — in-window (`open`, or `pre`≥08:45 IST) + stale (token mtime <
      today 08:45 IST; ignores Dhan's lying `expiryTs`) → force-mint (Dhan `mint.py` pure-API, Upstox
      `login.py` headless; Fyers parked/skipped). Idempotent when fresh; per-broker degradation so
      Dhan always heals. `--force` for manual recovery.
- [x] Wire into `scripts/supervisor.ps1` — probe each in-window tick (`in` = open|pre), log
      MINTED/MINT-FAIL events. No task re-registration (Task Scheduler re-reads the .ps1).
- [x] `DailyMorning` 08:55 unchanged — primary pre-open mint; `ensure-tokens` is the backstop.
- [x] Docs: `SCHEDULE.md` (daemon blockquote + table row) + `tasks/feedback.md` lesson.
- [x] Verify: no-op skip (post-market) ✓; `--force` mints both brokers + redacts + logs ✓;
      supervisor.ps1 parses ✓ and runs clean with the token block correctly guarded off on `post` ✓.

## Review
Root cause was a fixed-clock dependency, not a code bug. Fix makes token freshness a self-heal keyed
on the OPEN window (Supervisor 5-min tick + AtLogOn), so opening the laptop any time the market is
open recovers within ≤1 tick and the daemon reads the new token on its next ~10s poll — zero
dependence on the 08:55 task having fired. Minimal surface: one new ~70-line script + ~12 lines of PS;
reuses the existing mint scripts and the Supervisor's established "delegate to a node helper" pattern.
Live end-to-end (in-window stale→mint) will confirm itself on the next morning the laptop opens late;
the branch is exercised by `--force` today. Fyers intentionally out of scope (parked, needs a desktop).

---

# Plan — note→realised F&O derivation (laptop-independent realised) — 2026-07-11

## Why
The `fno-ledger` realised (`grossRealised`) is sourced from the broker's daily `realizedProfit`
(evening capture), which the broker WIPES at next pre-open. Laptop off ⇒ that evening capture
never runs ⇒ that day's broker-sourced realised is gone. But every trade's CONTRACT NOTE sits
permanently in Gmail → parsed into `ledger:cn:*`. Charges already reconstruct from notes
(`ledger:fno:overlay`); realised did NOT — it was deferred (needed cross-note FIFO). This builds it.

## Feasibility (verified against real KV, 2026-07-11)
830 notes / 756 self / 677 F&O / 7,286 F&O fills (2023→2026). ~81% of fills have a COMPLETE,
stable contract key after `normContractKey` (e.g. `OPTSTKHDFCLIFE28MAR24620.00CE`,
`FUTSTKASHOKLEYLND26JUN25`). The same contract → same key across notes, so cross-note FIFO keys on
the normalized instrument string — NO underlying/expiry parsing. The truncation the todo warned of
is real but a minority (Dhan/older layouts split one fill across rows: `OPTSTK SHRIRAMFIN` + `105 CE`)
→ detect via `isCompleteContract`, flag the note, exclude from FIFO (surfaces as residual open lots).

## Design (DORMANT artifact — matches the charge-overlay pattern; nothing live reads it yet)
- `scripts/lib/fnoFifo.mjs` — pure per-contract FIFO: books realised on each close at the ORIGINAL
  entry price (identical algo to `backfill-fno-realised.mjs`, which is broker-trades-sourced). Plus
  `normContractKey` + `isCompleteContract`. Unit-tested.
- `scripts/derive-fno-realised.mjs` — reads `ledger:cn:*` (self, F&O), keys+sorts fills per broker,
  runs the FIFO, aggregates realised per (date,broker). Reconciles per-FY×broker vs `fno-ledger`
  grossRealised; reports fragmented notes + residual open lots (incompleteness). DRY by default;
  `--write` → `data/fno-realised-notes.json` (gitignored mirror) + KV `ledger:fno:realised`.

## Steps
- [x] `scripts/lib/fnoFifo.mjs` (FIFO + key helpers)
- [x] `scripts/lib/fnoFifo.test.mjs` — 10/10 green (carried long/short, partial-FIFO order, same-day,
      residual lots, distinct contracts, rounding + normContractKey + isCompleteContract)
- [x] `scripts/derive-fno-realised.mjs` (note-sourced FIFO + reconciliation, dry-run/--write)
- [x] Verify: dry-run reconciled vs broker `fno-ledger` — FY26-27 Dhan Δ **−₹114 on ₹3.2L** (0.04%),
      FY24-25 Fyers Δ **₹0**; incompleteness surfaced (residual lots per broker; 125 fragmented notes)
- [x] Persisted dormant artifact: KV `ledger:fno:realised` + gitignored `data/fno-realised-notes.json`
- [x] Updated the schedule-resilience artifact (realised now note-derivable)
- [x] Commit
- [x] WIRED into the live view (user go-ahead): `app/lib/fnoRealised.js` `applyFnoRealised` gap-fills
      the note-derived realised onto the charge-overlaid ledger in `app/api/portfolio/route.js`
      (`loadFnoRealised` mirrors `loadFnoOverlay`). SAFE/additive: never overrides a captured broker
      row; only fills a genuine gap or upgrades a charge-only day; scoped to `NOTE_REALISED_FROM =
      2026-04-01` (verified-complete window). Verified end-to-end: `/api/portfolio` HTTP 200,
      `_noteRealisedApplied {added:0,upgraded:1}` — 2026-07-07 Dhan gap day recovered from the note.
      5 unit tests + 276 regression tests green.

## Pending (user-owned) — 2024-25 Dhan CSV
- [ ] **USER: add the 2024-25 Dhan CSV** to complete note→realised for the fragmented FY24-25 Dhan
      history (the 125 excluded split-row notes) so it's "to the dot". Then: ingest → `ledger:cn:*`,
      re-run `scripts/derive-fno-realised.mjs --write`, confirm fragmented/residual counts drop, and
      LOWER `NOTE_REALISED_FROM` (app/lib/fnoRealised.js) to cover the recovered history.
      → **REMINDER set:** memory `pending-dhan-2024-25-csv` surfaces this on any status request.
- [ ] Alt/also: reassemble the 125 fragmented notes at the PARSER level (engine.py) so their fills
      carry a complete key — recovers the excluded history without a manual CSV.

## Review
Built the note→realised derivation, dormant and verified. Three pieces:
- `scripts/lib/fnoFifo.mjs` — the per-contract FIFO factored out of `backfill-fno-realised.mjs` (which
  runs it over the Dhan trade-history); books realised on each close at the ORIGINAL entry price, plus
  `normContractKey` / `isCompleteContract`. Source-agnostic + unit-tested (10/10).
- `scripts/derive-fno-realised.mjs` — feeds the durable contract-note fills (`ledger:cn:*`, self, F&O)
  through that engine and reconciles per FY×broker against the committed broker-sourced ledger.
- Verified against REAL KV (830 notes / 677 F&O / 5,437 FIFO fills): on the current-format year the
  note reconstruction reproduces the broker to **−₹114 on ₹3.2L** and FY24-25 Fyers to **₹0** — proving
  the notes independently recover realised. Where the note history is incomplete (Fyers/Upstox residual
  lots) or the layout is split (125 fragmented Dhan-2024/Upstox-2025 notes) it FLAGS rather than fudges.
Then WIRED it into the live view (user go-ahead): a SAFE additive gap-fill (`applyFnoRealised`) that
recovers realised the broker missed (verified: 2026-07-07 Dhan gap day now served) without ever
overriding a captured broker row, scoped to the verified-complete FY26-27 window. The pre-2026
fragmented history stays on the broker rows until the user's 2024-25 Dhan CSV lands (reminder set via
the `pending-dhan-2024-25-csv` memory). KV `ledger:fno:realised` + gitignored mirror; graceful when absent.

---

# Plan — retime morning to 08:55 + symmetric DailyEvening — 2026-07-11

## Requested
Shift `DailyMorning` 07:00 → 08:55; make `CaptureIntradayIndia` launch at 08:55 and "start like
intraday US" (no inline token mint); "build a daily evening just like daily morning".

## Decisions (from the user)
- Both morning tasks at **08:55** exactly; **drop `capture.cmd`'s own Dhan+Upstox mint** — mint is
  now owned solely by `DailyMorning`'s sync. Safe because the daemon idles until the 09:13 open, so
  the sync (starting 08:55, done in a few min) has refreshed the token files on disk first.
- India intraday "starts like US" = wrapper just launches the daemon; no mint step.
- New `DailyEvening` built like `DailyMorning` (chained `.cmd` + `register-*.ps1`), replacing
  `BrokerSyncEvening`. **Timing: 18:40 weekdays** — co-timed with `CaptureIntradayUS` (18:40) so the
  evening mirrors the morning (both morning tasks share 08:55). No mint race: US capture is
  token-free (keyless Yahoo), so the two fire together cleanly.

## Correctness linchpin (verified)
`capture-daemon.mjs` → `lib/brokers.mjs` reads `mcp/{dhan,upstox,fyers}/.token.json`. `DailyMorning`'s
`sync-brokers.mjs` refreshes exactly those: `dhanToken()` self-mints + writes Dhan (line 121-122);
Upstox mint-on-demand runs `login.py`; Fyers from `FyersDailyLogin` (08:15). Cold late-logon: capture
skips a broker for a tick or two until the sync finishes, then self-heals — the accepted coupling.

## Steps
- [x] `register-morning.ps1`: 7:00AM → 8:55AM (+ comments/desc)
- [x] `register-capture-daemons.ps1`: India trigger 9:10AM → 8:55AM (+ comments/desc)
- [x] `capture.cmd`: remove the India token-mint block → both sessions just launch the daemon
- [x] `scripts/evening.cmd`: new thin chainer → `sync-evening.cmd`
- [x] `scripts/register-evening.ps1`: register `DailyEvening` (weekday 18:40), retire `BrokerSyncEvening`
- [x] `daily-check.mjs`: heal target BrokerSyncEvening→DailyEvening; snapshot `due` 07:30→09:30 (past the 08:55 start); brokerSync `due`→19:00
- [x] `SCHEDULE.md` + `realised-design.md` + `resilience-benchmark.md` + legacy script banners: BrokerSyncEvening→DailyEvening + times
- [x] `scripts/lib/scheduleHealth.mjs`: JOB_META labels + cadence (morning → 08:55, evening → 18:40)
- [x] Apply live: DailyMorning → 08:55 (Set-ScheduledTask); DailyEvening registered + BrokerSyncEvening retired
- [!] CaptureIntradayIndia live retiming BLOCKED — LogonType Password rejects modification without the
      stored Windows pw (same elevation constraint as the session-0 move). USER must run the updated
      `register-capture-daemons.ps1` (elevated; re-prompts for the pw) to move it 09:10 → 08:55.
- [x] Verify: schedule-health 7 ok · 0 stale; daily-check dry-run clean; DailyMorning/DailyEvening triggers confirmed
- [x] Commit

## Review
Retimed the morning cluster to 08:55 and built a symmetric `DailyEvening`, mirroring `DailyMorning`.

- **`DailyMorning` 07:00 → 08:55** (live, applied via `Set-ScheduledTask`). It is now the SOLE morning
  token minter.
- **`CaptureIntradayIndia` "starts like US"**: stripped the Dhan+Upstox mint out of `capture.cmd` so
  both sessions just launch the daemon. Safe because the daemon idles until the 09:13 open, by which
  time `DailyMorning`'s sync (08:55) has refreshed `mcp/{dhan,upstox,fyers}/.token.json` — the exact
  files `lib/brokers.mjs` reads. Cold late-logon self-heals (skip a broker a tick or two). The task
  trigger move to 08:55 is edited in the source-of-truth register script but its LIVE apply is blocked
  on the stored password (see above) — until the user re-runs the register script it launches at 09:10,
  which is harmless (daemon idles to 09:13 either way; only the warm-up differs).
- **`DailyEvening` 18:40 weekdays** (live), replacing `BrokerSyncEvening`. Co-timed with
  `CaptureIntradayUS` (18:40) so evening mirrors morning; NO mint race because US capture is token-free.
  `evening.cmd` → `sync-evening.cmd`, `register-evening.ps1` (retires BrokerSyncEvening).
- **Follow-on correctness fix**: `daily-check.mjs` snapshot `due` moved 07:30 → 09:30 — otherwise a
  self-heal tick between 07:30 and 08:55 would re-run `DailyMorning` early and defeat the retiming; and
  its evening heal target renamed to `DailyEvening`.
- Verified: `schedule-health.mjs` 7 ok · 0 stale (new labels/cadences), `daily-check` dry-run clean,
  live triggers confirmed (DailyMorning daily 08:55; DailyEvening weekly Mon–Fri 18:40).

---

# Plan — session-0 the background scheduler tasks (kill the every-5-min flicker) + window-aware Supervisor — 2026-07-11

## Context
`Supervisor` runs every 5 min, 24/7 under `LogonType Interactive`, so each tick briefly draws a
PowerShell/node console (despite `-WindowStyle Hidden`) over whatever is on screen — the flicker the
user sees over Netflix. It's the ONLY task that re-pops a window; the capture/ingest daemons launch
once and then run persistently hidden. Fix: move the background tasks into **session 0** (no desktop,
nothing can draw), and make `Supervisor`'s cadence **window-aware** per the user's request.

Constraint found: session 0 has two flavours. **S4U** (no stored password) can't decrypt the
DPAPI-bound HTTPS credential, so any task that `git push`es breaks. **Password logon** (stores the
Windows password, LSA-encrypted) keeps credential access. `capture-daemon.mjs:61,74` pushes the
archive at close → captures need Password logon; `Supervisor` + `IngestDaemon` are push-free → S4U.

## Decisions (from the user)
- Session 0 for: `Supervisor`, `IngestDaemon` (+ `IngestWeeklyReport`), `CaptureIntradayUS/India`.
- Captures → `LogonType Password` (user types pw; stored LSA-encrypted) so the close push still works.
- `Supervisor` + Ingest → S4U (push-free, no password needed).
- Stay Interactive (git push + puppeteer/browser): `DailyMorning`, `BrokerSyncEvening`.
- `Supervisor` cadence: 5 min during India (09:10–15:35) + US (18:40–02:35) windows; **2 h** otherwise.

## Steps
- [x] `register-supervisor.ps1`: principal → S4U; triggers → 2 h base + India 5-min window + US 5-min window + at-logon; refreshed comments/desc.
- [x] `register-ingest-daemon.ps1`: principal → S4U (covers `IngestDaemon` + `IngestWeeklyReport`); noted why S4U-safe.
- [x] `register-capture-daemons.ps1`: `Get-Credential` prompt; register with `-User`/`-Password` (Password logon).
- [x] Validated building blocks non-destructively: `.Repetition`-on-Weekly builds (PT5M/PT6H25M, Mon–Fri); `Register-ScheduledTask -User/-Password/-RunLevel` is a real param combo; `S4U` is a valid LogonType.
- [!] BLOCKED — apply needs ELEVATION. Re-registering to S4U/Password grants a batch-logon right → Access denied (0x80070005) from a non-elevated shell, and I can't answer UAC. Confirmed Supervisor left intact/unchanged after the denied attempt.
- [x] **USER (elevated PowerShell)**: ran all three register scripts (captures prompted for the Windows pw) — confirmed working.
- [x] **USER**: restarted `IngestDaemon` (stop→start); Supervisor picks up S4U on its next tick.
- [x] Verify: user confirmed the elevated run succeeded (S4U on Supervisor/Ingest, Password on captures, heartbeat fresh).
- [ ] Deferred verify: captures still push at next close (India ~15:32 / US ~02:30) — `capture-*.log` shows "archive pushed". (Can only be observed at the next real close.)
- [x] Commit + push the three edited register scripts after the elevated run was confirmed.

## Review
Root cause of the Netflix flicker: `Supervisor` was the only task that *re-popped* a window (every 5
min, `LogonType Interactive`); despite `-WindowStyle Hidden`, an interactive-session console draws for
~200 ms before it hides. The persistent daemons (capture/ingest) launch once and never re-pop, so they
were never the cause. Fix = move the background tasks into **session 0** (no desktop → nothing draws):
`Supervisor` + `IngestDaemon`(+report) via **S4U** (push-free, no password), captures via **Password
logon** (they `git push` the archive at close, and S4U can't decrypt the DPAPI-bound HTTPS credential —
the one non-obvious constraint that made a blanket S4U move wrong). Left `DailyMorning` /
`BrokerSyncEvening` Interactive (git push + puppeteer). Also made `Supervisor` window-aware per request:
5-min ticks only inside the India (09:10–15:35) + US (18:40–02:35) capture windows, a 2-h backstop
otherwise (keeps IngestDaemon alive for overnight mail + the hourly daily-check) — fast heal only where
a mid-window daemon death costs intraday data, avoiding the ~55-min blind spot a flat 1-h would create.
All three register scripts (the versioned source of truth) updated + committed. Applying required an
elevated shell (S4U/Password grant a batch-logon right → UAC), so the user ran them; I validated the
non-obvious building blocks (`.Repetition`-on-Weekly, the `-User/-Password/-RunLevel` param set, S4U
enum) beforehand. Only the close-time archive push remains to observe at the next market close.

---

# Plan — Minimalism across all scheduled tasks (close the resilience loopholes) — 2026-07-10

## Why
The "Scheduled Tasks & Resilience" artifact surfaced glaring loopholes. Traced to source
(`SCHEDULE.md`, `tasks/resilience-benchmark.md`) + verified against the wired reality:
1. **Accretion is the anti-minimalism** — ~12 jobs across 3 scheduling systems, each a
   reactive patch (token-rot→mint, mint-miss→retry, snapshot-freeze→local task, daemon-death
   →watchdog). "Heaviest mechanism, one patch at a time."
2. **Silent failure with no surfaced health signal** — all 3 past incidents (`feedback.md`)
   were "found by a manual check, not any alert." Nothing reports *a job didn't run*.
3. **Doc ≠ reality** (the drift the SoT doc exists to prevent): `SCHEDULE.md §1` headlines a
   `/api/premarket` cron that is **NOT in `vercel.json`** (route exists, cron gone); no
   `register-*.ps1` for `DailyBrokerSync` / the login tasks; 3 Claude-routine prompts unversioned.
4. **Redundancy without a clear owner** — dual F&O-realised capture (evening + CloudFnoCapture),
   dual snapshot (Vercel cron `growth:<date>` drops ~35% + local recompute).
5. **Remote routines known-unreliable but still load-bearing** (record-snapshot died after 1 run).

## The minimalism thesis
Not a 13th mechanism (monitoring stack). The one cross-cutting thing that would have caught
ALL 3 past incidents at once: a **freshness surface computed from the dated fingerprint each
job already leaves** (a committed date key / `syncedAt` / `updatedAt`). One check replaces N
reactive patches; zero new infra; readable anywhere (CLI now, app strip later).
NOT solving the laptop-SPOF by going cloud — `resilience-benchmark.md` already ruled that HIGH
lift + breaks the PAN-stays-local posture. Laptop stays primary; the check makes any freeze
visible within one cadence instead of 3 weeks.

## Steps
### 1. Schedule-health surface (keystone — closes loophole 2) — DONE 2026-07-10
- [x] `scripts/schedule-health.mjs` — data-driven JOB manifest; each job → newest committed
      fingerprint date vs a per-job `maxAgeDays`; prints `ok / STALE / unknown` table + summary;
      `--json`; exit 1 on any critical STALE (so it can gate). `HEALTH_TODAY=` override for testing.
- [x] Honest blind spots: `gmail-state.json` / `fno-overlay.json` (gitignored) + `/api/premarket`
      (KV) report `unknown` with a note, never a false `ok`. Premarket row flags the §3 drift.
- [x] Verify: live run 7 ok · 2 unknown · exit 0; `HEALTH_TODAY=+10d` → 7 STALE · exit 1 (gates);
      `+3d` → only the 3 daily jobs (maxAge 2) STALE, weekday jobs (maxAge 4) still ok (weekend
      tolerance discriminates correctly).
### 2. Collapse doc-vs-reality to one source (loophole 3)
- [x] **Premarket fork → resolved by folding, not restoring (Option C, "fold multiples into one").**
      The FII/DII trail already builds on the live `/api/snapshot` cron via the shared
      `captureFiiDiiTrail`; the only gap was that the cron persisted cash but not the FII
      derivative stance (`der`). Fixed by:
      - moving `fetchParticipantStats` (+ MON/toDDMMYYYY/istDDMMYYYY helpers) out of
        `app/api/premarket/route.js` into the shared `app/lib/fiidiiTrail.js` — one copy,
        two callers (route + cron), matching the existing `fetchFiiDii`/`nseCookie` pattern;
      - `captureFiiDiiTrail()` now fetches the derivative stance and passes it to
        `persistTrail`, so the daily cron builds the positioning history too.
      - `SCHEDULE.md §1` + overview rewritten: the sole Vercel cron is `/api/snapshot`
        (growth + FII/DII cash + derivatives), `/api/premarket` is the live route (on-demand
        persist, no cron), cap corrected 10-day → ~20-session.
      - Verified: 8/8 behavioral checks (stubbed fetch) — moved fn parses CSV → bearish/divergence,
        cron path now fetches participant-OI, persistTrail no-ops w/o KV. `next build`/KV write
        deferred to prod (no toolchain/KV in this clone — repo's documented KV-verify pattern).
- [x] Point `SCHEDULE.md` at the `schedule-health.mjs` manifest as the machine-checkable inventory
      (intro now says "run `node scripts/schedule-health.mjs`"; the manifest mirrors the table).
- [x] Add missing `register-*.ps1` (DailyBrokerSync) → `scripts/register-broker-sync.ps1`
      (mirrors `register-snapshot-daily.ps1` structurally; ASCII-clean; laptop-verify only — no pwsh here).
- [~] Capture the 3 Claude-routine prompts into `tasks/routines.md` — `CloudFnoCapture` fully versioned
      (command + env); the weekly-Dhan + monthly-stratzy prompts stubbed with a paste slot (they live only
      in the Routines UI). SCHEDULE.md §5/§6 point at it. ← paste the 2 prompts to finish.
### 3. Retire genuine redundancy / fold multiples into one (loopholes 4/5)
- [x] **UA string** — 14 identical `const UA` copies across API routes + libs folded into one
      `app/lib/ua.js`; all 14 import it. Verified: 0 leftovers, 14 imports, all parse ESM, none unused.
- [x] **F&O realised dual-capture → primary/fallback (deliberately NOT collapsed).** Cloud
      `CloudFnoCapture` = primary for Dhan/Fyers (laptop-off); laptop `BrokerSyncEvening` = fallback
      for them + sole path for Upstox. Redundancy kept on purpose (Remote routines die silently) and
      made safe by the `fno-ledger` freshness check in `schedule-health.mjs`. Documented SCHEDULE.md §4c.
- [x] **Snapshot cron + local recompute = NOT a fold** — deliberate two-tier (KV serving copy vs
      durable git archive); collapsing would re-blind the durable tier (loophole #1). Left as-is.
- [x] **Token minting / morning-cluster merge (4 → 2).** Verified the Upstox + Fyers MCPs just READ
      `.token.json` (Dhan self-mints), so `UpstoxDailyLogin` is redundant — the sync mints it on demand
      each morning → RETIRED. Chained `DailyBrokerSync` + `DailyNetworthSnapshot` into one `DailyMorning`
      task (07:00, sync→snapshot; `morning.cmd` + `register-morning.ps1`; `daily-check` heal target →
      `DailyMorning`). `FyersDailyLogin` stays (headed mint, can't chain). Laptop-apply: run `register-morning.ps1`.

### 4. Alerting — turn the health check from pull → push (closes loophole #1)
- [x] **Shared manifest** — `scripts/lib/scheduleHealth.mjs` (JOB_META + `classify` + fingerprint
      extractors) so the CLI and the cloud alerter can't drift on cadences. CLI refactored to consume
      it; behavior re-verified identical (live 7 ok · +10d 7 stale/exit 1 · +3d 3 daily stale).
- [x] **Channel-agnostic sender** — `app/lib/alert.js` `sendAlert()` (Telegram), env-guarded no-op
      without `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`. 8/8 unit tests (no-op + POST paths).
- [x] **Cloud watch** — folded into the nightly `/api/snapshot` cron (the only always-on cloud tick;
      no new cron, respects Hobby limit): reads the committed fingerprints of the laptop CRITICAL jobs,
      pushes ONE deduped alert on a fresh STALE. Fully gated on `alertConfigured()` → zero behavior
      change until env is set. Verified: stale-set logic picks the right jobs; route parses; guard proven.
- [ ] **ACTIVATION (user):** create a bot via @BotFather → set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
      in Vercel env → redeploy. Until then it's a silent no-op.
- [x] **Dead-man's-switch** — the cron pings `HEALTHCHECK_URL` on a successful run (`app/lib/alert.js`
      `pingHealthcheck`, wired into `/api/snapshot`); an external monitor (healthchecks.io) pages you if the
      ping stops — the only thing that watches the watcher. Guarded no-op. Activate: set `HEALTHCHECK_URL` in Vercel env.
- [ ] **Optional:** laptop-side same-day detection + self-heal ALREADY exists (`daily-check.mjs` via the
      `Supervisor` task; folded onto the shared manifest 2026-07-11). The only add would be a Telegram push
      on its STILL-STALE branch, so a failed self-heal pages you same-day (the cloud nightly already covers
      laptop-off). Deferred.

## Review
Applied the project's minimalism motive — "fold the multiples into one" — across the whole scheduled-task
layer: one freshness surface (`schedule-health.mjs`) replacing N reactive silent-failure patches; the FII
derivative capture, the 14 UA copies, and the schedule-health manifest each collapsed to a single home;
doc-vs-reality drift reconciled (`SCHEDULE.md`, the missing register script); F&O ownership made explicit
(cloud primary / laptop fallback) and snapshot's two-tier deliberately preserved. Finally turned the health
check from pull → push: a guarded, deduped, cloud-side Telegram alert folded into the nightly cron, no-op
until the user sets two env vars. Everything verified without the toolchain (behavioral stubs + syntax +
guard proofs); the KV write and live Telegram send are prod-verified per the repo's documented pattern.
Remaining, all user/laptop-gated: activate Telegram, version the 3 routine prompts, the token-minting fold.

---

# Plan — 2025 Dhan contract-note adapter (text-line parser) — PROPOSED 2026-07-10

## Why
The 2025 Dhan "Contract Note (Cash F&O and Currency)" notes are **REFUSED** by the parser
(`checksum N/A → not pushed`), so ~35 notes from Jan–Sep 2025 never reached `ledger:cn:*`.
They are the **only independent source** for the 2025 F&O realised: the Dhan `/v2/trades`
API is missing Mar–Sep 2025 (1300 residual open lots), and the fno-ledger's 2025 figure
(+₹40,159) is a `source:'report'` backfill that has never been checked against anything.

## Root cause (verified 2026-07-10, masked diagnostics in scratchpad)
The 2025 Dhan layout is **text-positioned, not ruled**. pdfplumber table extraction (both the
default line-based AND the old-Dhan text-position strategy) fragments each fill across several
physical rows → `net_total 0/N`, `net_amount` not always found → the checksum can't run → REFUSED.
BUT the fill data is clean on **single text lines**:
```
<15-16 digit trade-no> <ord-time> <trd-time><security-desc> <B|S> <signed-qty> <gross-rate> <net-rate> <net-total> <remark D/M/*>
```
and charges are a text block `Description | seg | seg | Total` with DR/CR values, incl.
`PAY IN/PAY OUT OBLIGATION … CR` and `NET AMOUNT RECEIVABLE/PAYABLE BY CLIENT … CR`.
→ A **text-line parser** (same idea as the existing Astha `parse_charges_from_text` path)
reconstructs both cleanly; no new table strategy needed.

## Scope confirmed
- cn2025_0 (2025-02-11): cash ETFs only (BANKBEES/FINIETF/FMCGIETF/ITBEES), `has_fno=False`.
- cn2025_1: has F&O (`fno 4` fills), `net_amount` present.
- So the adapter must handle **cash + F&O (+ currency)** segments in one note.

## Design (all in `scripts/contract-parser/engine.py`; runner/KV/masking unchanged)
1. **Detector** `is_dhan_2025_textnote(text)` — broker==dhan AND the note carries the wrapped
   column header "Brokerage per Unit … Net Total (Before Levies)" AND the text charges block
   ("PAY IN/PAY OUT OBLIGATION" + "NET AMOUNT RECEIVABLE/PAYABLE BY CLIENT"). Precise enough to
   NOT catch 2023-24 old-Dhan (which the ruled / text-position table path already handles).
2. **Fills** `parse_dhan2025_fills_from_text(text)` — regex the data lines above →
   {instrument, side (B/S), qty (abs; sign→side), price (net-rate), net_total (signed by side:
   BUY −, SELL +), trade_no, trade_time}. Symbol/ISIN from the `Symbol :XXX ISIN : YYY Net`
   summary lines → feeds `infer_segment` (cash vs fno) + `backfill_isin`.
   Skip the `Total Total Sell : …` and `Symbol : … Net` summary/subtotal lines (not fills).
3. **Charges** `parse_dhan2025_charges_from_text(text)` — reassemble WRAPPED label lines, then
   for each: `label_key` on the reassembled label, take the **Total** (last) DR/CR value
   (DR = negative charge, CR = positive). `PAY IN/PAY OUT`→pay_in, `NET AMOUNT …`→net_amount.
   Reuse the existing `TABLE_LABELS`/`label_key` map (add any 2025-only label wording as needed).
4. **Wire into `build_ledger`**: when the detector fires, take fills+charges from the text
   parsers (skip the table path); everything downstream (segment tag, checksum, per-segment
   checksum, KV push, masking, REFUSE-on-fail) is unchanged. The checksum is the safety net —
   a mis-parse that doesn't reconcile still REFUSES, never writes bad data.

## Steps
- [x] Add the parser fns + detector to `engine.py`; wire into `build_ledger` (table-first,
      text-fallback-only-when-the-table-can't-reconcile → ruled notes never regressed).
- [x] Dry-run cn2025_0 + cn2025_1 → both **checksum PASS** (were N/A/REFUSED).
- [x] **Regression**: `test_engine.py` 282/282 pass (was 262; +20 for the 2025 adapter incl. the
      ruled 'Eqfo_signed' bare-cell variant). Table path unchanged for all proven adapters.
- [x] Downloaded all 36 2025 Dhan notes (read-only) → batch dry-run: **36/36 OK** (was 0/36
      before; the 3 that first REFUSED were a no-pay_in obligation, a page-split wrapped charge
      label, and a ruled bare-cell-zero pollution — all fixed).
- [ ] **Report the tally to the user and get a go-ahead BEFORE any real `--write`/KV push**
      (KV is the live serving copy; and the ingest-daemon must be stopped first to avoid a
      concurrent gmail-state write — see tasks/ingest-handoff.md).  ← WAITING HERE

## After the adapter lands (separate confirmations)
- [x] Ingested the 36 2025 notes → `ledger:cn:*` (KV, all PUSHED; via run.py direct — no daemon
      stop needed, it writes idempotent cn keys only, not gmail-state/manifest).
- [x] Rebuilt the overlay → `ledger:fno:overlay` (KV prod) + `data/fno-overlay.json` (local
      mirror): 55 Dhan-2025 days now carry REAL F&O charges (earliest was 2025-10-06 → now
      2025-01-07). FY24-25 Dhan 382 · FY25-26 Dhan 26,404.
- [ ] Re-derive 2025 F&O realised from the parsed notes; compare to the `source:'report'`
      +₹40,159. NOTE: a note states charges + trades, NOT realised — needs cross-note FIFO, and
      the F&O fill descs are truncated (strike+CE, no underlying/expiry) → needs contract
      reassembly first. Deferred (not in the selected scope).
- [ ] **Re-scope the guard** in `build-trading-ledger.mjs`: it subtracts F&O-only `fnoGross`
      from whole-account `realisedDerived` (incl. cash −₹15k + currency), so its "₹51k undercount
      ⚠" is a multi-segment residual, NOT an F&O gap. Deferred (not in the selected scope).
- [ ] Revisit item-4's removal of the 2026-07-07 fno row (a contract note exists for it).

## Open questions / risks
- How many distinct 2025 sub-layouts (cash / F&O / currency / cross-currency)? Batch dry-run reveals.
- Do all 2025 notes decrypt with CN_PW_SELF? (some may be CN_PW_MOM — the runner tries all.)
- Multi-page notes repeat the header block — the text parser must handle repeats idempotently.

## Review
Built a text-line parser for the 2025 Dhan text-positioned GST-invoice notes (`engine.py`:
`is_dhan_2025_textnote`, `_dhan2025_key`, `parse_dhan2025_charges_from_text`,
`parse_dhan2025_fills_from_text`), wired as a **fallback** in `build_ledger` — it only runs when
`broker=='dhan'` AND the table parse doesn't reconcile AND the text parse DOES, so every ruled
layout (Zerodha/Fyers/Upstox/old-Dhan/2025 'Eqfo_signed') keeps its proven table path.
Result: **36/36** 2025 Dhan notes now reconcile (dry-run), **282/282** unit tests pass.
Three format quirks handled: (a) notes with no PAY IN/PAY OUT row (obligation = signed fills),
(b) charge labels that wrap around the value line / across a page break (paren-balance tail
absorption), (c) ruled notes that render 0-charges as BARE cells with no DR/CR (self-contained
commit + buf flush so a bare zero can't glue onto the next charge's label).
NOT YET DONE (gated on user go-ahead): the real KV push / daemon-stop / 2025 re-derivation /
guard re-scope. The guard-rescope finding stands regardless: `build-trading-ledger.mjs` subtracts
F&O-only `fnoGross` from whole-account `realisedDerived` (cash −₹15k + currency included), so its
"₹51k undercount ⚠" is a multi-segment residual, not an F&O gap.

---

# Plan — 1M (and windowed) money-made card ≠ growth chart — PROPOSED 2026-07-10

## Symptom
The "Growth" card 1M tile reads **₹40,240** while the "Your book" growth line over the
same month reads **~₹10–16k**. User net worth 12 Jun 18.68L → 10 Jul 30.08L; chart money
made 12 Jun→10 Jul = **₹15,862**; `SNAPSHOT.md` implies **₹14,446**. Chart + SNAPSHOT agree;
the card is the outlier, overstating by ~₹24–26k.

## Root cause (traced)
Both numbers reduce to `moneyMade_today − moneyMade_anchor`, `moneyMade = nw − invested`,
so the ~₹30k gap is entirely a **start-anchor mismatch**:
- Chart (`GrowthView.js:154`): starts at first real snapshot `>= pts[0].d`, where the server
  window is `lastNDates(30)` → 11 Jun. Anchor pinned to the window edge.
- Card (`ProjectionTab.js:449-454`): `ref` = **newest real snapshot `<= today−30d`**. When
  snapshots are sparse near the 30-day mark, this **floats arbitrarily far back** to an older,
  lower-money-made snapshot (implied ~₹154k vs 12 Jun's ~₹178k), inflating the "1M" move.

## Fix (minimal, aligns card to the chart's basis)
In the `growth` useMemo windowed branch (`r.days != null`), change the anchor from
"newest real snapshot before the window start" to "**oldest real snapshot at/after the
window start**" (iterate ascending, first `ms(d) >= cutoff`) — the same edge the chart uses.
Add a degenerate guard: if the chosen anchor is < half the window old, return `chg:null`
("building") instead of a misleading near-zero-span number. Leave the `r.days == null`
(max fallback) path unchanged; max is already handled by `totalGains`.

## Scope
- [ ] Apply the ascending-anchor change to ALL windowed tiles (1M/3M/6M/1Y) — same latent bug.
- [ ] Keep the temp `[1M-anchor-trace]` log until verified, then remove it.

## Verify (ledger edit → render-verify live, per CLAUDE.md)
- [ ] Live dashboard: 1M tile now matches the chart legend (~₹15,862) for the same window.
- [ ] Longer tiles (3M/6M/1Y) still populate and don't regress to "building" spuriously.
- [ ] No layout/CSS touched → certify.mjs N/A.

---

# Plan — Daemon liveness watchdog (self-heal the .mjs daemons) — 2026-07-10

## Why
US intraday capture died mid-session (~18:45, after 1 tick) and nothing relaunched it: the
window was still open until 02:30 IST but capture stayed dark ~4h. Root cause is structural,
not US-specific — every long-running `.mjs` daemon is launched by a **fire-once / at-logon**
task with no mid-session relaunch, so a process death inside its window is unrecovered until
the next day / next logon. Affected daemons:
- `ingest-daemon.mjs`  → task `IngestDaemon`        — always-on (at logon, no exec limit)
- `capture-daemon.mjs` → task `CaptureIntradayUS`   — fire-once 18:40, US window 18:45→02:30
- `capture-daemon.mjs` → task `CaptureIntradayIndia`— fire-once 09:10, India window 09:13→15:32

## Design (additive — does NOT touch the working primary launches)
A short-lived, stateless watcher that Task Scheduler runs every 5 min, 24/7. Task Scheduler's
timer is the durable heartbeat, so nothing has to watch the watcher (a long-running watcher
would just reintroduce the same "who restarts it" problem).
- `scripts/market-state.mjs` — tiny JSON CLI over `marketHours.mjs` (the ONE DST-aware source
  of truth): prints `{us, in, t}`. The watcher never re-encodes window logic.
- `scripts/daemon-watchdog.ps1` — snapshot live `node` command lines once; for each daemon,
  if it SHOULD run now but no process matches, `Start-ScheduledTask <its task>` (reuses that
  task's full hardened launch + IgnoreNew). Heartbeat → overwrite `daemon-watchdog.state`
  each run (never grows); append to `daemon-watchdog.log` ONLY on a restart/failure event.
- `scripts/register-daemon-watchdog.ps1` — registers `DaemonWatchdog`: every-5-min repetition
  + at-logon, battery-friendly, 2-min exec limit (zombie backstop < the 5-min interval),
  MultipleInstances IgnoreNew.

## Correctness guards
- **Heal only on the real OPEN window, never 'pre'.** `marketState` returns `'pre'` for ALL of
  00:00–09:13, so restarting India on 'pre' would idle it for hours holding keep-awake (the very
  trap the register scripts warn about). Predicates: ingest=always, capture-us=`us==open`,
  capture-in=`in==open`. The primary timed tasks still own the on-time (slightly-early) launch;
  the watcher only heals mid-window deaths.
- Shared match: both capture tasks match `capture-daemon.mjs`; windows are disjoint so at most one
  is should-run at a time, and a just-launched match is marked alive to prevent any double-start.

## Steps
- [x] Write `scripts/market-state.mjs`
- [x] Write `scripts/daemon-watchdog.ps1` (ASCII-only — PS 5.1 reads .ps1 as ANSI; em-dashes
      corrupted parsing on the first pass)
- [x] Write `scripts/register-daemon-watchdog.ps1`
- [x] `/scripts/*.state` added to .gitignore (heartbeat rewrites every 5 min)
- [x] Register the `DaemonWatchdog` task — repetition confirmed stuck (RepInterval=PT5M,
      RepDuration=P3650D) + logon trigger; NextRunTime set.
- [x] Verify: clean no-op run (`us=open in=post [ingest=up capture-us=up capture-in=off]`);
      kill-and-heal smoke test PASSED — killed capture-us PID 12848, watcher logged
      `RESTARTED CaptureIntradayUS`, fresh PID 19180 came up and resumed the tape.

---

# Plan — Daily-job checker (catch silent misses of syncs + snapshot) — 2026-07-10

## Why
The one-shot daily jobs miss/fail SILENTLY. Found 2026-07-10: `DailyNetworthSnapshot`
has NEVER run (Result 0x41303, no log) — it's `LogonType Interactive` + needs a headless
browser, so a 07:00 trigger while the laptop's asleep just evaporates; `DailyBrokerSync`
exited 1 on a git-rebase conflict; `BrokerSyncEvening` returned success while Upstox fetch
failed inside it. `snapshot-sleeves.json` is down to 2 entries. History is NOT lost
(`growth.json` self-heals via `backfill-growth.mjs 7`, 380 entries, no gaps) — so NO backfill
(user: "don't recover it"). The ask: a checker + log so a miss can't stay silent / recur.

## Design (verify OUTCOMES, not trust the scheduler)
`scripts/daily-check.mjs` — reads each job's OUTPUT freshness, re-runs a stale+due one
(once/day, via its own scheduled task = same launch Task Scheduler uses), appends one status
line to `scripts/daily-check.log` every run (the "checker log"). State file caps re-runs at
1/day/job so a persistently-down job is logged STALE without spamming heavy re-runs.
- **snapshot**    — `snapshot-sleeves.json` latest date == today? (daily, due 07:30) → `DailyNetworthSnapshot`
- **broker-sync** — `broker-state.json` syncedAt == today AND upstox+dhan `ok`? (weekdays, due 18:40) → `BrokerSyncEvening`
  (the `ok` check also catches today's Upstox-fetch-failed class, not just total misses)
`scripts/daily-check.cmd` wrapper + `scripts/register-daily-check.ps1` (task `DailyJobCheck`,
hourly + at-logon; short exec limit; IgnoreNew). Complements `DaemonWatchdog` (daemons); this
covers the one-shot dailies.

## Steps
- [x] `daily-check.mjs` (+ `CHECK_DRY=1` to log-without-triggering for testing)
- [x] `daily-check.cmd` + `register-daily-check.ps1`; `/scripts/*.state` already gitignored
- [x] Register `DailyJobCheck`; dry run verified: fresh→`ok`, simulated stale broker-state→
      `STALE(2026-07-09) would-rerun BrokerSyncEvening`, dry never writes state/triggers
- [x] Hourly repetition confirmed stuck (PT1H / P3650D + logon); scheduled run wrote the log
      (`LastTaskResult 0`); left running to catch the next real miss

## Review
Shipped `daily-check` — a checker for the one-shot daily jobs (complements `DaemonWatchdog`,
which covers the long-running daemons). It verifies each job's OUTPUT is fresh for today
(`snapshot-sleeves.json` latest == today; `broker-state.json` syncedAt == today AND upstox+dhan
`ok`), re-runs a stale+due one via its own scheduled task (max 1/day via `daily-check.state`),
and appends one status line to `daily-check.log` every hourly run — so a miss can't stay silent.
The broker `ok` check catches the per-broker-fetch-failed class (today's Upstox), not just total
misses. No backfill (history is intact in `growth.json`, which self-heals via `backfill-growth.mjs`).
Verified end-to-end incl. the STALE→would-rerun branch and the scheduled-path log write.
Latent root cause left as-is per scope: `DailyNetworthSnapshot` is `LogonType Interactive` +
browser-dependent, so its 07:00 trigger evaporates when the laptop's asleep — the checker heals
this by re-running when the user is present. A cleaner root fix (add an at-logon trigger to the
snapshot task) is noted but not done.

**Consolidated 2026-07-11 (one task to rule the watchers):** merged `DaemonWatchdog` +
`DailyJobCheck` into a single `Supervisor` task (5-min tick: daemon liveness every run;
daily-check gated to ~1/hour via an IST-hour stamp). `daemon-watchdog.ps1`→`supervisor.ps1`;
removed `daily-check.cmd` + the two old register scripts. The 9 WORKER tasks stay
separate (different lifetimes/triggers — an always-on daemon can't be one periodic task with a
07:00 browser snapshot). Watcher tasks: 2 → 1.

**Latched 2026-07-11 (behaves daily, not hourly):** a daily job doesn't need hourly
verification — the frequent check is only cheap resilience (catch a miss whenever the box is
on, since it reboots). Made `daily-check.mjs` latch: it acts/logs ONLY on a transition
(pending → CONFIRMED / re-ran / STILL-STALE), then goes silent for the rest of the day, and the
re-run stays capped 1/day. So the check still runs ~hourly as a cheap safety net (2 file-reads
when fine) but reads as ~one line per job per day in the checker log — the hourly noise is gone.

---

# Review — Daemon liveness watchdog

Shipped a stateless liveness watchdog for the long-running `.mjs` daemons. Three files:

---

# Review — Daemon liveness watchdog

Shipped a stateless liveness watchdog for the long-running `.mjs` daemons. Three files:
`market-state.mjs` (JSON CLI over `marketHours.mjs` — the ONE DST-aware window source),
`daemon-watchdog.ps1` (snapshot live node cmdlines; restart any daemon that should be up but
isn't, via its own scheduled task), `register-daemon-watchdog.ps1` (`DaemonWatchdog`, every
5 min 24/7 + at-logon). Additive: the working primary launches (IngestDaemon at-logon,
CaptureIntradayUS/India timed) are untouched — the watcher only heals mid-window deaths.
Key correctness call: heal ONLY on the real `open` window, never `marketState=='pre'` (which
spans 00:00-09:13) — restarting on 'pre' would idle a daemon for hours holding keep-awake, the
exact trap the register scripts warn about. Heartbeat -> `daemon-watchdog.state` (overwritten,
never grows); the `.log` stays quiet unless a restart/failure actually happens.
Tests: 1357 pass; the only 2 failures are pre-existing + unrelated (a separate git worktree's
missing `cas-parser/.venv`), untouched by this change.
Not automated (by design): stall detection (a daemon alive-but-not-ticking) — the observed and
reported failure was a clean process death, so the watcher checks process existence, not tape
freshness. A freshness check is a possible future add if a stall is ever seen.
