# Registers DaemonWatchdog -- runs scripts\daemon-watchdog.ps1 every 5 minutes, 24/7,
# to self-heal any dead long-running .mjs daemon (IngestDaemon always-on;
# CaptureIntradayUS / CaptureIntradayIndia inside their market windows).
#
# Run ONCE in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\register-daemon-watchdog.ps1
#
# Repo-relative paths ONLY (the DhanDailyLogin/UpstoxDailyLogin path-rot lesson: absolute
# C:\Users\... actions died when the repo moved drives). The watcher is short-lived and
# stateless -- Task Scheduler's 5-min timer is the durable heartbeat, so nothing watches it.
#
# ASCII-ONLY on purpose (PowerShell 5.1 reads .ps1 as ANSI).

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$ps1  = Join-Path $PSScriptRoot 'daemon-watchdog.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`"" `
  -WorkingDirectory $repo

# Every 5 min, effectively forever. PS 5.1 chokes on [TimeSpan]::MaxValue for the duration,
# so use a 10-year span (outlives the machine). -AtLogOn so a reboot resumes coverage at once
# (and the first post-reboot run heals anything the reboot killed).
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$logon  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# The watcher finishes in ~1-2s; a 2-min exec cap kills any hang well before the next 5-min
# fire, so IgnoreNew (which would skip a new run while a zombie is "still running") can never
# strand the schedule. Battery-friendly so it keeps healing on an unplugged laptop.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'DaemonWatchdog' `
  -Action $action -Trigger @($repeat, $logon) -Settings $settings -Principal $principal `
  -Description 'Liveness watchdog for the .mjs daemons: every 5 min, restarts IngestDaemon (always-on), CaptureIntradayUS (US window), or CaptureIntradayIndia (India window) if it should be running but is not. Window logic from scripts\market-state.mjs (marketHours.mjs). Heartbeat: scripts\daemon-watchdog.state; events: scripts\daemon-watchdog.log.' `
  -Force | Out-Null

Write-Host "Registered DaemonWatchdog (every 5 min, 24/7 + at logon)." -ForegroundColor Green
Write-Host "Heartbeat:  scripts\daemon-watchdog.state" -ForegroundColor Cyan
Write-Host "Events:     scripts\daemon-watchdog.log" -ForegroundColor Cyan
