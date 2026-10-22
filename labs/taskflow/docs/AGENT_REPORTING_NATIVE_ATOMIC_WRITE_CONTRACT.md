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

The wrapper only reports committed when the injected Native Authority returns a committed transaction result. Without that adapter it returns `NATIVE_WRITE_UNWIRED`. An opaque hash in a public comment is only a non-secret correlation placeholder; it is not protected storage and must not be treated as evidence retrieval.

Required correlation is preserved across both operations: Issue ID, Workspace, Dispatch ID, Executor, Provider, Provider Run ID, Session ID, Event ID, Lease ID, Fencing Epoch, expected revision, and audit event. Provider ACK/Run and STOP/Handoff remain unverified unless supplied by their server-side authoritative source.
