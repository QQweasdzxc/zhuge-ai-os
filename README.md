# Zhuge AI OS Foundation v1.0

This repository is the formal Zhuge AI OS development mainline.

The root entry point is the Zhuge AI OS Dashboard. WorkLog is the first
application module and has been migrated into `modules/worklog/` at the
Production baseline `0.9.0-alpha.8.4 / 20260731-0905`.

Foundation rules: One Identity, One Dashboard, One Shared Runtime,
Independent Modules. The default product locale is `zh-TW` with timezone
`Asia/Taipei`.

## Phase 2 scope

- establish Dashboard → module routing;
- keep shared auth, Google, Supabase, API, component, theme, and utility code
  outside individual modules;
- preserve WorkLog business logic and runtime behavior while relocating files;
- expose public product/legal pages from the new `zhuge-ai-os` site;
- keep the legacy `worklog-workspace` repository as a redirect-only archive.
- keep Shell, Shared Core, Services, AI, Theme, i18n, and module contracts
  stable for future modules.

## Local preview

Serve this directory with any static file server and open `index.html`. GitHub Pages publishes the same static tree.

## Version

See [`version.json`](./version.json). Architecture boundaries are documented
in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
