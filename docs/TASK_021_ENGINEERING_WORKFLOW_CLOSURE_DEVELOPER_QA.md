# TASK-021 Engineering Workflow Closure — Developer QA Evidence

Runtime / Source Build: `20260825-1356`
Source Commit: `bd3768435056c0080849b7ef0eb2059c1da2b834`  
Edge Function: `engineering-transition` (ACTIVE, version 3)

## Controlled Evidence Path

The existing short-lived AI Actor Token and `engineering-transition` Edge
Function were extended with a `checklist` operation. The function validates the
signed actor, task/item relationship, matching Co/GPT stage and evidence
requirement, then calls the existing `board_update_checklist_item()` RPC.

- Browser/client never receives a Service Role Key.
- No direct client DML is used.
- The existing transition RPC remains the only Status/Assignee write path.
- Checklist row and `engineering_activity_log` audit are written atomically by
  the existing RPC.

## Database Correction

Migration: `task_021_allow_checklist_audit_entity`  
File: `docs/supabase/20260810_task_021_allow_checklist_audit_entity.sql`

The existing checklist RPC already emitted `entity_type =
engineering_checklist_item`, but the production constraint did not allow that
value. The migration only updates that existing constraint. No RLS, Auth,
workflow RPC, or unrelated schema object was changed.

## E2E Evidence

1. `TASK-021 qa / NULL` was returned through the controlled Co path to
   `inprogress / Co`.
2. Co Developer QA evidence was written through the controlled checklist path.
3. `TASK-021` was handed to `qa / GPT` through the existing transition RPC.
4. `TASK-001`, `TASK-002`, `TASK-003`, `TASK-004`, `TASK-005`, and `TASK-006`
   each received Co evidence and were handed to `qa / GPT`.
5. A GPT token attempting to update a Co checklist item was rejected with
   `Actor GPT may only update the co checklist stage.`
6. GPT independently inspected `TASK-021` after handoff without writing GPT or
   QJC evidence.

## Audit Correction

The historical `TASK-001` activity rows were retained. Their note incorrectly
mentioned TASK-021 while the entity ID belonged to TASK-001. A later controlled
transition audit entry explicitly records the correction/superseding mapping;
no historical row was deleted or overwritten.

## Current Gate State

- Co checklist: PASS for TASK-001..006 and TASK-021.
- GPT checklist: not_verified; awaiting independent GPT Review.
- QJC checklist: not_verified; awaiting PM QA.
- TASK-001..006 and TASK-021: `qa / GPT`.
- No task was marked `done`.
