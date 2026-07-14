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
| 2026-06-19 | 1880931 | 2608206 | 1685053 |
| 2026-07-10 | 3006170 | 3725401 | 2811925 |
| 2026-07-11 | 2989406 | 3708637 | 2794303 |
| 2026-07-13 | 2967001 | 3686232 | 2774203 |
| 2026-07-14 | 2914391 | 3633622 | 2726163 |
