# Zhuge AI OS v0.9.0-alpha.9.13

## Golden Master Phase 1 Candidate

- Version: `0.9.0-alpha.9.13`
- Build: `20260821-1555`
- Package time: 2026-08-21 15:55 (Asia/Taipei)
- Artifact type: Full Source Candidate; not a Production Release

### Changes

- Promoted the current AI Board presentation contract into the only Empty Golden Master.
- System Template mounts the same empty shared framework; no Fixture, GM-FIX or parallel presentation remains.
- Preserved the one-template, two-adapter, two-domain-data boundary.
- No Cloud, Schema, RPC, RLS, GitHub, or deployment changes.

## Previous Release Record

# Zhuge AI OS v0.9.0-alpha.8.4

## Release Build

- Version: `0.9.0-alpha.8.4`
- Build: `20260731-0905`
- Package time: 2026-07-31 09:05 (Asia/Taipei)

## Changes

- OAuth review landing page information
- Product page and Google Drive integration explanation
- Contact page
- Google Data Usage page
- Privacy policy reviewer section labels and authorization wording
- Foundation v1.0 contracts: Shell, Shared Core, Services, AI, Theme, Config,
  Assets, and module boundaries
- Release identity correction: ZIP, version metadata, UI, and build stamp now
  use `20260731-0905`

## Runtime and Data

- Runtime business logic: no change
- OAuth / Supabase / Router / WorkLog: no change
- Database schema: no change

This release build identifies the Foundation v1.0 architecture release. The
validated WorkLog runtime and database schema remain unchanged.

## 0.9.0-alpha.9.12 — 20260804-1515

- Fixed WorkLog startup remaining on `Opening WorkLog…` when the cloud work-profile row is absent.
- Made `normalizeWorkProfile` null-safe and retained the existing profile fallback behavior.
- Updated WorkLog runtime cache-busting so browsers load the patched JavaScript.
- Added a regression test for a null cloud work-profile response.

## 0.9.0-alpha.9.12 — 20260804-1515

- Fixed high-frequency WorkLog screen flicker on macOS Chrome and Safari.
- Cloud sync status now preserves DOM nodes and updates only changed text.
- Prevented redundant child-list mutations caused by repeated `innerHTML` replacement.
