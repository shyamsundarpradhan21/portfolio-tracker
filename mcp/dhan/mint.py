#!/usr/bin/env python3
"""Force-mint a fresh Dhan access token, headless (TOTP self-mint).

Standalone CLI: server.py's __main__ launches the MCP server, so the daily mint
lives here. Writes mcp/dhan/.token.json (the file the capture daemon reads off disk).
Run before the India F&O capture window — SEBI invalidates overnight tokens at the
daily pre-open cycle, so a token minted the evening before is dead by morning.

  python mint.py        # mints, overwrites .token.json, prints status

Bypasses server._token()'s mint+23h cache heuristic (which would otherwise consider
the dead token "still valid" and skip the re-mint) by calling _mint() directly.
"""
import sys
import time
import server  # same dir on sys.path[0]; loads DHAN_CLIENT_ID/PIN/TOTP_SEED from .env

# Bounded retry — parity with Upstox's login.py, which already retries. The TOTP
# endpoint occasionally blips (network / 5xx / a TOTP-window edge), and the mint
# fires exactly ONCE at the pre-open with nothing behind it, so a single miss at
# 09:10 stranded the F&O tape (dhan MTM absent, no error surfaced) for the WHOLE
# trading day (06-Jul-2026). Short backoff, NOT the ~2-min rate-limit wait: only one
# mint runs per morning, so we're covering transients, not a self-inflicted rate
# limit — and a long synchronous wait would delay the daemon's start. Each miss's
# reason is logged to stderr by server._mint() → capture-*.log.
ATTEMPTS = 3
for i in range(ATTEMPTS):
    r = server._mint()
    if r:
        print(f"[dhan-mint] ok — token len {len(r[0])} (attempt {i + 1}/{ATTEMPTS})")
        sys.exit(0)
    if i + 1 < ATTEMPTS:
        wait = 8 * (i + 1)
        print(f"[dhan-mint] attempt {i + 1}/{ATTEMPTS} failed — retrying in {wait}s")
        time.sleep(wait)
print(f"[dhan-mint] FAILED after {ATTEMPTS} attempts — check DHAN_CLIENT_ID/PIN/TOTP_SEED "
      "in mcp/dhan/.env, or the 1-per-2min rate limit (reasons logged above)")
sys.exit(1)
