# AI Board Development Batch #1 — Developer QA / Evidence Report

Date: 2026-08-09  
Batch: AI Board Formal Cloud Read & Shared Workflow Integration  
Baseline: `v0.9.0-alpha.9.12` / Runtime Source Build `20260804-1515`  
Handover package: `20260809_0725_ZhugeAIOS_v0.9.0-alpha.9.12_Source_Flicker_Hotfix.zip`

## Scope covered

Approved TASK slices: `TASK-001`, `TASK-005`, `TASK-015`, `TASK-016`, `TASK-021`, `TASK-022`, `TASK-023`.

The implementation is intentionally limited to formal Board Cloud Read, Shared Identity/Gateway reuse, canonical status-to-workspace mapping, approved-principles read, Traditional Chinese Board copy, and removal of unauthorized write affordances. TASK-026 remains `qa / GPT` and is not changed here.

## Modified files

- `app/Board/ai/index.html` — keeps the approved prototype layout, loads the Shared runtime/read adapter, and presents the Board as read-only.
- `app/Board/ai/board-runtime.js` — renders Cloud Read results, maps status to the four approved workspaces, clears prototype fixtures, and disables write/drag affordances.
- `shared/board/board-read-service.js` — canonical read adapter for `public.board_tasks` and approved `public.engineering_knowledge` through `ZhugeSupabaseGateway` and Shared Identity.
- `app/dashboard/zhuge-dashboard.js` — adds the authenticated AI Board module entry.
- `app/Board/ai/README.md` — documents the formal Cloud Board boundary and QA expectations.
- `app/Board/ai/app.js` — marked as legacy prototype reference; it is not loaded by the formal Board entry point.
- `tests/ai-board-cloud-read.test.js` — unit/static regression coverage for mapping, data separation, source wiring, and no-write boundary.

## Architecture impact

The Board is a presentation module. It does not create a Supabase client, own OAuth, own Session, or import another module. It consumes:

```text
Shared Identity → Shared Supabase Data Gateway → Board Read Adapter → Board UI
```

Canonical workflow mapping:

| Database status | Board workspace | Label |
|---|---|---|
| `ready` | `todo` | 待辦 |
| `inprogress` | `progress` | 推進 |
| `qa` | `qa` | 驗證 |
| `done` | `done` | 完成 |

Approved principles are read separately from `engineering_knowledge`; they are not treated as a fifth TASK status.

## Developer QA results

- `node --check shared/board/board-read-service.js` — PASS
- `node --check app/Board/ai/board-runtime.js` — PASS
- Inline JavaScript extracted from `app/Board/ai/index.html` — PASS
- `node --test tests/ai-board-cloud-read.test.js` — **5 passed / 0 failed**
- `node --test tests/*.test.js` — **24 passed / 0 failed**
- `git diff --check` — PASS
- Formal Board entry does not load legacy `app/Board/ai/app.js` — PASS
- Prototype fixture cards are cleared before the asynchronous Cloud Read — PASS
- Board adapter has no insert/update/delete path — PASS

## Database / security boundary

- Database migration: **NO**
- Schema change: **NO**
- Constraint/index/view/RPC change: **NO**
- RLS change: **NO**
- Drag/status/assignee/ownership writes: **NOT ENABLED**

Formal write workflow remains blocked pending the separately requested Ownership/RLS proposal and PM approval.

## Global regression scope

The existing full Node regression suite passes, including Shared Platform, Auth/Session, WorkLog, Investment, release consistency, and sync-status tests. No OAuth, Supabase configuration, Router, Session, WorkLog business logic, or database files were modified.

## Known limitations / next gate

1. Live browser QA against an authenticated GitHub Pages deployment is still pending GPT Review and QJC/PM QA.
2. `engineering_knowledge` visibility depends on the authenticated user's existing RLS policy; an empty result is shown explicitly and is not replaced by prototype data.
3. Formal Board writes, drag transitions, assignee handoff, Ownership migration, and RLS changes are intentionally out of this batch.

## Release identity

No release or deployment was performed. Keep the current baseline identity until GPT Review and QJC/PM QA authorize a release:

```text
Version: v0.9.0-alpha.9.12
Runtime / Source Build: 20260804-1515
Handover Package Time: 20260809-0725 (not a Runtime Build)
```
