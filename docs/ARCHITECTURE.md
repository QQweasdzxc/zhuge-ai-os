# Zhuge AI OS Skeleton Architecture

## Phase 1 decision

`zhuge-ai-os` is the future root repository. The existing `worklog-workspace` repository remains the production reference and is not modified by this skeleton migration.

## Runtime shape

```text
Root URL
  ↓
Dashboard (`app/dashboard/`)
  ↓
Module Launcher
  ├─ WorkLog (`modules/worklog/`)
  └─ Investment (`modules/investment/`)
```

## Boundaries

```text
app/       Root shell, dashboard, and router boundary
shared/    Cross-module services and UI primitives
modules/   Independent product modules
assets/    Shared static assets and theme
config/    Environment and product configuration
docs/      Architecture and migration decisions
public/    Public/static supporting assets
tests/     Future test suites
```

Modules may depend on `shared/*` only. A module must not import or reach into another module. Authentication and provider integration are planned under `shared/auth`, `shared/google`, and `shared/supabase`; no production OAuth client or callback is copied in Phase 1.

## Migration rule

Phase 1 establishes boundaries only. WorkLog business logic, Supabase schema, production OAuth, and the existing `worklog-workspace` deployment remain untouched.
