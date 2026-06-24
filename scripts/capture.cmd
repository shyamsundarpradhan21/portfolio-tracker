@echo off
REM ── Long-running intraday capture daemon for one session ─────────────────────
REM Launched by Task Scheduler (see scripts/register-capture-daemons.ps1). The
REM daemon gates on the IST clock itself and self-exits after its session window
REM closes, so the OS task only needs to launch it on time.
REM
REM Args:  %1 = session name (in | us). Defaults to 'in' (India F&O + equity).
REM
REM Logs:  scripts\capture-in.log  /  scripts\capture-us.log
REM
cd /d "%~dp0.."
set SESSION=%1
if "%SESSION%"=="" set SESSION=in
node scripts\capture-daemon.mjs >> "%~dp0capture-%SESSION%.log" 2>&1
