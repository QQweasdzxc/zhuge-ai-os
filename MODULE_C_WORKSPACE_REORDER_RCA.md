# TASK-35 Canonical Main 收斂：Module C Workspace Reorder RCA

## Scope

This is a local convergence record for canonical `main` before the local commit.
It does not apply the SQL migration, write Cloud data, or mutate GitHub.

- Canonical repo: `/Users/qq/Documents/GitHub/zhuge-ai-os`
- `BEFORE_SHA`: `9ab42c6b3d419773b5ceac356496300af1a0f454`
- Compared source: `/Users/qq/Documents/Zhuge AI OS/Worktrees/canonical-main-recovery-20261001`
- Source baseline: `66e3d44fef68459731c7bf8a9d15761bdfafc351`

## RCA

Canonical `main` already contained the TASK-34 shared Board Instance reorder RPC,
full-list validation, normalized `sort_order`, and audit write. It also already
rendered the completion column as a draggable column. The remaining TASK-35 gap
was authority separation and WorkTodo guard isolation:

```text
Drag workspace
  -> shared/components/task-board.js
  -> shared/components/golden-master-runtime.js
  -> shared action adapter / Board Instance service
  -> board_instance_reorder_workspaces(uuid[])
  -> UPDATE board_workspaces.sort_order
  -> trg_enforce_worktodo_workspace_scope
```

`public.enforce_worktodo_workspace_scope()` in
`docs/supabase/20260902_workspace_delete_non_completion.sql` required
`zhuge.worktodo_workspace_write = '1'` for every WorkTodo update. Reorder used
that broad legacy context, so the PM error could still be raised instead of
using an ordering-only context.

New workspaces use the same full-order Board Instance RPC, so they were not
intrinsically protected; they inherited the same guard path. Completion
protection and ordering eligibility are separate concerns.

## Convergence boundary

The canonical fix adds:

1. `shared/board/workspace-ordering-authority.js` as the single browser-side
   placement, validation, normalization, persistence-delegation, and read-back
   authority.
2. `module_c_workspace_ordering_authority(uuid[])` as the single SQL
   implementation, with the historical RPC names retained as thin wrappers.
3. A transaction-local `zhuge.module_c_workspace_ordering` guard. It permits
   only `sort_order`, `updated_by`, and `updated_at` to change for WorkTodo
   ordering; the old WorkTodo write context remains separate.
4. Runtime placement resolution for both halves of a target column, including a
   true final position.

Delete protection, completion lifecycle protection, immutable identity,
owner/tenant authorization, RLS, and reserved semantics remain unchanged.
