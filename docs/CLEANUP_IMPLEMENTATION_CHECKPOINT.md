# Cleanup implementation checkpoint — 2026-09-10

Status: WORKFLOW CAPABILITY V2 + LEGACY RECONCILIATION IMPLEMENTED; FINAL QA /
CANDIDATE PACKAGING CHECKPOINT.

## Current implementation authority and scope

The approved implementation baseline is
`65044cf9101c9096ffea7d3084831314583f9e09`. The current source checkpoint is
`1a6845835b59d2252883972145eca7f0254fb661` plus the explicit, PM-authorized
legacy reconciliation bridge recorded in this worktree. The canonical source is
the shared C Mother runtime and service; Consumers provide Board Instance
identity, capability flags, and their own workflow data only.

Historical TASKs were not inferred from title, status, assignee, or workspace.
The approved 33-card disposition was executed one card at a time through the
authenticated C reconciliation contract: 28 historical completions and 3
reverified completions were bound to the published completion step, while
TASK-010 and TASK-020 retained cancelled terminal semantics and were archived
in place. No Board Instance or Card identity was changed.

## Implemented in the C canonical sources

- `shared/board/board-read-service.js` exposes the single
  `module-c-lifecycle-acceptance-v2` capability. It resolves a Board
  Instance-owned Cloud Workflow, normalizes the editor/runtime boundary, and
  routes Draft, Validate, Publish, Adoption, Step Mapping, Card Resolution,
  Workspace Decision, Completion, and Reopen through the controlled RPCs.
- `shared/components/golden-master-runtime.js` mounts the shared `流程設定`
  capability for C Consumers, uses explicit Card Workflow Version / Current
  Step bindings, and fails visibly instead of guessing a Workspace or falling
  back to `待辦`.
- `shared/components/task-action-adapters.js` routes AI Board, WorkTodo, and C
  Template movement through the shared C Workflow capability. Investment keeps
  its read-only capability boundary.
- `shared/components/template-parity-engine.js` compares the v2 canonical
  behavior contract and reports the workflow-owner, version, current-step,
  Cloud-resolution, and no-runtime-inference checks without weakening the
  underlying parity rules.
- The shared Workflow Settings UI supports readable Step preview, Step
  editing/reordering, role and Workspace assignment, optional Gates/Evidence,
  legal transitions, draft save, immutable publish, read-only mode, and
  reload-backed Cloud state.

## Cloud implementation and safety boundary

Applied additive migrations:

- `20260910_c_workflow_capability_v2`
- `20260910_c_workflow_capability_v2_security`
- `20260910_c_workflow_card_binding_v2`
- `20260910_c_workflow_capability_v2_hardening`
- `c_workflow_publish_state_fix`
- `c_workflow_draft_lineage`
- `c_workflow_private_helper_security`
- `20260910_c_workflow_legacy_reconciliation_v2`
- `20260910_c_workflow_pm_actor_label_fix`
- `20260910_c_workflow_audit_entity_types_fix`
- `20260910_c_workflow_legacy_reconciliation_v2_cancelled_status_fix`

The eight public Workflow tables and private idempotency table exist with RLS
enabled. Browser roles have read-only table access; writes go through the
authenticated canonical RPCs. Private helper execution is revoked from
public/anon/authenticated. The insert trigger binds only newly created cards
when an explicit published workflow is available; it never backfills or
rewrites historical cards.

The legacy reconciliation and retirement RPCs are authenticated, owner-scoped,
idempotent, and one-card-at-a-time. They never guess a step, create a card,
move a card to `待辦` as a delete fallback, or rewrite existing evidence.

## Current verification

Commands run from the formal worktree:

```sh
node --check shared/board/board-read-service.js
node --check shared/components/golden-master-runtime.js
node --check shared/components/task-action-adapters.js
node --check shared/components/template-parity-engine.js
node --check shared/services/template-adoption-policy.js
git diff --check
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node --test --test-concurrency=4 tests/*.test.js tests/investment/*.test.js
node tools/release-governance.js preflight
```

- Syntax, whitespace, and Release Preflight: PASS.
- Full automated suite after the checkpoint update: 471/471 PASS, 0 FAIL, 0
  SKIP.
- Explicit Chrome browser suite: 8/8 PASS, including desktop and mobile
  viewport contracts; final runtime deployment remains outside this package
  gate.
- Build Identity is synchronized to `20260910-1235` across runtime literals,
  cache-busters, module manifests, and release metadata.
- No new test failure was introduced by the cleanup implementation.

### Current Cloud read-back

Project: `lenpbbhwxyyfwgvjcozf` (`QQ's Project`). The AI Board instance is
`74ff1127-ab98-4543-8f69-872e5d92fd33`. The published Workflow V2 is
`05557542-2f91-465a-bb14-3518105f9537`, version 1, status `published`.

The read-back reports: 1 definition, 1 published version, 1 instance workflow
state, 5 steps, 20 transitions, 1 completion gate, 0 evidence requirements,
0 adoptions, and 0 step mappings. The five steps are `待辦 → Co → GPT區 →
QJC驗證 → 完成`; GPT區 is not a mandatory transition. The formal completion
step is the `完成` step, not the retired `已完工` workspace.

The AI Board has 73 total cards. Thirty-one completion-class Legacy cards are
bound to the published completion step and appear in the formal completion
workspace; 2 cancelled cards remain in the legacy workspace with their original
status and are archived in place. The legacy workspace has no Published
Workflow references and no active non-terminal cards, and is soft-retired
(`active=false`, with `archived_at` set). The formal completion workspace has
57 cards. Reconciliation audit count is 33, retirement audit count is 1,
and the matching idempotency counts are 33 and 1. Card identity, original
timestamps, terminal metadata, cancellation history, existing evidence, and
merge history were preserved.

The three `VERIFIED_COMPLETE` records carry explicit `record_type=reverification`
evidence; the 28 historical completions retain historical-completion context;
TASK-010 and TASK-020 retain cancelled terminal semantics. No unclassified
historical card was guessed or batch-filled.

Supabase advisor notices are pre-existing project-wide findings (including the
intentional private idempotency RLS-without-policy notice and existing legacy
security-definer/performance notices); no new workflow-specific privilege
exposure was found. They are not silently represented as a clean project-wide
security audit.

### Cloud-backed placement verification

The existing production read path was exercised against the Cloud task rows in
an isolated DOM harness. Active cards render to their exact Cloud
`workspace_id`; unknown/inactive references fail visibly rather than falling
back to `待辦`. The source runtime filters inactive/archived workspaces from
the normal board. The currently deployed `20260910-1235` runtime was checked
before this candidate and still showed an empty legacy column, because it
predates the retirement read-path source; GitHub Pages deployment is not part
of this candidate and must be performed before PM Runtime QA.

## Historical pre-v2 audit (superseded, retained as evidence)

The earlier Phase 1 audit found the old `board_orchestrate_developer_qa` and
`board_transition_task` sequential paths, including the TASK-040-specific
legacy behavior. They remain historical migration definitions and are not the
canonical v2 runtime path. The current browser Runtime has no caller for the
old transition/orchestration path; the old definitions are retained in
migration history for recovery and audit rather than used to route the retired
workspace. The canonical retirement result is therefore a soft workspace
retirement with no destructive drop of historical Cloud functions.

The renderer no longer excludes active GPT workspaces or silently places
unknown references in `待辦`. The current C runtime instead uses explicit
Board Instance Workflow bindings and fails closed when a card has no binding.

## Delivery gate

Cloud reconciliation and workspace retirement are complete. Source has passed
final QA and requires the final commit, clean-tree verification, and the
FullSource Cleanup Candidate packaging step. GitHub Pages, Production Release,
further TASK/Card transitions, and PM Acceptance remain intentionally
unperformed.
