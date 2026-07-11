@echo off
REM -- DailyEvening: post-close F&O realised capture, mirroring DailyMorning's chained shape ----
REM DailyMorning chains sync.cmd -> snapshot-daily.cmd (morning setup). This is its evening
REM counterpart: it runs the evening broker sync that books TODAY's realised F&O P&L + fills into
REM data/fno-ledger.json / data/trades-log.json BEFORE the broker APIs reset at next-day pre-open.
REM Kept a thin chainer (like morning.cmd) so a second evening step can slot in later without
REM re-plumbing the task. Co-timed with CaptureIntradayUS (18:40) so the evening mirrors the
REM morning (DailyMorning + CaptureIntradayIndia share 08:55); US needs no broker token, so the
REM two fire together with no mint race.
REM Registered as the Windows task DailyEvening (weekday 18:40 IST) by scripts\register-evening.ps1.
REM Replaces BrokerSyncEvening. Log: scripts\sync-evening.log (owned by sync-evening.cmd).
call "%~dp0sync-evening.cmd"
