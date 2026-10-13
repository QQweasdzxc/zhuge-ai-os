# Issue #42 — Supabase Connector write gate

## Decision

The current Supabase Connector cannot safely be used as a TaskFlow card writer.
The connected database session is the shared `postgres` role and has no
authenticated Zhuge user/JWT subject. The connector accepts SQL, so a PostgreSQL
function grant would not establish that a call came from the PM: the same
connection can issue unrelated SQL, bypass ordinary grants, or provide a
caller-supplied UUID. No production privilege or data change is included in this
candidate.

## Native create path and SQL limitations

TaskFlow's native `IssueService.Create` validates Project/Workspace membership,
uses the active-title duplicate lock, allocates the next workspace issue number
inside the create transaction, chooses the next top position, applies server
limits, then emits the in-process `EventIssueCreated` after commit. Listeners
create the activity record and subscriptions and dispatch realtime, notification,
plugin/automation, analytics, and assignment-related work.

A direct SQL insert, including one wrapped in a stored function, does not invoke
that in-process event bus. A function could explicitly reproduce selected rows
such as `activity_log` and `issue_subscriber`, but it still could not reliably
dispatch realtime, notifications, plugins, analytics, or assignment hooks. It
would also duplicate TaskFlow's number/limit rules and could drift from the
native transaction behavior.

## Minimum safe prerequisite

Before implementing a writer, the existing connector must expose a verifiable
non-superuser caller identity that can be restricted to one narrowly scoped
create operation. The smallest viable boundary is a dedicated connector login
with no direct table DML and execution rights only on a TaskFlow-owned,
security-reviewed create function; the function must derive/verify the PM actor
and Project membership from trusted identity, not from an arbitrary UUID
parameter. The current connector's shared `postgres` identity cannot meet this
condition. If the connector cannot authenticate as a dedicated restricted role,
the next-safe option is the existing authenticated TaskFlow API/native create
path, not SQL write access.

## QA boundary

No real write/readback test was run because this Supabase project has no isolated
database branch and the only connected SQL identity is shared `postgres`.
Testing a write against that connection would mutate Production; mocking it
would not prove the requested authorization boundary. This item remains blocked
until an isolated database and trusted restricted connector identity are
available and approved.
