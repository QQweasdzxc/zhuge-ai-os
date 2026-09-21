# TASK-074 Agent Workspace Closed Loop

## Canonical authority

`public.board_tasks` remains the only Task source of truth. The existing
`private.board_task_claims` ledger remains orchestration metadata; this change
adds `GPT` as a controlled actor and records `claim_purpose` as
`co_execution`, `gpt_planning`, or `gpt_review`.

All new writes are reached through the signed `engineering-transition` Edge
Function and service-role-only RPCs. A GPT token cannot use a Co operation, and
a Co token cannot use a GPT operation. Same actor/idempotency-key retries are
bound to the original Board instance and Task.

## Lifecycle

```text
ready / Co / todo
  -> GPT Claim (qa / GPT / gpt)
  -> GPT plan + handoff (ready / Co / todo)
  -> Co Claim (inprogress / Co / co)
  -> Co Developer QA (qa / GPT / gpt)
  -> GPT Review PASS (qa / QJC / qjc)
  -> QJC / PM acceptance or Runtime QA
```

GPT `REWORK` records review evidence and returns the Task to `ready / Co /
todo`; Co must acquire a fresh Claim. Lease expiry is fail-closed: planning
claims return to the Co queue, while review claims remain in the GPT review
queue. No Task, Card, or Product Data is created, deleted, migrated, or
copied by the orchestration metadata change.

## QJC Runtime QA action

Runtime QA is a human QJC-authorized action, not a GPT actor action. The
canonical source contract is `public.board_task074_runtime_qa(...)`. It accepts
only `pass` or `rework`, requires bounded evidence and an idempotency key, and
atomically binds the target workspace/status/assignee to the published
workflow step while recording before/after evidence in
`engineering_activity_log` and the existing workflow idempotency ledger.

The action is fail-closed unless the published workflow has exactly one
required `runtime_qa` gate and exactly one matching QJC transition for the
requested result. It cannot perform PM-controlled completion. The GPT-only MCP
surface must not expose this action as a QJC impersonation path; GPT Review
therefore remains a handoff to the authenticated QJC gate.

## Evidence gates

GPT planning writes only the existing Board Task contract fields. GPT Review
PASS requires Review evidence, Regression evidence, and an explicit next gate
of `pm_decision_required` or `runtime_qa`; the existing canonical transition
then moves the Task to QJC. Direct GPT `qa` transitions are rejected by the
controlled Edge/tool surface and must use the Review RPC.

## Source / QA boundary

Migration source:
`docs/supabase/20260920_task_074_agent_workspace_closed_loop.sql`

Runtime source:
`supabase/functions/engineering-transition/index.ts`

Protected tool:
`tools/engineering-transition.js`

Developer regression:
`tests/task-074-agent-workspace-closed-loop.test.js`

This source checkpoint is not a Cloud deployment or Runtime acceptance. Apply
the migration and deploy the Edge Function only under the separate PM
Deployment authorization gate.
