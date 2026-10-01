# TASK-18 WorkTodo Create Authority Closeout

Status: `ENGINEERING PASS / PM RUNTIME QA NOT REQUIRED FOR THIS SOURCE CLOSEOUT`

This evidence records the bounded retirement of the WorkTodo-specific task
creation route. It does not change existing WorkTodo cards, WLTK identities,
workspaces, or historical data, and it does not package a Candidate.

## Root cause

The formal WorkTodo Board already used the Module C instance runtime, but the
WorkLog AI Assistant's visible 「建立待辦」 action still called
`ZhugeBoardReadService.worktodoCreateTask()`.

That adapter invoked the separate Cloud function
`public.worktodo_create_task(text, text, text, text, uuid)`, which directly
wrote `board_tasks`. The result was a live WorkTodo create-writer split even
though the current Board page itself used the C instance contract.

Live Cloud read-back before the change showed:

- `board_instance_create_task(uuid, text, text, text, text, uuid)` was the
  current C instance writer and was executable by the existing application
  roles.
- `worktodo_create_task(text, text, text, text, uuid)` was also executable by
  `authenticated` and `service_role`.
- No Cloud function body in `public` or `private` referenced the old create
  function, and no WorkTodo trigger used it.

## Current authority after the change

```text
WorkLog AI Assistant
  → createCanonicalWorkTodoTask()
  → createInstanceService(templateKey=c, legacyApplicationScope=worktodo)
  → resolve existing WorkTodo Board Instance
  → resolve the existing active worktodo-todo workspace UUID
  → board_instance_create_task()
  → board_tasks + existing Cloud audit/work-code trigger
```

The default workspace lookup is only Consumer configuration resolution. The
write, authorization, identity allocation, audit, and Board Instance scope
remain in the shared C Cloud contract. If the canonical default workspace is
missing, the adapter fails closed and does not create a card.

The shared WorkTodo action adapter now delegates `createTask` to the supplied
C instance service. It no longer calls a WorkTodo-specific create RPC.

## Source evidence

| Evidence | Result |
|---|---|
| `modules/worklog/worklog-app.js` Assistant action | Calls `createCanonicalWorkTodoTask`; user-facing success message and `工作待辦` navigation are unchanged |
| `shared/board/board-read-service.js` | Resolves the existing WorkTodo instance/default workspace, then delegates to `service.createTask()` |
| `shared/components/task-action-adapters.js` | WorkTodo `createTask` uses the shared service `createTask` operation |
| Current runtime source search | No `gateway.rpc("worktodo_create_task", ...)` caller remains in current runtime source |
| Historical SQL/docs | Old function definitions remain as historical records; they are not current runtime callers |

## Cloud authority read-back

Project: `lenpbbhwxyyfwgvjcozf`

Migration applied: `20260913110621_worktodo_legacy_create_authority_closure`

After the ACL change:

- `board_instance_create_task(...)`: existing `anon`, `authenticated`,
  `postgres`, and `service_role` grants remain unchanged.
- `worktodo_create_task(...)`: only `postgres` retains `EXECUTE`; `public`,
  `anon`, `authenticated`, and `service_role` no longer have `EXECUTE`.
- The old function remains present and is commented as retained only for
  owner-controlled historical/rollback inspection.
- `board_tasks` and `board_workspaces` RLS remain enabled.
- No Cloud function body, table row, card, workspace, or WLTK identity was
  changed.

## Data and identity boundary

Product data mutation: `0`.

No card was created by QA, moved, copied, renamed, deleted, or re-numbered.
The post-change read-back still resolves the existing WorkTodo Board Instance
`0b2b5c4e-6767-4792-a97a-d2ddf42e60da` with prefix `WLTK`. The read-only count
check returned 34 distinct `board_tasks` IDs and 34 distinct WLTK codes; this
was an observation only and was not changed by the ACL migration.

## QA

- Targeted authority/create regression: `49 PASS / 0 FAIL / 0 SKIP`.
- Full Node regression: `475 total / 469 PASS / 0 FAIL / 6 SKIP`.
- The six skips are existing Browser regressions requiring a configured
  Chrome/Chromium executable; no new skip was introduced.
- JavaScript syntax checks: PASS.
- `git diff --check`: PASS.

Authority Census result for the current WorkTodo create path:

`No WorkTodo-class authority split found.`

The separately named WorkTodo update/delete/history adapters remain outside
this bounded create-authority task; they were not promoted, removed, or
rewired by this change.

## Deferred item

Management Center Runtime Identity / Authority visualization remains a later
UX task. It is intentionally not modified here.
