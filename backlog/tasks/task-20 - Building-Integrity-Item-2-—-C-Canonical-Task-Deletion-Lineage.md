---
id: TASK-20
title: Building Integrity Item 2 — C Canonical Task Deletion Lineage
status: In Progress
assignee: []
created_date: '2026-09-15 04:03'
updated_date: '2026-09-15 05:03'
labels: []
dependencies: []
priority: high
type: enhancement
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the approved Option D deletion lineage contract for all formal C consumers. The canonical board_instance_delete_task contract must atomically record an immutable deletion manifest and task_deleted activity snapshot before hard-deleting the task and existing cascade children, without changing legacy WorkLog data or active production cards.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 board_instance_delete_task remains the sole formal C parent-task delete authority
- [x] #2 Deletion evidence is written atomically before hard-delete and evidence failure prevents task deletion
- [x] #3 Manifest and task_deleted activity preserve task, board, consumer, template/module, workspace, work_code, core snapshot, child IDs/counts, actor, contract, event, and idempotency evidence
- [x] #4 Application roles cannot mutate immutable deletion evidence and existing 49 historical activities remain unchanged
- [x] #5 QA/Test Task proves lineage read-back, cross-instance isolation, no new parentless deletion lineage, and 0 regression failures
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reconfirm current board_tasks, board_instances, child FK/cascade, engineering_activity_log constraints/RLS, delete RPC ACL/body, and all formal C delete callers; do not touch active data.\n2. Add an additive private immutable deletion-manifest store plus guarded task_deleted activity evidence and an authenticated read-back RPC; keep legacy WorkLog and existing historical activity unchanged.\n3. Replace only the canonical board_instance_delete_task body so it resolves Board/Consumer/Workspace identity, snapshots task and child IDs/counts, writes activity then manifest in the same transaction, hard-deletes the parent/cascade children, returns evidence, and supports deterministic idempotent retry.\n4. Add source/static contract tests and Cloud read-back assertions; verify no alternate parent delete authority is introduced.\n5. Execute a dedicated QA/Test Task through the normal authenticated C runtime, delete it through the canonical route, read back the manifest/activity, verify lineage, isolation, idempotency and no new parentless deletion event; run targeted and full regression without publishing or packaging.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation authorized by PM Option D; active product data and the 49 historical parentless activities are out of scope and must remain unchanged.

Validated 2026-09-15: authenticated WorkTodo QA task WLTK-051 (task 7261e2e8-02f3-46c4-bce7-1554c3034233) was created and deleted through the normal C runtime. Cloud read-back shows task absent, one immutable manifest (28b5d4ab-0f90-429d-a789-da2e90cc7d6f), one task_deleted activity (id 1699), exact board/consumer/workspace lineage, one checklist child captured then cascaded, zero remaining QA children, zero task_deleted events without a manifest, zero manifest/activity lineage mismatches, and zero child orphans. Existing board_tasks total returned to 125; the 49 pre-existing parentless activities were not modified. Reload showed WorkTodo normal and WLTK-051 absent. Targeted 6/6 pass; full suite 542 tests, 536 pass, 0 fail, 6 browser skips because no CHROME_PATH/CHROMIUM_PATH/BROWSER_EXECUTABLE.
<!-- SECTION:NOTES:END -->
