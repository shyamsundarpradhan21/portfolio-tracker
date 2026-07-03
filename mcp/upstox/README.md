# Upstox MCP server

A standalone [MCP](https://modelcontextprotocol.io/) server for an Upstox account —
read tools always, order tools gated behind an explicit arm flag. You run and own
this process; it is **not** auto-wired into any agent's config. Built on the
Upstox v2 REST API (called directly with `requests`).

## Safety model

- **Read-only by default.** `place_order` / `modify_order` / `cancel_order` only
  work when `UPSTOX_READONLY=0`. Until you set that, the server cannot trade.
- **Keep client-capital accounts read-only** (`UPSTOX_READONLY=1`).
- Credentials live in the environment / `.env` (gitignored), never in code.
- The access token expires daily at ~3:30am IST — `login.py` re-mints it.

## Setup

1. **Create a free Upstox API app** at <https://account.upstox.com/developer/apps>
   → note the **API Key** (client_id) and **API Secret**, set a **Redirect URI**
   (e.g. `https://127.0.0.1/upstox`).
2. **Enable Time-based OTP (TOTP)** in Upstox (account security) so the login can
   be automated without SMS. At the QR screen, capture the **base32 seed** (use
   "enter key manually") and add it to your authenticator app too.
3. **Install deps** (a venv is recommended):
   ```bash
   cd mcp/upstox
   python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python -m playwright install chromium          # shared with other servers
   ```
4. **Configure env** — copy `.env.example` to `.env` and fill in.

## Connect it to your MCP client

You add this yourself (the agent is intentionally not allowed to self-wire trade
tools). In `.mcp.json` (repo root), point `command` at your venv's python:
```json
{
  "mcpServers": {
    "upstox": {
      "command": "ABSOLUTE/PATH/TO/mcp/upstox/.venv/Scripts/python.exe",
      "args": ["ABSOLUTE/PATH/TO/mcp/upstox/server.py"],
      "env": {
        "UPSTOX_READONLY": "1"
      }
    }
  }
}
```
(This replaces the hosted `mcp.upstox.com` MCP, whose OAuth re-prompts a browser
daily and can't be auto-driven.)

## Daily auth — automated (hands-off)

```bash
python login.py --show    # Playwright + TOTP: mobile -> TOTP -> PIN -> token
```
Writes the day's access token to `.token.json`; the server reads it. Needs in
`.env`: `UPSTOX_CLIENT_ID/SECRET/REDIRECT_URI`, `UPSTOX_MOBILE`,
`UPSTOX_TOTP_SEED`, `UPSTOX_PIN`. Try headless first (`python login.py`); if the
login refuses it, run headed (`--show`). Schedule it daily (Windows Task
Scheduler) each morning.

## Tools

| Tool | Access |
|---|---|
| `upstox_status` | auth |
| `get_profile`, `get_funds`, `get_holdings`, `get_positions`, `get_orderbook`, `get_trades`, `get_quotes` | read |
| `place_order`, `modify_order`, `cancel_order` | **trade — only when `UPSTOX_READONLY=0`** |

`place_order(instrument_token, quantity, transaction_type, order_type="MARKET", product="D", …)`
— `transaction_type` BUY|SELL · `order_type` MARKET|LIMIT|SL|SL-M · `product`
D (delivery) | I (intraday) | MTF · instrument_token e.g. `NSE_EQ|INE848E01016`.

## Arming trading

Only when you mean it: set `UPSTOX_READONLY=0` (env or the `.mcp.json` block) and
relaunch the client. Otherwise keep it at `1` (read-only).
