@echo off
REM ── Morning broker holdings sync (headless) ──────────────────────────────────
REM Refreshes live broker holdings/positions/funds + the Macro market-wrap into
REM data/broker-state.json (and data/market-wrap.json) via the Node engine, with
REM mint-on-demand for the 3 zero-touch brokers (Upstox, Dhan, Fyers). Commits +
REM pushes so the deployed app rebuilds. No Claude, no Kite — the INDIAN (Zerodha)
REM sleeve is delivery equity, hand-maintained in app/portfolio.js after trades /
REM corp actions, never touched here. Double-click anytime, or let the
REM DailyBrokerSync logon task (~06:00 IST) run it. Same Node engine the evening
REM task uses; logs to scripts/sync.log.
cd /d "%~dp0.."
node scripts\sync-brokers.mjs >> "%~dp0sync.log" 2>&1
