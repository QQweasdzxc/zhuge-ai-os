# Zhuge AI OS

This repository is the formal Zhuge AI OS development mainline.

The root entry point is the Zhuge AI OS Dashboard. WorkLog is the first
application module and has been migrated into `modules/worklog/` at the
Production baseline `0.9.0-alpha.8.4 / 20260730-1135`.

## Phase 2 scope

- establish Dashboard → module routing;
- keep shared auth, Google, Supabase, API, component, theme, and utility code
  outside individual modules;
- preserve WorkLog business logic and runtime behavior while relocating files;
- expose public product/legal pages from the new `zhuge-ai-os` site;
- leave the legacy `worklog-workspace` repository read-only and unchanged.

## Local preview

Serve this directory with any static file server and open `index.html`. GitHub Pages publishes the same static tree.

## Version

See [`version.json`](./version.json). Architecture boundaries are documented
in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
