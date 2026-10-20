# CO-02｜PHASE2-RUNTIME Status Handoff

這份交接對應 PR #107 之後的獨立 Review 工作線。它只包含 Backend、Runtime、
Provider security contract 和 Native API adapter 的增量；不修改 CO-01 的整合分支、
CO-03 的 PR #103 或正式 TaskFlow DB／Secrets。

## Base and source delta

- Base: PR #107，`80f61c9ce8ba6f52659dbbec5f3ab9749df0e720`
- Scope: Native transaction audit／writer fencing hardening、Provider callback binding
  gate、受控 Native `/dispatch` client adapter、negative tests
- Formal runtime status: `UNVERIFIED`／`BLOCKED` where no approved binding or credential
  exists. No Provider was called and no Run ID was generated.

### New integration files

- [`native-persistence-adapter-contract.mjs`](../pages-client/native-persistence-adapter-contract.mjs)
  now validates record identity, single version advancement, fencing epoch monotonicity,
  active writer immutability and transaction evidence. Normal event audit is read from the
  native record; precondition／rollback audit can use an explicitly injected review sink.
- [`provider-adapter-contract.mjs`](../pages-client/provider-adapter-contract.mjs) exports
  `buildProviderCallbackAcceptanceDecision`. The gate binds official callback evidence to
  the persisted authority, workspace, issue, native task and idempotency key, rejects replay,
  signature failure and TaskFlow-task-as-Run-ID confusion, and keeps capability-specific
  heartbeat／checkpoint／quota／resume paths fail-closed.
- [`taskflow-api.mjs`](../pages-client/taskflow-api.mjs) exports
  `buildNativeCTODispatchBody` and `requestCTODispatch`. It sends only `{task_id?,
  executor_id, provider}` to the existing `POST /api/issues/{id}/dispatch` candidate;
  client CTO labels and authority metadata are rejected before transport. Server-side
  authorization remains mandatory.
- [`runtime-read-model-projector.mjs`](../pages-client/runtime-read-model-projector.mjs)
  now exposes the read-only Workbench envelope. It binds the native Issue ID and
  workspace to the durable record, runtime read model, native task readback and native
  GitHub readback without creating another task store. The checked-in contract is
  [`DM00_DM03_PHASE2_RUNTIME_WORKBENCH_SCHEMA.json`](./DM00_DM03_PHASE2_RUNTIME_WORKBENCH_SCHEMA.json).
- Provider permission, credential, callback, quota and cost prerequisites are recorded in
  [`DM00_DM03_PHASE2_PROVIDER_DECISION_MATRIX.md`](./DM00_DM03_PHASE2_PROVIDER_DECISION_MATRIX.md).

## Native API contract for CO-01

The existing authenticated TaskFlow transport is the only API client. It exchanges the
Zhuge session at `/auth/zhuge`, keeps the TaskFlow bearer in memory, and sends the workspace
through `X-Workspace-Slug`.

| Operation | Native endpoint | Evidence rule |
| --- | --- | --- |
| Read issue/intake | `GET /api/issues`, `GET /api/issues/{id}` | Native issue only; GitHub Issue is not a TaskFlow card |
| Create/update card | `POST /api/issues`, `PUT /api/issues/{id}` | Existing TaskFlow Auth and workspace ACL |
| Dispatch candidate | `POST /api/issues/{id}/dispatch` | Backend must resolve authenticated CTO and protected allowlist; client metadata cannot authorize |
| Native task readback | `GET /api/issues/{id}/task-runs` | Native `task_id` only; never a Provider Run ID |
| Metadata evidence | `GET /api/issues/{id}/metadata` | `zhuge_*` values are readback/evidence, not authority |
| GitHub evidence | `GET /api/issues/{id}/pull-requests` | PR, exact SHA and CI remain evidence; they cannot create ACK/Run |

The canonical read model remains
[`DM00_DM03_PHASE2_RUNTIME_SCHEMA.json`](./DM00_DM03_PHASE2_RUNTIME_SCHEMA.json).
`provider_run_id` is `null` until an official, signed and identity-bound Provider callback
or native Provider readback is accepted.

## Security and persistence evidence

The Review tests cover:

- concurrent native row-lock mutations and persisted version conflict;
- independent process identities, fixed issue→task lock order, commit failure rollback,
  restart recovery and process-scoped transaction evidence;
- replay with no second write;
- restart lease expiry and explicit reassignment review;
- stale fencing token rejection and active-writer rewrite rejection;
- reducer rollback and audit evidence for rejected events;
- missing CTO authority, wrong workspace, unknown executor, provider mismatch and forged
  client authority fields;
- callback signature, identity binding, replay, Run ID collision, heartbeat/checkpoint/quota
  capability gates, duplicate ACK, stale heartbeat, wrong Run ID and retry source binding;
- Native Issue → Dispatch Intent → Runtime Read Model → Workbench identity and schema
  validation.

The injected transaction fake proves the contract only. Formal native DB transaction
injection, cross-process lock readback, CTO allowlist provisioning and audit persistence
remain external gates.

## CO-01 handoff and blocked gates

CO-01 may review the source delta and consume the Native read model immediately. The new
client adapter is safe to call only after the target backend has the route overlay and a
formally provisioned CTO allowlist. Without that configuration the expected response is
fail-closed (`503` for unavailable authority or `403` for an authenticated denial).

Still blocked:

1. Formal CTO allowlist and native mutation readback: requires CTO/PM-approved deployment
   configuration and the existing TaskFlow authority.
2. Native DB adapter enablement and write: requires the designated TaskFlow DB transaction
   implementation; no new dispatch database is permitted.
3. Codex Cloud/Gemini credentials and provider binding: requires CTO authorization, secret
   scope and any PM fee approval. No paid Provider was started.
4. Official callback/Run/heartbeat/checkpoint evidence: requires the Provider-supported
   endpoint, signature verification and server-side TaskFlow identity mapping.

No formal ACL, Secret, Production DB or paid Provider operation was performed by this
Review branch.
