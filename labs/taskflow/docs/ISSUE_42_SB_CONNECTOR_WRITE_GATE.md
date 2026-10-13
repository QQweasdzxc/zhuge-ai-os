# Issue #42 — controlled TaskFlow issue operations through the SB Connector

## Candidate boundary

This is an isolated candidate, not an automatic app migration and not installed
in Production. PM has accepted the existing Supabase SQL Connector running as
`postgres` as a trusted single-operator management channel. The database
cannot prove which human requested a query made through that shared login. The
Connector is therefore an explicit operator trust boundary, not a user JWT or
per-user authorization proof. No table DML is granted to `postgres`, and no
new OAuth, API, MCP, account, or database role is introduced.

The candidate SQL is
`labs/taskflow/sql/issue42_connector_create_issue_candidate.sql`. It must be
installed by the existing `taskflow_migrator` principal after the TaskFlow
migrations are already applied. The migration identity must own schema
`taskflow` and the TaskFlow tables. The candidate refuses elevated migrator
attributes, unexpected existing function owners, or drift in the installed
function security contract.

## Function and role matrix

| Principal | Schema / table rights added by this candidate | Function execution |
| --- | --- | --- |
| `taskflow_migrator` | None; owns the ledger/functions by existing migration boundary | No Connector entry path; direct session rejected |
| `postgres` Connector | No schema or table DML; its existing schema usage/read grants remain unchanged | `EXECUTE` on the two fixed TaskFlow functions only |
| `taskflow_runtime` | No change | Explicitly revoked |
| `anon`, `authenticated`, `service_role` | No change | Explicitly revoked |
| PostgreSQL `PUBLIC` | No change to shared schema/table ACLs | Explicitly revoked on candidate functions |

Both functions are `SECURITY DEFINER`, owned by `taskflow_migrator`, and use
the fixed path `pg_catalog, taskflow, extensions, pg_temp`. Each function
checks that the immutable login is exactly `postgres` and the effective
definer is exactly `taskflow_migrator`. The table-owner identity is necessary
because the Connector has no direct DML. There are no dynamic SQL statements
or caller-selected object names.

The install transaction verifies the schema owner, function owner, definer
flag, stored search path, denied app-role grants, and Connector execute grant
before commit. `taskflow.sb_connector_issue_request` is owned by
`taskflow_migrator`; the candidate gives no Connector or runtime access to its
payloads or issue mapping.

## Create/update behavior

`taskflow.sb_connector_create_issue(...)` accepts a Project, title, description,
status, priority, optional dates, and caller-generated UUID request ID. It
derives the Workspace from the selected Project; validates an active status and
allowed priority; requires exactly one Workspace owner for attribution; and
uses that owner as creator. In one transaction it shares the native advisory
duplicate lock key, checks the normalized active-title duplicate rule scoped
to Project/root issues, increments the Workspace issue counter, picks the top
position for the Workspace/status column, inserts the Issue, creator
subscription, `created` activity row, and idempotency ledger entry.

Repeating the same request ID and exact payload returns the same Issue. The
same ID with a changed payload is rejected. Since IDs are scoped globally in
the ledger, an ID cannot be reused across create/update operations. A deleted
Issue whose request ledger entry remains is not recreated on retry.

`taskflow.sb_connector_update_issue(...)` takes the Project and Issue IDs, the
observed Issue `revision`, a complete editable snapshot, and a fresh request
ID. It rejects Project mismatch (including a different Project in the same
Workspace), cross-Workspace mismatch, inactive status, duplicate active title,
and stale revision. It uses the same native duplicate advisory key for a title
rename or activation. It records changed fields in `activity_log` and stores
the idempotency record in the same transaction. Same-request retries return
the existing Issue without a second update or duplicate activity.

This entry point derives attribution from the selected Workspace owner; it
does not accept a caller-supplied UUID. Because the Connector is a shared
trusted operator role, it cannot independently verify that the human behind a
query is the PM or that the PM has a JWT membership in the selected Project.
Production use must remain restricted to the PM-controlled Connector and a
PM-selected Project. If TaskFlow later becomes multi-user or the Connector is
shared beyond that operator, replace this trust boundary with authenticated
user-bound authorization before enabling the functions.

## Native API parity and limitations

The SQL preserves the durable records required for a TaskFlow read: Issue ID,
Project/Workspace relation, ZG-style number, status, priority, dates, position,
revision, creator, creator subscription, activity, and retry ledger. The
Workspace-row counter update serializes number allocation with the native
allocator. The integration suite tests both same-title advisory locking and
concurrent distinct-title allocation.

PostgreSQL triggers installed by TaskFlow migrations still run for the
function's inserts/updates (for example search-index, usage-dirty, and
collaboration/wakeup capture triggers). Direct SQL does not publish the
Multica in-process EventBus message. Consequently it does not immediately
broadcast websocket state or run app-side notifications, plugins, analytics,
Cloud entitlement checks, or agent dispatch. The UI may need a normal refresh
to see a Connector-created card. Agent assignment/run is intentionally outside
this function. For the current single-operator manual-card use, these are
accepted limits; use the native API if live event delivery or automation is a
requirement.

## Isolated PostgreSQL verification

The `taskflow-build-parity.yml` backend job builds the TaskFlow backend image,
then runs its actual `taskflow-migrate.sh` against an ephemeral
`pgvector/pgvector:pg17` PostgreSQL service. It applies the final candidate SQL
as `taskflow_migrator`, creates synthetic owner/Workspace/Project/status
fixtures, and executes create/update/readback, request replay, duplicate,
revision, invalid-status, same-Workspace Project mismatch, cross-Workspace
mismatch, direct-DML denial, app-role execute denial, runtime readback,
concurrent allocation, and rollback/reinstall assertions. The CI service is
disposable, uses synthetic data only, and is not connected to Supabase or
Production.

The required evidence is the `backend-image` job's full staged-migration step
and `ISSUE42_POSTGRES_INTEGRATION=PASS` output on the final Review Branch SHA.
No runtime/PostgreSQL PASS should be reported until that job completes
successfully. The test proves the function against the pinned, staged TaskFlow
schema in PostgreSQL 17; it is not a Production canary or live TaskFlow Browser
test.

## Rollback and Production canary gate

The candidate disable script is
`labs/taskflow/sql/issue42_connector_create_issue_rollback.sql`. Run it only
with a separately approved operator change as `taskflow_migrator`. It drops
the Connector functions but does not drop the ledger or delete cards,
activities, subscriptions, numbers, or other product data. A reinstallation
keeps request IDs consumed, so retries remain idempotent. Rollback does not
undo already-created card content; normal TaskFlow operations manage that data.

Before a future first Production write, PM must separately approve function
installation and one canary. The operator should first read the chosen
Workspace/Project, sole owner, active status, prefix/counter and current issue
count; record the pre-install function/schema ACL state; install using the
controlled migrator connection; verify function owner/ACL/search path and no
new table DML; create one clearly labelled card with a fresh request ID; read
back Issue, identifier, Project/Workspace, activity and subscription through
both the Connector and TaskFlow UI; retry the same request; and test a
revision-checked update. If any check fails, drop only these entry-point
functions and leave the canary row/ledger intact for an explicit UI cleanup.
No Production installation, canary, DB permission change, or deployment is
authorized by this candidate.
