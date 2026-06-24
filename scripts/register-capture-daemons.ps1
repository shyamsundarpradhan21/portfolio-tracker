# Registers the two intraday capture-daemon Task Scheduler jobs:
#   CaptureIntradayIndia — weekdays 09:10 IST, F&O (10s) + India equity (60s)
#   CaptureIntradayUS    — weekdays 18:40 IST, US equity (60s) overnight to ~02:30
#
# Run ONCE in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\register-capture-daemons.ps1
#
# The daemon (scripts/capture-daemon.mjs) gates on the IST clock itself, so each
# task just needs to launch on time; the daemon self-exits when its session
# window closes. ExecutionTimeLimit is a safety net well above each window's
# real length (India ~6h, US ~8h overnight including the past-midnight tail).
# -StartWhenAvailable means a missed launch (laptop asleep at the trigger time)
# fires at next logon — useful before the open, harmless once the window has
# closed (the daemon's gate will idle/exit immediately).

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'capture.cmd'

function Register-CaptureTask {
  param(
    [string] $TaskName,
    [string] $SessionArg,
    [DateTime] $TriggerAt,
    [int] $LimitHours,
    [string] $Description
  )
  $action  = New-ScheduledTaskAction -Execute $cmd -Argument $SessionArg -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -Weekly `
    -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $TriggerAt
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
    -ExecutionTimeLimit (New-TimeSpan -Hours $LimitHours) `
    -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
    -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description $Description -Force | Out-Null
}

Register-CaptureTask -TaskName 'CaptureIntradayIndia' -SessionArg 'in' `
  -TriggerAt 9:10AM -LimitHours 8 `
  -Description 'Intraday capture daemon — India session (09:13-15:32 IST). F&O P&L (10s) + India equity day-change (60s). Publishes to KV intraday:<date> + intraday:eq:<date>; commits archives once at close.'

Register-CaptureTask -TaskName 'CaptureIntradayUS' -SessionArg 'us' `
  -TriggerAt 6:40PM -LimitHours 10 `
  -Description 'Intraday capture daemon — US session (18:45 IST -> 02:30 IST next day, overnight). US equity day-change (60s, in INR via live USD/INR). Publishes to KV intraday:us:<date>; commits archive once at close.'

Write-Host "Registered CaptureIntradayIndia (weekday 09:10 IST) and CaptureIntradayUS (weekday 18:40 IST)." -ForegroundColor Green
Write-Host "Run now to test:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName CaptureIntradayIndia" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName CaptureIntradayUS"    -ForegroundColor Cyan
Write-Host "Logs:  scripts\capture-in.log  /  scripts\capture-us.log" -ForegroundColor Cyan
