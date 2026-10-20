# TaskFlow Runtime Readback (Review Candidate)

`GET /api/issues/{id}/dispatch-runtime` is a TaskFlow-owned, read-only
boundary for the dispatch workbench. It is protected by the same native
session, workspace selection, membership check, and issue access check as the
native issue/task routes. The request has no authority, ACK, Run ID, or
`VERIFIED` input fields.

The response is a projection of server-side native TaskFlow task rows. It is
not a Provider event. Until an authenticated Provider event or official native
Provider readback is persisted, the response intentionally uses:

- `provider_binding: NOT_BOUND`
- `authorization: UNVERIFIED`
- `evidence.provider_ack: UNVERIFIED`
- `provider_run_id_source: NOT_AVAILABLE`

Therefore a native `running` task is returned as `state: UNKNOWN`; it is never
promoted to `RUNNING` by the endpoint. Durable terminal states (`DONE`,
`FAILED`, `CANCELLED`) and `ACK_PENDING` are safe to expose from native
TaskFlow rows. Cross-workspace and unauthenticated requests are rejected by
the existing native issue access path.

The frontend must use this endpoint as the only runtime source for the
workbench. Issue metadata, GitHub CI, HTTP 202 responses, and client-supplied
runtime-shaped JSON are display context only and cannot establish Provider
execution.
