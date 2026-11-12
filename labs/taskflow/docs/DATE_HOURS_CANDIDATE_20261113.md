# Date-hours candidate checkpoint

Status: implementation in progress. Not deployed, not enrolled, no production DDL or backfill.
Base Web commit: 4ed883e7d467f46b13fed1ef8f3b37be459dee27.

## Owner rule

A native TaskFlow issue's start and/or due date counts as one hour on that date regardless of completion. Same date once, distinct endpoints separately, no intermediate dates. Hours remain manually adjustable, source issue stays linked. No Add step and no completion gate. Only this change has an immediate deployment exception; Knowledge remains December.

## Candidate

- Existing public.work_entries stores date_only rows with NULL clocks, original issue reference in a separate JSON field, no misuse of legacy task_uuid FK.
- Explicit owner/workspace enrollment, no read-time writes or historical batch import. Trigger runs only for enrolled workspaces whose owner membership remains present.
- Fixed definer functions and trigger, no broad runtime grants. Normal REST roles cannot invent, modify or delete date-only rows; owner edit RPC checks app approval, workspace owner, row owner and optimistic version.
- One transaction updates the exact source endpoint and same hours row when its date moves. Original notes, manual hours and ECP association remain. Clears/deletes create Google deletion intent for exact binding only.
- Daily/monthly statistics read the same work table. No fake clock position in day/week view; date hours have their own row.
- Google one-day transparent date event carries explicit hours metadata, never a 24-hour busy block. Durable binding, source version, provider etag and existing conflict review guard imports and updates.
- ECP XLSX rows carry date strings in start/end fields and exact hours, original owner/department/task values, no private note. External ECP importer acceptance remains unverified.

## Verified at checkpoint

- 148 node unit/integration tests pass, including real runtime/service/provider/durable-store synthetic date-hours round trip and both conflict choices.
- TypeScript noEmit passes.
- Full 87 Python overlay contract tests pass; worker ES2022 ESM bundle succeeds and node syntax check passes.
- Five legacy compatibility source tests plus existing sprint/status tests pass, and old timed ECP export remains byte-identical after canonical rules regeneration.
- SQL PGlite matrix passes: disabled history, owner scope, missing dates, same-day dedup, split/clear/delete, manual 1.5h retention, endpoint adjacent move/swap identity, version/owner edits, app approval and authenticated-role write denial, timed-row constraint preservation.
- 320/390/1440 synthetic native date-hours browser path passes: automatic count, hours edit, source link, no fake clock, week visibility, no horizontal overflow.
- Existing native-wrapper/mobile-editor/task-markers/task-dates/visible-range/export-parity/editor-parity browser suites pass.
- Existing timed ECP export remains byte-identical for the same 84 rows. Date-hours XLSX was opened with openpyxl: 85 rows, one date row, dates only, exact 1.5h, no private note.
- Current live Supabase metadata read: taskflow date columns are DATE; work_entries clocks are still NOT NULL; set_work_entries_updated_at exists; original owner RLS and restrictive app approval remain. All checks were SELECT only.

- Broad source run: 1152 tests, 1143 pass. Eight assertion failures reproduce on the unchanged Web base; the remaining PGlite suite process SIGKILL also reproduces on the base with identical dependencies. No whole-repository green claim.

## Remaining release gates

1. Legacy Pages reader now preserves dateOnly, shows no-clock labels, keeps daily/month totals and ECP exact date/hours, excludes date rows from timed slot allocation, skips them in bulk sync, blocks stale edit/delete with TF guidance. Five source tests and 390/1280 canonical panel/capture visual fixtures pass. Full legacy app acceptance remains to be run before activation.
2. Broader browser/full overlay/build/CI validation and final runtime packaging, including copying date-hours module into the worker function package.
3. SQL enrollment scope must be matched to the actual authorized owner/workspace, activation last after compatible readers and worker. No historic batch write.
4. Source clear/re-add now inserts a fresh registration rather than reviving an old tombstoned Google binding. SQL test verifies new identity; full synthetic worker deletion/reintroduction acceptance passes with distinct Google identities. Existing ACL restriction forbids retry/bypass/reconnection. Do not claim live Google verification from synthetic tests.
5. Owner/day advisory locking serializes manual cap checks and destination-day accounting is corrected; stress concurrent edits further if deployment traffic warrants. Auto registrations may exceed 12h by owner rule, manual edits may reduce existing over-limit days but not increase them.
6. External ECP importer date-only acceptance is not established. Keep the caveat in the UI/report; never fill a fake midnight to satisfy it.
7. Preserve current Render Free plans, AutoDeployOff, pinned vendor, private attachments and original data. Do not mix Knowledge or deploy the Web source tree as API.

## Rollout order, only after gates

Install compatible disabled SQL, release matching Web/legacy reader and worker, verify current source versions, then explicitly enable the owner's workspace enrollment. Do not activate early. Rollback disables enrollment first; never drop date-only data or restore old NOT NULL constraints while those rows exist.
