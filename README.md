# Zhuge AI OS Foundation v1.0

This repository is the formal Zhuge AI OS development mainline.

The root entry point is the Zhuge AI OS Dashboard. WorkLog is the first
application module. Investment is Module 02 and reads owner-scoped Supabase
data only after Shared AAL2 verification.

Foundation rules: One Identity, One Dashboard, One Shared Runtime,
Independent Modules. The default product locale is `zh-TW` with timezone
`Asia/Taipei`.

## Current foundation

- establish Dashboard → module routing;
- keep shared auth, Google, Supabase, API, component, theme, and utility code
  outside individual modules;
- preserve WorkLog business logic and runtime behavior while relocating files;
- expose public product/legal pages from the new `zhuge-ai-os` site;
- keep the legacy `worklog-workspace` repository as a redirect-only archive.
- keep Shell, Shared Core, Services, AI, Theme, i18n, and module contracts
  stable for future modules.
- keep module data access behind Shared Data Gateway and Shared Identity.
- require a short-lived Shared AAL2 unlock for sensitive Investment data.

## Local preview

Serve this directory with any static file server and open `index.html`. GitHub Pages publishes the same static tree.

## Version

See [`version.json`](./version.json). Architecture boundaries are documented
in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
