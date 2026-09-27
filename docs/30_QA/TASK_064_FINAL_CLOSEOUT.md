# TASK-064 Final Closeout

Status: `ENGINEERING PASS / PM RUNTIME QA PASS / LEGACY RETIRED / FINAL CANDIDATE`

This is the final evidence record for the WorkTodo same-data cutover and the
approved retirement of the old WorkTodo runtime entry. Historical data remains
retained; retirement means removal of runtime reachability and authority, not
deletion of history.

## Final QA read-back

### WLTK-050

Cloud read-back from project `lenpbbhwxyyfwgvjcozf`:

- Card: `ea9debaf-f225-400c-a218-20432a25c08f`, `WLTK-050`.
- Title: `TASK-077 Runtime QA 測試卡`.
- Board Instance: `0b2b5c4e-6767-4792-a97a-d2ddf42e60da`.
- Workspace/status: `完成` / `completed`.
- Completion designation: `worktodo-completed` / `完成`, workspace
  `1ac5492b-a333-4373-bab2-75cd2a0eb746`.
- `completion_at`: `2026-09-13T07:14:48.322042+00:00`.
- `archive_due_at`: `2026-09-14T07:14:48.322042+00:00`.
- Difference: exactly `86400` seconds.
- `archived_at`: null because the due time had not arrived; the card remains
  lifecycle evidence for the active scheduler.
- Checklist: 1/1 complete (`TASK-077 Checklist QA`).
- Attachment: one active ready attachment is present in the formal board
  attachment storage.
- Activity: `TASK-077 Activity QA` is present, with PM completion activity.
- Policy: published C Policy v2, `86400` seconds / 24 hours.
- Scheduler: active `module-c-completion-archive-v2`; latest run completed with
  `error_count = 0`.

### TASK-077

- Formal AI Board task ID: `fb895d5c-0990-49ab-8333-19892403b6be`.
- Cloud status: `done`.
- Checklist: 22 unique items, 22 completed.
- PM completion activity records `QJC驗證 → 完成`, `completion=true`, policy
  version 2, and archive delay `86400`.
- This records PM Runtime QA as PASS; no browser operation is inferred from
  automated tests.

## Same-data integrity

- WorkTodo Board Instance remains
  `0b2b5c4e-6767-4792-a97a-d2ddf42e60da`.
- The formal WorkTodo data remains 33 unique card IDs and 33 unique WLTK codes
  across 7 active Workspaces.
- The board currently has 34 rows because WLTK-050 is the separately retained
  TASK-077 QA evidence card. No formal WorkTodo card was copied, renumbered, or
  deleted by retirement.
- `user_tasks` (15 rows) and `work_journal_entries` (37 rows) remain retained
  historical/compatibility storage. No data migration or deletion was run.

## Runtime authority retirement

The canonical WorkTodo entry is `/app/Board/worktodo/`.

- The former `?consumer=worktodo-old` URL redirects to the canonical entry.
- The old navigation/comparison link was removed.
- The comparison detector and old label mutation were removed from the current
  runtime.
- The defensive shared read-only service boundary remains fail-closed for
  rollback tooling; it is not a navigation or writer path.
- The formal WorkTodo page no longer loads the legacy WorkLog data service.
- The old WorkTodo lifecycle reconcile call and repository method were removed.
- The shared unscoped global lifecycle read route and wrapper were removed from
  current source; the corresponding Cloud function remains retained but has no
  application-role execute grant.
- The `user_tasks` WorkTodo lifecycle trigger is disabled. The code function,
  legacy reconciler, global lifecycle RPC, and PM/lifecycle compatibility RPC
  are retained for rollback/history but have no `public`, `anon`, or
  `authenticated` execute grant.
- The WorkTodo formal writer remains the C Shared Instance Runtime. No second
  WorkTodo writer or lifecycle authority is connected.

## Lifecycle and checker

- WorkTodo Workflow `NOT_CONFIGURED` is legal; no fake Workflow was created.
- WorkTodo completion and archive designation are resolved from explicit
  consumer configuration and the C Shared Lifecycle, not from a global
  workspace name.
- C Policy v2 is 86400 seconds / 24 hours.
- Background Scheduler job `module-c-completion-archive-v2` remains active and
  uses the canonical private C reconciler. Read-triggered canonical
  reconciliation remains a safety net.
- The authenticated Authority Checker routine remains protected by the
  authenticated-only boundary. The live SQL read-only session correctly
  rejected unauthenticated invocation with `42501`; no JWT impersonation or
  security bypass was used. Source/contract QA and post-migration catalog
  read-back prove the legacy WorkTodo route is disabled.

## Regression evidence

- Targeted retirement/source tests: 25/25 PASS, 0 FAIL, 0 SKIP.
- JavaScript syntax checks: PASS.
- `git diff --check`: PASS.
- Full regression: 473 tests, 467 PASS, 0 FAIL, 6 SKIP. The six skips are the
  existing browser regressions that require a configured Chrome/Chromium
  executable; no new skip was added.
- Browser/runtime evidence for TASK-077 is PM-provided and Cloud-backed; it is
  not replaced by automated test claims.

## Retention and rollback

`WorkTodo（舊）` runtime entry is retired, but historical `user_tasks`, journal,
activity, attachment, migration, and card evidence remain retained. No final
drop/delete of those objects is part of TASK-064 closeout. The pre-retirement
source commit and the reversible disable/revoke migration are the rollback
boundary.
