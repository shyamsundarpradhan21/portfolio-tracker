@echo off
REM ── Unified ingestion — Task Scheduler wrapper ────────────────────────────────
REM Launched by the tasks registered in scripts/register-ingest-daemon.ps1
REM (repo-relative — no C:\Users\... path rot).
REM
REM   ingest.cmd          → the long-running daemon (at-logon task IngestDaemon):
REM                         Pub/Sub pull (when GCP creds exist) + inbox/ fs-watch
REM                         → one queue → parse → manifest. Runs until logoff.
REM   ingest.cmd report   → completeness report (weekly task IngestWeeklyReport).
REM
REM Logs: scripts\ingest.log (append — both modes).
cd /d "%~dp0.."
if /I "%1"=="report" (
  node scripts\ingest-report.mjs >> "%~dp0ingest.log" 2>&1
) else (
  node scripts\ingest-daemon.mjs >> "%~dp0ingest.log" 2>&1
)
