---
name: council
description: Convene a council of independent expert reviewers to critique the work from multiple angles, then synthesize a verdict. Use when the user types /council, or asks for a multi-perspective review / "what's wrong with this" / a panel critique of code, a design, a diff, or rendered output.
---

# Council

Review the target from several **independent expert perspectives**, then merge
them into one prioritized verdict. The goal is breadth (catch issues a single
reviewer would miss) followed by a decisive synthesis (not a pile of opinions).

## 1. Establish the target

Figure out what is under review, in this order:
1. Explicit argument after `/council` (e.g. `/council the projection tab`).
2. If none, the **current uncommitted diff** (`git diff` + `git diff --staged`).
3. If the working tree is clean, the most recent commit (`git show`).

State in one line what you are reviewing before going further.

## 2. Convene the council

Pick the 4–6 personas most relevant to the target. Default roster for this
codebase (a Next.js financial dashboard):

- **Correctness** — logic bugs, wrong numbers, edge cases, state/race issues.
- **UX & Visual** — layout, theming (day/night), typography, responsiveness,
  accessibility, information density.
- **Performance** — re-renders, bundle size, expensive effects, animation cost.
- **Data integrity** — formatting (₹/$, %, rounding), units, source-of-truth,
  stale-cache handling.
- **Maintainability** — duplication, dead code, naming, component boundaries.
- **Security/Privacy** — leaked secrets, unsafe `dangerouslySetInnerHTML`,
  external data handling.

Swap or add personas to fit the target (e.g. an "API contract" reviewer for a
route, a "tax logic" reviewer for the FY computations).

## 3. Each persona reviews independently

For every persona, produce a short section with **concrete, file-anchored
findings** — `path:line` references, what's wrong, and why it matters. No vague
praise. If a persona finds nothing real, it says so in one line rather than
inventing filler. Rank each finding **High / Medium / Low**.

Actually read the relevant files (and, when useful, render or run the app) —
do not critique from memory.

## 4. Synthesize

Close with a single **Verdict** section:
- A merged, deduplicated, severity-sorted list of the top issues.
- The 1–3 things to fix first.
- Anything the council disagreed on, with your recommendation.

Keep the whole thing skimmable. Do not edit files unless the user asks — this
skill produces a review, not a change. If the user wants fixes, offer to apply
the top findings.
