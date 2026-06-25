# Task — Tier-driven type scale + footer/alignment

Diagnose the app-wide text-size ambiguity; make figure size a function of the
card's ROLE (not the component / card size / string length); fix footers.

## Plan
- [x] Diagnose: figures sized ad hoc (5+ sizes for one role); `.vlg`/`.vmd` size
      collision; inline `fontSize` overrides; no real Tier-2 home.
- [x] Record the standing rule in `tasks/feedback.md` (tiers + footer/alignment).
- [x] Build a render mock of the 4 tiers (night + day); get approval.
- [x] Implement the ladder in `globals.css` as the single source of truth.
- [x] Remove inline figure-size overrides → tier classes.
- [x] Footer utilities (single-line clip + two-value split).
- [x] Verify (static, since no node_modules/data in this cloud session).

## Changes
- `globals.css`: tier block — `.vt1`/`.vmd`=`--fs-2xl` (T1), `.vt2`=`--fs-xl` (T2),
  `.vt3`/`.vsm`=`--fs-lg` (T3, →`--fs-md` in `.mini`). Old `.vlg` folded into T1.
  Added `.csm .sub` single-line clip + `.sub.split` two-value footer.
- De-inlined headline figures → `.vt2`: `FnoHistory`, `MarketOverview`, `AlgoTab` (×2).
- `vlg`→`vmd`: `GrowthDashboard`, `FnoPositions` (prominent totals, size preserved).

## Review
- Size-preserving by design: no figure changed tier blindly. The win is structural —
  one source of truth, no inline magic, the `.vlg`/`.vmd` collision gone, Tier 2 has a
  real class, footers fixed. Prevents the screenshot's divergence from recurring.
- Verified statically: CSS braces balanced; no `vlg`/inline `--fs-xl|2xl` figure left;
  `.vt2` defined + used ×4; rendered a harness from the real rules — ladder + footer
  behaviour confirmed (Tier 1>2>3; equal height across value lengths; clip + split).
- Kept inline `--fs-md` on `FnoPositions` leg P&L + `BenchmarkBars` bar % — dense
  ROW/bar values (table-like Tier 3), not card headlines.
- Remaining (needs a live render to verify): re-tiering deeper secondary stats
  (e.g. US dividend breakdown grid) from Tier 1 → Tier 2. Not done blind.
