@echo off
REM ── One-shot historical backfill of the daily F&O ledger ─────────────────────
REM Drop your broker tax/P&L reports in data\reports\ first (esp. the Dhan all-time
REM F&O .xls — that's the one with per-trade sell dates that fills the calendar).
REM Then just run:  scripts\backfill.cmd
REM
REM It parses the reports -> broker-tax.json (with fno_daily), upserts the daily
REM rows into data\fno-ledger.json, prints what landed, and reminds you to commit.
REM Idempotent: safe to re-run whenever you add newer reports.
cd /d "%~dp0.."

echo === 1/2  parsing broker reports (data\reports\) ===
python scripts\parse-broker-tax.py
if errorlevel 1 ( echo. & echo parser FAILED — is python + openpyxl installed, and reports in data\reports\? & exit /b 1 )

echo.
echo === 2/2  backfilling daily F^&O ledger ===
node scripts\backfill-fno-ledger.mjs
if errorlevel 1 ( echo. & echo backfill FAILED & exit /b 1 )

echo.
echo === result ===
node -e "const j=require('./data/fno-ledger.json');const d=j.rows.map(r=>r.date).sort();console.log('  '+j.rows.length+' ledger rows  ('+(d[0]||'-')+' to '+(d[d.length-1]||'-')+')');const rep=j.rows.filter(r=>r.source==='report').length;console.log('  '+rep+' from reports (historical), '+(j.rows.length-rep)+' from live capture')"

echo.
echo Looks right? Commit + push:
echo   git add data\broker-tax.json data\fno-ledger.json
echo   git commit -m "chore: backfill daily F^&O ledger from broker reports"
echo   git push
