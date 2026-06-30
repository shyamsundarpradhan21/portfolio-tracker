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
import server  # same dir on sys.path[0]; loads DHAN_CLIENT_ID/PIN/TOTP_SEED from .env

r = server._mint()
if r:
    print(f"[dhan-mint] ok — token len {len(r[0])}")
    sys.exit(0)
print("[dhan-mint] FAILED — check DHAN_CLIENT_ID/PIN/TOTP_SEED in mcp/dhan/.env, or the 1-per-2min rate limit")
sys.exit(1)
