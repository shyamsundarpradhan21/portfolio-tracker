# Registers DailyNetworthSnapshot — the daily 07:00 IST headless durable-snapshot
# recorder. Run ONCE in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\register-snapshot-daily.ps1
#
# Why 07:00: the laptop is off overnight (which is why the growth KV cron lives on
# Vercel at 03:00 IST). 07:00 is the first laptop-on slot after the prior day is fully
# closed on every sleeve (India 15:30 + US ~02:00 IST + AMFI NAV published), and after
# DailyBrokerSync (06:00) refreshes broker-state.json. -StartWhenAvailable means a
# missed slot (laptop off) runs at next logon; the rolling 7-day backfill then self-
# heals up to a week of missed days. Replaces the dead Remote "daily-networth-snapshot"
# routine (couldn't git-push/puppeteer from the ephemeral cloud workspace — the fallback
# SCHEDULE.md §4 pre-authorised). -LogonType Interactive so puppeteer/next-dev have a
# user session and git uses the cached HTTPS credential store, same as FyersDailyLogin.

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'snapshot-daily.cmd'

$action  = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 7:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'DailyNetworthSnapshot' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Daily 07:00 IST headless durable snapshot -> data/growth.json (rolling 7d recompute) + data/SNAPSHOT.md + data/snapshot-sleeves.json; one commit+push. Replaces the dead daily-networth-snapshot Remote routine; the Vercel /api/snapshot cron stays as the KV serving copy.' `
  -Force

Write-Host "Registered DailyNetworthSnapshot (daily 07:00 IST)." -ForegroundColor Green
Write-Host "Run now to test:  Start-ScheduledTask -TaskName DailyNetworthSnapshot" -ForegroundColor Cyan
Write-Host "Log:  scripts\snapshot-daily.log" -ForegroundColor Cyan
