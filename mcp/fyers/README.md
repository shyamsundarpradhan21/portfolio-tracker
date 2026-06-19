# Fyers MCP server

A standalone [MCP](https://modelcontextprotocol.io/) server for a Fyers account —
read tools always, order tools gated behind an explicit arm flag. You run and own
this process; it is **not** auto-wired into any agent's config. Built on
[`fyers-apiv3`](https://pypi.org/project/fyers-apiv3/).

## Safety model

- **Read-only by default.** `place_order` / `modify_order` / `cancel_order` only
  work when `FYERS_READONLY=0`. Until you set that, the server cannot trade.
- **Keep client-capital accounts read-only** (`FYERS_READONLY=1`).
- Credentials live in the environment / `.env` (gitignored), never in code.
- The access token is valid ~one trading day — re-auth each session.

## Setup

1. **Create a Fyers API app** at <https://myapi.fyers.in/dashboard> → note the
   App ID and Secret, and set a Redirect URI (e.g. `https://127.0.0.1/fyers`).
2. **Install deps** (a venv is recommended):
   ```bash
   cd mcp/fyers
   python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. **Configure env** — copy `.env.example` to `.env` and fill in, or export the
   vars in your shell before launching the MCP client.

## Connect it to your MCP client

You add this yourself (the agent is intentionally not allowed to self-wire
trade tools). Use an absolute path to `server.py`.

**Claude Code** — add to `.mcp.json` in the repo root:
```json
{
  "mcpServers": {
    "fyers": {
      "command": "python",
      "args": ["ABSOLUTE/PATH/TO/mcp/fyers/server.py"],
      "env": {
        "FYERS_APP_ID": "${FYERS_APP_ID}",
        "FYERS_SECRET_ID": "${FYERS_SECRET_ID}",
        "FYERS_REDIRECT_URI": "${FYERS_REDIRECT_URI}",
        "FYERS_READONLY": "1"
      }
    }
  }
}
```
(For Claude Desktop the same block goes in `claude_desktop_config.json`. Point
`command` at your venv's python if you used one.)

## Daily auth flow

1. Call **`fyers_auth_url`** → open the returned URL, log in (TOTP).
2. Copy the `auth_code` from the redirect (or the whole redirect URL).
3. Call **`fyers_set_token`** with it → today's token is cached in memory.
4. `fyers_status` shows auth + whether trading is armed.

Set `FYERS_ACCESS_TOKEN` instead if you already minted today's token elsewhere.

## Tools

| Tool | Access |
|---|---|
| `fyers_status`, `fyers_auth_url`, `fyers_set_token` | auth |
| `get_profile`, `get_funds`, `get_holdings`, `get_positions`, `get_orderbook`, `get_tradebook`, `get_quotes` | read |
| `place_order`, `modify_order`, `cancel_order` | **trade — only when `FYERS_READONLY=0`** |

`place_order(symbol, qty, side, order_type=2, product_type="INTRADAY", …)` —
`side` 1=Buy/-1=Sell · `order_type` 1=Limit/2=Market/3=SL/4=SL-M ·
`product_type` INTRADAY|CNC|MARGIN|CO|BO · symbol e.g. `NSE:SBIN-EQ`.

## Arming trading

Only when you mean it: set `FYERS_READONLY=0` (env or the `.mcp.json` block),
relaunch the client. For an account with client capital, leave it at `1` and
keep order placement off.
