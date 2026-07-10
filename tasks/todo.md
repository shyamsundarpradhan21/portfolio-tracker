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
`daily-check.mjs` unchanged (invoked by the supervisor, still writes the `daily-check.log`
checker log); removed `daily-check.cmd` + the two old register scripts. The 9 WORKER tasks stay
separate (different lifetimes/triggers — an always-on daemon can't be one periodic task with a
07:00 browser snapshot). Watcher tasks: 2 → 1.

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
