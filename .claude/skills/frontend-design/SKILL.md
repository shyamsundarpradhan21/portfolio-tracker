---
name: frontend-design
description: Project design language for the portfolio-tracker dashboard — use when building or restyling UI (cards, tabs, charts, theming). Replaces generic design-skill bundles.
---

# Frontend design — portfolio-tracker

The house style for this Next.js financial dashboard. Use this instead of generic design skills.

## Tokens (single source: `app/globals.css`)
- Font sizes: `--fs-*` only, never raw px.
- Colors: theme vars (`--txt2`, `--bg`, alloc/cat palettes). Must work in BOTH day and night.
- Direction (gain/loss): COLOR, never +/- glyphs.

## Layout
- The card is the unit. Headers use `.hdr-card`; respect existing gutters / clamp padding (don't crop).
- `tabs/` compose, `shared/` reuse (AllocCard, AnalysisCard, BrokerTable, charts…). Reuse before building new.

## Numbers
- All figures through `app/lib/fmt.js`. Headline values use the `Live*` count-up wrappers (`app/components/shared/Live.js`).
- Subtexts are DERIVED from data — never hardcoded.

## Charts
- ECharts; keep palettes consistent with `ALLOC_COLORS` / `CAT_COLORS`.

## Before shipping UI
- Check both themes, check figure formatting, check nothing private leaked into a client import.
- For a structured multi-lens critique, use `/council`.
