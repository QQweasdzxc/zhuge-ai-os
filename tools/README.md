# Controlled Engineering Tool Path

`engineering-transition.js` is a server/tool-side adapter for the approved
`board_transition_task` and `board_update_checklist_item` RPCs. It is not browser code and must not be bundled by
GitHub Pages or any module. `engineering-actor-broker.js` only issues short-lived
Co/GPT actor tokens; it never calls Supabase or writes Board data.

The tool requires these environment variables in a protected execution
environment:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
ENGINEERING_ACTOR_TOKEN=<short-lived protected token>
ENGINEERING_ACTOR_PRIVATE_JWK=<protected broker-only P-256 private JWK>
```

The Supabase service-role key remains only in the Edge Function runtime. It is
never placed in source, ZIP artifacts, HTML, JavaScript served to browsers, or
this tool's environment.

On the protected macOS Engineering Runtime, the rotated private JWK is held in
Keychain under the service `zhuge-ai-os-engineering-actor-private-jwk` and is
loaded only into the broker process environment. It must never be echoed,
written to a file, committed, or pasted into chat:

```bash
ENGINEERING_ACTOR_PRIVATE_JWK="$(security find-generic-password \
  -a co-gpt-broker \
  -s zhuge-ai-os-engineering-actor-private-jwk \
  -w)" \
node tools/engineering-actor-broker.js issue --actor Co
```

## Actor token issuance (protected broker runtime)

```bash
ENGINEERING_ACTOR_PRIVATE_JWK='…' node tools/engineering-actor-broker.js issue --actor Co
```

The token is short-lived (maximum five minutes), scoped to `board:transition`,
and must never be placed in browser code, a ZIP, source control, or chat.

## Trusted Engineering Memory read path

For a new Zhuge AI OS engineering Co, issue a separate read-only capability
from the protected broker and use the Startup Gate consumer:

```bash
ENGINEERING_ACTOR_PRIVATE_JWK="$(security find-generic-password \
  -a co-gpt-broker \
  -s zhuge-ai-os-engineering-actor-private-jwk \
  -w)" \
node tools/engineering-actor-broker.js issue --actor Co --profile memory-read

SUPABASE_URL=https://<project-ref>.supabase.co \
ENGINEERING_ACTOR_TOKEN=<short-lived-read-token> \
node tools/engineering-memory-startup-gate.js
```

The `memory-read` profile is scoped to `engineering-memory:read` and is
accepted only for the `startup_gate` operation. It cannot inspect, transition,
or update Board work. The consumer has no Supabase write credential and is not
an anonymous or browser access path.

## Read-only inspection

```bash
node tools/engineering-transition.js inspect --task TASK-001
```

## Dry-run validation

Omit `--confirm` to validate the current status and approved transition without
writing to Supabase:

```bash
node tools/engineering-transition.js transition \
  --task TASK-001 \
  --actor Co \
  --expected-status ready \
  --target-status inprogress \
  --target-assignee Co
```

## Controlled write

Only run this from the protected Engineering Tool environment:

```bash
node tools/engineering-transition.js transition \
  --task TASK-001 \
  --actor Co \
  --expected-status ready \
  --target-status inprogress \
  --target-assignee Co \
  --confirm
```

## Controlled Checklist Evidence

Co/GPT may update only their own checklist stage through the same protected
Edge Function. A verified state requires an evidence note or reference; the
RPC writes the checklist row and its audit entry atomically.

```bash
node tools/engineering-transition.js checklist \
  --task TASK-001 \
  --actor Co \
  --item-key developer-qa \
  --state pass \
  --evidence-note 'Developer QA: 87 passed, 0 failed' \
  --evidence-ref 'commit:bd3768435056c0080849b7ef0eb2059c1da2b834' \
  --confirm
```

The caller still uses only a short-lived actor token. The service-role key is
held exclusively by the Edge Function runtime, and checklist writes never use
direct client DML.

The database RPC remains the authority for transition validation, RLS boundary,
Status/Assignee update, and `engineering_activity_log` audit. Direct DML and
anonymous CRUD are not supported.

## PM-authorized Governance Write

Governance writes require two separate capabilities:

1. An authenticated QJC / PM owner issues a one-time, short-lived,
   payload-bound authorization through
   `issue_engineering_governance_authorization(jsonb)`.
2. GPT uses that opaque authorization together with a short-lived
   `governance-write` actor token from the protected broker.

The Edge Function accepts only `governance_write`, and the database executor
allowlists `create_task_contract`, `update_task_contract`, and `update_checkpoint`. The executor rechecks
the PM authorization, payload binding, expiry, single-use state, actor label,
and service-role server path before calling the existing controlled RPCs.

Example protected GPT invocation:

```bash
ENGINEERING_ACTOR_PRIVATE_JWK="$(security find-generic-password \
  -a co-gpt-broker \
  -s zhuge-ai-os-engineering-actor-private-jwk \
  -w)" \
node tools/engineering-actor-broker.js issue --actor GPT --profile governance-write

SUPABASE_URL=https://<project-ref>.supabase.co \
ENGINEERING_ACTOR_TOKEN=<short-lived-governance-token> \
PM_AUTHORIZATION_TOKEN=<one-time-pm-authorization-token> \
node tools/engineering-governance-write.js write \
  --operation update_checkpoint \
  --payload '{"checkpoint_key":"current", "current_task":"..."}'
```

The PM authorization token is not a GPT identity and cannot be created by the
GPT broker. Approved Principle maintenance, arbitrary SQL, direct DML, PM
Accepted Baseline writes, and Artifact writes are outside this first-phase
allowlist.

## PM Governance Approval Runner

`pm-governance-approval.js` is a localhost-only operational bridge for the
same allowlisted Governance Write path. It is not a second Authorization or
Governance system. A protected engineering workflow supplies one immutable
action manifest; PM/QJC only reviews the rendered action and chooses approve or
reject in the local page.

```bash
node tools/pm-governance-approval.js start \
  --action-file /protected/path/governance-action.json \
  --port 8765 \
  --open
```

The runner binds only to `127.0.0.1`, performs the existing Supabase Google
OAuth/PKCE login, keeps the authenticated session in memory, and then uses:

1. `issue_engineering_governance_authorization(jsonb)` with the authenticated
   PM/QJC session;
2. `engineering-actor-broker.js` with the protected GPT governance-write
   profile;
3. `engineering-governance-write.js` and the existing
   `engineering-transition` Edge Function; and
4. an authenticated read-back of the affected canonical record.

The browser never receives an authorization capability, actor capability,
JWK, service credential, or action payload JSON. The action is immutable for
the runner process; reject/cancel and a second approval attempt do not execute
a write. Capability values exist only in the local process memory and are
cleared after the attempt. The runner does not log request bodies or secrets.

### One-time local redirect setup

Before the first local run, PM/QJC must add the exact callback URL to the
existing Supabase Auth redirect allow-list:

```text
http://127.0.0.1:8765/auth/callback
```

No Google OAuth provider callback or Production URL is replaced. If a different
port is used, add that exact `127.0.0.1` URL and use the same port for the
runner. `SUPABASE_URL`/`ZHUGE_SUPABASE_URL` and
`ENGINEERING_GOVERNANCE_WRITE_URL` are resolved from protected environment
values when present; the existing checked-in URL/anon configuration is only a
public fallback. The Engineering Actor private JWK is loaded at approval time
from the protected environment or the existing macOS Keychain entry and is
never written to a file.
