# Module C Workspace Creation × Workflow Binding Integration

## Source gate and identity

PM initially authorized Source implementation and Developer QA only.
Subsequent PM authorization permits one local commit and a FullSource export
of that commit. GPT Review, live Runtime/QJC QA, Cloud mutation, push and
deployment remain outside this authorization.

- Repository: `QQweasdzxc/zhuge-ai-os`
- Implementation branch: `work`
- Base HEAD / origin/main: `1133d66112f8633d003b41722c579c527fcc0de9`
- Version / Candidate Build: `0.9.0-alpha.9.13` / `20261001-2324`, unchanged
- Task: local Backlog `TASK-37`; this is not a new Cloud TASK record.
- The Developer QA JSON records the earlier uncommitted QA snapshot;
  its timestamps and flags are historical evidence. The export manifest
  records the subsequent local commit identity.
- No schema, RLS, migration, RPC signature, Secrets, Production or Cloud
  data changes. Cloud schema/RPC updates are not required by this change;
  it uses the existing installed Workflow authority.

## Resulting behavior

The shared Instance Service reads canonical Workflow configuration before
creating a Workspace. A Board without Published Workflow keeps its optional
Workflow behavior: create a Workspace through the existing RPC, without
creating or publishing a Workflow.

For a Board with Published Workflow, creation requires an explicit role,
non-completion status and publish confirmation. The shared drawer presents
those choices. The service enforces the same requirement for other callers;
omitting binding options cannot silently create another unbound Workspace.

The sequence is:

1. Read the Published version and reject an existing draft before creation.
2. Create the Workspace using `board_instance_create_workspace`.
3. Read Workflow state again and reject a detected version/draft conflict.
4. Copy the existing definition, steps, transitions, gates and evidence into
   the existing `saveDraft` capability, adding exactly one non-initial,
   non-completion Step for the new Workspace.
5. Call the existing `validateDraft` capability. Validation must return true.
6. Check draft lineage/content and Published pointer again before calling
   the existing `publish` capability with the expected Published version.
7. Read back the new Published pointer, Board identity and exactly one binding.
   Only this result produces the success message.

No transition or gate is invented for the added Step. The drawer explains
that it starts without new transition connections. Existing transitions,
role lists, gates, evidence requirements and their sort order are preserved.
Existing cards retain their previous version bindings; no adoption, movement,
task creation or status update is part of binding integration.

`private.board_c_resolve_workflow_create_state` and its exactly-one guard
remain unchanged. No new Workflow RPC, table, registry or repair authority
was introduced.

## Existing AI Board scope

The service owns one operation allowlist; the UI reads that same policy.
The Workspace menu offers **納入流程** only for these active, currently
unbound AI Board keys:

| Workspace | Canonical key |
|---|---|
| 資源分享與參考 | `task-custom-50ae893517654d71baac8d457061a46b` |
| 暫緩 | `task-custom-12c1399e29c9438e9abc28ce1cf115f9` |

The service verifies the Workspace is active and belongs to the resolved
AI Board. Existing Workspace binding does not create, rename or move a
Workspace. `TASK-081-E2E-20260922` is excluded. There is no automatic repair
on load, refresh or startup, and this task did not run either operation live.

## Partial progress and recovery

Workspace creation and Workflow publication are separate existing RPCs;
this integration does not claim a cross-RPC transaction.

- If a Workspace exists but save/validation/publish/read-back fails, its ID
  remains in the drawer for this session. Retry uses that Workspace, not
  another create RPC.
- If a create response is uncertain, the service retains the original
  workspace key for this session. Retry reads that canonical key; it never
  re-sends creation. If no row can be confirmed, it stops with an explicit
  uncertainty message.
- If a draft exists, automatic integration stops. The drawer offers the
  existing Workflow Settings surface for review rather than overwriting or
  deleting the draft.
- If publication succeeded but read-back failed, retry can recognize the
  already-published unique binding without another writer call.
- Session recovery state is transient UI/orchestration state, not a local
  Workspace or Workflow registry. After reload, inspect the canonical Board
  and Workflow before attempting another creation.

The existing saveDraft RPC does not provide an atomic compare-and-swap for
the absence of a draft. Re-reads detect observable conflicts, but cannot
eliminate a simultaneous write between separate RPC calls. Future authorized
Runtime QA must use an isolated Board with no concurrent Workflow editors.
Stronger multi-session transaction guarantees require separate authority
review; they are not claimed or implemented here.

## Developer QA evidence

The service tests use an in-memory gateway. Browser QA serves the existing
shared UI plus the real service/runtime over localhost HTTP, substitutes an
in-memory gateway, and blocks external browser requests. Fixture validation,
publication and read-back are Developer QA evidence, not live Cloud acceptance.

Coverage includes:

- Canonical authority order and exact-one Published read-back.
- Existing step/transition/gate/evidence preservation and unchanged cards.
- Both authorized existing AI Board Workspaces, excluded TASK-081, inactive
  and foreign Workspace rejection, and read-only restrictions.
- Optional and configured Workflow service behavior for WorkTodo, GAS and C.
- Explicit UI role/status/publish confirmation and optional UI behavior.
- Existing draft, observable concurrent changes, invalid validation,
  publication conflict, uncertain read-back and duplicate in-flight requests.
- Partial/uncertain creation recovery without a duplicate create operation.

Final counts, checks, baseline comparison and source hashes are recorded in
`developer-qa.json`. Full-suite file URL browser failures are reported
separately from this task's localhost fixture. They are not converted to PASS.

The initial formal release preflight was blocked by the uncommitted tree.
After the explicitly authorized local commit, clean-tree preflight is rerun
and its result is recorded in the export manifest. This does not turn the
eleven full-regression failures into PASS. The formal Candidate package
entry point requires full regression PASS, so this export is labeled a
local-commit FullSource snapshot, not a release-ready Candidate. It reuses
the existing source file filters, manifest and archive validation helpers.

The eleven failed test names in `full_regression.failed_tests` exactly match
`unchanged_head_browser_baseline.failed_tests` in `developer-qa.json`.
The before run was the selected browser checks on unchanged HEAD (16 tests,
5 PASS / 11 FAIL); the after run was the full suite (832 tests,
821 PASS / 11 FAIL). The compared failure-name sets are identical; the
different suite totals are not represented as equivalent full-suite runs.

## Next gate

HARD STOP after the authorized local commit and Source export. GPT Review
and any isolated Runtime/QJC mutation require the next PM decision. The two
live AI Board binding gaps remain unchanged by this Source-only task.
