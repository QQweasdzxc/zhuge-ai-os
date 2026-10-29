# Agent Reporting Native Atomic Write Contract

Version `1.0`. This is the integration seam for CO-01 and names the existing TaskFlow Native Authority as the only persistence owner. It does not create a task database, SQL table, ACL, secret, provider binding, or runtime credential.

The injected adapter must expose:

- `runAtomicMutation({ issueId, taskId, idempotencyKey, event, mutate })`
- transaction locks in order: native Issue row, then native agent task queue row
- one transaction for read, version check, mutation, audit append, and commit
- idempotency and expected version checks
- fencing and lease checks before accepting the mutation
- rollback evidence on every rejected or failed mutation

`createNativeAgentAtomicWriteAdapter()` exposes the Agent Reporting methods:

- `applyAgentReportMutation(mutation)`
- `applyCtoCompletion(completion)`

The wrapper only reports committed when the injected Native Authority returns a committed transaction result. Without that adapter it returns `NATIVE_WRITE_UNWIRED`. Sensitive detail must use the injected Agent Protected Detail Store contract. Without it, public comments contain no detail reference and the mutation remains unconnected to protected evidence storage.

Required correlation is preserved across both operations: Issue ID, Workspace, Dispatch ID, Executor, Provider, Provider Run ID, Session ID, Event ID, Lease ID, Fencing Epoch, expected revision, and audit event. Provider ACK/Run and STOP/Handoff remain unverified unless supplied by their server-side authoritative source.

## Abstract locked-record projection

The JS wrapper is an internal integration seam, not an HTTP authorization endpoint
or a concrete SQL adapter. Its injected transaction must return a canonical record
with `issue_id`, `workspace`, `dispatch_id`, `executor_id`, `writer_id`, `provider`,
`lease_id`, `provider_run_id`, `provider_session_id`, `fencing_token`,
`fencing_epoch`, `lease_active`, and `lease_expires_at`. The report mutation must
carry `issue_id`, `workspace_id`, `lease_id`, an atomic claim with `fencing_epoch`,
and audit bindings for `dispatch_id`, `executor_id`, `provider`, `provider_run_id`
and `session_id`. Every string binding must be nonempty on both sides and equal;
`writer_id` must match the report executor. Missing fields fail closed. This is
not a claim that a SQL row already has this shape: the native projection/mapping
remains unwired. Direct SQL persistence uses the separate Go ingress/writer.

The factory's `serverClock` is a server-owned function (default `Date.now`), never
a request timestamp. It is called fresh inside the locked reducer. An invalid,
missing, expired or exactly-expiring lease is rejected. A report cannot change an
Issue already in review or done. CTO completion is a separate internal seam whose
caller must first use `authorizeCtoCompletion`; it requires `in_review` under lock
and does not require the former Agent's lease.

The reducer preserves report audit and comment in the abstract record, but that
alone does not prove native comment/activity persistence. A concrete transaction
implementation must persist those fields atomically. Repeated use of one factory
revision is rejected by the version check; this is not general event deduplication
across newly constructed factories. Native Go/SQL idempotency is a separate path.
