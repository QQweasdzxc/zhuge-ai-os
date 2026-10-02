# TASK-35 Module C Workspace Ordering Authority

## Canonical contract

> Every visible Module C workspace is reorderable. Protected does not mean fixed-position.

There is one ordering path:

- Browser authority: `shared/board/workspace-ordering-authority.js`
- Shared caller: `shared/components/golden-master-runtime.js`
- SQL authority: `public.module_c_workspace_ordering_authority(uuid[])`
- Compatibility wrappers: `board_instance_reorder_workspaces(uuid[])` and
  `board_reorder_workspaces(uuid[])`
- Position SSOT: `public.board_workspaces.sort_order`
- Source migration: `supabase/migrations/20261002193217_task_35_module_c_workspace_ordering_authority.sql`

## Behavior

The browser authority validates a complete active order, resolves before/after
from the target midpoint, supports first/middle/last placement, normalizes
positions in steps of 10, delegates the authorized persistence call, reloads,
and rejects a read-back mismatch. It does not write local storage or invent
audit records.

The SQL authority validates one active Board Instance, rejects empty,
duplicate, missing, inactive, and cross-instance IDs, writes only
`sort_order` plus normal update metadata, and preserves the existing canonical
board-instance audit contract. Existing RPC names remain compatibility wrappers
so consumers do not create a second persistence route.

## Protection separation

The WorkTodo trigger keeps delete and identity checks. Only the canonical SQL
ordering function sets the transaction-local
`zhuge.module_c_workspace_ordering = '1'` context. Under that context, any
mutation other than `sort_order`, `updated_by`, or `updated_at` is rejected.

The completion workspace remains non-deletable/lifecycle-controlled but is
reorderable. Card drag, task movement, workspace creation, and Investment source
are outside this convergence change.

## Consumers

The authority script is loaded before the shared runtime by AI Board, WorkTodo,
the C template preview, procurement/GAS, and the shared browser fixtures.
