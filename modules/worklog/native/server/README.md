# WorkLog Google sync worker candidate

Private source, not activated. This runs in the original WorkLog Supabase
function boundary, NOT as taskflow_runtime. No new TaskFlow role privileges,
public-table proxy through the TaskFlow API, project timers or task-time fields.

## Implemented paths

- Native Calendar button starts narrowly scoped, offline Google consent using
  its own fresh PKCE session. That newly minted session is handed to the worker,
  not also persisted/refreshed by the browser. Existing browser/Office sessions
  are not copied. Normal WorkLog connection stays separate.
- HTTP checks a fixed origin allowlist, Supabase owner and original APPROVED
  application access. It refreshes and verifies the fresh worker session,
  checks Google verified identity against that owner and verifies the configured
  named calendar's write access before connecting.
- Credential envelope is AES-256-GCM with owner-bound authenticated data.
  Only private worker configuration supplies the key. Browsers cannot read
  credentials or raw binding tables. No refresh credentials in status responses.
- Owner/calendar durable mappings; deterministic operation and event IDs;
  worker leases serialize credential refresh and cursor updates. Connection
  replacement/disconnection is blocked during an active worker lease.
- Full source pipeline invokes the original owner-RLS WorklogService, including
  original app-access checks and actual row/model/ECP shape. Admin credentials
  only touch private sync metadata and verify identity; work-entry writes use
  the worker-owned user's original session. Existing source CHECK permits
  manual/ai-card/migrated, so Google-entered records use manual with Google
  provenance kept in the mapping, not an invalid source enum.
- Incremental Google cursor only advances after every import/export succeeds.
  Stable IDs replay successful operations after partial failures. Initial
  baseline does not backfill events older than activation. Ordinary sequential
  edits use source update timestamps; unreadable/identical version ordering
  fails rather than inventing a winner. Cross-midnight hand entry stays exact.
- TF saves invoke one bounded sync cycle if connected; worker scheduler endpoint
  supports off-page cycles with a separate private scheduler bearer. No cron
  registration, public deployment or event write has been performed.

## Deliberately not activated or claimed verified

Source-only SQL is `storage-candidate.sql`, outside auto migrations. It was
executed against an isolated PostgreSQL-compatible PGlite test database, not the
real Supabase project. Real migration/deployment, provider refresh configuration,
function bundling/deployment, actual OAuth consent and Google mutation are still
acceptance gates. Scheduler registration and its user-visible cadence are not
set. An expired Google cursor is recovered by a bounded full scan that keeps
existing mappings, processes known bindings/recent changes, skips old unbound
history and never deletes local records. Deletion cascade and recurring/all-day
conversion are not implemented. Disconnect stops sync and removes encrypted
credentials, but does not delete existing work rows, events or their mappings.

Server configuration names (secret values never belong in source):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `WORKLOG_SYNC_ENCRYPTION_KEY`,
`WORKLOG_GOOGLE_CALENDAR_ID`, `WORKLOG_SYNC_ALLOWED_ORIGINS`,
`WORKLOG_SYNC_SCHEDULER_SECRET`, `WORKLOG_GOOGLE_SYNC_ENABLED=true`.
The calendar ID is deployment-configured; the user sees its name, not an ID form.

Browser build names: `NEXT_PUBLIC_TASKFLOW_WORKLOG_ENABLED`,
`NEXT_PUBLIC_TASKFLOW_WORKLOG_SUPABASE_URL`,
`NEXT_PUBLIC_TASKFLOW_WORKLOG_ANON_KEY`,
`NEXT_PUBLIC_TASKFLOW_WORKLOG_CALENDAR_ENABLED`. Both flags default off. Exact
callback is the TF origin's `/auth/worklog`, pending allowed-redirect setup.

Run Node tests with `npm run test:worklog`. The full synthetic pipeline uses
actual runtime, Google provider, durable store and original WorklogService,
while intercepting external HTTP and using synthetic rows. It verifies Google
new/edit, TF new/edit, record identities, binding count, original source enum
and private-note exclusion. This is not production-account acceptance.

`../../tests/worklog-server` has a separately locked SQL/bundle harness. Run `npm ci`, `npm run test:sql` and `npm run test:bundle`;
it checks SQL execution, lease/lifecycle behavior and denies anon,
authenticated and taskflow_runtime access. No test dependencies go into the
native production bundle.

Current provider contract evidence, fetched 2026-11-11:
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://developers.google.com/workspace/calendar/api/v3/reference/events/patch

PATCH deliberately sends only work title/start/end, with no description,
attendee, private-note, recurrence or extended-property overwrite.

## Push delivery and safety reconciliation

The source implements Events watch for the single deployment-configured calendar.
`WORKLOG_SYNC_WEBHOOK_URL` must be the worker's own HTTPS URL with `?push=1`.
New channel IDs and random nonces are generated per watch; only nonce hashes,
resource IDs and expiration are kept in private owner-bound metadata. The public
receiver requires matching channel/resource/nonce, rejects expired channels, and
atomically ignores old/duplicate notification numbers. No event body is trusted.
Google's initial `sync` notification is safely ignored. New connections start a
bounded worker run; push events invoke the same leased incremental sync.

An hourly server-side safety run covers lost notifications and renews watches
when less than 24 hours remain (seven-day requested TTL). It is API traffic, not
logged-in website polling. New channel state is durable before stopping the old
one. A failed initial watch persistence attempts to stop the orphan. Disconnect
stops the channel first when possible, removes credentials and channel metadata,
and leaves work rows, events and bindings alone. If Google credentials are
already revoked, local disconnect still succeeds; an old provider channel may
send body-free notifications until expiration, but the receiver ignores them.
The receiver uses the edge platform background-task lifetime, not a browser timer.

Deploy configuration must disable the platform's outer JWT verifier only for
this function, since Google's push has no Supabase JWT. The existing owner API
continues to verify its own bearer, owner UUID and APPROVED access; scheduled runs
require the separate scheduler bearer and no Origin. No other function changes.

Reference: https://developers.google.com/workspace/calendar/api/guides/push
Reference: https://developers.google.com/workspace/calendar/api/v3/reference/events/watch
