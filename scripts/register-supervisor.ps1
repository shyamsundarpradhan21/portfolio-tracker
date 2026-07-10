# Registers Supervisor -- the ONE self-heal task: runs scripts\supervisor.ps1 every 5 min,
# 24/7. Each tick keeps the long-running .mjs daemons alive; once an hour it hands off to
# scripts\daily-check.mjs to verify the daily jobs (snapshot / broker sync) produced fresh
# output and re-runs a stale one. Replaces the old two-task split (DaemonWatchdog +
# DailyJobCheck), which this script unregisters.
#
# Run ONCE in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\register-supervisor.ps1
#
# Repo-relative paths ONLY (DhanDailyLogin/UpstoxDailyLogin path-rot lesson). ASCII-ONLY
# (PowerShell 5.1 reads .ps1 as ANSI).

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$ps1  = Join-Path $PSScriptRoot 'supervisor.ps1'

# Fold the old two watcher tasks into this one.
foreach ($old in 'DaemonWatchdog', 'DailyJobCheck') {
  if (Get-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $old -Confirm:$false
    Write-Host "Unregistered old task $old" -ForegroundColor DarkYellow
  }
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`"" `
  -WorkingDirectory $repo

# Every 5 min, effectively forever. PS 5.1 chokes on [TimeSpan]::MaxValue for the duration,
# so use a 10-year span. -AtLogOn so a reboot resumes coverage at once (and the first run
# after logon heals anything the reboot killed).
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$logon  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# The daemon check is ~1-2s; the hourly daily-check adds a node run (re-runs are fired async
# via schtasks and not waited on). A 5-min exec cap kills any hang before the next tick so
# IgnoreNew can't be stranded by a zombie. Battery-friendly so it keeps healing unplugged.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'Supervisor' `
  -Action $action -Trigger @($repeat, $logon) -Settings $settings -Principal $principal `
  -Description 'One self-heal task for the pipeline. Every 5 min: keeps the .mjs daemons alive (IngestDaemon / CaptureIntradayUS / CaptureIntradayIndia). Hourly: verifies the daily jobs (DailyNetworthSnapshot, BrokerSyncEvening) produced fresh output and re-runs a stale one. Logs: scripts\supervisor.log (+ .state heartbeat), scripts\daily-check.log (the checker log).' `
  -Force | Out-Null

Write-Host "Registered Supervisor (every 5 min, 24/7 + at logon)." -ForegroundColor Green
Write-Host "Daemon events:  scripts\supervisor.log  (heartbeat: scripts\supervisor.state)" -ForegroundColor Cyan
Write-Host "Checker log:    scripts\daily-check.log" -ForegroundColor Cyan
