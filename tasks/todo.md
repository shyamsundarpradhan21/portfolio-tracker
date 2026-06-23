# Task: Live F&O Positions panel (all brokers, open + closed) → feeds YTD

## Goal
A Trading-tab panel showing every broker's F&O positions — open (live unrealised
MTM) and closed-today (realised) — whose P&L updates the YTD F&O figures
simultaneously (same live derivation drives panel + YTD strip).

## Live data check (read-only, 2026-06-23)
- Dhan: 2 OPEN legs (bear call spread, expires today) — short 24150 CE +₹10,764,
  long 24550 CE −₹806 (sync-time; live MCP now +11,609 / −741). Net open MTM ₹9,958.
- Fyers: flat (0 positions). Upstox: flat (0 positions). Nothing closed today.
- Sync currently writes ONLY `positions.DHAN_FNO`; Fyers/Upstox positions not pulled.

## Plan
- [ ] 1. Mock the panel (served HTML) — 2 layout variants — get pick. [mock-first rule]
- [ ] 2. Sync: extend pullFyers + pullUpstox to pull F&O positions; normalize to the
        Dhan row shape; write `positions.FYERS_FNO` / `positions.UPSTOX_FNO`. Keep
        closed rows (status CLOSED, netQty 0, realized != 0).
- [ ] 3. lib: live-P&L derivation in brokerState.js — aggregate `positions.*`, split
        open (unrealised) vs closed (realised), per broker + totals.
- [ ] 4. Component: `FnoPositions` shared card — grouped by broker, open + closed
        sections, net open MTM headline, funds strip, flat-broker footer. House
        tokens only; colour-for-direction; ₹ via .rs; day+night.
- [ ] 5. YTD integration: fold live realised(today) + open MTM into the Trading-tab
        YTD figures so panel + YTD move together. DECISION on labelling (below).
- [ ] 6. Verify in the running app (Dhan renders live; YTD reflects it).

## Open decision (financial labelling)
The YTD F&O figure is currently "net realised". Folding OPEN unrealised MTM in
changes its meaning. Options:
  (a) YTD shows realised only; open MTM shown as a separate live "+ open MTM" line
      that updates alongside (cleanest, honest labels). [recommend]
  (b) YTD becomes a combined "live" figure = realised + open MTM, relabelled
      "YTD incl. open MTM" (one number, mixes realised + mark).
Expiring-today options settle to realised at EOD, so (a)'s open-MTM line becomes
realised tonight either way.

## Review
DONE + verified live (2026-06-23, Trading tab, chrome-devtools).
- Sync: pullFyers/pullUpstox now pull F&O positions; write FYERS_FNO/UPSTOX_FNO
  (generalized from Dhan-only); normalized `avg` = entry price (short→sell avg,
  confirmed: 24150 CE shows 48.85, 24100 CE 43.40, not 0). Re-sync OK: Upstox 0 /
  Fyers 0 / Dhan 4 open.
- fnoLive() in brokerState.js: open/closed split, per-broker + per-strategy totals.
- FnoPositions panel (Variant A): 4 Dhan legs render, colour-for-direction
  (₹13,000 grn, the 3 losses red), side chips (short red / long blue), funds strip,
  flat-broker footer. Net open MTM ₹11,996.
- YTD (treatment a): YtdFno shows Open MTM live ₹11,996 + Net + open MTM ₹1,85,424
  (= net realised 1,73,428 + 11,996, exact). S02 hides the line (flat). Same
  fnoLive() drives panel + YTD.
- Theme: tokens only, holds day + night by construction.

## Not yet done
- Commit (feature files + refreshed broker-state; the verify-sync also appended 2
  Dhan trades to trades-log + possibly an fno-ledger row).
- Decide: keep or drop public/fno-positions-mock.html (dev mock).
