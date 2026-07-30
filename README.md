# Zhuge AI OS

This repository is the Phase 1 architecture skeleton for Zhuge AI OS.

The root entry point is the Zhuge AI OS Dashboard. WorkLog is the first reserved module; its existing production implementation remains in the separate `worklog-workspace` repository during this phase.

## Phase 1 scope

- establish the Dashboard, shell, and router boundaries;
- reserve independent module boundaries for WorkLog and Investment;
- reserve shared authentication, Google, Supabase, API, component, theme, and utility boundaries;
- publish a static GitHub Pages skeleton;
- do not change production OAuth, Supabase schema, or WorkLog business logic.

## Local preview

Serve this directory with any static file server and open `index.html`. GitHub Pages publishes the same static tree.

## Version

See [`version.json`](./version.json).
