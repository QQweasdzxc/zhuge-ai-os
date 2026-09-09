# Cleanup implementation checkpoint — 2026-09-10

Status: WORKFLOW CAPABILITY V2 IMPLEMENTED; FINAL QA / CANDIDATE PACKAGING
CHECKPOINT.

## Current implementation authority and scope

The approved implementation baseline is
`65044cf9101c9096ffea7d3084831314583f9e09`. This checkpoint records the
approved Module C Workflow Capability v2 implementation and the earlier
workspace-placement cleanup it supersedes. The canonical source is the shared
C Mother runtime and service; Consumers provide Board Instance identity and
capability flags only.

The implementation does not infer or batch-reconcile historical TASKs. Existing
cards remain untouched until a future explicit Adoption / Step Mapping / PM
classification flow is run. No Board Instance or Card identity was changed.

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

The eight public Workflow tables and private idempotency table exist with RLS
enabled. Browser roles have read-only table access; writes go through the
authenticated canonical RPCs. Private helper execution is revoked from
public/anon/authenticated. The insert trigger binds only newly created cards
when an explicit published workflow is available; it never backfills or
rewrites historical cards.

The latest Cloud read-back recorded zero Workflow definitions, zero published
versions, zero adoptions, zero mappings, and zero bound historical cards out
of 118 total cards. This is an intentional safe state under the approved
no-guess/no-batch-mutation rule, not a hidden runtime fallback.

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
- Full automated suite: 471/471 PASS, 0 FAIL, 0 SKIP.
- Explicit Chrome browser suite: 6/6 PASS, including desktop and mobile
  viewport contracts.
- Build Identity is synchronized to `20260910-0148` across runtime literals,
  cache-busters, module manifests, and release metadata.
- No new test failure was introduced by the cleanup implementation.

### Current Cloud read-back

Project: `lenpbbhwxyyfwgvjcozf` (`lenpbbhwxyyfwgvjcozf`). The eight public
Workflow tables exist with RLS enabled and authenticated SELECT-only table
grants. Controlled authenticated RPCs expose the approved write boundary;
anonymous execute is revoked. The private idempotency table has no browser
grants or policies, and private Workflow helpers have public/anon/authenticated
EXECUTE revoked.

Counts: definitions 0, workflow states 0, steps 0, transitions 0, gates 0,
evidence requirements 0, adoptions 0, step mappings 0, bound historical cards
0, total cards 118. Existing Board/Card data and identities were not mutated.
This is intentional: no historical Workflow Version / Current Step is guessed
or batch-filled. New workflows are created through the shared C Settings
contract and cards bind only when an explicit published workflow exists.

Supabase advisor notices are pre-existing project-wide findings (including the
intentional private idempotency RLS-without-policy notice and existing legacy
security-definer/performance notices); no new workflow-specific privilege
exposure was found. They are not silently represented as a clean project-wide
security audit.

### Cloud-backed placement verification

The existing production read path was exercised against the Cloud task rows in
an isolated DOM harness. Active cards rendered to their exact Cloud
`workspace_id`; unknown/inactive references fail visibly rather than falling
back to `待辦`. No TASK, Workspace, Board, or Card rows were changed.

## Historical pre-v2 audit (superseded, retained as evidence)

The earlier Phase 1 audit found the old `board_orchestrate_developer_qa` and
`board_transition_task` sequential paths, including the TASK-040-specific
legacy behavior. They remain historical migration definitions and are not the
canonical v2 runtime path. Their retirement is gated by the v2 caller/adoption
and reconciliation checks; removing them before safe adoption would leave
existing unbound cards without a recoverable path, so no destructive retirement
or historical data rewrite is claimed in this Candidate.

The renderer no longer excludes active GPT workspaces or silently places
unknown references in `待辦`. The current C runtime instead uses explicit
Board Instance Workflow bindings and fails closed when a card has no binding.

## Delivery gate

Source is ready for the final commit, clean-tree verification, and the
FullSource Cleanup Candidate packaging step. GitHub Pages, Production Release,
TASK/Card transitions, and PM Acceptance remain intentionally unperformed.
