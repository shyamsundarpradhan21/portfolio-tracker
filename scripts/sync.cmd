@echo off
REM One-key broker sync launcher. Opens Claude Code and runs /sync - which syncs
REM the 3 zero-touch brokers via scripts/sync-brokers.mjs (with mint-on-demand)
REM and walks the Kite/Zerodha login. Double-click it anytime, or let the
REM DailyBrokerSync logon task run it on your first logon of the day (~06:00).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-launch.ps1"
