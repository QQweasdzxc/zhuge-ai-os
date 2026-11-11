# TQ6 native WorkLog integration candidate

Private reversible preparation, not a deployed release. Base canonical main
7390d1f0. Current production icon fixes are pinned separately. Do not deploy this
main-based candidate over those pins, restore AutoDeploy or activate PR247.

## Native functionality

Native workspace route and sidebar immediately below Office; three-panel
calendar/hours/suggestions with day/week/month/year views; original models,
aliases, custom defaults, disabled history, source references, actual records
and ECP tasks; stable add/edit/soft-delete/batch and response-lost retries;
original 15-column Excel generation, original owner/department and no notes.
Fixed work/lunch times assist automatic suggestions, without settings controls
or rejecting explicit lunch/cross-midnight times. All data operations retain
original owner-RLS and original application-access check. No migrations run
while loading a page. Local-only old-browser merge/ignore decisions remain
at their original origin; no claim they have crossed origins. Existing library
entry is retained, not replaced by an empty new knowledge system.

Official 2026/2027 holiday assets retain source provenance. The fixed-source
suspension route has freshness and unavailable states, never synthesizes work,
attendance or ECP rows. Sources: https://data.gov.tw/dataset/14718 and
https://www.dgpa.gov.tw/typh/daily/nds.html .

## Selected calendar semantics

TF and the designated WorkLog calendar are two entry points for the same actual
records, including Google-side new events. No pre-existing TF binding or second
actual-work proof. Normal sequential changes update the same record; other
calendars are excluded. Original storage validation failures are explicit, not
silent success. All-day/recurrence conversion, historical backfill and deletion
cascade are not silently added.

When both entry points changed the same record and version order cannot prove
which is newer (equal or missing timestamps), the cycle records a durable
owner-only conflict with both sides' comparable fields (title/date/start/hours
and version stamps; never notes or credentials), keeps both originals, records
the failure and retains the cursor. The owner reviews the two versions in the
worklog page and picks one: keep-TF writes the event with the reviewed If-Match
etag, keep-calendar saves the entry with the original updated_at conditional
write. Any version drift since review aborts with CONFLICT_CHANGED and nothing
is written. A later decidable plan supersedes and clears a pending conflict
without asking; missing event etag still stops as STALE.

## Worker implementation, not production activation

The native Calendar button, scoped PKCE callback, encrypted worker connection,
owner-only durable mapping/leases, Google provider, incremental cursor and
bounded owner cycle are now source-wired. Native saves can request one cycle;
a separate authenticated scheduler endpoint handles off-page cycles. Worker
runs under original WorkLog ownership using its independently minted user
session, not TaskFlow's runtime role. New credential metadata remains private
and encrypted. No Office/browser refresh session is copied to another refresher.
Full details and activation/config checks: `server/README.md`.

Browser flags default off in source and Docker build. The exact callback is
`/auth/worklog` on the chosen TF origin. The currently checked Supabase allowlist
lacks TF; it has NOT been edited. No production schema, secret, scheduled job,
Google event, public source, deploy or auth setting was changed.

## Verification at 2026-11-11 16:54 Asia/Taipei

- 65 Node tests: original service/rules/holiday/auth, provider, coordinator,
  cursor/lease cycles, credential envelope, owner HTTP boundary, real runtime
  connection, durable identities and full actual-module synthetic sync pipeline.
- The full pipeline uses actual runtime/provider/durable-store/WorklogService,
  intercepting external HTTP with synthetic tables. Google new/edit and TF
  new/edit retain row/event identities, original schema enums, mapping count and
  note privacy. This is NOT live Google/Supabase acceptance.
- 2 idempotent native overlay tests; focused TypeScript passed.
- Source SQL executed in a private PostgreSQL-compatible PGlite database:
  connect/acquire/advance/release/disconnect pass; reconnect/disconnect is blocked
  during active worker; anon/authenticated/taskflow_runtime access denied.
- Actual native page wrapper tested in a constrained 1120x720 content region
  with clearly labelled synthetic auth/path/owner transport. Native loading,
  save and disabled-calendar notice pass. Real sidebar/member/backend still
  not fully accepted. Full native compile caused resource failure and was not
  repeated. A narrow wrapper test is not presented as a full build.
- Browser add/edit/delete-cancel/soft-delete/batch/long-default adjustment,
  response-loss retry, 23:30 plus60min exact next-day end, official holiday/
  outage and actual Excel download passed. Decisive pixels inspected. Screenshot
  fixtures are synthetic, not the formal user's data.
- Previously Next native callback returned200 safe-disabled; its development
  Issue was inspected as missing local /api/me backend404. Not a production error.

## Conflict review candidate checks

- 85 Node tests green (base 74 including the integrator's new-record ECP
  default patch, merged with synthetic fixtures), plus conflict cases:
  planner two-sided diff with no silent overwrite, durable conflict record and
  supersede-on-decision, keep-local If-Match write, keep-remote conditional
  save, CONFLICT_CHANGED/GONE/CHOICE_REQUIRED rejections, owner-only endpoint
  routing with bounded codes, and a full runtime pipeline lifecycle
  (conflict -> owner choice -> guarded apply -> clean resync).
- The review subcomponent worklog-sync-conflicts.tsx is standalone with inline
  styles (shared worklog.css untouched) and passed a jsdom behavioral harness:
  both versions rendered, differing fields highlighted, reviewed fingerprint
  sent on choice, resolved item leaves the list, empty state renders nothing.
  The integrator also verified the 320/390/1280px native wrapper and visible metadata-read failure/retry behavior.
- Source-only: no deploy, no production data, no new cron/Vault changes. The
  new worklog_google_conflicts table is private candidate SQL with the same
  RLS/service_role pattern; it is not applied automatically.

## Reproduce

`npm run build:worklog-rules`, `npm run test:worklog`,
`python -m unittest discover -s labs/taskflow/tests -p test_taskflow_worklog_overlay.py`.
Browser harness has its own lock, Vite8.3.8, React19.2.3, Playwright1.58.2,
TS5.9.3, local-only bind and audit0. Run its `npm ci`, then Vite and the `.cjs`
regressions; CHROME_PATH selects Chromium, WORKLOG_OUTPUT selects artifacts.
`tests/worklog-server/sql-check.mjs` needs separately installed @electric-sql/pglite.

Latest native browser regression also enables the calendar flag against synthetic
worker HTTP. It checks named connected state, source-reason modal, TF save-triggered
sync, Google-side synthetic new row appearing without changing selected date,
remote failure preserving the successful local save and showing no false remote
success, and disconnect preserving entries. Desktop/mobile pixels were inspected.
Worker entry bundling (135KB ES module) and syntax check passed; this is local
bundling, not deployment. The separately locked SQL/bundle harness audits clean.
