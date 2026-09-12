# Source Architecture / Authority Audit — Round 2

## Audit metadata

- Product version: 0.9.0-alpha.9.13
- Runtime Build: 20260912-0921
- Baseline Source Commit: 83b00fcea2fc343c5e56e38ff5cf523340d5fa4a
- Branch: codex/task-063-delete-card-20260907
- Audit date: 2026-09-12 (Asia/Taipei)
- Mode: read-only Source / caller / test / Cloud-contract audit

This report is the deliverable for the second Source Architecture / Authority Audit.
It is not a cleanup execution plan and does not authorize any mutation.

## Mutation ledger after approved RED route repair

| Area | Result |
|---|---|
| Product Source code | One minimal WorkTodo Caller/Route repair |
| Cloud contract / schema / RLS | 0 changes |
| Supabase data | 0 changes |
| TASK / Card / Workspace data | 0 changes |
| Deployment / Candidate packaging | 0 |
| Regression tests | Updated only for the repaired route and its contract evidence |
| Documentation | This audit report updated with the remediation record |

## Method and evidence boundary

The audit used the current Source tree, HTML entry points, imports and references,
runtime callers, test dependencies, and read-only Supabase function/RLS existence
checks. No write RPC, SQL DML, migration, deployment, or runtime mutation was
performed. Line references below refer to the unchanged baseline files.

The previous cleanup result remains valid: the two uncalled legacy implementations
already removed by commit 83b00fc were not restored. This round identifies current
routes and authority risks; it does not delete or merge them.

## Executive result

### Overall health after approved RED fix: ORANGE — frozen follow-up items remain

The audit started with one RED finding. That finding is now remediated in Source
and is retained below as an explicit audit trail. The five ORANGE items remain
frozen exactly as PM/GPT directed; none was merged, deleted, refactored, renamed,
or changed.

The current C Core is structurally healthy: the five C-facing pages load the same
shared runtime, shared Golden Master renderer, shared task action contract, and
shared C workflow capability. No exact duplicate JavaScript file and no confirmed
second C Renderer or C Movement Engine were found.

The original blocking finding was a reachable WorkTodo-specific workspace
deletion route that called worktodo_update_task for every card. The approved
minimal fix now routes each card through the existing C Workflow decision
capability before the existing WorkTodo finalization contract.

### Status summary

| Level | Meaning | Current count |
|---|---|---:|
| GREEN | One clear authority or approved capability boundary | 7 |
| YELLOW | Legitimate compatibility or domain boundary; no confirmed competing authority | 4 |
| ORANGE | Reachable/conditional duplicate route, confusing structure, or security review item | 5 |
| RED | Reachable wrong-flow or high-risk write authority | 0 after approved fix |

## 1. GREEN — current authority is clear

| Capability | Current Authority | Other Route | Caller | Runtime Reachable? | Write Authority? | Risk | Evidence | Recommendation |
|---|---|---|---|---|---|---|---|---|
| C Board rendering and A+C composition | shared/components/golden-master.js and shared/components/golden-master-runtime.js | No second C renderer found | C Mother, AI Board, WorkTodo, GAS, Investment entry points | Yes | No | Low | All five Board HTML entry points load the same shared task-card, task-drawer, task-board, Golden Master, and golden-master-runtime scripts | KEEP; preserve Mother → Consumer adoption path |
| C Card / Task action contract | shared/components/task-action-contract.js and task-action-adapters.js | Consumer adapters only select data/capabilities | shared golden-master-runtime.js | Yes | Indirectly through service/RPC | Low | moveWorkspace is one shared action; adapters call moveThroughCWorkflow and do not implement a second movement engine | KEEP; consumer adapters remain bounded |
| C workflow resolution and normal movement | createWorkflowCapability in shared/board/board-read-service.js | v1 compatibility route is recorded under ORANGE | shared runtime for C Mother, AI Board, WorkTodo, GAS | Yes | Yes, through v2 workflow/adoption/instance RPCs | Low when v2 is available | moveWorkspaceDecision resolves Published Workflow, resolves task, adopts only when Cloud can uniquely validate, then reconciles through the v2 Contract | KEEP as current canonical path |
| Template publish, adoption, and parity | shared/services/template-release-service.js and shared/components/template-parity-engine.js | No second publish/parity engine found | Template Management Center and C Mother/template preview | Yes | Yes through controlled Cloud RPCs | Low | release service reads get_published_module_release and performs Cloud read-back; parity engine compares adopted C to latest published C | KEEP; no new pending-state logic |
| Investment Position → IVTK projection | sync_investment_ivtk_projection Cloud function, consumed by investment-cloud-bridge.js and supabase-investment-repository.js | Two triggers call the same idempotent function; no second algorithm found | Investment page load and repository sync path | Yes | Yes through one Cloud function | Low/controlled | Cloud read-only check found 11 positions, 11 active links, zero missing or duplicate links; 2330/AAPL/NVDA are linked to IVTK-009/010/011 | KEEP; future work may simplify trigger inventory only |
| Auth/session lifecycle boundary | shared/auth/session-service.js and session-lifecycle.js, with runtime-session-provider.js adapter | session-manager.js is a compatibility facade | shared runtime and legacy WorkLog bridge | Yes | No business-state write | Low | session provider adapts the canonical session; session manager delegates to ZhugeSession; no C board SoT is stored locally | KEEP; do not create another identity/session system |
| Current regression and documentation boundaries | tests/golden-master-conformance.test.js and current docs indexes; docs/90_ARCHIVE/README.md | Historical tests/docs remain labelled or isolated | QA and release process | Yes for tests; docs are non-runtime | No | Low | Archive README explicitly denies implementation/runtime authority; full suite had 489 tests, 481 pass, 8 skipped, 0 fail | KEEP current guards; archive historical material only |

## 2. YELLOW — legitimate boundary or compatibility, not a confirmed second authority

| Capability | Current Authority | Other Route | Caller | Runtime Reachable? | Write Authority? | Risk | Evidence | Recommendation |
|---|---|---|---|---|---|---|---|---|
| Domain task CRUD | C/GAS use shared Board service and board_instance RPCs; AI Board uses shared generic Board service; WorkTodo uses its own product RPCs | board_instance_*, board_*, and worktodo_* are separate domain contracts | Shared adapters and WorkLog-specific product code | Yes by product | Yes | Medium source-navigation risk, not proven duplicate C authority | No consumer page contains a private C renderer or movement engine; WorkTodo-specific operations are product-bounded | KEEP boundaries; require a caller matrix before any future consolidation |
| WorkLog data compatibility | shared/api/data-service.js and shared/api/repositories.js | Local migration/cache compatibility path | modules/worklog/worklog-app.js and WorkLog data layer | Yes for WorkLog | Yes for WorkLog/Knowledge REST resources | Medium if reused for C | DataService local state is migration/UI compatibility; Repository writes are scoped to WorkLog/Knowledge, and no C Board caller was found | KEEP for WorkLog; never use as C Board SoT |
| Supabase request compatibility | shared/supabase/supabase-gateway.js | shared/api/repositories.js has a legacy direct REST repository path | C uses gateway; WorkLog uses repository compatibility path | Yes by domain | Yes by domain | Medium if a new C caller chooses the wrong path | C Board read/write goes through Board service and gateway; WorkLog callers use DataService/Repository | KEEP until a separately approved WorkLog migration; do not merge in this round |
| Session compatibility bridge | shared/auth/runtime-session-provider.js and shared/core/session-manager.js | shared/auth/session-service.js is canonical snapshot/lifecycle source | Legacy root/session consumers and shared runtime | Yes | No business-state write | Low/medium future confusion | Files are adapters/facades, not independent auth stores; no service-role or local business authority found | KEEP with explicit compatibility documentation; retire only after caller inventory |

## 3. ORANGE — follow-up cleanup or security review required

### O1. v1/v2 lifecycle write surface remains exposed

| Field | Finding |
|---|---|
| Capability | Workspace decision, transition, completion, acceptance, and reconciliation |
| Current Authority | Normal runtime path is C Workflow V2 through createWorkflowCapability and shared golden-master-runtime.js |
| Other Route | board-read-service.js still exports v1 helpers including transitionTask, reconcileWorkspaceDecision, moveTaskWorkspace, acceptTaskFromQjcDrop, and reconcileCompletionLifecycle; Cloud still exposes corresponding v1 RPCs |
| Caller | Normal runtime prefers v2; compatibility exports and tests still reference v1; runtime has a conditional v1 lifecycle fallback when v2 capability is unavailable |
| Runtime Reachable? | Conditional and publicly exposed from the shared service; not the normal path when v2 is loaded |
| Write Authority? | Yes |
| Risk | High: a future caller can write status/assignee or completion through the old semantic route and recreate status/workspace inference |
| Evidence | board-read-service.js v1 exports around transition/reconcile/acceptance; golden-master-runtime.js fallback from workflow authority to lifecycle authority |
| Recommendation | RETIRE candidate only after v2 Caller Inventory, Consumer Adoption, Regression, and Reconciliation PASS. Do not delete this round |

### O2. C instance direct move API sits beside the v2 decision API

| Field | Finding |
|---|---|
| Capability | Board Instance card movement |
| Current Authority | workflow.moveWorkspaceDecision / reconcileWorkspaceDecision is the canonical decision path |
| Other Route | createInstanceService exposes instanceMoveTaskWorkspace, which directly invokes board_instance_move_task_workspace |
| Caller | Instance service and tests; no current page caller for the direct method was found during this audit |
| Runtime Reachable? | Exposed conditionally through the service object |
| Write Authority? | Yes |
| Risk | Medium/high: a caller can bypass Workflow resolution/adoption and create a second movement entry point |
| Evidence | board-read-service.js instance service exports direct move plus v2 workflow methods; golden-master-runtime.js normally routes drops through the workflow capability |
| Recommendation | RETIRE candidate after caller inventory proves it is not required as the canonical no-workflow core operation; retain until then |

### O3. Browser completion fallback can become a second gate if capability wiring fails

| Field | Finding |
|---|---|
| Capability | Completion decision |
| Current Authority | C Workflow capability and Cloud Contract |
| Other Route | golden-master-runtime.js completionGateStatus contains browser-side checklist/evidence fallback logic |
| Caller | Completion UI path when the service capability is unavailable |
| Runtime Reachable? | Conditional; not selected when the canonical service method is present |
| Write Authority? | The fallback is gate evaluation, while the actual write remains service/RPC controlled |
| Risk | Medium: capability-loading failure could reintroduce hidden PM/engineering evidence expectations |
| Evidence | completionGateStatus and acceptThroughCContract in golden-master-runtime.js |
| Recommendation | KEEP only as a fail-closed diagnostic until a later contract cleanup proves it can be removed; add a test that capability failure cannot silently replace C semantics |

### O4. Procurement entry has a stale asset cache-buster

| Field | Finding |
|---|---|
| Capability | Runtime asset loading |
| Current Authority | current version/build files and shared runtime |
| Other Route | app/Board/procurement/index.html references app-config.js with v=20260906-001 while the current build is 20260912-0921 |
| Caller | Procurement page browser loader |
| Runtime Reachable? | Yes |
| Write Authority? | No |
| Risk | Medium: cache/source confusion can make a developer inspect or run a stale asset and misdiagnose authority |
| Evidence | Procurement HTML query string differs from other current shared asset version queries |
| Recommendation | RETIRE the stale cache-buster in a release-hygiene change; do not mix that change into this read-only audit |

### O5. Instance movement RPC grant asymmetry needs explicit security proof

| Field | Finding |
|---|---|
| Capability | Cloud board instance movement |
| Current Authority | Authenticated shared gateway calling the controlled instance RPC |
| Other Route | Read-only pg_proc grant check reports anon EXECUTE on board_instance_move_task_workspace, while board_c_reconcile_workspace_decision_v2 is authenticated-only |
| Caller | Current Source calls through an authenticated runtime gateway |
| Runtime Reachable? | Cloud function is present; browser caller is authenticated in current product flow |
| Write Authority? | Yes |
| Risk | Medium/high until function-body actor/owner checks are explicitly verified; anon EXECUTE alone is not proof of an exploit, but it is a boundary inconsistency |
| Evidence | Read-only Supabase function/grant inventory; no function body or policy was changed |
| Recommendation | SECURITY REVIEW pending. Verify internal auth/owner checks and align grants only in a separately approved Cloud change; no mutation this round |

## 4. RED — current reachable wrong-flow authority

### R1. WorkTodo populated workspace deletion bulk-moves cards

| Field | Finding |
|---|---|
| Capability | Delete workspace with existing cards |
| Current Authority | WorkTodo adapter maps deleteWorkspace to worktodoDeleteWorkspace in shared/board/board-read-service.js |
| Other Route | AI Board/C generic delete path is guarded by rejectPopulated and does not perform the same fallback; C instance deletion uses its own controlled instance contract |
| Caller | shared/components/task-action-adapters.js WorkTodo delete action → golden-master-runtime.js workspace delete action → worktodoDeleteWorkspace |
| Runtime Reachable? | Yes, when WorkTodo deletes a populated workspace |
| Write Authority? | Yes; loops worktodo_update_task with a target workspace before finalization |
| Risk | Critical for Workflow V2 semantics: workspace deletion is treated as bulk relocation, without Current Step / Workflow Version reconciliation. It can make formal card location change as a side effect of deleting a workspace |
| Evidence | board-read-service.js worktodoDeleteWorkspace calls worktodo_request_delete_workspace, updates every task with workspace_id target, then calls worktodo_finalize_delete_workspace; it is not guarded by rejectPopulated |
| Recommendation | Original recommendation at audit start: STOP until a bounded fix was approved. The approved current-round route fix is recorded below; no direct WorkTodo workspace write remains in this delete path |

This RED finding was not a data incident: no delete action or Cloud mutation was
executed during the audit or the Developer QA.

### R1 remediation record — current round

- Original Finding: WorkTodo populated Workspace Delete looped through worktodo_update_task with a workspace_id patch, then finalized the delete. This made deletion imply card relocation outside C Workflow Reconciliation.
- Root Cause: The WorkTodo adapter passed only workspace and target IDs to worktodoDeleteWorkspace; its move callback directly used the WorkTodo task-update RPC instead of the already available shared C Workflow capability.
- Fix: board-read-service.js now reuses the supplied runtime workflow capability, or constructs the existing C v2 capability for the WorkTodo Board Instance, and routes every existing card through moveWorkspaceDecision with deterministic idempotency keys. task-action-adapters.js passes the same capability used by normal card movement.
- Authority After Fix: Module C C_WORKFLOW_CANONICAL_CONTRACT v2 remains the only movement/reconciliation authority. WorkTodo remains a Consumer and retains only its workspace-delete/finalization product contract.
- Regression Evidence: Targeted Source/Contract QA passed 49/49, including populated AI Board fail-closed behavior, WorkTodo one-card and multi-card reconciliation, empty WorkTodo deletion, no worktodo_update_task in the delete function, C v2 RPC ordering, and existing C consumer movement tests.
- Full Regression Evidence: 490 tests, 482 passed, 0 failed, 8 skipped. The test count increased by the new empty-Workspace route guard; all skipped cases are existing browser checks without CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE.
- Changed Files: shared/board/board-read-service.js (+26/-5), shared/components/task-action-adapters.js (+1/-1), tests/ai-board-cloud-read.test.js (+64/-9), tests/task-011-template-operation-parity.test.js (+8/-2), and tests/template-c-shared-action-conformance.test.js (+8/-2). Total tracked diff: 107 insertions, 19 deletions. The audit document is the separate documentation artifact.
- Cloud Read-back: Existing authenticated C v2 resolve/adopt/reconcile functions and WorkTodo request/finalize functions were confirmed present. No Cloud mutation, card mutation, workspace mutation, or delete action was executed.
- Final Status: Source route repaired; Developer QA passed. Formal deployed Runtime verification remains outside this round and is not represented as Runtime PASS.

## 5. Duplicate Logic / Duplicate Authority assessment

### Exact duplicates

An exact-content scan of current JavaScript under app, modules, and shared found no duplicate file bodies.

### Semantic duplicates

| Capability | Path A | Path B | Current caller | Current authority | Assessment |
|---|---|---|---|---|---|
| Board Instance resolution | createInstanceService instance resolver in board-read-service.js | createWorkflowCapability board resolver in the same shared file | Instance service and workflow capability | Same Cloud Board Instance tables/RPCs | Semantic duplication of resolver closures, not two product authorities; YELLOW. Do not refactor without measuring cache/ownership behavior |
| Card movement | shared C Workflow moveWorkspaceDecision | v1 direct moveTaskWorkspace / instanceMoveTaskWorkspace | v2 normal runtime; compatibility exports/tests/direct service surface | V2 workflow decision path | ORANGE compatibility surface; direct methods must not become a new caller |
| Lifecycle transition | v2 reconcileWorkspaceDecision | v1 transitionTask/reconcile/acceptance helpers | v2 normal runtime; legacy tests/fallback | V2 Contract | ORANGE; old write surface remains reachable conditionally |
| Cloud read/write gateway | supabase-gateway.js | repositories.js direct REST request | C Board uses gateway; WorkLog uses repository | Domain-specific and currently bounded | YELLOW; not a C duplicate, but a future developer could select the wrong path |
| Investment projection | one Cloud sync function | two JS callers invoke that same function | investment-cloud-bridge.js and supabase-investment-repository.js | Cloud sync_investment_ivtk_projection | Not a duplicate algorithm; YELLOW trigger duplication only |
| Template adoption/release | template-release-service.js | no second current service found | Management Center / C preview | template-release-service | GREEN |
| Task code generation | Cloud Board create RPCs | no frontend formal C code generator found | Board service create paths | Cloud RPC allocates work_code/identity | GREEN; do not add local generator |

## 6. Route and write-authority inventory

| Action | Current route | Alternate/legacy route | Direct frontend write? | Assessment |
|---|---|---|---|---|
| Task create | Shared Board service createTask or instanceCreateTask → controlled board RPC | WorkTodo product create RPC; WorkLog repository is separate domain | No C page direct INSERT found | GREEN by domain boundary |
| Task read | Shared Board service load → board_tasks/workspaces scoped by board instance/application scope | Investment projection read model and links | No local C SoT | GREEN |
| Task update | Shared Board service update/instance update → controlled RPC | WorkTodo update RPC; WorkLog REST repository | No C direct write found | YELLOW domain split, not C duplication |
| Task move | Shared runtime → task-action-adapters → C Workflow V2/adoption/instance decision | v1 board/instance direct move exports; repaired WorkTodo delete route | No direct C page write | ORANGE compatibility surface; original RED WorkTodo route is repaired, deployed verification pending |
| Task delete | Shared runtime → controlled C/instance delete contract | WorkTodo product delete contract | No direct C page delete found | YELLOW/ORANGE depending WorkTodo workspace deletion context |
| Workspace resolve/state | Shared Board service Cloud-scoped read and instance resolver | No local C state fallback found | No | GREEN |
| Workflow resolve/gate | createWorkflowCapability and Cloud v2 RPCs | v1 lifecycle helpers and conditional browser fallback | No direct formal state write | ORANGE compatibility surface |
| Board Instance resolve | Shared Board service resolvers and board instance Cloud tables/RPCs | Legacy application-scope resolver remains as compatibility input | No | YELLOW; owner/scope contract is still shared |
| Template adoption | template-release-service controlled Cloud release/adoption path | No current duplicate found | No | GREEN |
| Investment projection | one Cloud sync_investment_ivtk_projection function | two callers to same function | No local master copy | GREEN/YELLOW; idempotent Cloud authority |

## 7. Module C Consumer authority check

| Consumer | C renderer/runtime | Movement authority | Consumer extension | Result |
|---|---|---|---|---|
| C Mother / template preview | Shared Golden Master and shared runtime | Shared C Workflow capability | Template settings/release UI | GREEN |
| AI Board | Same shared renderer/runtime | Same shared C Workflow capability | Engineering/task data and capability policy | GREEN |
| WorkTodo | Same shared renderer/runtime | Same shared C Workflow path for normal move and populated-workspace delete relocation | WorkTodo data operations remain product-bounded | YELLOW overall; original RED delete route repaired, deployed verification pending |
| GAS / procurement | Same shared renderer/runtime | Same shared C Workflow capability | Vendor list and Vendor association extension | GREEN |
| Investment | Same shared renderer/runtime for board presentation | Read-only capability intentionally disables card movement/reorder | Position projection and IVTK data extension | GREEN approved capability difference |

No Consumer-specific C renderer, C Movement Engine, or private Workflow Engine was confirmed.
The WorkTodo delete route is a wrong product operation path, not evidence that WorkTodo owns a second C engine.

## 8. Workflow / fallback audit

### Confirmed healthy

- Current v2 movement resolves the Published Workflow and task binding from Cloud.
- Existing unbound cards can be adopted only when Cloud can uniquely validate the current Workspace UUID against a Published Workflow Step.
- No active v2 path was found that forces GPT to be a universal Developer QA gate.
- No active v2 path was found that maps status alone to Workspace or assignee.
- C Board reads are Cloud-scoped; localStorage is not the C Board source of truth.
- Investment read-only is a declared capability boundary and must remain so.

### Still risky

- v1 lifecycle helpers and RPCs remain exported and can write formal state.
- The runtime has a conditional v1 fallback when v2 capability is unavailable.
- Browser completion fallback contains evidence/gate language that must not become authoritative.
- WorkTodo workspace deletion can bulk-move cards outside Workflow V2 reconciliation.

## 9. Local, cache, and compatibility authority

| Mechanism | Current use | Can determine C formal state? | Classification |
|---|---|---|---|
| LocalStorage / LocalCache | WorkLog migration, draft/UI compatibility, legacy session support | No C Board caller found; C board reads Cloud | YELLOW KEEP |
| Supabase gateway 401 refresh fallback | Network/session compatibility when lifecycle is not loaded | No business-state authority | YELLOW KEEP |
| runtime-session-provider | Adapts legacy root session to shared runtime | No business-state authority | YELLOW KEEP |
| Legacy v1 RPCs | Formal Cloud writes if a caller invokes them | Yes | ORANGE RETIRE candidate |
| Compatibility repository | WorkLog/Knowledge REST writes | No C Board caller found | YELLOW KEEP |

No dangerous local fallback becoming C Board SoT was confirmed.

## 10. Source structure readability

| Area | Rating | Why |
|---|---|---|
| shared/board and shared/components C runtime | CLEAR | Shared service, action contract, adapters, renderer, and runtime are visible in one canonical area |
| C Mother / Consumer HTML script composition | CLEAR | All five entry points load the same shared C runtime stack |
| v1 and v2 lifecycle methods in board-read-service.js | HIGH-RISK CONFUSING | One large shared file exposes old and new write surfaces side by side |
| session-service / session-lifecycle / runtime-session-provider / session-manager | CONFUSING | Correct layering exists, but compatibility names can mislead new developers |
| Investment projection bridge plus repository trigger | CONFUSING | Two callers invoke one Cloud projection contract; no duplicate algorithm was found |
| procurement app-config cache-buster | CONFUSING | Asset query is older than current Runtime Build and can suggest a stale source |
| docs/00_CURRENT, docs/10_GOVERNANCE, docs/20_MODULES, docs/30_QA, docs/40_RELEASES, docs/90_ARCHIVE | CLEAR | Current index and Archive warning establish document authority |
| dist old candidate artifacts | CLEAR as historical artifacts | Not runtime source; must not be treated as implementation authority |

## 11. Legacy disposition

### KEEP

- Current shared C runtime, Golden Master, action contract, adapters, and workflow capability.
- Approved Investment read-only and Position projection extensions.
- GAS Vendor extensions.
- WorkLog repository/data compatibility, session adapters, and migrations while their callers remain.
- Current regression tests, including tests named after historical TASKs when they still protect a live contract.
- Historical Cloud migration files as release/audit records.

### ARCHIVE

- Historical documentation and old candidate artifacts already isolated under docs/90_ARCHIVE and dist.
- They remain reference-only and have no Runtime or implementation authority.

### RETIRE candidate

- v1 lifecycle write wrappers/RPC callers after v2 caller inventory, adoption, reconciliation, and regression pass.
- Direct instance move export if no approved caller remains after the canonical v2 path is proven.
- WorkTodo populated-workspace bulk relocation route, after a WorkTodo-specific retirement/reconciliation contract is approved.
- Procurement stale cache-buster in a release-hygiene change.

### DELETE candidate

None identified in this round. The previous cleanup already removed the two uncalled legacy implementations, and this audit found no additional deletion with sufficient evidence.

## 12. Cloud boundary read-back

Only read-only contract checks were made:

- Confirmed presence of C v2 workflow, adoption, reconciliation, retirement, Board Instance movement, WorkTodo, template release/adoption, and Investment projection functions.
- Confirmed RLS is enabled on inspected workflow, board, task, workspace, investment link, and position relations.
- Confirmed the current Investment projection read model has 11 positions, 11 active links, zero missing links, and zero duplicate links.
- Confirmed no Cloud mutation, migration, task mutation, workspace mutation, or data cleanup occurred.

The anon EXECUTE asymmetry for the instance movement function is recorded as O5 for a separate security review. This report does not infer an exploit without inspecting the function body and policies.

## 13. Recommended next-round order

This is a recommendation only; nothing below was executed.

1. Build a complete v2 caller inventory and prove which v1 write exports have zero production callers.
2. Resolve the WorkTodo populated-workspace retirement contract without automatic card relocation or guessed Workflow steps.
3. Add a fail-closed regression for v2 capability loss so browser evidence fallback cannot become an alternate Acceptance authority.
4. Review instance RPC grants and internal owner checks.
5. Remove stale procurement cache-buster as a bounded release-hygiene change.
6. Only after those proofs, retire old callers; do not delete first.

## Final audit answer to PM

- Duplicate Code: no exact duplicate file body found.
- Duplicate Logic: a small number of semantic/compatibility overlaps remain; the main ones are v1/v2 lifecycle surfaces, two Board Instance resolver closures, two Investment projection triggers to one Cloud function, and the separate WorkLog REST compatibility layer.
- Duplicate Authority: no confirmed second formal C Renderer, Movement Engine, Workflow Engine, or Template/Parity engine. v1 write surfaces are still exposed and therefore remain an authority risk.
- Wrong Flow: The original WorkTodo populated-workspace deletion bulk-move route was confirmed and is now repaired through the C v2 decision authority; the original finding remains in the R1 remediation record.
- Old Route: v1 lifecycle wrappers/RPCs remain as conditional compatibility paths.
- Dangerous Fallback: The direct WorkTodo deletion fallback is no longer present in the repaired function; C Board localStorage fallback is not confirmed.
- Consumer Reimplementation: not confirmed. Investment read-only and GAS Vendor features are bounded approved extensions; WorkTodo has a product-specific delete route that needs future contract cleanup.
- Historical material that can remain: archived docs, old release artifacts, and compatibility code with live callers, provided they are not allowed to decide C formal state.
- Items worth next cleanup: retire v1 write callers, prove RPC grants, add a capability-failure regression for browser completion fallback, and remove the stale asset cache-buster. The WorkTodo delete route should receive deployed Runtime verification, not another Source implementation.
- Items not to touch in this round: C Core movement, A+C composition, Workflow behavior, Investment feature logic, GAS feature logic, data, historical TASKs, and Candidate packaging.

**Round 2 result: Approved RED route repaired with minimal Caller/Route changes. Product Source Mutation is limited to the approved WorkTodo route and its regression tests; Cloud/Data Mutation = 0. Full Regression passed; stop for PM/GPT interpretation.**
