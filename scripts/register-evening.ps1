# Registers DailyEvening -- the evening counterpart of DailyMorning: the post-close F&O realised
# capture, wrapped in the same chained-.cmd + Daily* task shape. It RETIRES BrokerSyncEvening
# (folded in, exactly as DailyMorning folded DailyBrokerSync + DailyNetworthSnapshot).
# Run ONCE in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\register-evening.ps1
#
# Why 18:40 weekdays: co-timed with CaptureIntradayUS (18:40) so the evening mirrors the morning,
# where DailyMorning + CaptureIntradayIndia share 08:55. Unlike the morning there is NO mint race --
# the US capture uses keyless Yahoo and mints no broker token, so the two can fire together cleanly.
# The evening sync must run AFTER market close (15:30) to book today's realised F&O + fills and well
# BEFORE the next trading day's pre-open reset wipes them; 18:40 satisfies both. Weekday-only because
# F&O realised only exists on trading days (DailyMorning is daily because its snapshot half runs
# 7d/wk). -LogonType Interactive so the git push uses the cached HTTPS credential store, same as DailyMorning.

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'evening.cmd'

$action  = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Weekly `
  -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 6:40PM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'DailyEvening' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Daily 18:40 IST (weekdays): evening broker sync (evening.cmd -> sync-evening.cmd) -- books today F&O realised + fills into fno-ledger.json / trades-log.json before the next-day pre-open reset. Co-timed with CaptureIntradayUS (18:40). Evening counterpart of DailyMorning; replaces BrokerSyncEvening.' `
  -Force

Write-Host "Registered DailyEvening (weekday 18:40 IST): evening F&O realised sync." -ForegroundColor Green

# Retire the superseded task (guarded; folded into DailyEvening).
if (Get-ScheduledTask -TaskName 'BrokerSyncEvening' -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName 'BrokerSyncEvening' -Confirm:$false
  Write-Host "Retired BrokerSyncEvening (folded into DailyEvening)." -ForegroundColor Yellow
}

Write-Host "Run now to test:  Start-ScheduledTask -TaskName DailyEvening" -ForegroundColor Cyan
Write-Host "Log:  scripts\sync-evening.log" -ForegroundColor Cyan
