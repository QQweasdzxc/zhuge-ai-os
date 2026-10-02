# Module C Completion 24h Auto-Archive RCA

Status: **Developer QA complete; GPT Review and PM Cloud/runtime review pending**

This task audits and verifies the existing shared Module C completion/archive authority. It does not create a second timer, change a Board UI, change Investment/Lab, or apply Cloud state.

## Verified source boundary

| Item | Value |
| --- | --- |
| Canonical repository | `/Users/qq/Documents/GitHub/zhuge-ai-os` |
| Branch | `main` |
| Source baseline before TASK-36 evidence | `a0e7df39e99655a105ef40d2c7482946ab9510ed` |
| Remote | `https://github.com/QQweasdzxc/zhuge-ai-os.git` |
| Cloud mutation | `0` |
| Remote mutation | `0` |
| Scope | Source and Developer QA only |

The source baseline already contains the Module C lifecycle migrations. The implementation in this task is contract coverage and evidence documentation; no competing production authority was added.

## RCA flow

The current canonical flow is:

```text
PM/card workspace decision
  -> public.board_c_reconcile_workspace_decision_v2
  -> completion_at = clock_timestamp() on entry to a completion semantic
  -> archive_due_at = completion_at + published policy delay
  -> private.board_c_reconcile_completion_archive_lifecycle_core
  -> archived_at / archived_by / updated_at only
  -> engineering_activity_log task_auto_archived
  -> canonical read-back / Archive view
```

The background path is:

```text
pg_cron module-c-completion-archive-v2 (*/5 * * * *)
  -> private.board_c_completion_archive_scheduler_run
  -> the same private C reconciler
```

The browser `instanceReconcileCompletionArchiveOnLoad` call remains a read-time safety net. It is not the only execution mechanism and it does not define another due-time rule.

## Audit answers

| Question | Verified answer |
| --- | --- |
| Is auto-archive present? | **Source: yes.** A server-side Module C scheduler and archive writer are present. Current live Cloud activation was not re-read in this turn, so PM Cloud runtime status remains pending. |
| Current archive hours | **24 hours** in the published v2 policy (`86400` seconds). Earlier 48-hour migrations are historical and are retired by the v2 closure. |
| Who executes it? | `pg_cron` invokes the private `SECURITY DEFINER` scheduler, which invokes the same instance-scoped private reconciler used by the authenticated safety-net. |
| Partial Board support? | The source contract is shared and instance-scoped for `template_key = 'c'`. WorkTodo, AI Board, procurement/GAS, and C Mother are wired to the shared service. A Board without a Published Workflow uses an explicit stable completion designation or returns legal `not_applicable`. |
| Server-side or page-triggered? | **Server-side by design.** Page-load reconciliation is a bounded safety net only. Live Cloud scheduler/read-back needs PM-authorized runtime verification. |
| Existing lazy cleanup? | Yes: the shared read service can reconcile on load when the capability is enabled. It is deliberately not the authority. |
| Archive RPC? | Yes: `public.board_c_reconcile_completion_archive_lifecycle_v2(uuid, uuid, uuid)` is the authenticated, Board-instance-scoped entry point; the background scheduler calls the private core directly. |

## Historical 48-hour finding

The repository contains earlier 48-hour lifecycle artifacts:

- `docs/supabase/20260820_board_completion_lifecycle.sql`
- `docs/supabase/20260820_task_039_completion_drag_lifecycle.sql`
- `docs/supabase/20260912_c_shared_completion_archive_policy.sql` policy v1

Those artifacts are not the effective current rule. `20260912_c_completion_archive_closure_v2.sql` retires published policy versions below v2 and publishes v2 at `86400` seconds. The final C authority/conformance chain and the WorkTodo retirement migration preserve the historical definitions for audit while removing them from application authority.

## Root cause and resolution status

The historical risk was authority drift: a global/legacy lifecycle path could calculate a different window or rely on a page read. The current source closes that risk by:

1. storing the policy in the private Module C policy table;
2. writing completion timing in the canonical C workspace-decision writer;
3. resolving completion by Workflow `is_completion` or a stable completion `workspace_key`, never by the display name `完成`;
4. using one instance-scoped reconciler for page safety-net and background execution;
5. retiring the legacy WorkTodo lifecycle trigger and application RPC execution;
6. guarding the background writer so only the validated archive-only update can pass the board-task trigger.

No new source defect requiring a production rewrite was found in this audit. TASK-36 adds the missing explicit boundary and cross-adopter contract coverage in `tests/module-c-completion-auto-archive.test.js`.

## Completion/reopen semantics

- Entry into a completion semantic writes a fresh `completion_at` and a fresh `archive_due_at` from `clock_timestamp()` and policy v2.
- Leaving completion clears the active completion timestamp and due time; the current countdown is cancelled.
- Re-entry writes a new timestamp and a new 24-hour due time.
- `created_at`, `updated_at`, and general edit time are not used to infer completion age.
- Archive is an update to archive state, not deletion. Existing task children and history remain available to the existing archive/history read path.

## Remaining gate

The Supabase CLI and `psql` were unavailable in this local environment. No Cloud migration, scheduler enablement, Cloud data write, or current scheduler read-back was attempted. Prior repository QA documents contain historical Cloud evidence, but that is not re-presented as a current runtime verification here. GPT Review and PM-authorized Cloud/runtime QA remain required.
