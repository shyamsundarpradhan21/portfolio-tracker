# Claude Routines — versioned reference

The three Claude Routines run **outside the repo** (in the Claude Routines panel), so their
schedules + prompts were never version-controlled — a wiped panel would lose them with no
trace (the loophole flagged in the resilience audit). This file captures them so the panel
can be rebuilt. Cross-referenced from `SCHEDULE.md` §4d/§5/§6.

- `CloudFnoCapture` runs a shell **command** → fully reproduced below.
- The other two are Claude **natural-language prompts** → paste the full prompt from the
  Routines panel into the placeholder (they can't be reconstructed from the repo).

---

## CloudFnoCapture — Dhan S01 + Fyers S02 F&O realised, laptop-off (Remote, daily ~18:45 IST)
Captures Dhan (S01) + Fyers (S02) realised F&O laptop-off. Full context: `SCHEDULE.md` §4d.

**Command:**
```
SYNC_ONLY=dhan,fyers SYNC_NO_BROWSER=1 node scripts/sync-brokers.mjs
```

**Env (Remote workspace):** `DHAN_CLIENT_ID`, `DHAN_PIN`, `DHAN_TOTP_SEED`, `FYERS_APP_ID`,
`FYERS_SECRET_ID`, `FYERS_PIN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` (reads the Fyers
refresh-token the laptop pushed to KV). Read-only — GETs only, never places an order.

---

## Weekly Dhan US sleeve review (Remote, Sat 09:00 IST)
A weekly review of the Dhan US (GIFT City) sleeve. Portfolio context: `tasks/dhan-portfolio.md`.

**Full prompt (paste from the Routines panel):**
> ⟨⟨ PASTE the exact prompt here — until then this routine lives only in the Routines UI ⟩⟩

---

## Monthly stratzy algo briefing (Local, ~day 26, 09:00 IST)
A monthly briefing on the trading/algo sleeve.

**Full prompt (paste from the Routines panel):**
> ⟨⟨ PASTE the exact prompt here — until then this routine lives only in the Routines UI ⟩⟩
