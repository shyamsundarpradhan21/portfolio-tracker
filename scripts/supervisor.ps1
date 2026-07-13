# Supervisor -- the ONE self-heal task for the whole pipeline (registered by
# register-supervisor.ps1). Two responsibilities, one 5-min tick:
#   (A) EVERY run  -- daemon liveness: keep the long-running .mjs daemons alive.
#   (B) HOURLY     -- daily-job freshness: hand off to scripts\daily-check.mjs (gated by
#                     an IST-hour stamp so the heavy check runs ~1/hour, not every tick).
# Short-lived and stateless, so Task Scheduler's timer IS the durable heartbeat -- nothing
# has to watch the supervisor (a long-running one would just reintroduce the "who restarts
# it when it dies" problem this exists to solve).
#
# (A) For each daemon: if it SHOULD be running now but no live process matches, re-trigger
# its OWN scheduled task (Start-ScheduledTask reuses that task's full hardened launch:
# working dir, log redirect, WakeToRun/battery settings, MultipleInstances IgnoreNew).
# Why: IngestDaemon (at-logon) and CaptureIntradayUS/India (fire-once timed) have NO
# mid-session relaunch -- a process death inside its window is unrecovered until the next
# logon / next day. (2026-07-10: US capture died ~18:45 after 1 tick; window stayed dark ~4h.)
# Window logic is NEVER re-encoded here: scripts\market-state.mjs is the single DST-aware
# source of truth (marketHours.mjs). We heal ONLY on the real OPEN window, never on 'pre'
# (marketState is 'pre' for ALL of 00:00-09:13, so an early relaunch would idle for hours
# holding keep-awake). The primary timed tasks still own the on-time launch; this heals
# mid-window deaths.
#
# ASCII-ONLY on purpose: PowerShell 5.1 reads .ps1 as ANSI, so a stray non-ASCII byte
# (em-dash, arrow) corrupts parsing. Keep it plain.

$ErrorActionPreference = 'Stop'
$repo      = Split-Path -Parent $PSScriptRoot        # ...\portfolio-tracker
$eventLog  = Join-Path $PSScriptRoot 'supervisor.log'    # append: daemon restart/failure EVENTS only
$stateFile = Join-Path $PSScriptRoot 'supervisor.state'  # overwrite: last-check heartbeat (never grows)

function Write-Event($msg) {
  Add-Content -Path $eventLog -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding utf8
}

# -- Current market session (DST-aware) from the daemons' own source of truth --
try {
  $state = & node (Join-Path $PSScriptRoot 'market-state.mjs') | ConvertFrom-Json
} catch {
  Write-Event "watchdog: market-state probe FAILED ($($_.Exception.Message)) -- skipped this run"
  exit 0
}
$usOpen = $state.us -eq 'open'
$inOpen = $state.'in' -eq 'open'

# -- One snapshot of live node command lines (drop entries we can't read under Limited) --
$cmdlines = @(
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty CommandLine -ErrorAction SilentlyContinue |
    Where-Object { $_ }
)

# name -> (process match, its scheduled task, should-it-run-now). Both capture entries share
# the capture-daemon.mjs match; the India/US windows are disjoint so at most one is should-run.
$daemons = @(
  [pscustomobject]@{ name='ingest';     pattern='ingest-daemon\.mjs';  task='IngestDaemon';         should=$true   },
  [pscustomobject]@{ name='capture-us'; pattern='capture-daemon\.mjs'; task='CaptureIntradayUS';    should=$usOpen },
  [pscustomobject]@{ name='capture-in'; pattern='capture-daemon\.mjs'; task='CaptureIntradayIndia'; should=$inOpen }
)

$restarts = 0
$launched = @()          # patterns started this run -- treat as alive so a shared match can't double-start
$status   = foreach ($d in $daemons) {
  if (-not $d.should) { '{0}=off' -f $d.name; continue }
  $alive = (@($cmdlines -match $d.pattern).Count -gt 0) -or ($launched -contains $d.pattern)
  if ($alive) { '{0}=up' -f $d.name; continue }
  # should run, nothing alive -> heal via its own task
  try {
    Start-ScheduledTask -TaskName $d.task
    $launched += $d.pattern
    $restarts++
    Write-Event ('watchdog: RESTARTED {0} -- {1} was DOWN inside its window (IST {2})' -f $d.task, $d.name, $state.t)
    '{0}=RESTARTED' -f $d.name
  } catch {
    Write-Event ('watchdog: FAILED to restart {0} ({1}) -- {2}' -f $d.task, $d.name, $_.Exception.Message)
    '{0}=FAIL' -f $d.name
  }
}

# (A2) Broker-token freshness -- the ONLY fixed minter is DailyMorning (08:55); if the laptop
# was asleep then, or the SEBI pre-open cycle killed the evening token before the daemon
# relaunched at 09:13, the F&O tape reads dead tokens ALL day with no recovery. ensure-tokens.mjs
# closes that: in-window + stale -> force-mint (dhan pure-API, upstox headless), idempotent when
# fresh. The daemon reads the new token on its next ~10s poll, so no restart is needed. We only
# probe inside the India window; ensure-tokens re-checks the precise 08:45 IST boundary itself.
# No 2>&1 (PS 5.1 wraps native stderr as errors); ensure-tokens prints its status to stdout.
if ($state.'in' -eq 'open' -or $state.'in' -eq 'pre') {
  try {
    $tokOut = & node (Join-Path $PSScriptRoot 'ensure-tokens.mjs')
    foreach ($l in @($tokOut)) {
      if ($l -match 'MINTED|MINT-FAIL|MINT-SKIP') { Write-Event ('tokens: {0}' -f $l) }
    }
  } catch {
    Write-Event ('tokens: ensure-tokens probe FAILED -- {0}' -f $_.Exception.Message)
  }
}

# Heartbeat: always-current one-liner (overwritten, so it never grows). The event log stays
# quiet unless something actually needed healing.
Set-Content -Path $stateFile -Encoding utf8 -Value (
  '{0}  IST {1}  us={2} in={3}  [{4}]  restarts={5}' -f `
    (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $state.t, $state.us, $state.'in', ($status -join ' '), $restarts
)

# (B) Daily-job freshness -- gated to ~1/hour so the 5-min daemon tick doesn't run the heavy
# check 12x/hour. Stamp = current IST clock-hour (yyyy-MM-dd-HH); run daily-check.mjs only when
# it changes. daily-check.mjs owns the freshness logic + its own checker log (daily-check.log)
# and per-day rerun cap, so a stale daily job is re-run and every check is recorded there.
$stamp    = Join-Path $PSScriptRoot 'daily-check.stamp'
$nowHour  = ((Get-Date).ToUniversalTime().AddHours(5.5)).ToString('yyyy-MM-dd-HH')   # IST hour
$lastHour = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { '' }
if ($nowHour -ne $lastHour) {
  Set-Content -Path $stamp -Encoding ascii -Value $nowHour
  $line = & node (Join-Path $PSScriptRoot 'daily-check.mjs')
  if ($line) { Add-Content -Path (Join-Path $PSScriptRoot 'daily-check.log') -Value $line -Encoding utf8 }
}
