# Registers the unified-ingestion Task Scheduler jobs:
#   IngestDaemon       — at logon: the always-on intake daemon (Pub/Sub pull when
#                        GCP creds exist + inbox/ fs-watch; one queue; manifest).
#   IngestWeeklyReport — Sunday 10:00: completeness/gap report → scripts\ingest.log.
#
# Run ONCE in PowerShell:
#   powershell -File scripts\register-ingest-daemon.ps1
#
# Repo-relative paths ONLY (learned from the DhanDailyLogin/UpstoxDailyLogin
# path-rot: absolute C:\Users\... actions died when the repo moved drives).
# The daemon has NO execution time limit (it is designed to run for the whole
# logon session; keepAwake inside it is work-scoped so it never blocks sleep),
# and IgnoreNew so a re-logon can't double-start it.

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'ingest.cmd'

$daemonAction  = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $repo
$daemonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$daemonSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
# S4U -- session 0 (no desktop). The daemon is push-free + browser-free (Gmail API + Pub/Sub
# pull; writes to KV + a local manifest; the fno-overlay rebuild it spawns is a KV write, not a
# git push), so it needs no credential store. Bonus: session 0 survives a logoff, so the
# overnight document mail is still ingested if the interactive session ends.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME `
  -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName 'IngestDaemon' `
  -Action $daemonAction -Trigger $daemonTrigger -Settings $daemonSettings -Principal $principal `
  -Description 'Unified document-ingestion daemon: Gmail Pub/Sub pull + inbox/ fs-watch -> parser registry -> manifest. Readonly Gmail; PASS deletes the clone, FAIL quarantines. Log: scripts\ingest.log' `
  -Force | Out-Null

$reportAction  = New-ScheduledTaskAction -Execute $cmd -Argument 'report' -WorkingDirectory $repo
$reportTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 10:00AM
$reportSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'IngestWeeklyReport' `
  -Action $reportAction -Trigger $reportTrigger -Settings $reportSettings -Principal $principal `
  -Description 'Weekly ingestion completeness report (expects-cadence gaps + staleness) appended to scripts\ingest.log.' `
  -Force | Out-Null

Write-Host "Registered IngestDaemon (at logon) and IngestWeeklyReport (Sun 10:00)." -ForegroundColor Green
Write-Host "Start now:  Start-ScheduledTask -TaskName IngestDaemon" -ForegroundColor Cyan
Write-Host "Log:        scripts\ingest.log" -ForegroundColor Cyan
