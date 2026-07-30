# Zhuge AI OS Architecture

## Foundation v1.0 decision

`zhuge-ai-os` is the only active development repository. The existing
`worklog-workspace` repository is now a read-only historical archive whose
root redirects to the new AI OS entry point.

## Runtime shape

```text
Root URL
  ↓
AI OS 首頁 (`app/dashboard/`)
  ↓
Root Router (`app/router/`)
  ↓
Identity Hub / 工作模組入口
  ├─ WorkLog (`modules/worklog/`)
  ├─ Investment (`modules/investment/`)
  ├─ Travel (`modules/travel/`)
  └─ HR (`modules/hr/`)
```

## Boundaries

```text
app/       Root shell, Dashboard, and router boundary
shared/    Single implementations of auth, provider, API, state, theme, i18n, and utilities
modules/   Independent product modules
assets/    Skeleton-only static assets
config/    Environment and product configuration boundary
docs/      Architecture and migration decisions
public/    Public/static supporting assets
tests/     Regression and migration tests

## Shared Core

```text
shared/
├── app-config.js
├── app-state.js
├── app-router.js
├── auth/auth-service.js
├── google/google-drive-service.js
├── api/{data-service,knowledge-api,repositories,realtime-service,services}.js
├── components/{index,workspaces}.js
├── theme/{zhuge-os,ai-product,legal,public-home}.css
├── i18n/zh-TW.js
└── utils/{shared-utils,render-engine,priority-engine}.js
```

WorkLog loads these files from `shared/*`. It does not carry a second Auth,
Google, Router, Theme, or global configuration implementation.

## WorkLog Module

```text
modules/worklog/
├── index.html
├── worklog-app.js
├── worklog.css
├── knowledge-*.js
├── ai-*.js
├── work-*.js
├── chat/
└── resources/
```

Only WorkLog-specific UI and business logic remains inside this directory.
```

Modules may depend on `shared/*` only. A module must not import or reach into
another module. The existing Production OAuth client, Supabase schema, and
credentials are preserved; this Phase 2 change relocates code and does not
change their behavior.

## Migration rule

The migration is a file/layout change, not a business-logic rewrite. The
legacy repository is redirect-only, and the new repository's WorkLog baseline
is `0.9.0-alpha.8.4` / `20260730-1135`.
