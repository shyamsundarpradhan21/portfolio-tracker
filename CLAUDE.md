## feedback

Read tasks/feedback.md before starting any task — it holds standing
rules distilled from the user's session feedback (data-driven UI text, git
workflow, communication style). When the user gives feedback meant to apply
beyond the current task — or corrects a mistake worth not repeating — encode it
there instead of relying on chat memory (see Workflow Orchestration →
Self-Improvement Loop). tasks/feedback.md is the single home for this; there is no
separate lessons file.

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Agent Teams

- Assemble a team of agents for any task that benefits from breadth or parallel work — keep the main context window clean by delegating research, exploration, and analysis to the team
- For complex problems, throw more compute at it: divide the work across teammates, one focused task per agent
- Pick the right teammate for each role: `Explore` for read-only search (reads excerpts, locates code — does not audit), `Plan` for implementation design, `claude-code-guide` for Claude Code / SDK / API questions; `claude`/`general-purpose` otherwise
- Launch the whole team in ONE message so they run concurrently; each teammate's final message returns to you, not the user, so relay what matters
- For codebase/architecture questions, try `graphify query`/`path`/`explain` (see below) before sending a teammate to search — the scoped subgraph is usually enough
- This is opt-in fan-out, not the heavyweight Workflow tool — reserve multi-agent Workflow orchestration for when the user explicitly asks

### 3. Self-Improvement Loop

- After ANY correction from the user: add the pattern to tasks/feedback.md
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these rules until mistake rate drops
- Review tasks/feedback.md at session start for the relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

- **Plan First:** write the plan to tasks/todo.md with checkable items
- **Verify Plan:** check in before starting implementation
- **Track Progress:** mark items complete as you go
- **Explain Changes:** high-level summary at each step
- **Document Results:** add a review section to tasks/todo.md
- **Capture Lessons:** record corrections in tasks/feedback.md

## Core Principles

- **Simplicity First:** make every change as simple as possible, impacting minimal code
- **No Laziness:** find root causes. No temporary fixes. Senior-developer standards
- **Minimal Impact:** changes should only touch what's necessary. Avoid introducing bugs

## Project Rules

Scoped conventions for this codebase (merged from the former `.claude/rules/`).

### Frontend (`app/`)
- Component boundaries: `tabs/` compose a view, `shared/` is reused, `lib/` is pure logic (no JSX).
- Hydration: private data is empty until the render gate runs — never read `portfolio.js` / `appData.js` exports at module-eval, only inside render or a post-gate call. Module-eval reads of that data are bugs.
- Numbers: format through `app/lib/fmt.js`; headline figures use the `Live*` count-up wrappers (`app/components/shared/Live.js`). Never hardcode a subtext — derive it from data.
- Direction (gain/loss): encode by COLOR, never +/- glyphs.
- Type: size via `--fs-*` tokens in `globals.css`, never raw px.
- Theming: every change must hold in both day and night themes.

### Data layer (Vercel KV + committed JSON — no SQL DB)
- Source of truth for private data: KV `portfolio:v1`, seeded from gitignored `data/portfolio.private.json` via `scripts/seed-portfolio-kv.mjs`. To change holdings/salary/loans: edit the JSON, run the seed. Never hand-edit KV. `data/portfolio.private.example.json` is the empty template.
- Committed JSONs (`broker-state`, `fno-ledger`, `trades-log`, …) are written by the sync pipeline — don't hand-edit; re-run the script. The seed has a sanity guard that refuses near-empty data; don't bypass it. `data/SNAPSHOT.md` is generated.

### API routes (`app/api/*/route.js`)
- Private-data routes use `loadPortfolio()` and must set `export const dynamic = 'force-dynamic'` (build-time data is null) so private figures never ship in the client bundle.
- External APIs: always `AbortSignal.timeout(...)`, validate the shape, fall back to last-known so the UI never breaks; optional-chain everything off the response.
- Caching: private routes → `no-store`; once-daily data (NAV) → `s-maxage` + `stale-while-revalidate`.
- Brokers are READ-ONLY: never `place_order` / `modify_order` / `cancel_order`.

## graphify

This project has a graphify knowledge graph at .graphify/.

Rules:
- For codebase or architecture questions, when `.graphify/graph.json` exists, first run `graphify query "<question>"` (or `graphify path "<A>" "<B>"` / `graphify explain "<concept>"`); these return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output
- If .graphify/wiki/index.md exists, navigate it instead of reading raw files
- If .graphify/graph.json is missing but graphify-out/graph.json exists, run `graphify migrate-state --dry-run` first; if tracked legacy artifacts are reported, ask before using the recommended `git mv -f graphify-out .graphify` and commit message
- If .graphify/needs_update exists or .graphify/branch.json has stale=true, warn before relying on semantic results and run /graphify . --update when appropriate
- Before proposing or committing .graphify artifacts, run `graphify portable-check .graphify`; commit-safe graph artifacts must use repo-relative paths, and never commit .graphify/branch.json, .graphify/worktree.json, .graphify/needs_update, or .graphify/cache/. If a repo already tracks any of them, first add them to .gitignore, then propose `git rm --cached .graphify/branch.json .graphify/worktree.json .graphify/needs_update` and `git rm -r --cached .graphify/cache`; never mutate git state without asking
- Before deep graph traversal, prefer `graphify summary --graph .graphify/graph.json` for compact first-hop orientation
- For review impact on changed files, use `graphify review-delta --graph .graphify/graph.json` instead of generic traversal
- Read `.graphify/GRAPH_REPORT.md` only for broad architecture review or when `query` / `path` / `explain` do not surface enough context
- After modifying code files in this session, run `npx graphify hook-rebuild` to keep the graph current
