---
id: TASK-18
title: Close WorkTodo Legacy Create Authority
status: Done
assignee:
  - '@codex'
created_date: '2026-09-13 11:02'
updated_date: '2026-09-13 11:10'
labels:
  - worktodo
  - authority
  - cleanup
dependencies: []
modified_files:
  - modules/worklog/worklog-app.js
  - shared/board/board-read-service.js
  - shared/components/task-action-adapters.js
  - docs/supabase/20260913_worktodo_legacy_create_authority_closure.sql
  - docs/30_QA/TASK_18_WORKTODO_CREATE_AUTHORITY_CLOSEOUT.md
  - docs/30_QA/SOURCE_AUTHORITY_AUDIT.md
  - tests/task-18-worktodo-create-authority.test.js
  - tests/ai-board-cloud-read.test.js
  - tests/task-dashboard-ux.test.js
  - tests/work-code-allocator.test.js
  - tests/task-063-board-delete.test.js
  - tests/worktodo-new-ai-board.test.js
priority: high
type: chore
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Route WorkLog AI Assistant task creation through the canonical C board-instance create authority and close the old WorkTodo-specific create RPC for application roles without modifying existing WorkTodo data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The WorkLog AI Assistant create action creates a real WorkTodo board task through the canonical C board-instance writer and preserves the existing user-visible result.
- [x] #2 Current formal runtime source has no caller of the old worktodo_create_task RPC, and the old application Execute surface is closed without weakening the C writer boundary.
- [x] #3 Targeted tests, full regression, and an authority census show WorkTodo has one current create writer and no WorkTodo-class authority split.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Replace the Assistant and compatibility adapter create route with the existing C board-instance service; resolve the existing WorkTodo default workspace by canonical key without adding a writer. 2. Add an idempotent grant-closure migration for the old WorkTodo create RPC application surface. 3. Update targeted authority/source tests, run full regression and static census, then commit without packaging a Candidate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current-state evidence: formal WorkTodo runtime already uses C instance service; WorkLog AI Assistant was the remaining live old RPC caller. Live Cloud confirms board_instance_create_task is the canonical writer and worktodo_create_task is separately executable by authenticated users.

Implementation complete: WorkLog Assistant and WorkTodo action adapter now use the C board-instance create authority. Cloud migration 20260913110621 closed application/service-role execution of worktodo_create_task while preserving the owner-only rollback surface. Targeted 49/49 PASS; full Node regression 475 total, 469 PASS, 0 FAIL, 6 pre-existing browser SKIP. Current WorkTodo create authority census found no old-RPC runtime caller or create-authority split.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed the WorkTodo create-authority split. WorkLog AI Assistant now resolves the existing WorkTodo Board Instance/default workspace and delegates creation to the shared C board_instance_create_task writer; the WorkTodo action adapter uses the same service. Migration 20260913110621 revoked public/anon/authenticated/service_role execution of the retired worktodo_create_task while preserving the owner-only rollback surface. Evidence: targeted 49/49 PASS, full Node regression 475 total with 469 PASS, 0 FAIL, 6 pre-existing browser SKIP, syntax and diff checks PASS, Cloud grants/RLS/read-only data read-back PASS. No existing WLTK was mutated and no Candidate was packaged.
<!-- SECTION:FINAL_SUMMARY:END -->
