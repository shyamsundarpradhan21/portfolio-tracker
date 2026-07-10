@echo off
REM ── Daily durable per-sleeve growth + NW/value snapshot (headless) ────────────
REM Revives the two git-committed durability tiers that the dead Claude Remote
REM routine stopped feeding (growth.json frozen 2026-06-25, snapshot sidecar frozen
REM 2026-06-19). Three artifacts, ONE commit+push:
REM   - data/growth.json          per-sleeve daily P&L archive (recomputed, self-heals)
REM   - data/SNAPSHOT.md          NW/assets/invested row
REM   - data/snapshot-sleeves.json per-sleeve {v,i} value breakdown
REM
REM Registered as the Windows task DailyNetworthSnapshot (daily ~07:00 IST) by
REM scripts/register-snapshot-daily.ps1. Runs AFTER DailyBrokerSync (06:00) so
REM broker-state.json is fresh, and after the prior day is fully closed on every
REM sleeve (India 15:30 + US ~02:00 IST). Replaces the Remote "daily-networth-
REM snapshot" routine (couldn't git-push/puppeteer from the ephemeral cloud box).
REM The Vercel /api/snapshot cron STAYS as the KV serving-copy feeder; this is the
REM durable git backstop that survives the 35-day KV TTL and fresh clones.
cd /d "%~dp0.."
set LOG=%~dp0snapshot-daily.log
echo ================ %DATE% %TIME% snapshot-daily start >> "%LOG%"

REM (1) Refresh the durable growth archive for a rolling 7-day window — recomputed
REM from Yahoo/AMFI closes + deterministic fd/cmpf via the SAME computeDayChange the
REM cron uses. Self-contained: no broker tokens, no dependence on whether the Vercel
REM cron fired (it drops ~35%% of nights); a laptop-off gap up to a week self-heals.
node scripts\backfill-growth.mjs 7 >> "%LOG%" 2>&1

REM (2) Harvest today's NW + per-sleeve VALUE snapshot from the app (puppeteer),
REM WITHOUT committing (SNAPSHOT_SKIP_GIT=1) so all three files ride ONE commit below.
set SNAPSHOT_SKIP_GIT=1
node scripts\record-snapshot.mjs >> "%LOG%" 2>&1
set SNAPSHOT_SKIP_GIT=

REM (3) One combined commit+push of the three durable artifacts.
for /f %%d in ('node -e "process.stdout.write(new Date(Date.now()+5.5*3600*1000).toISOString().slice(0,10))"') do set TODAY=%%d
git add data/growth.json data/SNAPSHOT.md data/snapshot-sleeves.json >> "%LOG%" 2>&1
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "chore: daily snapshot %TODAY%" >> "%LOG%" 2>&1
  git pull --rebase --autostash >> "%LOG%" 2>&1
  git push >> "%LOG%" 2>&1
) else (
  echo [snapshot-daily] no changes to commit. >> "%LOG%"
)
echo ================ %DATE% %TIME% snapshot-daily done >> "%LOG%"
