@echo off
REM ── Long-running intraday capture daemon for one session ─────────────────────
REM Launched by Task Scheduler (see scripts/register-capture-daemons.ps1). The
REM daemon gates on the IST clock itself and self-exits after its session window
REM closes, so the OS task only needs to launch it on time.
REM
REM Args:  %1 = session name (in | us). Defaults to 'in' (India F&O + equity).
REM
REM Broker tokens are NOT minted here — both sessions just launch the daemon (India
REM now mirrors US). The daemon reads whatever daily tokens are on disk and skips a
REM broker whose token is missing/stale for that tick. The morning DailyMorning sync
REM (sync.cmd -> sync-brokers.mjs) is the SOLE morning minter: it refreshes
REM mcp/{dhan,upstox,fyers}/.token.json well before the 09:13 India open (it starts
REM 08:55 alongside this task; the daemon idles until 09:13, by which time the tokens
REM are fresh). The US session needs no broker token at all (keyless Yahoo).
REM
REM Logs:  scripts\capture-in.log  /  scripts\capture-us.log
REM
cd /d "%~dp0.."
set SESSION=%1
if "%SESSION%"=="" set SESSION=in

node scripts\capture-daemon.mjs >> "%~dp0capture-%SESSION%.log" 2>&1
