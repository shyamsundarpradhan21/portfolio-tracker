# Registers DailyJobCheck -- runs scripts\daily-check.cmd hourly, 24/7, to catch a
# silently-missed or silently-failed daily job (DailyNetworthSnapshot snapshot;
# BrokerSyncEvening broker-state) and re-run it, logging every check.
#
# Run ONCE in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\register-daily-check.ps1
#
# Repo-relative paths ONLY (DhanDailyLogin/UpstoxDailyLogin path-rot lesson). The checker
# is short-lived + stateless; Task Scheduler's hourly timer is the durable heartbeat.
# ASCII-ONLY (PowerShell 5.1 reads .ps1 as ANSI).

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'daily-check.cmd'

$action = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $repo

# Every hour, effectively forever. PS 5.1 chokes on [TimeSpan]::MaxValue, so use a 10-year
# span. -AtLogOn so a session resumes coverage at once (and the first run after a logon heals
# anything a laptop-asleep trigger evaporated -- the exact DailyNetworthSnapshot failure).
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$logon  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# The check itself is ~1s (re-runs are fired async via schtasks and not waited on); a 10-min
# cap is a generous hang backstop below the 1-hour interval. Battery-friendly so it keeps
# checking on an unplugged laptop.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'DailyJobCheck' `
  -Action $action -Trigger @($hourly, $logon) -Settings $settings -Principal $principal `
  -Description 'Daily-job checker: hourly, verifies DailyNetworthSnapshot (snapshot-sleeves.json) and BrokerSyncEvening (broker-state.json) produced fresh output; re-runs a stale+due one via its own task (max 1/day) and logs every check. Log: scripts\daily-check.log; state: scripts\daily-check.state.' `
  -Force | Out-Null

Write-Host "Registered DailyJobCheck (hourly, 24/7 + at logon)." -ForegroundColor Green
Write-Host "Log: scripts\daily-check.log" -ForegroundColor Cyan
