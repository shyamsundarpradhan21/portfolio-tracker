@echo off
REM -- DailyMorning: broker holdings sync THEN the durable snapshot, in sequence -----------
REM The snapshot needs fresh broker-state (which the sync produces), so chaining them under
REM ONE 07:00 task removes the old 06:00/07:00 two-task timing gamble (a 07:00 snapshot whose
REM trigger evaporated while the laptop slept -- the miss daily-check had to heal). Each step
REM keeps its own commit+push (different data). Replaces DailyBrokerSync + the standalone
REM DailyNetworthSnapshot; UpstoxDailyLogin is retired too (the sync mints the Upstox token on
REM demand and the MCP just reads it). Registered by scripts\register-morning.ps1.
call "%~dp0sync.cmd"
call "%~dp0snapshot-daily.cmd"
