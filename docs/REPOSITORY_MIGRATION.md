# Repository Migration Plan

## Phase 1 — Skeleton (complete)

Created the repository, Dashboard entry point, module boundaries, shared
boundaries, version source, documentation, and GitHub Pages deployment.

## Phase 2 — WorkLog migration (current)

Moved the `0.9.0-alpha.8.4 / 20260731-0833` WorkLog source into
`modules/worklog/`, moved cross-module runtime dependencies into `shared/`,
and moved public/legal pages to the new repository root.

The legacy `worklog-workspace` repository is not modified. Production OAuth,
Supabase schema, and WorkLog business logic remain unchanged.
