# Module C Completion / Archive Authority

## Authority statement

Module C has one completion/archive authority. Consumer Boards do not own separate 24-hour timers or archive policies.

The canonical contract is:

```text
enter completion semantic
  -> completion_at (entered_completion_at semantic)
  -> archive_due_at = completion_at + published 86400-second policy
  -> after due time, server-side archive-only transition
```

The active source contract is `module-c-lifecycle-acceptance-v2`.

## Migration/conformance chain

The existing source authority is assembled by these tracked migrations:

1. `20260912_c_shared_completion_archive_policy.sql` establishes the private policy table and calculation surface. Its initial 48-hour policy is historical.
2. `20260912_c_completion_archive_closure_v2.sql` retires policy versions below v2, publishes v2 at `86400`, and makes the C workspace-decision writer set/clear completion timing.
3. `20260912_c_completion_archive_instance_scope.sql` makes reconciliation Board-instance and Workflow scoped.
4. `20260912_c_completion_archive_scheduler_v2.sql` adds the single background scheduler and a transaction-scoped advisory lock.
5. `20260913_c_completion_archive_optional_workflow.sql` allows a C Board with no Published Workflow to use an explicit stable completion designation, while reusing the same writer.
6. `20260913_task_064_worktodo_legacy_retirement.sql` disables/revokes the legacy WorkTodo lifecycle writer without deleting historical definitions or data.
7. `20260915_c_completion_archive_actor_label_system.sql` constrains the system writer to the canonical `System` activity taxonomy and permits only a validated archive-only scheduler update.
8. The C conformance/final-alignment migrations verify policy, writer reachability, scope, and legacy retirement.

TASK-36 does not add another migration or another runtime authority.

## Canonical state transitions

| Transition | Canonical write | Result |
| --- | --- | --- |
| Enter completion | C workspace-decision writer sets `completion_at = clock_timestamp()` and computes `archive_due_at` from published policy v2 | New 24-hour window starts |
| Leave completion | Same writer clears `completion_at` and `archive_due_at`; reopens clear archive state | Current window is cancelled |
| Re-enter completion | Same writer writes a new `completion_at` and due time | Countdown restarts from this entry |
| Due background reconcile | Private C core locks due candidates and updates only `archived_at`, `archived_by`, and `updated_at` | Task is archived, not deleted |
| Already archived/re-run | Candidate requires `archived_at is null`; row update also rechecks it | No second transition or duplicate archive activity |

## Time authority

`public.board_tasks.completion_at` is the persisted canonical field. Its semantic name in this contract is `entered_completion_at`: the timestamp of the latest entry into a completion semantic.

The due calculation uses `completion_at + 86400 seconds`. It does not derive eligibility from `created_at`, `updated_at`, or a display label.

## Completion semantics and naming

The authority does not hard-code the Chinese label `完成`:

- a Published Workflow resolves the completion step by `is_completion = true` and its Board-instance binding;
- an optional-Workflow C Board resolves a unique stable completion `workspace_key` such as `completed` or `worktodo-completed`;
- ambiguous or missing configuration fails closed or returns legal `not_applicable`.

Renaming the display label therefore does not disable or silently redirect the rule.

## Server-side execution and safety net

The source scheduler creates/uses `pg_cron` job `module-c-completion-archive-v2` at `*/5 * * * *`. It calls `private.board_c_completion_archive_scheduler_run`, which calls the same private lifecycle core as the authenticated reconciliation path.

The scheduler has:

- a transaction-scoped advisory lock for overlapping runs;
- instance and Workflow scope validation;
- `FOR UPDATE SKIP LOCKED` candidate handling;
- due-time and unarchived predicates;
- a private `SECURITY DEFINER` boundary;
- a transaction-local scheduler marker checked by the board-task trigger.

The trigger accepts the scheduler only when the change is a Module C archive-only transition: old `archived_at` is null, new `archived_at` is non-null, due time has passed, completion timing remains present, and all non-archive fields are unchanged. Delete, rename, identity, owner, tenant, and ordinary application mutation paths are not opened by this guard.

The browser load reconciler is retained as a safety net and read-back path. It does not replace the server scheduler and does not create a second policy.

## Archive retention and audit

Archive is not delete. The background writer does not execute `DELETE` against task or child tables. It preserves the task row and its existing checklist, notes, activity, evidence, attachments, and audit relationships.

Each successful system archive writes the existing canonical activity record:

- entity: `board_task`;
- action: `task_auto_archived`;
- actor type: `system`;
- persisted actor label: `System`;
- note identifying Module C instance-scoped or optional-Workflow reconciliation;
- `before_data` and `after_data` containing the task/archive context, including completion and due timestamps;
- scheduler source actor provenance retained separately from the canonical actor taxonomy.

The repository uses `task_auto_archived` as the canonical action name; it does not introduce a second `auto_archived_after_completion` action.

## Consumer contract

| Consumer | Module C authority path | TASK-36 verification |
| --- | --- | --- |
| WorkTodo | Shared C instance service, legacy lifecycle writer retired | Same RPC gateway and 86400 policy contract |
| AI Board | Shared C instance service | Same RPC gateway and 86400 policy contract |
| GAS / Procurement | Shared C instance service for the procurement C adopter | Same RPC gateway and 86400 policy contract |
| C Mother / fixture | Canonical C instance path | Same RPC gateway and 86400 policy contract |
| Future C adopter | Opts into the shared C completion/archive capability | Must satisfy the same instance/scope/contract checks |
| Investment | Read-only comparison/adoption boundary; not a completion/archive writer | Intentionally not mutated by this task |

The cross-adopter test uses an injected gateway to prove route convergence. It is a source contract test, not a claim that live Cloud data was mutated.

## Protected boundaries

Completion/archive authority is independent of:

- workspace reorder authority;
- card drag/drop presentation;
- task create/delete protection;
- completion gates and evidence requirements;
- Board permissions, tenant/owner checks, and RLS;
- archive/history read-back.

The system scheduler guard is narrow and cannot be used to rename, delete, change identity, move a card, or alter unrelated task fields.

## Cloud gate

This document records source authority and Developer QA only. Cloud migration application, `pg_cron` activation read-back, Cloud task samples, and PM runtime acceptance were not performed in this task turn.
