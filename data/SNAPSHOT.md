# Historical Net-Worth Snapshots

Authoritative month-end (or any-date) figures, merged into the growth chart
and the live XIRR. Rows here OVERRIDE the synthetic backfill for the past;
the browser's daily snapshots take over from their first recorded day.

Rules:
- One row per date, ISO format, plain integers in rupees (commas allowed).
- `invested` = cumulative capital deployed as of that date (net of
  withdrawals). If unknown leave the cell empty — it fills forward from the
  previous row, but XIRR accuracy improves when it's real.
- `assets` = gross assets (before loan). Optional; empty is fine.
- Keep rows sorted by date. Commit the file — it's the source of truth.

| date       | nw        | assets    | invested  |
|------------|-----------|-----------|-----------|
| 2026-06-12 | 1867826 | 2595101 | 1688027 |
