# Zhuge AI OS v0.9.0-alpha.9.13

## Module C Workspace Email Notification v1 — 20260904-2351

- Version: `0.9.0-alpha.9.13`
- Build: `20260904-2351`
- TASK-18 Developer QA: PASS for Cloud Settings persistence/read-back, reload and
  re-login, GAS-001 workspace movement, Resend delivery, audit linkage, and
  idempotency.
- Candidate package time and SHA-256 are recorded in the controlled Candidate
  Manifest; PM QA remains required.

## A/C Canonical Composition Repair — 20260903-1359

- Version: `0.9.0-alpha.9.13`
- Build: `20260903-1359`
- Restored direct Module A composition for 管理功能 and 庶務行政.
- Registered 庶務行政/GAS and Investment IVTK as consumers of the canonical C
  runtime; no consumer-specific board/card fallback remains.
- Formal Candidate and PM QA are required; deployment is not acceptance.

## A/C Shared Composition — 庶務行政/GAS and Investment IVTK Candidate

- Version: `0.9.0-alpha.9.13`
- Build: `20260903-1221`
- Artifact type: Full Source Candidate; PM QA remains required.
- Module A exposes 庶務行政 as a peer of 工作待辦, with GAS and 廠商清單
  tabs. Its GAS surface is a truthful empty state until a formal GAS data source
  exists; it does not borrow WorkLog, Investment, or test records.
- Investment `#portfolio` and the consolidated `觀察名單` use the canonical C
  Board/Card/Drawer runtime with Investment-owned data slots and stable source
  identity. The legacy `#watchlist` route remains only as a compatibility
  redirect.
- The retired 資料健康檢查（唯讀） capability is no longer reintroduced by C
  consumers. WorkLog, AI Board, and Investment remain on their existing data and
  controlled service boundaries.

## Shared Board Layout Restoration Candidate — 20260822-0957

- Restored the 20260821-1456 AI Board reference geometry in the shared Golden Master board presentation.
- AI Board and the new WorkTodo continue to consume the same shared column, card, count, and add-task presentation.
- No Cloud, Schema, RPC, RLS, migration data, or consumer domain logic changed.
- Candidate only; PM visual QA remains required.

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
