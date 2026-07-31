# Zhuge AI OS Architecture

The detailed Foundation contracts are documented in `docs/FOUNDATION.md` and
the companion module, naming, UI, coding, and release specifications.

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
AI OS Portal / Identity Hub / 工作模組入口
  ├─ WorkLog (`modules/worklog/`)
  ├─ Investment (`modules/investment/`)
  ├─ Travel (`modules/travel/`)
  └─ HR (`modules/hr/`)
```

## Boundaries

```text
app/       Root shell, layout, Dashboard, and router boundary
shared/    Single implementations of platform contracts
modules/   Independent product modules
assets/    Public static assets
config/    Repository-level configuration boundary
docs/      Architecture and migration decisions
public/    Public/static supporting assets
tests/     Regression and migration tests
```

## Shared Foundation

```text
shared/
├── core/{identity,session,workspace,permission,navigation}-manager.js
├── services/       Cross-module service boundary
├── ai/index.js     Mr. KM capability boundary
├── config/         Environment, OAuth, Supabase, version, feature flags
├── assets/logo/    Shared Zhuge AI OS brand mark
├── app-config.js   Validated WorkLog compatibility config
├── app-state.js
├── app-router.js
├── auth/auth-service.js
├── google/google-drive-service.js
├── api/{data-service,knowledge-api,repositories,realtime-service,services}.js
├── components/{index,workspaces}.js
├── theme/          Runtime styles and Foundation tokens
├── i18n/zh-TW.js
└── utils/{shared-utils,render-engine,priority-engine}.js
```

WorkLog loads the validated implementations from `shared/*`. It does not carry
a second Auth, Google, Router, Theme, AI, or global configuration
implementation. The new contracts are introduced incrementally and are not a
second runtime.

## Module shape

```text
modules/<module>/
├── pages/
├── components/
├── services/
├── models/
├── config/
├── assets/
└── index.html
```

The WorkLog compatibility entry remains in `modules/worklog/index.html` while
its staged internal boundaries are prepared. Modules may depend on `shared/*`
only and must not import or reach into another module.

## Migration rule

The migration is a file/layout change, not a business-logic rewrite. The
legacy repository is redirect-only, and the Foundation release identity is
`0.9.0-alpha.8.4` / `20260731-0833`.
