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

REM ── Refresh broker tokens before the India F&O window ────────────────────────
REM SEBI invalidates access tokens at the daily pre-open cycle, so a token minted
REM the evening before is dead by morning. Mint HERE (repo-relative — can't rot like
REM the absolute-path DhanDailyLogin/UpstoxDailyLogin tasks did after the repo moved).
REM Non-fatal: the daemon skips any broker whose token is missing, so a mint failure
REM degrades to one sleeve, never a crash. India session only (US has no F&O).
set DHANPY=mcp\dhan\.venv\Scripts\python.exe
if not exist "%DHANPY%" set DHANPY=python
set UPSTOXPY=mcp\upstox\.venv\Scripts\python.exe
if not exist "%UPSTOXPY%" set UPSTOXPY=python
if /I "%SESSION%"=="in" (
  echo [capture] %DATE% %TIME% refreshing broker tokens ^(dhan + upstox^)>> "%~dp0capture-%SESSION%.log"
  call "%DHANPY%" mcp\dhan\mint.py >> "%~dp0capture-%SESSION%.log" 2>&1
  call "%UPSTOXPY%" mcp\upstox\login.py >> "%~dp0capture-%SESSION%.log" 2>&1
)

node scripts\capture-daemon.mjs >> "%~dp0capture-%SESSION%.log" 2>&1
