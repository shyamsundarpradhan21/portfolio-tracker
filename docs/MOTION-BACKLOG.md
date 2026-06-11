# Motion & Flare Backlog — wealth-os redesign

Animation/delight ideas from the `/emil-design-eng` review (Emil Kowalski design-engineering
philosophy) plus follow-up brainstorms. Target branch: `redesign/shadcn-vaul`.

Guiding rule (Emil's frequency framework): how often is it seen?
- 100+/day → no animation
- tens/day → ≤150ms, minimal
- occasional (modals, drawers, toasts) → standard treatment
- rare (first load, milestones) → can be theatrical

**Decision: the `✦` twinkle stays.** One bit of personality, deliberately kept.

---

## A. Fixes to existing motion (Before/After)

| Before | After | Why |
|---|---|---|
| One `--ease` spring used for enter AND exit | Keep spring for enter; add `--ease-out: cubic-bezier(0.23,1,0.32,1)` for exits | Exits should be snappier than entrances |
| `.sb-item` no `:active` state | `transform: scale(0.97)` on `:active`, 100ms | Pressables must confirm the press |
| `.sb-icon-btn` hover = background only | `scale(1.08)` hover, `scale(0.93)` active | Dense 28px buttons need amplified affordance |
| `.card:hover` `translateY(-2px)` | `scale(1.005)` + deeper shadow | GPU-only; feels like breathing, not jumping |
| NW hero 11s gradient shimmer | Solid `var(--acc)` + one-time entrance fade-up | Gradient text is a banned pattern; entrance earns its place |
| Instant appearance of sidebar/cards on load | Stagger entrance, 30–50ms/item, 8px translateY + fade, 260–280ms ease-out | Once per session — earns full treatment |
| Drawer enter/exit same 320ms | Enter 320ms `cubic-bezier(0.32,0.72,0,1)` (Ionic drawer curve) + scale 0.98→1; exit 220ms | Asymmetric timing: deliberate open, responsive close |
| Price flash = 0.9s opacity pulse | `clip-path: inset(0 100% 0 0) → inset(0 0 0 0)` reveal, 180ms | The number looks stamped in; carries information |
| Day/night switch 1.2s | 400ms `cubic-bezier(0.23,1,0.32,1)` | 1.2s makes the user watch the theme crawl |
| Hover transforms unguarded | Wrap in `@media (hover: hover) and (pointer: fine)` | Touch devices fire hover on tap |
| Skeleton `ease-in-out` alternate | `linear` with sharp mid-keyframe (scan-line feel) | Faster-feeling shimmer = faster-feeling load |

## B. New animation ideas — round 1

### Numbers (numbers are the interface)
1. **Count-up on NW hero** — first load rolls from ~97% → real value, ~600ms ease-out. Tabular figures = zero layout shift.
2. **Odometer digits on refresh** — changed digits slide vertically (old up, new in from below, 200ms). Shows *which* digits moved — information, not decoration.
3. **Flash decay trail** — after a price flash, color lingers at 30% and decays over ~4s. Glanceable "what just moved" trail.

### Charts
4. **Donut sweep / bar grow-in on tab entry** — donut sweeps clockwise 380ms ease-out; bars grow from 0 with 30ms stagger. Tab change only, never on data ticks.
5. **Spring-lag crosshair** on NW history chart — hover dot follows cursor via `useSpring` (stiffness 300, damping 25). Desktop-only.

### Structure
6. **Tab content crossfade** — 140ms fade + 4px translateY on incoming content. Must stay ≤150ms (tens of uses/day).
7. **Sidebar badge pulse** — sleeve value badge does one 1→1.06→1 pulse when it repriced. Tells you what moved without opening the tab.
8. **Drawer stats stagger** — six stat cells fade up 35ms apart after the sheet settles.

### Moments (rare = theatrical allowed)
9. **All-time-high celebration** — NW exceeds every snapshot: twinkle gets two friends for 3s + one soft hero glow pulse.
10. **Toast checkmark draw** — snapshot-saved checkmark draws via `stroke-dashoffset`, 240ms.

**Top picks (effort-to-payoff):** #1 count-up, #4 chart draw-in, #6 tab crossfade, #9 ATH moment.

## C. New animation ideas — round 2

### Live-ness
11. **Market-open ripple** — when NSE/NYSE flips to OPEN, its sidebar live-dot emits one expanding ring (like the pulse halo, single-shot). State change announced once, not nagging.
12. **Refresh sweep** — during a price fetch, a 1px accent line sweeps across the top of the main content area (left→right, linear). Replaces spinner-anxiety with a calm progress cue; instantly killed on completion.
13. **Stale-data desaturation** — if prices are >15min old, live values ease to 85% saturation over 2s; refresh restores instantly. The page itself communicates freshness.

### Micro-interactions
14. **Sort-direction flip** — table sort arrow rotates 180° (160ms ease-out) and the sorted column briefly tints. The re-sort itself can FLIP-animate rows ≤12 rows (240ms, capped — never on the full holdings table).
15. **Hold-to-confirm snapshot delete** — if/when manual snapshot management lands: hold 1.5s with a clip-path fill (Emil's hold-to-delete pattern), release snaps back 200ms.
16. **Theme toggle moment** — sun/moon icon does a half-rotation + crossfade through `blur(2px)` on cycle (240ms). Used a few times/day at most.
17. **Drawer drag friction** — vaul already gives momentum dismissal; add overdrag damping at the top snap point so pulling past 75% resists progressively.

### Charts II
18. **Projection slider haptic ticks** — as the projection slider crosses each year boundary, the year label does a tiny 1→1.08 pop. Makes scrubbing feel notched.
19. **Benchmark race draw** — portfolio vs Nifty counterfactual lines draw in together via `stroke-dashoffset` (600ms, once per tab entry). The "race" framing is the product's whole point.
20. **Savings-rate bar cascade** — monthly bars rise bottom-up with 20ms stagger on first scroll into view (`IntersectionObserver`, once).

### Moments II
21. **FD maturity day** — on the day an FD matures, its row gets a one-time golden shimmer sweep + "CASH IN" badge scales in with spring bounce 0.2.
22. **Milestone crossings** — NW crossing a round crore/10L boundary (vs last session) triggers the ATH-style moment with the milestone figure briefly shown under the hero.
23. **First-visit-of-day greeting** — hero sub-line fades in "↑ ₹X since yesterday" 400ms after the count-up settles, once per calendar day.

---

## Implementation notes
- All motion: transform/opacity/clip-path only (GPU). No width/height/layout animation.
- Every addition needs a `prefers-reduced-motion: reduce` fallback (crossfade or none).
- CSS transitions over keyframes wherever interruption is possible.
- Stagger delays 30–80ms; total stagger budget <400ms; never block interaction.
- Count-up/odometer: respect `font-variant-numeric: tabular-nums` (already mono).
