# Registers DailyMorning -- the merged 07:00 IST morning task: broker holdings sync THEN the
# durable snapshot, in sequence (the snapshot needs the fresh broker-state the sync writes).
# Run ONCE in PowerShell (pull latest first, so the updated daily-check heal target is in place):
#   powershell -ExecutionPolicy Bypass -File scripts\register-morning.ps1
#
# This MERGES three morning tasks into one. It registers DailyMorning and RETIRES:
#   - DailyBrokerSync (06:00)          -> now the first half of DailyMorning
#   - DailyNetworthSnapshot (07:00)    -> now the second half of DailyMorning
#   - UpstoxDailyLogin (06:20)         -> redundant: the Upstox MCP just READS .token.json and
#                                         the sync mints it on demand each morning (verified).
# Why chain: the snapshot always needed the broker-state the sync produces, so one sequenced
# task kills the two-task timing gamble. Why 07:00 (not 06:00): the prior day is fully closed on
# every sleeve by then (US ~02:00 IST + AMFI NAV). FyersDailyLogin stays its OWN task -- its mint
# is HEADED (needs a browser), so it can't run in this headless chain. -LogonType Interactive so
# puppeteer/next-dev + the git push work, same as the tasks it replaces.

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'morning.cmd'

$action  = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 7:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'DailyMorning' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Daily 07:00 IST: broker holdings sync (sync.cmd) THEN durable snapshot (snapshot-daily.cmd), chained so the snapshot has fresh broker-state. Replaces DailyBrokerSync + DailyNetworthSnapshot + UpstoxDailyLogin.' `
  -Force

Write-Host "Registered DailyMorning (daily 07:00 IST): sync -> snapshot." -ForegroundColor Green

# Retire the three superseded tasks (guarded; each fold is explained above).
foreach ($t in 'DailyBrokerSync', 'DailyNetworthSnapshot', 'UpstoxDailyLogin') {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t -Confirm:$false
    Write-Host "Retired $t (folded into DailyMorning / redundant)." -ForegroundColor Yellow
  }
}

Write-Host "Run now to test:  Start-ScheduledTask -TaskName DailyMorning" -ForegroundColor Cyan
Write-Host "Logs:  scripts\sync.log + scripts\snapshot-daily.log" -ForegroundColor Cyan
