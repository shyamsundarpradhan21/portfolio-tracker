# Registers Supervisor -- the ONE self-heal task: runs scripts\supervisor.ps1 in SESSION 0
# (S4U, no desktop) so its tick never flashes a console over what's on screen. Cadence is
# window-aware: every 5 min DURING the India + US capture windows (where a mid-window daemon
# death actually costs intraday data), and a sparse every-2-hour backstop the rest of the time
# (keeps IngestDaemon alive for overnight mail + the hourly-gated daily-check). Each tick keeps
# the long-running .mjs daemons alive; once an hour it hands off to scripts\daily-check.mjs to
# verify the daily jobs (snapshot / broker sync) produced fresh output and re-runs a stale one.
# Replaces the old two-task split (DaemonWatchdog + DailyJobCheck), which this script unregisters.
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

# Window-aware cadence (replaces the flat every-5-min). Fast heal ONLY where a mid-window daemon
# death actually costs data; a sparse backstop the rest of the time:
#   base   -- every 2h, 24/7: keeps IngestDaemon alive (overnight mail) + the hourly-gated daily-check.
#   inWin  -- Mon-Fri 09:10->15:35 IST, every 5 min: heals CaptureIntradayIndia inside its window.
#   usWin  -- Mon-Fri 18:40->02:35 IST, every 5 min (crosses midnight): heals CaptureIntradayUS.
#   logon  -- resume coverage the instant a reboot's logon happens.
# PS 5.1 can't hang -RepetitionInterval on a -Weekly trigger directly, so lift the .Repetition
# object off a throwaway -Once trigger (the standard 5.1 workaround). Durations are window length.
# During a window BOTH the base and the 5-min window fire; IgnoreNew dedups the overlap, so the
# net cadence is ~5 min in-window / 2 h out. PS 5.1 chokes on [TimeSpan]::MaxValue -> 10-year span.
$base = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Hours 2) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$inWin = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 9:10AM
$inWin.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 6 -Minutes 25)).Repetition
$usWin = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 6:40PM
$usWin.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 7 -Minutes 55)).Repetition
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# The daemon check is ~1-2s; the hourly daily-check adds a node run (re-runs are fired async
# via schtasks and not waited on). A 5-min exec cap kills any hang before the next tick so
# IgnoreNew can't be stranded by a zombie. Battery-friendly so it keeps healing unplugged.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew
# S4U -- run in session 0 (no desktop) so the tick never flashes a console over what's on screen.
# Supervisor is push-free + browser-free (it only reads local files, runs node, and
# Start-ScheduledTask's the other tasks), so it needs no credential store and S4U's
# no-network-credential restriction costs nothing here.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName 'Supervisor' `
  -Action $action -Trigger @($base, $inWin, $usWin, $logon) -Settings $settings -Principal $principal `
  -Description 'One self-heal task for the pipeline, in session 0 (S4U, invisible). Every 5 min DURING the India (09:10-15:35) + US (18:40-02:35) capture windows, every 2h otherwise: keeps the .mjs daemons alive (IngestDaemon / CaptureIntradayUS / CaptureIntradayIndia). Hourly: verifies the daily jobs (DailyMorning, DailyEvening) produced fresh output and re-runs a stale one. Logs: scripts\supervisor.log (+ .state heartbeat), scripts\daily-check.log (the checker log).' `
  -Force | Out-Null

Write-Host "Registered Supervisor (session 0 / S4U; 5-min in market windows, 2h otherwise + at logon)." -ForegroundColor Green
Write-Host "Daemon events:  scripts\supervisor.log  (heartbeat: scripts\supervisor.state)" -ForegroundColor Cyan
Write-Host "Checker log:    scripts\daily-check.log" -ForegroundColor Cyan
