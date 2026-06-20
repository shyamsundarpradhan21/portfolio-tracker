# Registers BrokerSyncEvening — the weekday 18:30 IST headless F&O realised
# capture. Run ONCE in PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\register-evening-sync.ps1
#
# Why 18:30: market closes 15:30 IST; broker trades/positions/realisedProfit reset
# at next-day pre-open, so the capture must run the SAME evening. -StartWhenAvailable
# means a missed slot (laptop off) runs at next logon — but if that's the next
# morning the intraday data is already gone, so that day is trued up at the annual
# ITR pass. The morning DailyBrokerSync (06:00) stays for holdings + Kite.

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'sync-evening.cmd'

$action  = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Weekly `
  -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 6:30PM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'BrokerSyncEvening' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Evening 18:30 IST headless F&O realised capture -> data/fno-ledger.json + trades-log.json. Catches today''s intraday data before the next-day broker-API reset; commits + pushes.' `
  -Force

Write-Host "Registered BrokerSyncEvening (weekday 18:30 IST)." -ForegroundColor Green
Write-Host "Run now to test:  Start-ScheduledTask -TaskName BrokerSyncEvening" -ForegroundColor Cyan
Write-Host "Log:  scripts\sync-evening.log" -ForegroundColor Cyan
