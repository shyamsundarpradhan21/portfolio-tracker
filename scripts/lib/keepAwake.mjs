// Keep Windows awake (system power, not the display) WHILE the capture daemon
// runs, so a long overnight session isn't suspended by idle sleep — the thing
// that killed the US capture mid-window (it died ~37min in, far short of the
// 18:45→02:30 window). We spawn a short PowerShell that holds
// ES_CONTINUOUS | ES_SYSTEM_REQUIRED for its own lifetime and re-asserts it each
// minute; it self-exits if the daemon (its parent PID) is gone, so a hard crash
// can't strand the laptop awake forever. The request is released the instant the
// daemon stops (we kill the child + it clears ES_CONTINUOUS on the way out).
//
// Deliberately scoped: NO global power-plan edit, and NOT ES_DISPLAY_REQUIRED —
// the screen may still sleep, only the system stays up. IMPORTANT: this does NOT
// override a *lid-close* sleep (that's a separate Windows "on lid close" action
// the user owns); it only defeats the idle-timer sleep that suspended us before.
import { spawn } from 'node:child_process';

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
const KEEP = ES_CONTINUOUS | ES_SYSTEM_REQUIRED; // 0x80000001

// Returns a release() fn. No-op (and returns a no-op) off Windows or if the
// helper can't spawn — capture still runs, it just won't fight sleep.
export function keepSystemAwake(parentPid = process.pid) {
  if (process.platform !== 'win32') return () => {};
  const ps = [
    "$s=@'",
    'using System;using System.Runtime.InteropServices;',
    'public static class P{[DllImport("kernel32.dll")]public static extern uint SetThreadExecutionState(uint e);}',
    "'@",
    'Add-Type -TypeDefinition $s',
    `[void][P]::SetThreadExecutionState(${KEEP})`,
    'while($true){',
    '  Start-Sleep -Seconds 60',
    `  if(-not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)){break}`,
    `  [void][P]::SetThreadExecutionState(${KEEP})`,
    '}',
    `[void][P]::SetThreadExecutionState(${ES_CONTINUOUS})`, // clear the request
  ].join('\n');
  let child;
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, stdio: 'ignore' });
  } catch { return () => {}; }
  return () => { try { child.kill(); } catch {} };
}
