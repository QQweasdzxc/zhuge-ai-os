# ZG-71 TaskFlow App access enforcement (dormant until enabled)

Code: labs/taskflow/overrides/taskflow_app_access{,_test,_lookup}.go, labs/taskflow/patches/apply-taskflow-app-access.py,
Dockerfile.backend (patch step in the source stage, go test in the builder stage), overrides/zhuge_auth.go (login gate).
SQL (NOT applied, needs explicit go): taskflow_app_access_decision.sql.draft.

## Mechanism
The vendored server already routes every id-based "account disabled" decision through auth.IsTemporarilyDisabledUserID.
The patch adds IsAppAccessDeniedUserID there, so these paths now ask the same resolver as the Supabase gates:
Auth middleware (JWT, PAT, PAT cache hit, cloud PAT, mat_ task token, CLI code), DaemonAuth JWT/PAT/cloud PAT,
session renewal (auth/session.go), ZhugeIssueCliToken, service-agent-token (by CreatedBy), websocket connect, and ZhugeLogin (new login).
Ownerless daemon tokens (mdt_, workspace/daemon scoped) carry no user and are unchanged.
Open websockets: inbound frames never re-enter auth, so writePump now rechecks before each outbound message and on every ping tick (<= 54s idle).
No creator bypass: the DB refuses to switch a creator or oneself Off (set_app_access_user_enabled, 42501).

## Policy (two separate numbers)
- Fresh cache: 15s. Grace: a previously ALLOWED answer younger than 60s survives a failed lookup (2s query timeout). Never-seen, denied, expired, or no lookup wired = denied. Not instant-Off.
- Dormant unless env TASKFLOW_APP_ACCESS_ENFORCE=on. Deploying the code alone changes nothing.

## Bounds. MEASURED (isolated PG + real hub + websocket) vs DERIVED worst cases
Measured: active traffic (push every 0.5s) Off -> close 13.0s; idle Off -> close 54.05s (one ping tick); DB stopped with traffic -> close 57.0s after the stop; reconnect as Off user refused at auth.
Derived (not measured):
- A check must deny once the last good answer is >60s old (+2s if the DB hangs). That is when an attempted check denies, not when a socket closes.
- Active socket, DB up: <= 15s + message interval (+2s slow DB).
- Idle socket, DB up: next 54s tick, worst case ~69s (+2s): a cache refresh within 15s before a tick can mask an Off set after it until the following tick.
- Idle socket, DB outage: the tick at +54s still sits inside the 60s grace; the next tick at +108s after the last good answer is the first that denies, so worst case ~110s (+2s). Active socket in an outage: <= 62s.
- HTTP requests (non-websocket) are checked per request, so they deny as soon as the rules above say so.

## Verification (committed harness: docs/zg71/tf-enforcement-proposal/verify/, CI: .github/workflows/zg71-tf-access-enforcement.yml)
Commands: `docs/zg71/tf-enforcement-proposal/verify/run.sh <patched source root, e.g. /tmp/taskflow-source/src> <postgres bin dir> "scenario active idle outage"`.
The harness builds the SQL chain in a throwaway Postgres, adds the decision function and a taskflow_runtime role, asserts grants/resolver/creator protection, then runs the real websocket tests against the patched server package.

### Done locally earlier
Full vendored patch chain (all Dockerfile source-stage RUN steps, including this patch) applied to a copy; `go build ./cmd/server` OK; `go test ./internal/auth` OK (includes 8 new tests); `go vet ./internal/realtime ./cmd/server` OK.
Not verified: real DB grant/function, deployed Render behaviour, websocket close end-to-end.

## Rollout / rollback
1. Merge (held). 2. Apply the SQL draft via the dashboard editor with hash check. 3. Render env TASKFLOW_APP_ACCESS_ENFORCE=on only at the activation decision (before activate_app_access_model). Rollback: set env to off (restart); the SQL function can stay.
