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
| `/api/premarket` (FII/DII trail → KV) | 00:30 UTC daily | Vercel | `vercel.json` (repo) |
| **FyersDailyLogin** (mint Fyers token) | 08:15 IST daily | this laptop, headed | Windows Task Scheduler |
| **UpstoxDailyLogin** (mint Upstox token) | 06:20 IST daily | this laptop, headless | Windows Task Scheduler |
| **daily-networth-snapshot** | 06:00 IST daily | Claude cloud (Remote) | Claude Routines panel |
| **DailyBrokerSync** (broker holdings → `broker-state.json`) | 06:00 IST daily | this laptop, headless | Windows Task Scheduler |
| **BrokerSyncEvening** (Fyers/Upstox F&O realised → `fno-ledger.json`) | 18:30 IST weekdays | this laptop, headless | Windows Task Scheduler |
| **CloudFnoCapture** (Dhan S01 + Fyers S02 F&O realised, laptop-off) | ~18:45 IST daily | Claude cloud (Remote) | Claude Routines panel |
| **Weekly Dhan US sleeve review** | Sat 09:00 IST | Claude cloud (Remote) | Claude Routines panel |
| **Monthly stratzy algo briefing** | ~day 26, 09:00 IST | this laptop (Local) | Claude Routines panel |

> **Dhan** has no scheduled job *by design* — the Dhan MCP server (`mcp/dhan/`)
> self-mints its 24h access token on demand via DhanHQ's pure-API TOTP endpoint,
> so there's nothing to schedule.

---

## 1. Vercel cron — FII/DII trail

- **Schedule:** `30 0 * * *` (00:30 UTC = 06:00 IST), in [vercel.json](vercel.json).
- **What:** hits `GET /api/premarket`; the route persists the latest NSE FII/DII
  cash-flow point into the Vercel KV store (`premarket:fiidiiTrail`, 10-day cap),
  so the Wrap tab's flow trail keeps building cross-device even with no browser open.
- **Deps:** Vercel KV / Upstash creds (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`);
  no-op if absent (falls back to the client's localStorage trail).
- **Verify:** the Wrap tab's FII/DII trail shows ≥2 recent sessions; or check KV.
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

## 4. daily-networth-snapshot — daily NW + per-sleeve history (Claude routine, Remote)

- **Schedule:** daily 06:00 IST, **Remote** (Claude cloud workspace).
- **Command:** `node scripts/record-snapshot.mjs`.
- **What:** boots the app headless (puppeteer), lets it compute net worth with its
  own live math, harvests the day's snapshot, and writes two committed artifacts:
  - `data/SNAPSHOT.md` — the NW/assets/invested row (human-readable)
  - `data/snapshot-sleeves.json` — per-sleeve `{v,i}` breakdown keyed by date
  then `git add + commit + push`. `historicalSnapshots()` merges the sidecar back
  so the gain-attribution waffles fill in for week/month/year as rows accrue.
- **Deps:** node, puppeteer/Chromium, network (Yahoo quotes), **git push auth**.
  Local dry-run: `SNAPSHOT_SKIP_GIT=1 node scripts/record-snapshot.mjs`.
- **Verify:** a `chore: daily snapshot <YYYY-MM-DD>` commit on `origin/main` each
  morning, and a new date key in `data/snapshot-sleeves.json`.
- **⚠️ Open question (as of 2026-06-19):** the recorder was only just fixed to
  commit+push (was silently dropping rows in the ephemeral cloud workspace). It is
  **unconfirmed** whether the Remote env can `git push` / run puppeteer. If a daily
  commit doesn't appear, switch this to a **local Windows task** running the same
  command (proven to work on the laptop) — same pattern as FyersDailyLogin.
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
