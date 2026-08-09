# AI Board Development Batch #2 — Developer QA Evidence

Batch: **AI Board Operational Workflow & Engineering Handoff**  
Product Version: `v0.9.0-alpha.9.12`  
Runtime / Source Build: `20260809-1737`  
Branch: `review/ai-board-batch1-20260809`

## Approved scope

Core: `TASK-021`, `TASK-022`, `TASK-023`, `TASK-032`, `TASK-026` (integration / QA gate).  
Integration slice: `TASK-015`, `TASK-024`.  
Deferred: `TASK-033`.

The implementation keeps GPT and Co as workflow actors. No GPT/Co Supabase Auth users or UUIDs were created. `QJC` is the authenticated human owner; browser writes use controlled RPCs, and AI actor writes require the controlled service path.

## Implemented slices

- Authenticated Cloud Read for `board_tasks` and approved Engineering Knowledge.
- Shared Supabase Gateway RPC and Realtime adapters.
- Canonical status/workspace mapping: `ready → 待辦`, `inprogress → 推進`, `qa → 驗證`, `done → 完成`.
- Controlled transition RPC with approved handoffs and QA-fail return to Co.
- Structured `engineering_checklist_items` model with Co/GPT/QJC stages and evidence fields.
- QJC task creation and checklist operations through controlled RPCs.
- Board task cards, drag-to-transition, task detail, Checklist/Evidence UI, and Realtime refresh.
- AI actor audit metadata (`actor_type`, `actor_label`) without fake Auth identities.
- Realtime publication for `board_tasks`, `engineering_checklist_items`, and `engineering_activity_log`.

## Changed files

- `app/Board/ai/board-runtime.js` — operational Board rendering, controlled transitions, Checklist UI, drag and Realtime handling.
- `app/Board/ai/index.html` — operational Board styles and runtime entry wiring.
- `shared/board/board-read-service.js` — Shared read, RPC, Checklist, and Realtime adapter.
- `shared/supabase/supabase-gateway.js` — shared RPC and authenticated Realtime boundary.
- `docs/supabase/20260809_ai_board_batch_2.sql` — approved idempotent migration and controlled RPC definitions.
- `tests/ai-board-cloud-read.test.js` — updated Board contract regression coverage.
- `tests/ai-board-batch-2.test.js` — migration, RPC, actor-boundary, and Realtime contract tests.

## Developer QA

| Check | Result |
|---|---|
| Board tests | **PASS — 5 passed / 0 failed** |
| Existing tests | **PASS — 27 passed / 0 failed** |
| JavaScript syntax (`node --check`) | **PASS** |
| Inline HTML script syntax | **PASS** |
| `git diff --check` | **PASS** |
| Supabase migration read-only verification | **PASS** |
| No GPT/Co Auth users created | **PASS** |
| No browser service key | **PASS** |

`npm test` is not available because this repository has no `package.json`; the authoritative Node test command is `node --test tests/*.test.js`.

## Database and security evidence

- Migration applied: `ai_board_batch_2_operational_workflow`.
- Task creation RPC applied separately and included in the checked-in migration file.
- `board_tasks` anonymous CRUD removed; authenticated engineering-member SELECT retained.
- Direct authenticated INSERT/UPDATE/DELETE on Board tables revoked.
- Checklist and activity-log direct client writes revoked.
- RLS remains enabled; no GPT/Co Auth users were created.
- Realtime publication includes the three Board tables.

## Global regression boundary

No OAuth, Session, Router, WorkLog, Investment business logic, or Product Version was changed. Production deployment, `main` merge, and final TASK completion were not performed.

## Known limitations

1. Live QJC browser QA against a deployed artifact remains the next gate.
2. GPT/Co writes require a controlled service/tool path; the browser intentionally cannot impersonate them.
3. Existing tasks may have no checklist rows until QJC creates the approved checklist items.
4. The prototype “新增工作區” action remains informational; arbitrary custom workspaces are out of scope.
5. `npm test` cannot run without a repository package manifest.
