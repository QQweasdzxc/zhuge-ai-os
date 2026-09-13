# TASK-064 Legacy Retirement Manifest

Status: `PREPARATION ONLY — DO NOT EXECUTE BEFORE PM RUNTIME QA`

This manifest is a dependency record for the WorkTodo（舊） retirement gate.
It is not an instruction to delete, drop, disable, or rename anything in the
current closeout. Rollback and comparison remain available until PM Runtime
QA passes and a separate retirement change is approved.

## Retirement gate

Required order:

`New C Runtime QA PASS → same-data verification PASS → Authority Checker PASS →
PM Runtime QA PASS → old entry retirement → legacy writer disable → regression →
separate decision on permanent removal`

The current source and Cloud state have not reached the execution point for the
last four steps.

## Current evidence

- Current formal WorkTodo route: `/app/Board/worktodo/`.
- Current Board Instance: `0b2b5c4e-6767-4792-a97a-d2ddf42e60da`.
- Current data: `public.board_tasks`, 33 unique WLTK cards, 7 active
  Workspaces.
- Comparison route: the same entry with `?consumer=worktodo-old`; it resolves
  the same Board Instance and is guarded by the shared service boundary.
- Old compatibility storage remains `public.user_tasks` and
  `public.work_journal_entries`.
- Live Cloud still contains the old `user_tasks` lifecycle trigger and RPCs;
  the current v2 Checker definition explicitly reports their current route as
  false for the C WorkTodo Board. Their existence is therefore rollback /
  compatibility evidence, not permission to remove them now.
- `WLTK-049` is absent after the authorized QA cleanup.

## Manifest

| Item | Current Source / Cloud object | Current dependency evidence | Current disposition | Post-PM-QA target |
|---|---|---|---|---|
| Old WorkTodo entry | `app/Board/worktodo/index.html`, `data-worktodo-old-entry`, `?consumer=worktodo-old` | PM comparison/rollback checklist; `tests/worktodo-new-ai-board.test.js` | KEEP | REMOVE after PM comparison PASS |
| Old runtime route | `isWorkTodoComparisonMode()` and read-only branch in `shared/components/golden-master-runtime.js` | `WORKTODO_OLD_READ_ONLY`; `tests/task-064-board-adoption.test.js` | KEEP | DISABLE, then REMOVE with a rollback checkpoint |
| Old service boundary | `createInstanceService(... readOnly)` in `shared/board/board-read-service.js` | All mutators are replaced by one fail-closed `WORKTODO_OLD_READ_ONLY` function | KEEP | REMOVE only when old entry is retired and no rollback route is required |
| Legacy writer reachability | `public.user_tasks` compatibility write path; `shared/api/repositories.js` legacy methods | `user_tasks` remains a separate legacy store; current `board_tasks` route is the formal WorkTodo writer | KEEP | DISABLE after PM QA, caller inventory, and rollback approval |
| Legacy lifecycle trigger | `public.worktodo_completion_lifecycle_before_write` → `public.worktodo_apply_completion_lifecycle()` | Live Cloud trigger read-back: enabled on `public.user_tasks`; no current `board_tasks` route | KEEP | DISABLE after new writer and rollback evidence are accepted |
| Legacy reconciler | `public.worktodo_reconcile_completion_lifecycle()` | Live function exists; it only reconciles legacy `user_tasks`; current v2 checker marks route unreachable | DEFER | DISABLE, then REMOVE after final caller inventory |
| Legacy lifecycle RPC | `public.board_reconcile_completion_lifecycle()` | Live function exists; current C tests assert current AI Board path does not call it | DEFER | REMOVE candidate after authenticated caller inventory and regression |
| Legacy PM/lifecycle compatibility RPC | `public.board_reconcile_pm_acceptance_lifecycle(uuid,text)` and related v1 compatibility functions | Historical compatibility surface; current C v2 path uses scoped C contracts | DEFER | REMOVE candidate only after all formal callers are proven absent |
| Legacy adapter | `shared/api/repositories.js` `user_tasks` / `work_journal_entries` methods | Dashboard/legacy WorkLog compatibility and rollback evidence; not loaded by the formal WorkTodo page | KEEP | DEFER or remove only per a separate caller inventory |
| Legacy storage | `public.user_tasks` | 15 historical rows were retained as rollback/history; not cloned into current Board data | KEEP | KEEP until PM approves data-retention retirement |
| Legacy journal storage | `public.work_journal_entries` | Historical journal/evidence boundary; not migrated or deleted in this closeout | KEEP | KEEP or separately retire after retention review |
| Compatibility read metadata | `legacyApplicationScope`, archived/read-only labels, legacy identity metadata | Needed to render rollback/comparison without changing current Board data | KEEP | DEFER until old entry removal is complete |
| Canonical C movement/completion/archive contracts | `board_c_reconcile_workspace_decision_v2`, `board_c_reconcile_completion_archive_lifecycle_v2`, private C archive core | Targeted 84/84 and full regression 0 FAIL; scheduler uses the same private core | KEEP | KEEP |
| Canonical C scheduler | `cron.job` `module-c-completion-archive-v2`; `private.module_c_completion_archive_scheduler_runs` | Live job active every 5 minutes; latest five runs completed with zero errors | KEEP | KEEP |
| Optional Workflow designation | `private.board_c_completion_archive_designation()` and WorkTodo `worktodo-completed` | Live read-back resolves `完成`; no fake Workflow is created | KEEP | KEEP |

## Do-not-remove conditions

Do not remove or disable an item in the manifest while any of these is true:

- PM QA task `TASK-077` is not Runtime PASS.
- The old entry is still needed for comparison or rollback.
- A caller inventory has not proven the legacy writer unreachable.
- The current Board data, Card UUIDs, WLTK codes, child data, or lifecycle
  timestamps would be affected.
- A legacy object is still needed for historical retention or compatibility
  reads.
- The authenticated Authority Checker cannot be read back through the formal
  runtime.

## Evidence after retirement (future change)

A future retirement change must add, before any destructive Cloud operation:

1. Authenticated Cloud caller inventory for every listed RPC, trigger, writer,
   and adapter.
2. A read-only old-entry/write-rejection proof.
3. A Board/Card/child-data count and identity snapshot.
4. A rollback checkpoint and a reversible disable step.
5. Targeted and full regression with no new failures.
6. PM Runtime QA evidence and an explicit retention decision for
   `user_tasks`/`work_journal_entries`.

Until then, all rows marked `KEEP` or `DEFER` remain active exactly as found;
the current Runtime must continue to use the canonical C path and must not use
them as a fallback authority.
