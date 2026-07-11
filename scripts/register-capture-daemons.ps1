# Registers the two intraday capture-daemon Task Scheduler jobs:
#   CaptureIntradayIndia — weekdays 08:55 IST, F&O (10s) + India equity (60s)
#                          + at-logon trigger (mid-session reboot resumes capture)
#   CaptureIntradayUS    — weekdays 18:40 IST, US equity (60s) overnight to ~02:30
#
# Run ONCE in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\register-capture-daemons.ps1
#
# The daemon (scripts/capture-daemon.mjs) gates on the IST clock itself, so each
# task just needs to launch on time; the daemon self-exits when its session
# window closes. Neither session mints broker tokens (capture.cmd just launches the
# daemon) — India launches at 08:55 alongside DailyMorning, which is the sole morning
# minter; the daemon idles until the 09:13 open by which time the tokens are fresh on
# disk. So the India launch time is only a warm-up; the CAPTURE window is still 09:13-15:32. ExecutionTimeLimit is a safety net well above each window's
# real length (India ~6h, US ~8h overnight including the past-midnight tail).
# -StartWhenAvailable means a missed launch (laptop asleep at the trigger time)
# fires at next logon — useful before the open, harmless once the window has
# closed (the daemon's gate will idle/exit immediately).

$repo = Split-Path -Parent $PSScriptRoot                 # ...\portfolio-tracker
$cmd  = Join-Path $PSScriptRoot 'capture.cmd'

# SESSION 0 with a STORED PASSWORD (LogonType Password), not S4U: capture-daemon.mjs pushes its
# archive to origin/main at session close (commitArchive -> git push), and that push needs the
# DPAPI-bound HTTPS credential -- which S4U CANNOT decrypt but a full password logon can. So the
# task runs off the interactive desktop (no console flashes) AND keeps the close push working.
# The password is prompted once, interactively, and handed straight to Task Scheduler's
# LSA-protected store -- it is NEVER written to disk or this repo. (Microsoft-account setups: use
# your Microsoft-account password; if a task later shows result 0x8007052E "bad username or
# password", re-run this and re-enter it.) This is why the script must be RUN BY YOU, not headless.
$cred = Get-Credential -UserName $env:USERNAME `
  -Message 'Windows password to store for CaptureIntraday* (session 0, invisible; needed so the close-time archive push keeps working)'
$script:CapturePw = $cred.GetNetworkCredential().Password
if ([string]::IsNullOrEmpty($script:CapturePw)) { throw 'No password entered -- aborting (captures need a stored password for their close-time git push).' }

function Register-CaptureTask {
  param(
    [string] $TaskName,
    [string] $SessionArg,
    [DateTime] $TriggerAt,
    [int] $LimitHours,
    [string] $Description,
    [switch] $ResumeAtLogon
  )
  $action  = New-ScheduledTaskAction -Execute $cmd -Argument $SessionArg -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -Weekly `
    -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $TriggerAt
  # -ResumeAtLogon adds an at-logon trigger so a mid-session reboot resumes capture
  # (the timed trigger already fired that day, so Task Scheduler alone never relaunches;
  # -StartWhenAvailable only recovers a MISSED launch). Safe off-hours: the daemon's
  # market gate exits immediately on post/weekend and idles briefly pre-open. India only —
  # the US daemon would idle from a daytime logon until 18:45 holding its keep-awake
  # request (blocking idle-sleep all day) and get killed by its execution limit mid-session.
  $triggers = @($trigger)
  if ($ResumeAtLogon) { $triggers += New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME }
  # Laptop-hardening so a session survives an unattended overnight window:
  #   -WakeToRun                 wake from sleep at the trigger to launch
  #   -AllowStartIfOnBatteries   a laptop is usually on battery — don't refuse
  #   -DontStopIfGoingOnBatteries don't kill a running session when it unplugs
  # Idle-sleep DURING the window is handled by the daemon's own keep-awake power
  # request (scripts/lib/keepAwake.mjs), not a global power-plan change. NB: a
  # lid-close sleep is a separate Windows "on lid close" setting the user owns.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
    -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours $LimitHours) `
    -MultipleInstances IgnoreNew
  # -User + -Password (no -Principal) => LogonType Password: run whether logged on or not, in
  # session 0, with the stored credential so the close-time git push still authenticates.
  Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $triggers -Settings $settings `
    -User $env:USERNAME -Password $script:CapturePw -RunLevel Limited `
    -Description $Description -Force | Out-Null
}

# India limit is 16h (not window+slack): a logon-resumed instance can start as early as a
# midnight logon and must survive to the 15:32 close; the limit is only a hung-zombie backstop.
# Launch 08:55 (was 09:10) — just before the open, alongside DailyMorning; the daemon idles until
# its 09:13 market gate opens (capture window unchanged), so the earlier launch is only a warm-up.
Register-CaptureTask -TaskName 'CaptureIntradayIndia' -SessionArg 'in' `
  -TriggerAt 8:55AM -LimitHours 16 -ResumeAtLogon `
  -Description 'Intraday capture daemon — India session (launch 08:55; captures 09:13-15:32 IST). F&O P&L (10s) + India equity day-change (60s). Publishes to KV intraday:<date> + intraday:eq:<date>; commits archives once at close. No token mint (DailyMorning owns it). Also relaunches at logon so a mid-session reboot resumes capture.'

Register-CaptureTask -TaskName 'CaptureIntradayUS' -SessionArg 'us' `
  -TriggerAt 6:40PM -LimitHours 10 `
  -Description 'Intraday capture daemon — US session (18:45 IST -> 02:30 IST next day, overnight). US equity day-change (60s, in INR via live USD/INR). Publishes to KV intraday:us:<date>; commits archive once at close.'

Write-Host "Registered CaptureIntradayIndia (weekday 09:10 IST) and CaptureIntradayUS (weekday 18:40 IST)." -ForegroundColor Green
Write-Host "Run now to test:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName CaptureIntradayIndia" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName CaptureIntradayUS"    -ForegroundColor Cyan
Write-Host "Logs:  scripts\capture-in.log  /  scripts\capture-us.log" -ForegroundColor Cyan
