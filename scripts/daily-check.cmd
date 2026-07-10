@echo off
REM Daily-job checker wrapper (Task Scheduler: DailyJobCheck, hourly) -- verifies the
REM once-a-day jobs produced fresh output, re-runs a stale one via its own task, and
REM appends a status line to scripts\daily-check.log. See scripts\daily-check.mjs.
cd /d "%~dp0.."
node scripts\daily-check.mjs >> "%~dp0daily-check.log" 2>&1
