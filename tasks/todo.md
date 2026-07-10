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
- [ ] Capture the 3 Claude-routine prompts into `tasks/`. ← needs the routine prompts pasted
### 3. Retire genuine redundancy / fold multiples into one (loopholes 4/5)
- [x] **UA string** — 14 identical `const UA` copies across API routes + libs folded into one
      `app/lib/ua.js`; all 14 import it. Verified: 0 leftovers, 14 imports, all parse ESM, none unused.
- [x] **F&O realised dual-capture → primary/fallback (deliberately NOT collapsed).** Cloud
      `CloudFnoCapture` = primary for Dhan/Fyers (laptop-off); laptop `BrokerSyncEvening` = fallback
      for them + sole path for Upstox. Redundancy kept on purpose (Remote routines die silently) and
      made safe by the `fno-ledger` freshness check in `schedule-health.mjs`. Documented SCHEDULE.md §4c.
- [x] **Snapshot cron + local recompute = NOT a fold** — deliberate two-tier (KV serving copy vs
      durable git archive); collapsing would re-blind the durable tier (loophole #1). Left as-is.
- [ ] **Token minting (3 paths)** — FyersDailyLogin + UpstoxDailyLogin + mint-on-demand in
      DailyBrokerSync ("logins kept to keep MCP warm"). Assess whether mint-on-demand makes the two
      login tasks droppable. Operational (laptop-side) — deferred.

## Review
(to fill in as steps land)

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

## Review
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
