# WorkLog worker v11 deployment record

Exact uploaded single-file bundle is `index.ts`. SHA-256 is recorded in
`deployment.json`, alongside the distinct platform bundle hash read back after
deployment. Source commit is the qualified native candidate, not a main merge.

The same existing function was updated after the private conflict table was
created. No Google OAuth settings, calendar selection, credentials, scheduler,
API deployment or automatic-deploy settings were changed by this update.
Owner-authenticated status and conflict reads returned HTTP 200 after deploy;
status remained connected and no conflict was present. These reads do not prove
Google push delivery or full two-way live-edit acceptance.

Added owner-only durable conflict review, guarded version choices and deletion
race protection. Public owner API still verifies bearer and approved access
within the function; only its outer platform JWT check remains disabled so
Google notifications can reach the nonce-verified push receiver.

Original scope excludes deletion cascade, historical backfill and recurring or
all-day event conversion. No real or synthetic work record was edited for this
deployment check.
