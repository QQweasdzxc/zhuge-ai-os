# TaskFlow × GitHub × Codex Phase 2 Candidate

Candidate-only; no Production schema, service, environment, or provider was changed.

## Current scope

- TaskFlow issue identifiers remain the native workspace prefix plus issue number. PM approval response includes the native GitHub closing marker (`Closes ZG-n`) so a future authorized dispatcher can carry the identifier into PR text. Existing Multica `pull_request` processing remains responsible for PR mirror and Issue–PR auto-linking.
- A TaskFlow-owned wrapper records signed `pull_request` webhook delivery receipts. `received`/`processing` are not success: `receipt=persisted` means the delivery and native PR mirror were verified in the database. `linked_issue_rows` is reported separately; it can be zero if the PR carries no recognized TaskFlow identifier or workspace auto-link is disabled, and is not represented as an Issue–PR link. A signed event from an installation no longer linked to a TaskFlow workspace is stored as `ignored` and acknowledged, matching native behavior rather than causing endless redelivery. Processing failure returns 503 with `Retry-After`; a replay with another payload under the same delivery UUID returns 409.
- The existing native PR refresh remains the source of CI state. The TaskFlow Run readback joins the current linked PR and only presents CI as current when `snapshot_head_sha` equals the PR `head_sha`. A webhook ACK alone is not a check result.
- `pull_request` receipts are durably recorded by this overlay. `check_suite`, `check_run`, and `status` still use the native asynchronous refresh queue; its 202 means the refresh was queued, not that the resulting CI snapshot was written. Readback reports CI only after the native snapshot is available for the PR's current head SHA. There is no new durable per-CI-delivery receipt in this candidate.
- The authenticated TaskFlow issue API records an owner-approved, five-minute, idempotent Run approval plus an immutable `pm_approved` event. Native issue revision is checked again in the database write; an active-run unique index prevents concurrent approvals. The UI exposes this as “record approval (no dispatch/no charge)” and reads the persisted history.
- New tables are additive and TaskFlow-owned. The runtime role receives read/insert and narrow state/receipt column updates only. Migration uses a separate migrator identity. Index migrations use single atomic `CREATE INDEX` statements because the migration runner has no TaskFlow-specific invalid-index repair hook; they do not use `CONCURRENTLY`.

## Provider boundary

No official, authorized Codex Cloud dispatch/ACK/result API was available to this candidate, and no additional paid AI run was authorized. There is no provider client, provider callback route, or worker claim. Therefore approval is **not** dispatch, Provider ACK, RUNNING, or a result. `dispatch_enabled` is fixed to `false`; a Run state cannot be advanced by a GitHub comment or by a browser request. A future provider integration must add authenticated provider identity, durable CAS/claim, signed ACK/result verification, timeout/retry policy, and PM review before enabling dispatch.

## Rollback

Rollback is migration-only and fail-closed. The base migration refuses to drop any Run, event, or delivery receipt; each index rollback also refuses while evidence exists. Preserve evidence and archive it through an approved process before any destructive rollback. The application overlay can be reverted independently, but the additive tables should remain until that review is complete.

## Candidate verification boundary

- Pure approval/idempotency/identifier/webhook contract tests run in a standalone Go package so they cannot be silently skipped by the upstream handler suite's database-dependent `TestMain`.
- The PostgreSQL CI service applies these migrations as a real `taskflow_migrator` login and checks runtime grants, schema boundaries, uniqueness, append-only behavior, and guarded rollback. It does not execute the complete native HTTP webhook handler against a production-shaped TaskFlow database.
- Browser component tests exercise the approval/readback UI contract with a mocked API. They are not TaskFlow runtime, GitHub delivery, or Codex Cloud end-to-end evidence.
