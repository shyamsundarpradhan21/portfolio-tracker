# Registers DailyBrokerSync -- the daily 06:00 IST headless broker-holdings sync.
# Run ONCE in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\register-broker-sync.ps1
#
# Why 06:00: after the ~03:30 SEBI daily token expiry and Upstox's funds-API
# maintenance window (00:00-05:30 IST). sync.cmd mints-on-demand for the 3
# zero-touch brokers (Upstox/Dhan/Fyers), so the sync self-heals regardless of
# when it fires or whether FyersDailyLogin/UpstoxDailyLogin ran. -StartWhenAvailable
# means a missed slot (laptop off) runs at next logon. Runs BEFORE
# DailyNetworthSnapshot (07:00) so broker-state.json is fresh for it. -LogonType
# Interactive so the git push uses the cached HTTPS credential store, same as
# DailyNetworthSnapshot / FyersDailyLogin. Kite/Zerodha is NOT synced -- that
# delivery sleeve is hand-maintained in app/portfolio.js. The F&O realised capture
# is the separate evening BrokerSyncEvening (18:30), register-evening-sync.ps1.

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'sync.cmd'

$action  = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 6:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'DailyBrokerSync' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Daily 06:00 IST headless broker holdings/positions/funds sync -> data/broker-state.json (+ market-wrap) via sync-brokers.mjs with mint-on-demand; commits + pushes. Kite/Zerodha NOT synced (hand-maintained delivery sleeve). F&O realised is the separate evening BrokerSyncEvening.' `
  -Force

Write-Host "Registered DailyBrokerSync (daily 06:00 IST)." -ForegroundColor Green
Write-Host "Run now to test:  Start-ScheduledTask -TaskName DailyBrokerSync" -ForegroundColor Cyan
Write-Host "Log:  scripts\sync.log" -ForegroundColor Cyan
