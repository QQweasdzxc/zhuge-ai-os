# Zhuge AI OS Source / Legacy Cleanup Inventory

Status: Current-State audit completed before cleanup execution.

Baseline candidate: `20260912-0009_Zhuge_AI_OS-v0.9.0-alpha.9.13-Investment-IVTK-Projection-FullSource-Candidate`

Baseline source commit: `d73798df1bcf50831ebbfcb3f372dce585578925`

Baseline Runtime Build: `20260912-0008`

Audit scope: source/document organization, duplicate-authority identification, legacy route review, and evidence-backed dead-code cleanup only. Product behavior, UI/UX, Cloud data, Workflow behavior, Investment, GAS, and architecture are frozen.

Mutation state at inventory creation: Source cleanup mutation not yet executed; Cloud Mutation = 0; Data Mutation = 0; Deployment = 0.

## Evidence rules

Every candidate was checked against:

1. Current source imports/references and runtime entry points.
2. Test, Golden Contract, and release dependencies.
3. Cloud contract presence where a route could affect Cloud authority.
4. A current replacement authority, if one exists.

Names such as `legacy`, `old`, `fallback`, `deprecated`, `v1`, and `migration` are not deletion evidence by themselves.

## Current authority map

| Path / area | Type | Current purpose | Current caller | Runtime authority | Test dependency | Cloud dependency | Replacement | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| `shared/board/board-read-service.js` `createInstanceService` / `createWorkflowCapability` | Source | Shared C instance, Cloud read, movement, workflow and reconciliation adapter | C Mother, AI Board, WorkTodo, GAS, Investment adapters | Current Module C authority | Current C, movement, workflow, Investment and task tests | `board_instances`, `board_workspaces`, workflow tables and controlled RPCs | None; this is the replacement authority | High if bypassed | KEEP |
| `shared/components/task-action-contract.js` | Source | Shared action contract for card operations | All C consumers through adapters | Current action contract | Action and C regression tests | Controlled board/task RPCs | None | High | KEEP |
| `shared/components/task-action-adapters.js` | Source | Consumer-neutral adapter into the shared C action contract | AI Board, WorkTodo and C Template runtimes | Current movement/action caller | C movement and consumer matrix tests | Shared C RPCs | None | High | KEEP |
| `shared/components/golden-master-runtime.js` | Source | Shared C presentation/controller runtime | All formal board pages | Current runtime controller | Golden and runtime tests | Uses shared C service | None | High | KEEP |
| `shared/components/golden-master.js` + `shared/components/task-board.js` | Source | Shared card/board presentation layers; distinct responsibilities | Golden runtime and board pages | Shared renderer layers, not duplicate engines | C composition and UI tests | Read-only through service | None | Medium | KEEP |
| `shared/components/c-template-preview.js` | Source | C Mother/template preview and release-state presentation | Template preview and management flows | Current preview composition helper | Template and parity tests | Module release/read contracts | None | Medium | KEEP |
| `shared/services/template-adoption-policy.js`, `template-release-service.js`, `template-parity-engine.js` | Source | Published C adoption, release and parity policy | Template management/runtime | Current template authority | Template contract tests | Module release tables/RPCs | None | High | KEEP |
| `shared/components/system-template-catalog.js` | Source | Current template catalog/management registry | Template management center | Current catalog presentation | Template management tests | Module release state | None | Medium | KEEP |
| `modules/investment/services/ivtk-board-adapter.js` | Source | Investment-specific projection slot over shared C card rendering | Investment runtime | Consumer extension only; no C authority | Investment projection/board tests | Investment position/link/projection contracts | Shared C renderer/service | High if expanded | KEEP |
| `modules/investment/services/supabase-investment-repository.js` + `app/Board/investment/investment-cloud-bridge.js` | Source | Investment read/projection synchronization | Investment runtime | Investment data integration, not C movement | Investment Cloud tests | Investment projection RPC/tables | None | High | KEEP |
| `shared/api/data-service.js` | Source | WorkLog compatibility and bounded legacy data migration | WorkLog runtime | WorkLog only; not C board SoT | WorkLog data tests | WorkLog tables and user-confirmed migration | Current WorkLog repository/Cloud path | Medium | KEEP |
| `shared/api/repositories.js` | Source | WorkLog repository and identity-safe `legacy_id` compatibility | WorkLog runtime | WorkLog data authority | WorkLog repository tests | WorkLog Cloud tables | None | Medium | KEEP |
| `shared/auth/runtime-session-provider.js` | Source | Validated adapter from legacy root session binding to shared session | All modules | Current auth/session boundary | Auth/security tests | Supabase Auth session | Canonical session provider after migration | High | KEEP |
| `shared/security/mfa-service.js` | Source | Shared MFA/security state with a bounded legacy setting-key alias | Investment/security flows | Current security authority | MFA tests | User settings/session | Canonical MFA setting after compatibility retirement | High | KEEP |
| `shared/services/c-mtdk-store.js` | Source | Old localStorage C operational motherboard store | No production caller found | None in current runtime; would be a duplicate C authority if reintroduced | None; intentionally bypasses Cloud | `createInstanceService` + shared C runtime | Historical tests only | High | RETIRE / DELETE CANDIDATE |
| `modules/worklog/services/gas-board-service.js` | Source | Old local GAS empty-state/data service | No production caller found | None in current procurement runtime; current GAS uses formal C service | Historical TASK-017 test only | None; intentionally does not read formal C data | Formal C instance service | High | RETIRE / DELETE CANDIDATE |

## Duplicate code / logic audit

| Location A | Location B | Current caller | Authority | Is it a real duplicate? | Recommendation |
|---|---|---|---|---|---|
| All tracked `app/`, `modules/`, `shared/` JavaScript files | Exact-content hash comparison across the same set | N/A | Current files | No exact duplicate file was found | KEEP |
| `shared/components/golden-master.js` | `shared/components/task-board.js` | Shared runtime | Golden Master composes the board; Task Board owns board presentation primitives | No; separate layers | KEEP |
| `shared/components/task-action-contract.js` | `shared/components/task-action-adapters.js` | All C board consumers | Contract vs consumer-neutral invocation adapter | No; separate layers | KEEP |
| `shared/components/golden-master-runtime.js` | `app/Board/*/index.html` bootstraps | All board pages | Runtime controller vs page boot wiring | No; page bootstraps do not own C behavior | KEEP |
| `shared/services/c-mtdk-store.js` | `shared/board/board-read-service.js` / C runtime | Historical test only vs all current C pages | Current C Cloud service is the only runtime authority | Yes: obsolete local C store duplicates board/workspace/task behavior and bypasses Cloud | RETIRE / DELETE CANDIDATE |
| `modules/worklog/services/gas-board-service.js` | `shared/board/board-read-service.js` / `golden-master-runtime.js` | Historical test only vs formal GAS page | Formal C instance service | Yes: obsolete custom GAS empty-state path is not the formal C consumer | RETIRE / DELETE CANDIDATE |
| `modules/investment/services/ivtk-board-adapter.js` | `app/Board/investment/investment-cloud-bridge.js` | Investment runtime | Adapter renderer vs position projection synchronizer | No; presentation extension and Cloud sync have different responsibilities | KEEP |
| `shared/api/data-service.js` | `shared/api/repositories.js` | WorkLog | WorkLog compatibility service vs repository | No; one coordinates migration/read behavior, one owns repository operations | KEEP |
| `shared/components/c-template-preview.js` | `shared/components/template-management-center.js` | Template preview/management | Preview status helper vs management UI | No; separate contexts reading the same release SoT | KEEP |

No current evidence supports merging any additional current C, Investment, or WorkLog files without changing behavior.

## Legacy route audit

| Route / location | Why it exists | Current runtime caller | Compatibility responsibility | New authority | Removal impact | Decision |
|---|---|---|---|---|---|---|
| Top-level helpers in `shared/board/board-read-service.js`: `transitionTask`, `moveTaskWorkspace`, `reconcileCompletionLifecycle` | Older non-instance board callers and historical contract tests | No current formal C page caller found; tests and compatibility surface remain | Legacy RPC wrapper compatibility | `createInstanceService().workflow` and `task-action-adapters` | Could break older callers/tests and any unindexed consumer | KEEP; RETIRE only after caller/test/Cloud retirement matrix |
| `deleteWorkspace` wrappers in `shared/board/board-read-service.js` | Older workspace delete contract | Historical tests/compatibility | Uses guarded request/finalize path; populated workspace is rejected rather than auto-moved by this wrapper | Current controlled workspace contract | Removing before all callers migrate can break delete flows | KEEP; RETIRE candidate |
| `shared/api/data-service.js` legacy WorkLog storage migration/fallback | Preserves user-owned WorkLog data during migration | WorkLog only | One-time, bounded WorkLog compatibility | WorkLog Cloud/repository path | Removing can strand legacy WorkLog data | KEEP |
| `shared/security/mfa-service.js` legacy `investment_mfa_required` alias | Preserves existing security setting key | Security/Investment settings | Security compatibility | Canonical MFA setting | Removing can change security behavior for existing settings | KEEP |
| `shared/auth/runtime-session-provider.js` legacy root session binding adapter | Bridges validated session to shared platform session | All formal modules | Session compatibility | Shared runtime session provider | Removing can break login/session continuity | KEEP |
| `shared/api/repositories.js` `legacy_id` handling | Identity-safe WorkLog dedup/race compatibility | WorkLog | Existing user data identity | WorkLog repository | Removing can duplicate or lose WorkLog identity | KEEP |
| `shared/services/c-mtdk-store.js` localStorage C route | Historical operational motherboard prototype | No current runtime caller; historical test only | None required by current Cloud C | Reintroducing it would create a second C authority | RETIRE / DELETE CANDIDATE |
| `modules/worklog/services/gas-board-service.js` custom GAS route | Historical GAS empty-state prototype | No current runtime caller; historical test only | None required by formal GAS C consumer | Reintroducing it would create a GAS-specific board path | RETIRE / DELETE CANDIDATE |

The current formal pages all load the shared C service/runtime path. `docs/supabase/` remains a release/Cloud dependency location and is not treated as removable Markdown.

## Wrong flow / wrong authority audit

| Finding | Evidence | Risk | Action in this cleanup |
|---|---|---|---|
| Old top-level board RPC helpers remain exported | Source exports and historical tests reference them; current formal pages route through instance/workflow capability | A future old caller could regain status/workspace authority | No behavior change in this cleanup; retain with retirement dependency recorded |
| Local C motherboard store remains in source | No production import; historical test only; uses localStorage and bypasses Cloud | Could revive a second C source of truth if imported again | Remove from current Runtime surface; retain until its historical test dependency is retired in this cleanup |
| Old GAS empty-state service remains in source | No production import; historical test only; formal GAS page does not load it | Could revive consumer-specific GAS presentation/data path | Remove from current Runtime surface; retain until its historical test dependency is retired in this cleanup |
| WorkLog local compatibility fallback exists | Active WorkLog caller and bounded migration semantics | Incorrectly treating it as C authority would be wrong | Keep; scope is WorkLog data compatibility, not board workflow |
| Current C movement path | `task-action-adapters` → `createInstanceService().workflow` / controlled RPC | No current divergence found | Keep unchanged |
| Current Investment projection path | Investment bridge/repository uses formal projection contract and shared C rendering | No duplicate Projection authority found | Keep unchanged |

## Test classification

| Test group | Classification | Reason | Decision |
|---|---|---|---|
| C composition, movement, workflow V2, parity, template and consumer matrix tests | Current Regression / Golden Contract | Protects current shared C behavior and adoption boundaries | KEEP |
| Investment projection, identity, market-route and read-only tests | Current Regression / Golden Contract | Protects Position → IVTK projection and Investment capability boundaries | KEEP |
| `tests/c-operational-motherboard.test.js` local-store section | Historical / Legacy authority guard | Directly tests the retired localStorage C prototype; other sections guard current C behavior | Remove only the legacy-store section with its source after confirming current replacement tests remain |
| `tests/task-017-ac-shared-composition.test.js` legacy GAS service section | Historical / Legacy authority guard | Directly tests the old GAS empty-state service; current composition tests protect formal C | Remove only the legacy-service section with its source |
| `tests/ai-board-batch-2.test.js`, `tests/task-039-*`, and old RPC assertions | Compatibility / historical contract guards | Still document or assert legacy route boundaries and are dependencies for safe retirement | KEEP for this round; no Cloud/RPC retirement authorized |
| Release/preflight/packaging tests | Current Release Guard | Protects source/build/package identity | KEEP |

No test is classified as safely dead solely because its TASK is complete. The two explicit legacy-only sections are removable only because their production callers are absent and current replacement tests cover the active authority.

## Documentation classification

| Path / set | Type | Current purpose | Reference/dependency check | Recommendation |
|---|---|---|---|---|
| `docs/ARCHITECTURE.md`, `FOUNDATION.md`, `FOUNDATION_V1.md`, `MODULE_SPEC.md`, `NAMING.md`, `UI_GUIDELINE.md` | Current architecture/module docs | Current source and architecture reference | README and current docs | Move to `docs/00_CURRENT/` and update links |
| `docs/CODING_STANDARD.md`, `docs/RELEASE.md`, `docs/adr/`, `docs/principles/` | Governance | Current engineering/release principles and decisions | Governance tests and docs | Move to `docs/10_GOVERNANCE/` and update links |
| `C_CARD_REPORT_EMAIL_V2.md`, `C_WORKSPACE_EMAIL_NOTIFICATION_V1.md`, `docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md` | Module capability docs | Current C/shared capability documentation | Tests reference the drawer assessment path | Move to `docs/20_MODULES/` and update test references |
| `docs/evidence/`, current QA/Regression docs | QA evidence | Regression and verification evidence | QA/release references | Move to `docs/30_QA/` |
| Candidate/handoff/release QA documents in `docs/` | Historical release evidence | Historical package/handoff record | No runtime authority | Move to `docs/40_RELEASES/` |
| `A_B_A_C_COMPOSITION_SCOPE.md` | Historical scope note | Superseded scope note; contradicts current GAS presence | No source/runtime caller | Move to `docs/90_ARCHIVE/` |
| `QA_REPORT_ALPHA_9_11.md` | Historical QA report | Old build/report | No runtime authority | Move to `docs/90_ARCHIVE/` |
| `docs/REPOSITORY_CLEANUP_REPORT.md`, prior `docs/CLEANUP_IMPLEMENTATION_CHECKPOINT.md` | Historical cleanup/release record | Superseded checkpoints | No runtime authority | Move to `docs/40_RELEASES/` or `docs/90_ARCHIVE/` |
| `docs/rfc/` legacy proposals | Historical proposal | Proposal/reference only; no runtime authority | One test path must be updated if relocated | Move to `docs/90_ARCHIVE/rfc/` and update test reference |
| `docs/supabase/` SQL migrations and rollback files | Cloud/release dependency | Migration source and contract evidence | Tests/tools/release references | KEEP in place; index from docs library |

## Cloud boundary verification

Read-only Supabase project `lenpbbhwxyyfwgvjcozf` verification found:

- Workflow tables and current C contract tables exist with RLS enabled.
- `board_instances`, `board_workspaces`, `board_tasks`, Investment projection/link tables, and Vendor link tables exist with RLS enabled.
- Current Edge Functions include `engineering-transition` v30, `workspace-email-notification` v14, `gas-vendor-bridge` v15, and `investment-screenshot-recognition` v11.
- No SQL, UPDATE, DELETE, migration, Edge Function deployment, or data repair was performed.

Cloud is not a cleanup target in this round. Any cleanup requiring Cloud mutation is `PENDING`.

## Initial execution decision

Safe to execute:

- Documentation library moves and index creation, with link/test path updates.
- Removal of the two explicitly uncalled legacy source files and their legacy-only test sections, after the current replacement tests are retained.

Keep / pending:

- Legacy top-level board RPC wrappers: keep until complete caller, Cloud contract, and regression retirement.
- WorkLog auth/repository compatibility routes: keep because they have current callers and data-preservation responsibility.
- Any Cloud objects, historical board/card data, workflow rows, or migrations: no mutation authorized.
- Any uncertain duplicate or legacy item: keep and report.

## Execution result

The following evidence-backed cleanup was executed after this inventory was
created:

- Current architecture, governance, module, QA, release, and archive
  documents were relocated into the library categories above; references and
  regression-test paths were updated without changing product behavior.
- `shared/services/c-mtdk-store.js` was removed because it had no production
  caller, intentionally bypassed Cloud, and only supported the retired local
  C prototype test section.
- `modules/worklog/services/gas-board-service.js` was removed because it had
  no production caller and only supported the retired custom GAS empty-state
  test section; the formal GAS route remains on the shared C service.
- The two corresponding legacy-only test sections were removed. Current C
  composition/movement and formal GAS isolation guards remain.
- No current C, WorkLog, Investment, auth, security, or release authority was
  merged, rewritten, or deleted.

The final cleanup report records the post-cleanup test, source, and Cloud
read-back evidence.
