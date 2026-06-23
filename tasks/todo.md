# FII derivatives positioning → Market Wrap (CSV path)

Goal: surface FII (and retail) **derivative positioning** under the existing
"FII / DII · net flow" card, sourced from NSE's participant-wise OI CSV
(`fao_participant_oi_<DDMMYYYY>.csv`) — no new dependency. Reveals the stance the
cash row hides (cash flat, but net-short futures + long puts = bearish) plus the
FII-vs-retail divergence.

Decision (user): enrich the EXISTING card with a positioning strip; do NOT touch
the existing cash chart; no separate card; no grid restructure.

## Tasks
- [x] 1. `app/api/premarket/route.js`: `toDDMMYYYY()` + `fetchParticipantStats(cookie, date)`
      — parses the OI CSV by column index; FII & retail nets; `stance` + `divergence`. Defensive.
- [x] 2. GET: keyed to `fiidii.latest.date` (IST-today fallback); attached as `fiiDerivs`.
- [x] 3. `MacroTab.js`: `FiiDerivStrip` in `.fdcard` after `<FiiDiiChart>`; `showFii` extended.
      Direction by colour + long/short word, no glyph.
- [x] 4. `globals.css`: `.fdderiv*` styles via tokens.
- [x] 5. Verified: feed matches the probe (FII idxFut −228,561, retail +163,438, bearish,
      divergence); strip renders in night + day; console 0 errors.

## Review
- Bug caught in verify: `/^Client/` grabbed the "Client Type" HEADER row (parsed to 0s) —
  anchored both picks (`/^FII$/`, `/^Client$/`). FII never collided (no "FII" header cell).
- Followed the house rule: net positions shown as magnitude + colour + long/short word
  (red short / green long), NOT a signed figure — deviated from the mock's "−2.29L".
- Graceful deg: NSE archives may be blocked from Vercel data-centre IPs (like the cash feed);
  on `{stale}` the strip simply doesn't render — the cash card is unaffected.
- Deferred (not in chosen mock): the idxFut over-sessions sparkline trail. Data accrues
  forward if wired later; flagged to user as the next step.
