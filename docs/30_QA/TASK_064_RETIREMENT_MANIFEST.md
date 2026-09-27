# TASK-064 Legacy Retirement Manifest

Status: `EXECUTED — PM RUNTIME QA PASS / LEGACY ENTRY RETIRED`

This manifest records the approved, reversible WorkTodo（舊） retirement.
Historical storage and rollback evidence remain retained. No historical data
was deleted, and the retained Cloud functions are not current application
authority.

## Retirement gate

Required order:

`New C Runtime QA PASS → same-data verification PASS → Authority Checker PASS →
PM Runtime QA PASS → old entry retirement → legacy lifecycle writer disable →
regression → historical retention`

This order was completed for the WorkTodo runtime on 2026-09-13. Permanent
deletion of historical storage and retained rollback functions remains out of
scope.

## Current evidence

- Current formal WorkTodo route: `/app/Board/worktodo/`.
- Current Board Instance: `0b2b5c4e-6767-4792-a97a-d2ddf42e60da`.
- Current data: `public.board_tasks`, 33 unique WLTK cards, 7 active
  Workspaces.
- The former comparison route `?consumer=worktodo-old` now redirects to the
  canonical WorkTodo path; no comparison navigation entry remains.
- Old compatibility storage remains `public.user_tasks` and
  `public.work_journal_entries`.
- The old `user_tasks` lifecycle trigger is disabled and the old lifecycle RPC
  execute grants for application roles are revoked. The functions and storage
  remain as rollback/history evidence.
- `WLTK-049` is absent after the authorized QA cleanup.

## Manifest

| Item | Current Source / Cloud object | Current dependency evidence | Current disposition | Post-PM-QA target |
|---|---|---|---|---|
| Former WorkTodo entry | `app/Board/worktodo/index.html`, former `data-worktodo-old-entry`, `?consumer=worktodo-old` | Redirect and route-retirement test; canonical navigation has one WorkTodo entry | RETIRED | KEEP redirect as compatibility boundary |
| Former runtime comparison route | Removed `isWorkTodoComparisonMode()` and comparison branch | `tests/task-064-final-retirement.test.js`; old query cannot open an operational old runtime | RETIRED | REMOVE redirect only in a later URL-compatibility review |
| Defensive read-only service boundary | `createInstanceService(... readOnly)` in `shared/board/board-read-service.js` | Fail-closed `WORKTODO_OLD_READ_ONLY` contract test; useful rollback guard | KEEP | REMOVE only when rollback tooling is no longer required |
| Legacy WorkTodo lifecycle writer route | `shared/api/data-service.js` old reconcile call and `shared/api/repositories.js` reconcile method | No formal WorkTodo caller remains after source cutover; legacy WorkLog storage methods remain separate | RETIRED | KEEP historical storage adapter methods only where separately required |
| Legacy lifecycle trigger | `public.worktodo_completion_lifecycle_before_write` → `public.worktodo_apply_completion_lifecycle()` | Post-migration read-back: trigger disabled; function retained without app-role execute grants | DISABLED | REMOVE only after retention/rollback review |
| Legacy WorkTodo reconciler | `public.worktodo_reconcile_completion_lifecycle()` | Post-migration read-back: retained, no `public`/`anon`/`authenticated` execute grant | RETIRED | REMOVE only after rollback review |
| Legacy global lifecycle RPC | `public.board_reconcile_completion_lifecycle()` | Post-migration read-back: retained, no application-role execute grant; canonical source no longer calls it | RETIRED | REMOVE only after all historical compatibility obligations close |
| Legacy PM/lifecycle compatibility RPC | `public.board_reconcile_pm_acceptance_lifecycle(uuid,text)` | Post-migration read-back: retained, no application-role execute grant; no current source caller | RETIRED | REMOVE candidate after a separate Cloud compatibility review |
| Legacy adapter | `shared/api/repositories.js` `user_tasks` / `work_journal_entries` methods | Legacy WorkLog/history boundary; not loaded by formal WorkTodo page | KEEP | DEFER to separate storage-retention review |
| Legacy storage | `public.user_tasks` | 15 historical rows were retained as rollback/history; not cloned into current Board data | KEEP | KEEP until PM approves data-retention retirement |
| Legacy journal storage | `public.work_journal_entries` | Historical journal/evidence boundary; not migrated or deleted in this closeout | KEEP | KEEP or separately retire after retention review |
| Compatibility read metadata | `legacyApplicationScope`, archived/read-only labels, legacy identity metadata | Needed to render rollback/comparison without changing current Board data | KEEP | DEFER until old entry removal is complete |
| Canonical C movement/completion/archive contracts | `board_c_reconcile_workspace_decision_v2`, `board_c_reconcile_completion_archive_lifecycle_v2`, private C archive core | Targeted 84/84 and full regression 0 FAIL; scheduler uses the same private core | KEEP | KEEP |
| Canonical C scheduler | `cron.job` `module-c-completion-archive-v2`; `private.module_c_completion_archive_scheduler_runs` | Live job active every 5 minutes; latest five runs completed with zero errors | KEEP | KEEP |
| Optional Workflow designation | `private.board_c_completion_archive_designation()` and WorkTodo `worktodo-completed` | Live read-back resolves `完成`; no fake Workflow is created | KEEP | KEEP |

## Retirement evidence

The retirement change proved before execution:

1. PM QA task `TASK-077` completed with 22/22 checklist items and PM
   completion evidence.
2. WLTK-050 Cloud read-back has `completion_at` and `archive_due_at` exactly
   86400 seconds apart, with the configured `worktodo-completed` designation.
3. The formal WorkTodo set remains 33 unique cards; WLTK-050 is retained as a
   separate QA evidence card and is not part of that 33-card set.
4. The old route is redirected, and old source callers were removed or made
   unreachable from the formal WorkTodo runtime.
5. The disable/revoke migration is additive and reversible; no historical
   table, card, workspace, attachment, journal, or lifecycle row was deleted.
6. Targeted and full regression completed with no new failures.

Future destructive retention changes must still add an explicit data-retention
decision and a new rollback checkpoint.

Rows marked `KEEP` remain available only for their documented historical or
defensive purpose. They must not become a fallback authority.
