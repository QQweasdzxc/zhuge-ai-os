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
- Fresh cache: 15s. With the DB reachable, an explicit Off takes effect within 15s of the next request (websocket: next message or <= 54s ping tick, plus 15s).
- Outage grace: only a previously ALLOWED answer younger than 60s survives a failed lookup (2s timeout). This is a deliberate availability tradeoff, not immediate revocation.
  Never-seen, denied, expired, or no-lookup-wired = denied. After 60s of lookup outage every id is denied, including the creator (TF shares the same Postgres, so this is also a TF outage).
- Dormant unless env TASKFLOW_APP_ACCESS_ENFORCE=on. Deploying the code alone changes nothing.

## Verification done locally
Full vendored patch chain (all Dockerfile source-stage RUN steps, including this patch) applied to a copy; `go build ./cmd/server` OK; `go test ./internal/auth` OK (includes 8 new tests); `go vet ./internal/realtime ./cmd/server` OK.
Not verified: real DB grant/function, deployed Render behaviour, websocket close end-to-end.

## Rollout / rollback
1. Merge (held). 2. Apply the SQL draft via the dashboard editor with hash check. 3. Render env TASKFLOW_APP_ACCESS_ENFORCE=on only at the activation decision (before activate_app_access_model). Rollback: set env to off (restart); the SQL function can stay.
