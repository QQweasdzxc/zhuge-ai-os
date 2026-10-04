# Archive version coverage / mixed-scope ordering

This narrow correction retains the reviewed Workspace/Step/Create Task design.
No Task is rebound, moved or renumbered; no Banner or UI behavior changes.

## Existing authorities and correction

`private.board_c_pending_archive_workflow_versions` is an internal selection
query, not a policy/writer/registry. It selects actual pending completion Tasks
in the same active Module C Board, with either a verified Published/Retired
version belonging to that Board or the existing unbound path. Client roles
cannot execute it. The existing completion scope and archive core still verify
context, calculate policy provenance, perform archive-only writes and audit.

The existing scheduler processes the current context plus all selected pending
contexts, retaining its advisory lock, per-Board atomicity/error evidence and
accurate instance/card counts. The authenticated read reconciler uses the same
selector/core and keeps its primary response identity while aggregating archive
counts. Task-scoped reconciliation validates the exact Task/Board/requested
version and uses the Task's actual binding, including NULL for unbound cards.

The existing ordering authority uses the full active Board Instance membership,
not historical application_scope uniformity. The legacy WorkTodo scope count
only activates the existing sort-order/update-metadata trigger marker. Full-list
exactly-once, same-Board access checks, identity guards, audit and readback stay.

Migration: `20261004082429_module_c_archive_version_coverage_mixed_scope_ordering.sql`.
Function-only; no backfill, rebind, policy/cron schedule change or Workflow
publication. Apply after the existing seven pending 20261002–20261004 migrations.
A Source migration file is not evidence of Production application.

## Required verification

- All original 15 migration-readiness cases, including Draft preservation,
  missing Workspace binding repair, standalone Create Task, zero Edge,
  archive/restore and adopter readback.
- Current + retained retired + unbound due cards archive through scheduler and
  authenticated read paths; original version/step/workspace/owner/due preserved.
- Scheduler works without an authenticated session; retry is idempotent.
- 24h completion entry and detach cancellation retain their original semantics.
- Real mixed-scope WorkTodo nine-Workspace reorder; cross-Board, partial,
  duplicate lists and direct ownership changes fail closed.
- Fresh targeted, Full Regression, official `npm run test:browser`, diff check,
  release preflight, Candidate identity and Source-to-ZIP gates.

`tests/module-c-archive-version-ordering-readiness.test.js` executes the existing
SQL scope/core/lifecycle functions in the shared PGlite fixture. Disposable
Supabase Postgres QA additionally uses the private read-only Production snapshot
and genuine migration history; no Production data/secrets enter Source or ZIP.
Exact Source SHA/Build and executed QA results are recorded in Candidate Manifest
and the external sanitized review evidence, not inferred from this document.

## Deployment rehearsal / Production gate

1. Confirm a write freeze; old clients must stop writing. Old main can publish
   unconfirmed Draft edges with the new schema and is unsafe in a mixed window.
2. Restore genuine migration history files in reviewed staging; current canonical
   directory alone lacks 157 already-applied files. Dry-run the exact eight-file
   pending chain, then apply only in disposable QA for rehearsal. Never repair
   history to pretend files were applied.
3. Simulate exact-SHA fast-forward main with an isolated local Git reference.
   This is not a GitHub push, Pages run or Production deployment.
4. Serve that exact Source tree on loopback HTTP, verify Source blobs, Version,
   Build and Runtime Build. Block non-loopback browser requests.
5. Using only the same canonical lifecycle/RPC on disposable data, reconcile
   missing Workspace bindings; preserve unpublished Draft content and all Task
   ownership/evidence, then perform the runtime acceptance cases.
6. Verify all gates before simulating release of the write freeze.

Production migration/reconcile and exact-SHA main Push require separate PM
permissions. Pages deployment does not apply SQL. A successful local rehearsal
must not be reported as an actual GitHub Pages deploy or Production Runtime PASS.
