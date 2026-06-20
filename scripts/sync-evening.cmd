@echo off
REM ── Headless evening F&O capture ─────────────────────────────────────────────
REM Runs the three zero-touch brokers' sync AFTER market close so today's intraday
REM trades + realised F&O P&L land in data/trades-log.json and data/fno-ledger.json
REM before the broker APIs reset at next-day pre-open. No Claude, no Kite, no
REM interactive terminal — just the Node engine, which commits + pushes so the
REM deployed app rebuilds with the new realised numbers.
REM
REM Registered as the Windows task BrokerSyncEvening (weekday 18:30 IST) by
REM scripts/register-evening-sync.ps1. Tokens minted that morning are still valid
REM at 18:30; Dhan self-mints if needed.
cd /d "%~dp0.."
node scripts\sync-brokers.mjs >> "%~dp0sync-evening.log" 2>&1
