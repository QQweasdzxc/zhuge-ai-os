# Issue #42 — trusted Supabase Connector issue operations

## Candidate decision

PM accepted the existing Supabase Connector as a trusted single-operator
management channel. This changes the previous implementation assessment from
"permanently blocked" to "candidate implementation permitted". It does not
turn the shared `postgres` role into proof of a human identity: the database
cannot distinguish a PM-directed call from any other use of that connector.
That is an explicit operator trust boundary accepted for this single-user
workflow. No privilege is granted to `anon`, `authenticated`, `service_role`,
or `taskflow_runtime` by this candidate.

The SQL candidate is in
`labs/taskflow/sql/issue42_connector_create_issue_candidate.sql`; the disable
script is `labs/taskflow/sql/issue42_connector_create_issue_rollback.sql`.
Neither file is an automatic migration. They are not applied to Production.

## Function contract

The install script creates two `SECURITY INVOKER` functions in `taskflow`,
revokes their default `PUBLIC` execute permission, and grants execution only to
the existing trusted `postgres` Connector role:

- `taskflow.sb_connector_create_issue(...)`
- `taskflow.sb_connector_update_issue(...)`

The create path takes a Project ID and derives the Workspace from
`taskflow.project`; it requires exactly one `owner` member in that Workspace
and attributes creation/activity to that owner. It verifies an active native
status key, a valid priority and a nonblank title. Within one transaction it
locks the Workspace counter, allocates the next `issue.number`, positions the
new card at the top of its Workspace/status column, inserts the Issue, adds the
creator subscription, records a `created` activity row and stores a request ID
plus exact payload in the idempotency ledger. Repeating the same request ID
and payload returns the same Issue; reusing that ID with another payload is
rejected.

In addition to request-key replay protection, the create path mirrors the
native active-title guard for top-level Project issues: normalized duplicate
titles in the same Project are rejected while terminal issues and items still
pending in Triage do not block a new issue. This is intentionally not a
replacement for `IssueService.Create` and does not implement its
`allow_duplicate` override.

The update path is intentionally snapshot-based: the caller first reads the
Issue and supplies all editable fields and the observed `revision`. Stale
revisions fail with a conflict instead of overwriting newer state. The update
repositions a status move and writes native-shaped activity rows for changed
title, description, status, priority and dates. It uses the same request ledger
for idempotent retries. Readback uses the existing `taskflow.issue` and
`taskflow.project` tables.

The SQL scopes every application relation to `taskflow` and fixes the function
search path. The Connector calls as the existing privileged `postgres` role,
so `SECURITY INVOKER` is sufficient and avoids introducing an unnecessary
RLS-bypassing definer context. The Connector already has broad privileges as
`postgres`; this SQL does not extend those privileges. Consequently, the
function is an operationally controlled entry point, not a defense against
misuse of the trusted Connector.

## Native EventBus difference

The candidate covers the minimum durable records needed for TaskFlow to read
and display a created/updated card:

- issue identity, Workspace/Project association, native status, position and
  sequential issue number;
- creator attribution and creator subscription;
- activity-log entries;
- exact request idempotency and revision-checked updates.

Direct SQL does **not** publish Multica's in-process EventBus events. It cannot
trigger websocket broadcasts, notification delivery, plugin/automation hooks,
analytics, Cloud entitlement checks, agent assignment dispatch, or other
listeners. Therefore the safe first candidate excludes agent assignment and
may require a TaskFlow refresh before the card appears. These effects can be
deferred for the PM's single-operator manual card workflow; if immediate live
updates or automations become required, the native API is the correct write
path.

## Isolated SQL exercise and first Production write

There is no isolated Supabase database available to this candidate, so no live
TaskFlow-schema write/readback was attempted. No Production data or privileges
were modified.
The candidate SQL was applied to a local PostgreSQL 17 container isolated with
`--network none` and a synthetic schema containing two Projects in one
Workspace, one owner, native status rows, and the relevant TaskFlow table
columns/constraints. That exercise verified: two Projects each received a
different sequential `ZG-*` issue; identical request replay returned the same
Issue; a changed payload under that key and a normalized active duplicate were
rejected; update replay returned the same Issue; a stale revision update was
rejected; durable activity rows were written; and the function ACL allowed
only `postgres` among `postgres`,
`anon`, `authenticated`, and `taskflow_runtime`. The synthetic SQL exercise
did not test Project-mismatch rejection, and no real TaskFlow or live Supabase
schema was available. Source contract checks verify the Project predicate, but
do not replace that runtime case or prove the SQL against the live TaskFlow
schema and Connector execution context.

Before the first Production write, a PM-approved one-card canary must:

1. Read the selected Project/Workspace, sole owner member, current prefix and
   counter, active status, and current Issue count without changing data.
2. Install the SQL as a separately reviewed operator change (not app startup
   migration), verify the function ACL, `SECURITY INVOKER`, fixed search path
   and `postgres` ownership, and confirm no API role gained execute or table
   privileges.
3. Call create with a fresh UUID request key and a clearly marked canary title
   in a PM-selected Project; read back the returned Issue ID, ZG identifier,
   Project, Workspace, status, activity and subscription through the Connector.
4. Refresh TaskFlow and verify the native card. Retry the exact same request and
   verify the same Issue is returned; try a different payload under that key
   and verify it is rejected.
5. Read the card, use the returned revision for one controlled update, read it
   back, repeat that update request, and verify no duplicate activity/change.
6. Test a non-member Project through the function's derived owner/project
   checks and verify rejection. The function itself does not accept a caller
   UUID, so it cannot be made to impersonate an arbitrary UUID.

Rollback revokes the two `postgres` execute grants and drops the functions.
Keep the idempotency ledger (a request-ID tombstone) and keep any already
created card unless the PM separately requests its deletion through TaskFlow.

**Approval required:** Production SQL installation and the one-card Production
canary are separate from this candidate coding GO. No Production write is
authorized by this document.
