# CO-03 Phase 2 Dispatch Workbench handoff

The Workbench remains read-only and consumes the existing TaskFlow native transport. It reads `/api/issues`, `/api/issues/{id}`, `/task-runs`, and `/pull-requests` using the authenticated workspace header.

The adapter accepts canonical metadata from CO-02:

| Evidence | Metadata key | Display rule |
| --- | --- | --- |
| Work Code | `zhuge_work_code` | Display only; never filters out an otherwise valid issue |
| Owner / executor | `zhuge_owner` | Takes precedence over `zhuge_executor` and native `assignee_id` |
| CTO authority | `zhuge_authorized_by` | Display as authorization source; empty is visibly unverified |
| Provider run | `zhuge_provider_run_id` | Required for `RUNNING` |
| Heartbeat / observation | `zhuge_provider_heartbeat_at`, `zhuge_observed_at` | Fresh heartbeat and observation required for `RUNNING` |
| Checkpoint / next step | `zhuge_provider_checkpoint`, `zhuge_next_step` | Display in task evidence detail |
| Block reason | `zhuge_block_reason` | Required explanation for `BLOCKED`/`FAILED` when supplied |
| GitHub delivery | `zhuge_github_pr_url`, `zhuge_github_sha`, `zhuge_github_ci_url` | Display as native evidence; exact SHA is validated |

`RUNNING` is never inferred from assignment or a TaskFlow task ID. Missing or expired evidence becomes `UNKNOWN` or `STALE`. PM Inbox only includes explicit `zhuge_pm_decision_required=true` and `REVIEW`; `BLOCKED`/`FAILED` stays in the engineering failure count.

## CO-02 verification scenarios

1. Return an issue with canonical owner and native assignee disagreement; Workbench must show `zhuge_owner` and retain the assignee as raw evidence.
2. Return an active run without provider run ID or heartbeat; status must be `UNKNOWN`/`STALE`.
3. Return two active runs; evidence validation must reject duplicate active execution.
4. Return a blocked run with `zhuge_block_reason`; PM Inbox must not claim PM approval is required unless the explicit PM flag or `REVIEW` is present.
5. Return PR, exact head SHA, and CI evidence; Workbench must display the values without manufacturing a success state.
