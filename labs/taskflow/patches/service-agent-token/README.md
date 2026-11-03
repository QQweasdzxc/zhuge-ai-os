TaskFlow Service Agent Token overlay
===================================

Apply `apply-taskflow-service-agent-token.py --root <disposable-multica-copy>`.
The script refuses frozen vendor paths, reapplication, missing/ambiguous anchors
and destination collisions; it validates all changes before writing any file.
Docker installs it after the existing identity/CLI patches. No native vendor
file or production migration runner is changed in the repository.

SQL files are **review candidates**, never automatically applied in production:

- `taskflow_service_agent_tokens_candidate.sql`: run as the non-elevated
  `taskflow_migrator`, followed by its matching postflight. All migration paths
  embed the existing role guard. Runtime receives SELECT/INSERT/UPDATE only.
- `taskflow_service_agent_tokens_rollback.sql`: refuses any nonempty token table,
  including revoked history. There is no cascading drop or history deletion.
- `taskflow_instinct01_service_agent_candidate.sql`: separately pending review.
  A reviewed session must set `taskflow.review_instinct01='approved'`. This is a
  review interlock, not authorization. Fixed audience, unsafe trigger-state and
  collision guards still apply. It never adopts or overwrites an existing agent.

Native Multica uses singular `agent` and `member` table names. INSTINCT-01 has
NULL runtime_id, empty runtime_config, private permission/visibility and offline
status: service-only / 無執行時. The native `runtime_mode='cloud'` storage enum
does not bind or start a runtime. Registration never mints a token.

Human workspace owners manage credentials only for agents they own (including
private agents). Other owners cannot list, mint or revoke those credentials.
An agent ownership transfer immediately invalidates its previous owner's SATs.

Credential endpoints:

- POST `/api/agents/{agentId}/service-tokens`, JSON `{"name":"assistant"}`;
  optional RFC3339 `expires_at` must be future and within 90 days. Response 201
  returns metadata plus `token` once and uses `Cache-Control: no-store`.
- GET the same path returns metadata only, without plaintext or token_hash.
- DELETE `/api/agents/{agentId}/service-tokens/{tokenId}` sets revoked_at, 204.

Each issuance/revocation transacts with the existing activity_log. Audit failure
rolls back the mutation. Audit details contain token/agent IDs, never secrets.
Secrets contain 256 random bits; storage uses the existing auth.HashToken.
Authentication is deliberately uncached. Unknown/revoked/expired tokens and DB
lookup failures return 401; missing creator membership or archived/missing agents
also fail closed. In-flight requests admitted before revocation can finish.
last_used_at records credential validation even if a later scope/handler denies.

Explicit SAT method/path allowlist, always bound to one workspace:

- GET `/api/issues`, `/api/issues/search`, `/api/issues/{uuid}`.
- POST `/api/issues` (create only) so service-agent cards carry true agent
  attribution; deletion, moving, batch mutations and broad edits stay denied.
- GET `/api/issues/{uuid}/comments`, `/timeline`, `/attachments`.
- POST `/api/issues/{uuid}/comments` with native comment validation/permissions.
- PUT `/api/issues/{uuid}` with only `status` and optional `expected_revision`.
- POST `/api/upload-file`, multipart with a bound-workspace issue_id. User, chat
  and task uploads are denied; the native handler checks optional comment linkage.
- GET/DELETE `/api/attachments/{uuid}` and GET its `/content` or `/download`,
  only for issue attachments without chat bindings. Native ownership checks remain.

Everything else returns 403, including human/account routes, credential/runtime
management, issue deletion/moving, batch mutations and broad issue edits.
Conflicting workspace selectors, including duplicate query values, are rejected.
Entity ownership is checked even if the human belongs to both workspaces.
Auth strips forged identity/source/task headers and stamps creator, agent and
workspace. Workspace resolution retains the binding; resolveActor attributes
writes/events to that agent; RequireHumanActor rejects SAT just like mat_/mcn_.

Verification:

- `python3 -m pytest labs/taskflow/tests/test_service_agent_token_patch.py`
  (also runs under existing unittest discovery).
- `python3 labs/taskflow/tests/service_agent_token_postgres.py <disposable-pg16-container>`.
- The backend full parity profile runs nine PostgreSQL Go contracts in a separate
  taskflow_sat_parity database and requires nine actual PASS results. Contracts
  cover the six required security scenarios, lifecycle/hash/metadata/audit,
  owner/expiry restrictions and injected audit-failure rollback.
- The existing final-router Go contract checks all three production routes.

No production migration, registration, deployment or main push is implied by
source changes or test success.
