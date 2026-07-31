# Phase 2 — WorkLog Formal Migration

## Release baseline

```text
Version: 0.9.0-alpha.8.4
Build:   20260731-0833
```

## Dashboard tree

```text
/
└── app/dashboard/index.html
    └── app/router/index.js
```

The root URL opens the Dashboard first. It never opens WorkLog directly.

## Module tree

```text
modules/
├── worklog/
│   ├── index.html
│   ├── worklog-app.js
│   ├── worklog.css
│   ├── ai-*.js
│   ├── knowledge-*.js
│   ├── work-*.js
│   ├── chat/
│   └── resources/
└── investment/
    └── index.html
```

WorkLog contains WorkLog-specific UI and business logic only. Investment is a
placeholder and contains no WorkLog dependency.

## Shared tree

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
└── utils/{shared-utils,render-engine,priority-engine}.js
```

WorkLog loads these files by URL from `shared/*`; no duplicate Auth, Google,
Router, Theme, or global configuration remains in the module.

## Public pages

The new application owns the public pages at the repository root:

```text
/product/
/privacy/
/terms/
/support/
/contact/
/google-data/
```

The previous UAT manifest and checksum record are retained under
`docs/legacy/worklog-production-artifact/` for traceability; they are not
loaded by the WorkLog runtime.

## Compatibility and boundaries

- Production OAuth credentials and Supabase schema are unchanged.
- The existing `worklog-workspace` repository is read-only and untouched.
- This migration changes file ownership and URL boundaries, not WorkLog
  business logic.
