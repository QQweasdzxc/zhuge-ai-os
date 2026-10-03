# Global Shared Header / Workspace Count Developer QA

BASE_SHA: 4a0dfafd4cdd772268903efc976418236dc714f4

This source-only change reuses ZhugeSharedShell, shared tokens/CSS, the Shared
Board read projection, Golden Master runtime and the existing detach RPC. No
push, deploy, workflow publish, migration apply or Production row repair.

## Shared Header

The single header geometry definition is in shared/theme/zhuge-shell.css.
Navigation legacy-header rules exclude the canonical shared header; competing
Workspace and WorkLog header geometry declarations were removed. No new
component or adopter-specific override was added. The redundant brand kicker
was removed; subtitle is secondary, with full text retained in the DOM/title.
Manual header mounts are marked mounted so automatic startup cannot discard
explicit identity/action options by remounting them.

Desktop minimum height is 74px. Narrow layouts use a title/identity row and a
scrollable action row (128px); headers without actions stay 74px. Shared header
controls are at least 44x44. The existing tools popup stays outside the action
scroll container and was exercised, including C Mother's wider action set.

header-geometry.json records 72 local Chromium measurements: 18 formal
adopter/routes at 1440, 1024, 390 and 320px. Fixtures retain formal stylesheet
order/header ancestor classes and existing renderers; business content/scripts
are excluded and external requests are blocked. These are Developer QA
presentation measurements, not authenticated Production screenshots. Identity
is synthetic PM / pm@example.test. Mobile tools, no horizontal page overflow,
identity preservation and control dimensions are asserted.

| Adopter | Before desktop / mobile 390px | After desktop / mobile 390px |
| --- | --- | --- |
| AI Board / WorkTodo | 94 / 211.8px | 74 / 128px |
| Procurement | 94 / 193.7px | 74 / 128px |
| Investment C Board / C Mother | 94 / 201.7px | 74 / 128px |
| Investment module (overview) | 94 / 193.7px | 74 / 128px |

Before values come from the preceding read-only canonical-source audit. The
additional Dashboard, WorkLog and Investment route cases have post-fix
readback; no pre-fix measurements are invented for those cases.

## Workspace count / historical deletion

The existing Shared Board read service now projects current, history and
retained totals. Classification uses the existing runtime archive predicate,
including WorkTodo's persisted-archive presentation; no second archive rule.
Search changes visible card count only, never retained totals/delete safety.

For the unchanged TASK-079 Cloud row: current 0 / history 1 / retained 1.
The main-board column exposes all three totals. Historical deletion says:

> 此工作區目前無進行中卡片，但仍保留 1 張歷史卡（TASK-079），因此不能刪除。

Canonical C consumers block populated deletion before requesting a writer.
Legacy optional-Workflow WorkTodo behavior and the canonical delete RPC are
preserved. The new localhost browser case runs the real shared rendering and
delete handler, confirms TASK-079 is hidden from current cards, searches,
clicks Delete, reads the exact message and verifies zero mock writer calls.

One existing regression asserted the obsolete generic delete-message text.
It now asserts the PM-required complete historical message and shared
projection/guard route; all other assertions remain. No skips or expected fails.

## Auto-archive RCA and source repair

Production read-only evidence (2026-10-03 UTC) confirms:

- pg_cron exists; module-c-completion-archive-v2 is active every five minutes.
- cron runs succeeded; the shared scheduler scanned AI Board without errors.
- The existing private reconciler/public page-reconcile function are present.
- TASK-079 completed at 2026-09-21 15:07:30 UTC; due at 2026-09-22 15:07:30 UTC.
- At 2026-09-22 12:10:34 UTC, workflow_detached_workspace_decision moved it
  from Completion to TASK-081-E2E-20260922 and cleared workflow/step binding.
- The detach writer preserved archive_due_at. Neither current Published
  Completion candidates nor unbound Completion-workspace candidates include
  this detached custom-workspace card. Cron success therefore archives zero.

The defect is retaining a countdown after leaving Completion, not a missing
cron job or a failing scheduler. PM explicitly chose the existing contract:
leaving Completion cancels the countdown and preserves completion evidence.
Do not widen the scheduler to archive tasks outside Completion.

The function-only migration
20261003093851_module_c_detach_cancel_completion_countdown.sql replaces the
existing board_c_detach_workflow_and_move_task_v1 signature. It reuses the
canonical completion designation, clears due time outside Completion and
preserves completion_at, task identity/status, authorization, leases,
idempotency and the existing activity writer. No new RPC, scheduler, RLS,
table or data backfill. It is NOT APPLIED to Production.

The exact migration compiled/executed in PGlite 0.3.14 (isolated Postgres).
Eight checks passed: leaving Completion, remaining in Completion, idempotent
replay, missing session, missing write authority, live lease, archived row,
invalid target and execution grants (replay is included in the first check).
Auth/write/designation dependencies use isolated test stubs; this is not live
RLS acceptance. See detach-postgres-readback.json for precise case grouping.

Future authorized application plan: inspect current function first; apply only
this function migration through the governed migration path; use an isolated
Board/card to test detach, due cancellation, evidence/audit preservation and
re-entry countdown; read back function/row/scheduler state. Restore only the
previous detach function body and grants for rollback, not the entire old
TASK-081 migration. This migration does not fix TASK-079 retrospectively.
Any governed stale-row correction requires a separate PM-authorized plan;
this task neither deletes/reassigns TASK-079 nor claims it is persisted archived.

## QA gates

Exact command/results are recorded in qa-summary.json. Existing official
npm run test:browser remains the browser authority; the new shared-header and
historical-count cases are included in it. Source identity and diff gates run
before commit; clean-tree release preflight runs after the local commit.

Product Version/Build remain 0.9.0-alpha.9.13 / 20261003-1407 during this scoped
source fix. Any ZIP is a commit-specific review/backup snapshot, not a newly
promoted Candidate or proof of Production deployment. New release identity
and promotion are separate gates. CTO review and Production acceptance remain
pending at the requested HARD STOP. The scope is
Global-Header-Workspace-Count-Archive-Fix; no formal TASK number is assigned
by local Backlog. The invalid local numbered record was removed under PM
authority; all Developer QA evidence remains in this directory.


## Governance reconciliation and enforcement Developer QA

PM-authorized scope: Global-Header-Workspace-Count-Archive-Fix. The prior header,
count and detach-writer implementation is preserved. Source BASE remains
4a0dfafd4cdd772268903efc976418236dc714f4; the existing unpushed source commit is
the parent of this governance correction. No new formal TASK ID is allocated.
The invalid local Backlog identity was removed, and the work branch is
global-header-workspace-count-archive-fix. Historical commits are preserved.

The existing release-governance.js now owns Candidate, Review and QA Backup
through one engine. Gates cover timestamp/type/scope, protected formal TASK
inspect readback, exact tracked eligible Git blobs, source/parent SHA, source
Build versus Artifact Created At, ZIP integrity, Manifest and automatic SHA256
sidecar. Output/delivery destinations are explicit storage choices with
append-only artifact sets. No Mac location is a Source Authority. Candidate
Build remains unchanged during Review packaging. No second registry/packager.

Final Developer QA: governance targeted 40 passed / 0 failed / 0 skipped;
Full Regression 851 passed / 0 failed / 0 skipped; official Browser Regression
31 passed / 0 failed / 0 skipped plus all five standalone scripts PASS. Browser
uses installed pinned Playwright Chromium and existing loopback fixture
transport. Existing assertions remain; obsolete fixed-Mac destination tests
were replaced by explicit destination, portable identity, no-overwrite and
complete-set rollback assertions. Generated historical screenshot files were
copied to external QA evidence and restored to their original committed blobs.

Source Version/Build remain 0.9.0-alpha.9.13 / 20261003-1407. After local commit,
run clean-tree preflight and package Review with actual Asia/Taipei creation
time. The tool's final Manifest supplies the exact new Source SHA/Parent SHA,
file hashes and QA evidence; do not label the previous parent as latest source.

SOURCE_STATE: local governance correction, pending GPT/CTO review.
MIGRATION_STATE: no apply this round; live state NOT VERIFIED this round.
DEPLOY_STATE: no Push / Deploy; Production readback NOT VERIFIED this round.
RUNTIME_STATE: no Cloud/Production mutation or Workflow publish; live
Runtime/QJC acceptance is separate and is not claimed by Developer QA.

## Formal Build Cycle: material Source identity correction

The preceding sections record historical implementation/review evidence. Their
unchanged-Build Review policy is superseded by the MATERIAL SOURCE CHANGE RULE
in docs/10_GOVERNANCE/RELEASE.md; it must not be used for a new delivery.

PM-authorized descriptive scope:
Global-Header-Workspace-Count-Archive-Governance. Formal Source BASE is
4a0dfafd4cdd772268903efc976418236dc714f4; development parent is
e904dd7c8b7b194aba0b4bc7acf1700ed7ff7547. Product Version remains
0.9.0-alpha.9.13. New Formal Build 20261003-1937 was generated at the actual
cycle start in Asia/Taipei through the existing release authority, replacing
the previous 20261003-1407 Source identity. Published C evidence retains its
existing Published identity; it is not promoted by this Candidate.

The single existing release-governance.js compares eligible committed Source
blobs with origin/main and rejects BUILD_IDENTITY_STALE before packaging when
material Source differs but the Build is unchanged. Candidate, Review and QA
Backup share this gate. Unchanged-source artifact-only operations may reuse
Build identity. The Manifest records immutable cut-time baseline evidence,
verified from Git even after main promotion, alongside source/parent SHA and
separate Artifact Created At. Existing Build synchronization updates ordinary
runtime projections/cache-busters and preserves Published C loaders/evidence.

Fresh governance, feature, Full Regression, official Browser Regression, diff
and clean-tree release preflight gates are required after the local commit.
Final counts, commands, exact commit and Candidate verification are recorded
in the external QA summary and Candidate Manifest only after these runs;
historical counts above are not reused as this cycle's result. Generated
tracked browser screenshots are copied to external evidence before restoring
their committed blobs. No assertion is removed, weakened or skipped.

Delivery is a new FullSource Candidate with Build-prefixed basename and matching
Manifest/SHA256 sidecars. Earlier Review/Build artifacts remain unchanged.
No formal TASK number is allocated. Source migrations remain included without
application; this cycle does not Push, Deploy, publish Workflow, change Cloud
data or claim live Production/Runtime acceptance.
