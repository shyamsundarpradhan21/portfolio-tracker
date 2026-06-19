# Dhan MCP server

A standalone [MCP](https://modelcontextprotocol.io/) server for a Dhan account on
the official [`dhanhq`](https://pypi.org/project/dhanhq/) SDK — read tools always,
order tools gated behind an explicit arm flag. You run and own this process; it is
**not** auto-wired into any agent's config.

## Safety model

- **Read-only by default.** `place_order` / `cancel_order` only work when
  `DHAN_READONLY=0`. Keep client-capital accounts read-only.
- Credentials live in the environment / `.env` (gitignored), never in code.
- Dhan's access token is portal-generated (longer-lived than the OAuth brokers),
  so there's **no interactive login** — just set the env vars.

## Setup

1. **Generate credentials** at <https://developer.dhanhq.co> → note your
   **Client ID** and **Access Token**.
2. **Install deps** (venv recommended):
   ```bash
   cd mcp/dhan
   python -m venv .venv && .venv\Scripts\activate   # mac/linux: . .venv/bin/activate
   pip install -r requirements.txt
   ```
3. **Configure env** — copy `.env.example` to `.env` and fill in, or export the
   vars in your shell before launching the MCP client.

## Connect it to your MCP client

You add this yourself (the agent is intentionally not allowed to self-wire trade
tools). Use absolute paths; point `command` at the venv's python.

```json
{
  "mcpServers": {
    "dhan": {
      "command": "ABSOLUTE/PATH/TO/mcp/dhan/.venv/Scripts/python.exe",
      "args": ["ABSOLUTE/PATH/TO/mcp/dhan/server.py"],
      "env": {
        "DHAN_CLIENT_ID": "${DHAN_CLIENT_ID}",
        "DHAN_ACCESS_TOKEN": "${DHAN_ACCESS_TOKEN}",
        "DHAN_READONLY": "1"
      }
    }
  }
}
```

## Tools

| Tool | Access |
|---|---|
| `dhan_status` | status |
| `get_holdings`, `get_positions`, `get_funds`, `get_orders` | read |
| `place_order`, `cancel_order` | **trade — only when `DHAN_READONLY=0`** |

`place_order(security_id, exchange_segment, transaction_type, quantity, order_type="MARKET", product_type="INTRA", price=0, trigger_price=0)` —
`exchange_segment` NSE/NSE_FNO/BSE · `transaction_type` BUY/SELL ·
`order_type` MARKET/LIMIT/SL/SL_M · `product_type` INTRA/CNC/MARGIN ·
`security_id` is Dhan's numeric instrument id.

## Arming trading

Only when you mean it: set `DHAN_READONLY=0`, relaunch the client. For an account
with client capital, leave it at `1`.
