@echo off
REM -- DailyEvening step 2: upcoming corp-actions scan (India NSE + US Yahoo) -> KV + committed
REM calendars, for the Wrap "Upcoming corp actions" card. Runs post-close on the residential IP
REM (NSE blocks datacenter IPs; Yahoo crumb for the US half). KV is the live serving copy that
REM /api/dividends reads; the committed JSONs are the cold fallback, kept fresh + pushed here too.
REM Invoked by evening.cmd (Windows task DailyEvening, weekday 18:40 IST). Log: corp-actions.log.
cd /d "%~dp0.."
echo ==== corp-actions %date% %time% ==== >> "%~dp0corp-actions.log"
node scripts\capture-corp-actions.mjs --write >> "%~dp0corp-actions.log" 2>&1
node scripts\capture-corp-actions-us.mjs --write >> "%~dp0corp-actions.log" 2>&1
git add data/corp-actions.json data/corp-actions-us.json >> "%~dp0corp-actions.log" 2>&1
git diff --cached --quiet && echo no corp-actions changes >> "%~dp0corp-actions.log" || git commit -m "chore: corp-actions calendar snapshot" >> "%~dp0corp-actions.log" 2>&1
git push >> "%~dp0corp-actions.log" 2>&1
