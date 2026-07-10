# SCHEDULE — automated & scheduled jobs

Single source of truth for everything that runs on a timer for this project.
The actual schedule definitions live in **three different systems** (only the
Vercel cron is in this repo), so this file is where they're written down together
— check here first when something that "should be automatic" isn't.

> Timezones: the Vercel cron is **UTC**; the Windows task and the Claude routines
> are **local time (IST)**. SEBI has the broker refresh-token APIs disabled, so
> broker tokens are daily-only — see [mcp/fyers/README.md](mcp/fyers/README.md).

## Overview

| Job | When (TZ) | Runs where | Defined in |
|---|---|---|---|
| `/api/snapshot` (growth day-change + FII/DII trail → KV) | 21:30 UTC daily (03:00 IST) | Vercel | `vercel.json` (repo) |
| **FyersDailyLogin** (mint Fyers token) | 08:15 IST daily | this laptop, headed | Windows Task Scheduler |
| **UpstoxDailyLogin** (mint Upstox token) | 06:20 IST daily | this laptop, headless | Windows Task Scheduler |
| **DailyNetworthSnapshot** (durable growth + NW/value → `growth.json` / `SNAPSHOT.md` / `snapshot-sleeves.json`) | 07:00 IST daily | this laptop, headless | Windows Task Scheduler |
| **DailyBrokerSync** (broker holdings → `broker-state.json`) | 06:00 IST daily | this laptop, headless | Windows Task Scheduler |
| **BrokerSyncEvening** (Fyers/Upstox F&O realised → `fno-ledger.json`) | 18:30 IST weekdays | this laptop, headless | Windows Task Scheduler |
| **CaptureIntradayIndia** (F&O P&L + India equity → KV + `fno-intraday.json` / `eq-intraday.json`) | one long-running process, 09:10→15:33 IST weekdays | this laptop, headless | Windows Task Scheduler |
| **CaptureIntradayUS** (US equity day-change in ₹ → KV + `us-intraday.json`) | one long-running process, 18:40 IST → 02:30 IST (overnight) weekdays | this laptop, headless | Windows Task Scheduler |
| **CloudFnoCapture** (Dhan S01 + Fyers S02 F&O realised, laptop-off) | ~18:45 IST daily | Claude cloud (Remote) | Claude Routines panel |
| **Weekly Dhan US sleeve review** | Sat 09:00 IST | Claude cloud (Remote) | Claude Routines panel |
| **Monthly stratzy algo briefing** | ~day 26, 09:00 IST | this laptop (Local) | Claude Routines panel |

> **Dhan** has no scheduled job *by design* — the Dhan MCP server (`mcp/dhan/`)
> self-mints its 24h access token on demand via DhanHQ's pure-API TOTP endpoint,
> so there's nothing to schedule.

> **IntradayDaemon** is the live path — ONE long-running process per session, not
> a periodic job. The daemon (`scripts/capture-daemon.mjs`) is launched by Task
> Scheduler at each session's open and gates on the IST clock itself; it self-exits
> when the window closes, so it's relaunched fresh each day. It reads daily broker
> tokens off disk and **never mints** (no browser, no rate-limit risk); a broker
> without a token is skipped for that tick (not zeroed). Each tick republishes the
> day's tape to KV (`intraday:<kind>:<date>`, 3-day TTL) so the deployed app reads
> it near-live via `/api/intraday` with NO redeploy. Git is touched exactly ONCE
> per session — a single archive commit+push at close (`--autostash`, so an
> unrelated dirty tree can't strand it).
>
> **Two sessions**, each its own scheduled task:
> - `SESSION=in` (default, 09:13–15:32 IST) — F&O (10s, Dhan/Upstox/Fyers; pending-
>   order check throttled to ~1/min via `ORDERS_EVERY`) + India equity day-change
>   (60s, `EQUITY_MS`) over INDIAN + SWING holdings priced via keyless Yahoo. The
>   loops have separate in-flight guards, so a slow Yahoo fetch never stalls the
>   10s F&O capture. No Kite token in the loop — the delivery holdings come from
>   the already-committed `broker-state.json`.
> - `SESSION=us` (18:45 IST → 02:30 IST overnight) — US equity day-change (60s)
>   in ₹, via keyless Yahoo (USD) × live USD/INR. Holdings from the private US
>   sleeve. The session-date helper buckets the past-midnight tail under the
>   evening's date so one US session is one tape entry.
>
> **One-time registration** (PowerShell — registers both Task Scheduler jobs):
>
>     powershell -ExecutionPolicy Bypass -File scripts\register-capture-daemons.ps1
>
> **Manual / debug** (PowerShell):
>
>     # India session right now (gates on the clock)
>     node scripts\capture-daemon.mjs
>     # Force-launch outside market hours
>     $env:CAPTURE_FORCE="1"; node scripts\capture-daemon.mjs; Remove-Item env:CAPTURE_FORCE
>     # US session
>     $env:SESSION="us"; node scripts\capture-daemon.mjs; Remove-Item env:SESSION
>     # Run-now via the registered task (uses logs in scripts\capture-*.log)
>     Start-ScheduledTask -TaskName CaptureIntradayIndia
>     Start-ScheduledTask -TaskName CaptureIntradayUS
>
> `scripts/capture-intraday.mjs` is a **one-shot** for a single manual point —
> writes the local file + KV and does NOT git-commit (the daemon owns the archive
> commit):
>
>     $env:CAPTURE_FORCE="1"; node scripts\capture-intraday.mjs; Remove-Item env:CAPTURE_FORCE

---

## 1. Vercel cron — daily snapshot (growth day-change + FII/DII trail)

- **Schedule:** `30 21 * * *` (21:30 UTC = 03:00 IST), in [vercel.json](vercel.json).
  This is the **sole** Vercel cron.
- **What:** hits `GET /api/snapshot`, which does two things server-side (no browser):
  1. writes the day's per-sleeve growth point → KV `growth:<date>` (the live serving
     copy; the durable git archive is the laptop `DailyNetworthSnapshot`, §4).
  2. via `captureFiiDiiTrail()` ([app/lib/fiidiiTrail.js](app/lib/fiidiiTrail.js)),
     persists the latest NSE FII/DII **cash** net **and** the FII **derivative-positioning**
     stance into KV `premarket:fiidiiTrail` (dedup by date, ~20-session cap ≈ a month), so
     the Wrap tab's flow trail keeps building cross-device with no browser open.
- **`/api/premarket` is NOT a cron** — it's the live **Market Wrap** route (rendered when
  you open the tab) and it persists the *same* trail on-demand through the *same*
  `lib/fiidiiTrail` helpers. One capture path, two callers (cron + page load). An earlier
  separate `30 0 * * *` premarket cron was folded into snapshot: Vercel Hobby is cron-limited
  and a second cron was redundant once snapshot built the trail. Folding the derivative
  stance into `captureFiiDiiTrail` (2026-07-10) closed the one gap — the cron used to persist
  cash only, so on days nobody opened the app the positioning history had holes.
- **Deps:** Vercel KV / Upstash creds (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`);
  no-op if absent (falls back to the client's localStorage trail, `app/lib/fiidii.js`).
- **Verify:** the Wrap tab's FII/DII trail shows ≥2 recent sessions (incl. the FII stance on
  captured days); or check KV `premarket:fiidiiTrail` / `growth:<date>`.
- **Notes:** runs in Vercel's infra — independent of the laptop.

## 2. FyersDailyLogin — daily Fyers token mint (Windows Task Scheduler)

- **Schedule:** daily 08:15 IST, **headed**, "run only when logged on"
  (`StartWhenAvailable`, so a missed run catches up at next logon).
- **What:** runs `mcp/fyers/.venv/Scripts/python.exe mcp/fyers/login.py --show`
  — Playwright drives Client ID → TOTP → PIN, captures the auth_code, and writes
  the day's access token to `mcp/fyers/.token.json`. The Fyers MCP server reads it.
- **Why headed + on the laptop:** headless is refused by the login's Cloudflare
  bot-check (`ERR_CONNECTION_REFUSED`); a residential IP + persistent profile clears
  it. So the laptop must be on + logged in at some point each day.
- **Deps:** Fyers venv (`playwright`, `pyotp`, `fyers-apiv3`) + Chromium;
  secrets in `mcp/fyers/.env` (`FYERS_FY_ID`, `FYERS_TOTP_SEED`) and the Windows
  user env (`FYERS_APP_ID`, `FYERS_SECRET_ID`, `FYERS_PIN`, `FYERS_REDIRECT_URI`).
- **Verify:** `fyers_status` → `authenticated: true`; or the mtime of
  `mcp/fyers/.token.json`; or `get_funds`.
- **Manage:** `Get-ScheduledTask -TaskName FyersDailyLogin`;
  `Start-ScheduledTask -TaskName FyersDailyLogin` to run now.

## 3. UpstoxDailyLogin — daily Upstox token mint (Windows Task Scheduler)

- **Schedule:** daily 06:20 IST, **headless**, "run only when logged on"
  (`StartWhenAvailable`). 06:20 is after the token's ~03:30 expiry and Upstox's
  funds-API maintenance window (00:00–05:30 IST).
- **What:** runs `mcp/upstox/.venv/Scripts/python.exe mcp/upstox/login.py` —
  Playwright drives mobile → TOTP → PIN (no Cloudflare check, so it runs headless
  and invisible), captures the auth_code, exchanges it, writes the day's token to
  `mcp/upstox/.token.json`. The Upstox MCP server reads it.
- **Deps:** Upstox venv (`playwright`, `pyotp`, `requests`) + Chromium; secrets in
  `mcp/upstox/.env` (`UPSTOX_CLIENT_ID/SECRET`, `UPSTOX_MOBILE`, `UPSTOX_TOTP_SEED`,
  `UPSTOX_PIN`).
- **Verify:** `import server; server._get('/v2/user/profile')` → `status: success`
  (note: the funds API is down 00:00–05:30 IST — not an auth failure); or the mtime
  of `mcp/upstox/.token.json`.
- **Manage:** `Get-ScheduledTask -TaskName UpstoxDailyLogin`;
  `Start-ScheduledTask -TaskName UpstoxDailyLogin` to run now.

## 4. DailyNetworthSnapshot — daily durable growth + NW/value history (Windows task)

- **Schedule:** daily **07:00 IST**, this laptop, headless, `-StartWhenAvailable`
  (a missed slot runs at next logon; the rolling 7-day backfill self-heals up to a
  week off). Registered by `scripts/register-snapshot-daily.ps1`; wrapper
  `scripts/snapshot-daily.cmd`; log `scripts/snapshot-daily.log`.
- **What:** three durable git-committed artifacts, ONE commit+push:
  1. `node scripts/backfill-growth.mjs 7` — recomputes the last 7 days' per-sleeve
     day-change into `data/growth.json` (+ best-effort KV) from Yahoo/AMFI closes +
     deterministic fd/cmpf, the SAME `computeDayChange` the cron uses. Self-contained
     (no broker tokens); doesn't depend on whether the Vercel cron fired.
  2. `SNAPSHOT_SKIP_GIT=1 node scripts/record-snapshot.mjs` — boots the app headless
     (puppeteer), harvests today's NW + per-sleeve VALUE snapshot → `data/SNAPSHOT.md`
     (NW/assets/invested row) + `data/snapshot-sleeves.json` (`{v,i}` per sleeve). No
     internal commit — the wrapper owns the single commit. `historicalSnapshots()`
     merges the sidecar so the gain-attribution waffles fill week/month/year windows.
  3. One `git add + commit + push` (`chore: daily snapshot <date>`) covering all three;
     `git pull --rebase --autostash` first so a concurrent broker-sync push can't reject it.
- **Why local (not Remote):** the old `daily-networth-snapshot` Claude **Remote** routine
  (06:00 IST, `node scripts/record-snapshot.mjs`) **silently died after one run on
  2026-06-19** — the ephemeral cloud workspace can't `git push` / run puppeteer, exactly
  as its own ⚠️ open-question feared. `data/growth.json` froze at 2026-06-25 and the
  sidecars at 2026-06-19. This local task is that pre-authorised fallback (same pattern
  as `FyersDailyLogin`). Runs AFTER `DailyBrokerSync` (06:00) so `broker-state.json` is
  fresh, and after the prior day is fully closed (India 15:30 + US ~02:00 IST + NAV).
- **Deps:** node, puppeteer/Chromium (installed — verified via the dry-run), network
  (Yahoo/AMFI), **git push auth** (cached HTTPS creds — the sync tasks push fine).
  Local dry-run: `SNAPSHOT_SKIP_GIT=1 node scripts/record-snapshot.mjs`.
- **Verify:** a `chore: daily snapshot <YYYY-MM-DD>` commit on `origin/main` each
  morning; new date keys in both `data/growth.json` and `data/snapshot-sleeves.json`.
- **Vercel cron stays:** `app/api/snapshot/route.js` (03:00 IST) keeps feeding KV
  `growth:<date>` as the live serving copy; this task is the durable git backstop that
  survives the 35-day KV TTL and fresh clones. (The cron drops ~35% of nights, so the
  archive must not depend on it — hence the recompute, not a KV-fold.)
- **Note:** distinct from the app's per-browser `localStorage` snapshots
  (`getSnapshots`), which only record on the days you open the app.

## 4b. DailyBrokerSync — live broker holdings → `data/broker-state.json` (Windows task)

- **Schedule:** daily **06:00 IST**, `-StartWhenAvailable` (so a missed slot runs on
  your first logon after 06:00). **Headless** — no terminal, no Claude.
- **Chain:** task → [scripts/sync.cmd](scripts/sync.cmd) → `node scripts/sync-brokers.mjs`
  (logs to `scripts/sync.log`). The same Node engine the evening task uses.
- **What it does:**
  - The **3 zero-touch brokers** by direct REST, with **mint-on-demand** (if an
    Upstox/Fyers token is expired it runs that broker's `login.py` inline, then
    retries; Dhan self-mints). Writes `holdings.SWING` (Upstox, **broker-driven**),
    `positions.DHAN_FNO`, `funds.*`; preserves `holdings.INDIAN`. Any broker that
    still can't refresh keeps its last values + an honest stale flag — never blocks
    the others.
  - Backfills the **Macro Wrap** (NSE sector heatmap + breadth + India VIX) zero-touch
    from Fyers index quotes when the on-disk wrap isn't already from today.
  - One `git add … && commit && push` of `broker-state.json`, `trades-log.json`,
    `fno-ledger.json`, `market-wrap.json` to `main`.
- **Kite/Zerodha is NOT synced.** The INDIAN (Zerodha) sleeve is delivery equity with a
  hand-maintained corp-action/XIRR ledger in `app/portfolio.js`; refresh its values by
  hand only after a trade or corporate action. (Until 2026-06-24 this task launched a
  Claude terminal to drive the hosted-OAuth Kite login — `sync.cmd → sync-launch.ps1 →
  wt -- claude "/sync"`; that whole interactive path was removed, the `/sync` skill
  retired, and the sync is now fully headless.)
- **Why 06:00 works despite the ~03:30 token expiry:** mint-on-demand makes the sync
  self-healing regardless of when it fires or whether `UpstoxDailyLogin`/`FyersDailyLogin`
  have run — it mints whatever's stale. (Those login tasks stay only to keep the MCP
  servers warm for mid-day Claude queries.) **Caveat:** at 06:00 the Fyers token may
  still be stale (FyersDailyLogin runs 08:15), and its headed Playwright mint can't run
  unattended — so the morning Wrap backfill may no-op until a later run; the evening
  task and cloud routine both cover it, and the Wrap is non-critical.
- **How the app consumes it:** [app/lib/brokerState.js](app/lib/brokerState.js) →
  `reconcileSleeve(curated, key)` merges the live numbers over the curated metadata
  (sector/cap/ns/name) without mutating it; [SyncBadge](app/components/shared/SyncBadge.js)
  shows `synced · <broker> · <date>` / `N drifted vs <broker>` / `<broker> · not synced today`
  on the Trading (SWING) and Indian tabs. Committed file → the deployed Vercel app
  reads it like `data/snapshot-sleeves.json` (no broker creds in the cloud).
- **Manual run:** double-click `scripts/sync.cmd`, or `node scripts/sync-brokers.mjs`
  from the repo root.
- **Verify:** the Trading tab's swing badge reads `synced · Upstox · <today>`; a fresh
  `syncedAt` in `data/broker-state.json`; a `chore: broker sync <date>` commit.
- **Manage:** `Get-ScheduledTask -TaskName DailyBrokerSync`;
  `Start-ScheduledTask -TaskName DailyBrokerSync` to run now.
- Zero broker tokens/passwords leave the laptop; only derived qty/value/MTM is committed.

## 4c. BrokerSyncEvening — daily realised F&O capture → `data/fno-ledger.json` (Windows task)

- **Schedule:** **18:30 IST, weekdays**, `-StartWhenAvailable`, headless (no terminal,
  no Claude, no Kite). Registered once via
  [scripts/register-evening-sync.ps1](scripts/register-evening-sync.ps1).
- **Why a separate evening run:** broker `get_trades` / positions / `realizedProfit`
  reset at the next trading day's pre-open. The 06:00 morning sync is too late to
  see *yesterday's* intraday F&O. So this fires the **same evening** (well before the
  next-day reset) to capture today's realised before it's wiped. Holdings (which
  persist) stay on the morning run.
- **Chain:** task → [scripts/sync-evening.cmd](scripts/sync-evening.cmd) →
  `node scripts/sync-brokers.mjs` (commits + pushes; logs to `scripts/sync-evening.log`).
- **What it captures, per zero-touch broker (Dhan/Upstox/Fyers):**
  1. Today's fills → `data/trades-log.json` (durable tradebook, append + dedupe).
  2. Today's **realised F&O P&L** → `data/fno-ledger.json` — one row per (date, broker):
     `grossRealised` (Dhan's native `realizedProfit`, which includes expiry/settlement;
     else same-day closed round-trips `Σsell−Σbuy`), `estCharges` (modeled by
     [scripts/lib/fno-charges.mjs](scripts/lib/fno-charges.mjs) — deterministic NSE
     F&O rate table, accurate to a few ₹), and `net`. Upsert by date:broker, so a
     re-run the same day overwrites with the fuller number.
- **How the app consumes it:** [app/lib/fnoLedger.js](app/lib/fnoLedger.js) →
  `deriveFY(seed, ledger)` rolls each captured day on top of the **frozen FY seed**
  (`data/fy2526_verified.json` → `s0X.fy2627`, the YTD through its `seedThrough` date)
  to drive the Trading tab's current-FY S01/S02 gross/charges/net **automatically** —
  no mid-year hand-editing. Charges show an `est.` tag; the tab footnote shows
  `auto · N days captured · last <date>`.
- **The only manual ritual is annual:** at ITR, replace the just-closed `fy2627` with
  the verified prior-FY block, roll `labels`, reset the next `fy2627` seed to 0 with a
  new `seedThrough`, and archive the ledger. (Charges snap from `est.` to exact here.)
- **Sleeve map:** Dhan/Zerodha → **S01**, Upstox/Fyers → **S02**.
- **Laptop-off coverage:** **Dhan (S01) + Fyers (S02) are captured laptop-off** by the
  cloud routine `CloudFnoCapture` (§4d), so this task is now mostly a redundant fallback
  for them plus the capture path for **Upstox** (the one broker with no cloud path).
  Trades are all-source: the trades REST endpoint returns app/algo-placed fills too
  (unlike broker order-webhooks, which only fire for API-key-placed orders — which is why
  webhooks were ruled out). An Upstox-only laptop-off day is recovered from the Upstox
  console or trued up at ITR.
- **Manage:** `Start-ScheduledTask -TaskName BrokerSyncEvening` to run now;
  `Get-ScheduledTask -TaskName BrokerSyncEvening`. Log: `scripts/sync-evening.log`.

## 4d. CloudFnoCapture — Dhan S01 + Fyers S02 F&O realised, laptop-off (Claude routine, Remote)

- **Why cloud:** the user trades on all brokers without the laptop on. Of the four,
  **only Dhan + Fyers can be captured unattended in the cloud:**
  - **Dhan** self-mints a ~30-day JWT via pure-API TOTP — no browser.
  - **Fyers** refresh-mints a daily access token via `POST /api/v3/validate-refresh-token`
    (`{appIdHash, refresh_token, pin}`) — that host is **not behind the login page's
    Cloudflare** (verified: it answers headless JSON), so it works for the refresh
    token's ~15-day life. The laptop's `FyersDailyLogin` mints the refresh_token and
    `sync-brokers.mjs` hands it off to **Vercel KV** (`fyers:refreshToken`); the cloud
    reads it from KV. As long as the laptop wakes once per 15 days, the cloud always
    has a live refresh_token.
  - **Upstox** stays laptop-side — its read API requires a registered **static IP** the
    cloud can't provide (Analytics Token investigation, tasks/todo.md). Not the active
    F&O book anyway.
  - **Kite** is delivery (no daily reset, irrelevant to F&O).
- **Schedule:** daily **~18:45 IST**, Remote — a touch after the laptop's 18:30 so on
  laptop-on days the laptop commits first and the cloud is a near-no-op; on laptop-off
  days the cloud is the sole capturer.
- **Command:** `SYNC_ONLY=dhan,fyers SYNC_NO_BROWSER=1 node scripts/sync-brokers.mjs`.
  `SYNC_NO_BROWSER=1` makes a stale token degrade gracefully instead of trying to launch
  Playwright (the cloud can't). Dhan self-mints; Fyers refresh-mints from KV.
- **What:** pulls each broker's positions/funds + **today's trades** (REST tradebooks are
  all-source incl. app/algo), books `realizedProfit`/closed-round-trip − modeled charges
  into `data/fno-ledger.json` (S01 + S02 rows) + appends fills to `data/trades-log.json`,
  commits + pushes. The git step rebases before pushing (`pull --rebase --autostash`), so
  laptop + cloud committers coexist; on the rare append-conflict it skips and the
  idempotent upsert heals next run. Read-only — only GETs, never places an order.
- **Setup (once):**
  1. In the Remote workspace env, set: `DHAN_CLIENT_ID`, `DHAN_PIN`, `DHAN_TOTP_SEED`,
     `FYERS_APP_ID`, `FYERS_SECRET_ID`, `FYERS_PIN`, and the KV creds
     `KV_REST_API_URL` + `KV_REST_API_TOKEN` (to read the refresh_token).
  2. On the **laptop**, set `KV_REST_API_URL` + `KV_REST_API_TOKEN` too, so its sync
     pushes the Fyers refresh_token to KV.
  3. Run `mcp/fyers/login.py --show` once so the updated login writes a `refresh_token`
     into `.token.json`; the next laptop sync uploads it to KV.
  4. Add the daily routine in the Claude Routines panel running the command above.
- **Coexistence:** different brokers → different `date:broker` ledger keys → no data
  collision even when laptop + cloud commit the same files.
- **Known limit:** if the laptop is off >15 days, the Fyers refresh_token expires and
  cloud-Fyers pauses until the next laptop login re-mints it (Dhan is unaffected —
  30-day self-mint). Any gap is trued up at the annual ITR pass.

## 5. Weekly Dhan US sleeve review (Claude routine, Remote)

- **Schedule:** Saturdays 09:00 IST, Remote.
- **What:** a weekly review of the Dhan US (GIFT City) sleeve. Full prompt lives in
  the **Claude Routines panel** (not in this repo) — portfolio context in
  [tasks/dhan-portfolio.md](tasks/dhan-portfolio.md).

## 6. Monthly stratzy algo briefing (Claude routine, Local)

- **Schedule:** ~day 26 of each month, 09:00 IST, **Local** (only runs while the
  computer is awake).
- **What:** a monthly briefing on the trading/algo sleeve. Full prompt lives in the
  Claude Routines panel (not in this repo).

---

## Where definitions live (and how to edit)

- **Repo:** only the Vercel cron (`vercel.json`) and the scripts/routes the jobs
  call. Everything else's *schedule* is defined outside the repo:
- **Windows Task Scheduler:** `FyersDailyLogin` — `Get-ScheduledTask` /
  `taskschd.msc`. (And any future local snapshot fallback.)
- **Claude Routines panel:** the three routines above — created/edited in the
  Claude Code "Routines" UI; "Local" runs while the computer is awake, "Remote"
  runs in the cloud. Their prompts are **not** version-controlled.

## Known constraints

- **Laptop dependency:** the Fyers token mint (and any Local routine) need the
  laptop on + logged in. To remove that, move the jobs + MCP servers to an
  always-on box (a home device keeps the residential IP the Fyers login needs;
  a cloud VM gives the static IP Upstox's long-lived token wants).
- **SEBI:** no silent token renewal for Indian brokers — daily login is mandatory,
  which is why FyersDailyLogin exists.
