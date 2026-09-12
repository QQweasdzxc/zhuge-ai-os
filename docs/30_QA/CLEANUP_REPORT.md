# Zhuge AI OS Source / Legacy Route / Duplicate Logic Cleanup Report

Status: Cleanup implementation complete; Candidate packaging follows the
final commit and release gates. This is a source/library cleanup, not a
product-feature release.

## 1. Cleanup前 Source狀態

- Input baseline: `20260912-0009_Zhuge_AI_OS-v0.9.0-alpha.9.13-Investment-IVTK-Projection-FullSource-Candidate`
- Baseline Source HEAD: `d73798df1bcf50831ebbfcb3f372dce585578925`
- Baseline Runtime Build: `20260912-0008`
- Final cleanup Runtime Build: `20260912-0921`
- Baseline branch: `codex/task-063-delete-card-20260907`
- Baseline Working Tree: clean
- Cleanup source commit: recorded in the final Candidate Manifest

The source audit found that formal C pages already used the same shared
`board-read-service` / `task-action-adapters` / `golden-master-runtime` path.
No consumer-specific C movement or renderer authority was found in the
current runtime.

## 2. MD / Docs 整理

Created `docs/README.md` as the single documentation index and organized the
library as follows:

- `docs/00_CURRENT/`: current architecture/foundation/module/naming/UI docs.
- `docs/10_GOVERNANCE/`: coding/release rules, ADRs, and principles.
- `docs/20_MODULES/`: current shared Module C capability documentation.
- `docs/30_QA/`: QA evidence, regression documents, inventory, and this report.
- `docs/40_RELEASES/`: historical candidate, release, and handoff records.
- `docs/90_ARCHIVE/`: superseded architecture, workflow, design, migration,
  and historical WorkLog documents.
- `docs/supabase/` remains at its existing path because SQL migrations and
  rollback files are release/Cloud dependencies.

`docs/90_ARCHIVE/README.md` explicitly marks archived material as Historical
Reference Only and denies it Architecture, Implementation Authority, Runtime
Contract, or workflow-restoration authority.

## 3. 實際移除的 Code

Removed only two source files and their legacy-only test sections:

- `shared/services/c-mtdk-store.js`
- `modules/worklog/services/gas-board-service.js`
- The independent-local-MDTK test section in
  `tests/c-operational-motherboard.test.js`
- The old custom-GAS empty-state test section in
  `tests/task-017-ac-shared-composition.test.js`

Why safe: neither source file has a production import or runtime entry;
current formal C/GAS tests cover the replacement authority; neither file has
a Cloud dependency; and retaining either would preserve an obsolete alternate
C/GAS data/presentation path. No Board, Card, Workspace, Position, Vendor, or
Cloud data was changed.

## 4. Duplicate Code / Duplicate Logic 結果

- Exact duplicate JavaScript file hash audit: no exact duplicate found.
- `golden-master.js` and `task-board.js`: distinct renderer layers, kept.
- `task-action-contract.js` and `task-action-adapters.js`: contract vs
  invocation adapter, kept.
- `ivtk-board-adapter.js` and the Investment Cloud bridge: renderer extension
  vs Position projection synchronizer, kept.
- `c-mtdk-store.js` vs the formal C Cloud service: confirmed obsolete duplicate
  C authority; removed.
- `gas-board-service.js` vs the formal C GAS route: confirmed obsolete custom
  GAS path; removed.

No additional merge was justified without changing behavior.

## 5. Legacy Route / Wrong Authority 結果

Kept with explicit retirement dependency:

- Top-level compatibility helpers in `shared/board/board-read-service.js`
  (`transitionTask`, `moveTaskWorkspace`, and
  `reconcileCompletionLifecycle`) remain exported for historical callers and
  tests. Current formal pages use the instance/workflow C capability. They are
  `RETIRE CANDIDATE`, not deleted, until caller inventory, Cloud contract
  retirement, and compatibility tests are migrated together.
- `shared/api/data-service.js` remains a bounded WorkLog compatibility and
  user-owned migration path; it is not C Board SoT.
- `shared/api/repositories.js` remains the active WorkLog repository because
  `legacy_id` handling protects existing identity.
- `shared/auth/runtime-session-provider.js` remains the validated session
  compatibility adapter used by current modules.
- `shared/security/mfa-service.js` remains the current security authority and
  retains its bounded legacy setting-key compatibility.

The removed local C store and custom GAS service have no current Runtime
authority. No old route was reconnected. No Workflow, Completion, Workspace
Move, Template Adoption, Investment Projection, or Vendor Bridge behavior was
modified.

## 6. Module C Authority Check

PASS: Module C has one current shared authority for board/card presentation,
movement, drawer actions, Cloud read/write adapters, reload hydration, and
workflow integration. AI Board, WorkTodo, GAS, and Investment consume the
shared path; Investment adds only its approved read-only/projection extension.

`C Mother = A + C`, consumer data isolation, C-CORE-001 movement, Workflow V2,
and Investment Position → IVTK Projection source were not changed.

## 7. Supabase Boundary

Read-only verification was performed against project `lenpbbhwxyyfwgvjcozf`:

- Current `board_instances`, `board_workspaces`, `board_tasks`, Workflow V2
  tables, Investment projection/link tables, and Vendor link tables exist and
  report RLS enabled.
- Current Edge Functions include `engineering-transition` v30,
  `workspace-email-notification` v14, `gas-vendor-bridge` v15, and
  `investment-screenshot-recognition` v11.
- Cloud Migration list was read for current contract presence.

Cloud Mutation = **0**. No SQL/DML, migration apply, function deployment,
workspace/card/task edit, data cleanup, or production deployment occurred.

## 8. QA 結果

- Focused cleanup/C-core/consumer regression: **31/31 PASS**.
- Full Node Regression after source cleanup: **481 PASS / 0 FAIL / 8 SKIPPED**.
- The 8 skipped tests are existing browser harness tests requiring an explicit
  local Chrome/Chromium executable; they are not new failures and no browser
  bypass was added.
- JavaScript syntax check: **PASS**.
- `git diff --check`: **PASS**.
- Release preflight after Build Identity alignment: **PASS** (`20260912-0921`,
  version `0.9.0-alpha.9.13`).
- New cleanup-specific regression failures: **0**.
- Runtime/PM Acceptance: not performed; no GitHub Pages or Production deploy
  was authorized. PM Runtime QA remains the handoff gate.

## 9. Pending / retained items

- Compatibility board RPC wrappers remain `KEEP / RETIRE CANDIDATE` pending a
  separate caller and Cloud retirement pass.
- Historical Cloud data, 39/22 mismatch queues, Workflow bindings, and all
  production records remain untouched.
- Browser visual QA requiring a deployed/authenticated Runtime remains PM QA
  pending; this cleanup did not create a Preview/QA/Staging environment.
- No uncertain duplicate or legacy item was deleted.

## 10. Delivery identity

- Version: `0.9.0-alpha.9.13`
- Runtime Build: `20260912-0921`
- Final Source Commit: recorded in the Candidate Manifest and final delivery
  response.
- Candidate ZIP: produced only after the final commit and post-packaging gate.
- Package Time: recorded by the formal packaging tool in `Asia/Taipei`.
- SHA-256: recorded in the Candidate Manifest and final delivery response.

This report and `CLEANUP_INVENTORY.md` are QA/audit records. They do not grant
Cloud authority and do not change Runtime behavior.
