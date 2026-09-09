# Cleanup implementation checkpoint — 2026-09-09

Status: PARTIAL IMPLEMENTATION; NOT A FINAL CLEANUP CANDIDATE.

## Authority and scope

PM confirmed `50fc9ed7aba8f688dce1d909258da7d13bfd060a` as the implementation
baseline. This checkpoint implements only the explicitly confirmed workspace
rendering defects and retires the uncalled client-side sequential planner.
It does not invent a work-type routing policy, develop another TASK, change
Consumer pages, mutate Cloud records, or claim PM Acceptance.

## Implemented in the C canonical sources

- `shared/components/golden-master-runtime.js`: active Cloud workspaces are no
  longer excluded by the `gpt` role or historical display names. Archived
  workspaces stay excluded and existing Consumer scope/instance filters remain.
- Task grouping uses the original Cloud `workspace_id` only. Unknown or
  inactive workspace references produce an error in the existing banner;
  they are not silently placed in `todo`.
- `shared/board/board-read-service.js`: removed `QJC_TRANSITIONS`,
  `planTransition`, and `availableTransitions`. Repository call-site search
  found no production callers; only obsolete tests referenced these exports.
  The existing `module-c-lifecycle-acceptance-v1` capability and controlled
  workspace-decision RPC remain the canonical PM movement path.
- Updated only tests that asserted the retired exclusion/sequential mechanism.
  Checklist evidence assertions and canonical acceptance/atomicity regression
  remain. Added six executable production-function tests for placement,
  fail-visible handling, archive boundaries, scope/instance isolation and
  retirement of the unused planner.

No source file was deleted. Removed code remains recoverable in Git.
Historical migration files and audit documents were not rewritten or deleted.

## Verification so far

Commands run from the formal worktree:

```sh
node --check shared/components/golden-master-runtime.js
node --check shared/board/board-read-service.js
git diff --check
node --test tests/cleanup-workspace-placement.test.js tests/ai-board-cloud-read.test.js tests/task-033-governance.test.js tests/ai-board-free-workspace.test.js tests/ai-board-lifecycle-consistency.test.js
node --test tests/template-parity-engine.test.js tests/investment/ivtk-board-adapter.test.js tests/ai-board-lifecycle-consistency.test.js tests/task-067-workspace-reorder.test.js
node --test --test-concurrency=4 tests/*.test.js tests/investment/*.test.js
```

- Syntax and whitespace: PASS.
- Focused tests: 58/58 PASS.
- Scoped parity/lifecycle/Investment read-only/reorder: 46/46 PASS.
- Baseline suite: 459 tests, 445 PASS, 6 FAIL, 8 SKIP.
- Modified suite: 465 tests, 451 PASS, the same 6 FAIL, 8 SKIP.
- New failures in this comparison: 0. Full Regression is NOT PASS.
- Browser discovery did not find Chrome on PATH, so eight browser tests were
  skipped. A macOS Chrome executable exists; explicit browser execution,
  Desktop/Mobile visual QA and New Session QA remain outstanding.
- TAP evidence for this run: `/tmp/zhuge-cleanup-qa.xuf1aZ/` (not packaged).

Unchanged baseline failure names:

1. Drawer replaces PM-visible Assignee with an in-drawer GPT Analysis entry
2. C route loads the canonical Cloud MDTK host and shared runtime
3. formal pages defer navigation mounting to the shared adoption lifecycle
4. C Mother Template, AI Board, and WorkTodo share one Board/Card/Drawer runtime contract
5. Module A exposes Management as a peer of Control Console and keeps GAS isolated
6. Template Management Center derives consumers and counts from the canonical Registry

### Live Cloud read-back through production rendering functions

Read-only snapshot: `2026-09-09T15:43:00.663129Z`, project
`lenpbbhwxyyfwgvjcozf`, AI Board instance
`74ff1127-ab98-4543-8f69-872e5d92fd33`.

73 Cloud task rows were normalized by the existing adapter and passed through
the production workspace selection/task rendering functions in an isolated
DOM harness. 16 cards were active according to the unchanged archive model;
all 16 rendered into their exact Cloud workspace UUID. Placement mismatch = 0.
TASK-063/064/065 rendered in GPT區; TASK-057/068 in QJC驗證. Their Cloud
status, assignee and workspace were not changed. This is Cloud-backed
production-function QA, NOT a deployed-browser or end-to-end handoff PASS.

Cloud also still marks the separate `GPT` and historical `已完工` workspaces
active. Both are empty in this read-back. The renderer no longer conceals
active rows; deciding whether to retire these Cloud workspaces is a separate
metadata decision, not something to mask by a new fallback or name filter.

## Remaining workflow gate — do not guess

The live `board_orchestrate_developer_qa` definition still:

- unconditionally resolves a `gpt` workspace;
- creates required GPT review/regression checklist records;
- writes `qa / GPT / gpt-workspace` on every Developer QA handoff;
- includes a `TASK-040` grandfathered special case.

`board_transition_task` also retains the sequential engineering review gates.
These Cloud definitions were read, not invoked or modified. Changing only
the Renderer cannot retire that server-side workflow.

No current work-type-to-handoff Workflow Definition, Current-State Map or
Gap Report was found in this baseline, the workspace audit/document folders,
or the queried canonical Cloud knowledge/settings records. The older
`TASK_022_WORKFLOW_ENHANCEMENT.md` specifies mandatory GPT review, while the
TASK-040 migration header describes Co -> QJC. Neither resolves the newly
requested work-type-dependent policy. Task category/domain are also often
null, so inferring a policy from those fields would be guessing.

Needed before continuing this part: the PM-approved work-type -> receiving
role/workspace -> required evidence definition, plus the current retirement
inventory for any additional file deletion. Do not implement TASK-074's
workflow editor, add task-ID exceptions, default every QA task to GPT or QJC,
rewrite historical migrations, or repair real TASK rows to bypass this gap.

## Delivery gate

Cleanup remains incomplete. No new release Build, FullSource ZIP, manifest,
Pages deployment, Cloud migration, TASK transition or PM Acceptance has been
performed. Source-declared Build remains `20260909-2158`; it is NOT a new
Cleanup Candidate identity. After the workflow gate is resolved, finish the
approved cleanup, run full Final QA, align a fresh delivery Build and package
only after the requested gates pass.
