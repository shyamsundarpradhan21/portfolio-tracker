# Dhan MCP server

A standalone [MCP](https://modelcontextprotocol.io/) server for a Dhan account —
read tools always, order tools gated behind an explicit arm flag. You run and own
this process; it is **not** auto-wired into any agent's config. Built on the
DhanHQ v2 REST API (called directly with `requests`).

## Why this is the cleanest of the broker servers

DhanHQ exposes a **pure-API TOTP token endpoint**, so the server **self-mints** its
own 24h access token on demand — no browser, no QR/SMS, no Playwright, and **no
scheduled task**. (The Dhan consumer web login is QR/SMS and can't be automated;
the *developer* TOTP endpoint can.) Static IP is only needed for *placing* orders,
not for reading.

## Safety model

- **Read-only by default.** `place_order` / `cancel_order` only work when
  `DHAN_READONLY=0`. Until then the server cannot trade.
- Credentials live in `.env` (gitignored), never in code.

## Setup

1. **At Dhan Web → DhanHQ Trading APIs** (<https://dhanhq.co>): note your
   **Client ID**, and click **Set-up TOTP → Add TOTP**. Capture the **base32
   secret** (the seed) and add it to your authenticator app too.
2. **Install deps** (a venv is recommended):
   ```bash
   cd mcp/dhan
   python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. **Configure env** — copy `.env.example` to `.env` and fill in `DHAN_CLIENT_ID`,
   `DHAN_PIN`, `DHAN_TOTP_SEED`.

## How auth works (self-minting)

On each call the server checks its cached token (`.token.json`); if missing or
within ~23h of mint, it POSTs `dhanClientId + pin + totp` (derived from the seed
with `pyotp`) to `https://auth.dhan.co/app/generateAccessToken`, caches the fresh
24h token, and proceeds. Nothing for you to run daily.

## Connect it to your MCP client

You add this yourself (the agent is intentionally not allowed to self-wire trade
tools). In `.mcp.json` (repo root), point `command` at your venv's python:
```json
{
  "mcpServers": {
    "dhan": {
      "command": "ABSOLUTE/PATH/TO/mcp/dhan/.venv/Scripts/python.exe",
      "args": ["ABSOLUTE/PATH/TO/mcp/dhan/server.py"],
      "env": { "DHAN_READONLY": "1" }
    }
  }
}
```
(This replaces the hosted `mcp.dhan.co` MCP, whose QR/consent login can't be
automated.)

## Tools

| Tool | Access |
|---|---|
| `dhan_status` | auth |
| `get_profile`, `get_funds`, `get_holdings`, `get_positions`, `get_orderbook`, `get_trades` | read |
| `place_order`, `cancel_order` | **trade — only when `DHAN_READONLY=0` (+ static IP)** |

Read endpoints use the DhanHQ v2 paths (`/profile`, `/fundlimit`, `/holdings`,
`/positions`, `/orders`, `/trades`) with an `access-token` header.

## Arming trading

Only when you mean it: set `DHAN_READONLY=0` and register a static IP at DhanHQ,
then relaunch the client. For an account with client capital, leave it at `1`.
