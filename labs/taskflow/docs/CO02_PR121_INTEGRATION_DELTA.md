# CO-02 PR #121 Integration Delta

This manifest identifies the Agent Reporting slice for CO-01's single Native TaskFlow Authority integration. It is a source handoff, not a production enablement claim.

## Files to integrate

- `labs/taskflow/pages-client/agent-reporting-contract.mjs`: event validation, Native mutation shape, CTO completion gate, atomic adapter, protected reference attachment.
- `labs/taskflow/pages-client/agent-detail-store-contract.mjs`: server-side Protected Detail Store interface and fail-closed boundary.
- `labs/taskflow/pages-client/native-persistence-adapter-contract.mjs`: existing transaction/row-lock contract consumed by the Agent adapter.
- `tests/taskflow-agent-reporting-contract.test.mjs`: reporting, replay, fencing, completion and adapter tests.
- `tests/taskflow-agent-detail-store.test.mjs`: Detail Store scope, ACL and unwired tests.
- `labs/taskflow/docs/AGENT_REPORTING_NATIVE_ATOMIC_WRITE_CONTRACT.md`: Native Authority integration contract.

Common version projections, CO-01 SQL/handlers, and CO-03 files are excluded from the CO-02 delta. CO-01 assigns the next integration version/build and reruns exact-SHA CI after cherry-picking the unique files.

## Required server proof before enabling writes

The Native Authority must create the scope object; clients cannot submit it. It must contain a verified server principal, `authority_scope=TASKFLOW_AUTHORITY_VERIFIED`, Workspace ACL `ALLOW`, Issue ACL `ALLOW`, Issue ID, Workspace ID, Executor ID and Event ID. The Detail Store must return a provider-owned `protected_ref` only after encrypted server-side persistence succeeds.

Without those proofs, the required results are `DETAIL_STORE_UNWIRED`, `DETAIL_SCOPE_UNVERIFIED`, `NATIVE_WRITE_UNWIRED`, or `NATIVE_TRANSACTION_INTERFACE_INVALID`.

The Node-only reference is excluded from browser entrypoints by `tests/taskflow-detail-store-browser-boundary.test.mjs`. Production persistence, KMS, ACL, recovery, and atomic binding requirements are specified in `CO02_PROTECTED_DETAIL_STORE_PRODUCTION_INTERFACE.md`.

## Correlation and error matrix

| Condition | Required result |
| --- | --- |
| Issue/Workspace mismatch | `TASKFLOW_SCOPE_MISMATCH` |
| Provider Run/Session mismatch | `RUN_SESSION_MISMATCH` |
| Expired Lease or wrong Fencing | `LEASE_EXPIRED` / `FENCING_TOKEN_MISMATCH` |
| Duplicate or stale event | `EVENT_OUT_OF_ORDER` / atomic claim rejection |
| Version conflict | `PERSISTED_VERSION_CONFLICT` |
| Detail Store absent | `DETAIL_STORE_UNWIRED` / `UNWIRED_NO_REFERENCE` |
| Native transaction absent | `NATIVE_WRITE_UNWIRED` |
| Provider ACK/Run absent | `ACK_UNVERIFIED` / `PROVIDER_BLOCKED` |

No GitHub comment, TaskFlow task ID, client metadata, or synthetic Run ID satisfies these conditions.
