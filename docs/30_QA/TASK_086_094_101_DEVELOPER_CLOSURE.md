# TASK-086 / TASK-094 / TASK-101 Developer Closure

This closure records the current source-level acceptance boundary. It does
not claim Cloud deployment, provider activation, production migration, or live
human acceptance.

## TASK-086 — Shared AI Context

**Developer status: PASS.**

- Shared attachment context serializes bounded text or in-memory image input.
- PDF input is parsed through the existing attachment reader before the AI
  reader; raw storage paths, signed URLs, browser tokens, and write commands
  are excluded.
- `task-attachment-ai-read` is an authenticated, read-only Edge adapter with
  bounded input, sanitized structured output, timeout/retry handling, and
  explicit ready / insufficient / unavailable states.
- Existing Task Drawer consumers render the result without creating a second
  attachment or Task authority.
- Evidence: `tests/task-086-ai-reader.test.js`,
  `tests/task-086-edge-reader.test.js`, and the Shared Attachment Context
  source checks.

**Human-only gate:** deploy the Edge function and configure the protected
`OPENAI_API_KEY` secret before live provider QA.

## TASK-094 — LINE Task Adapter

**Developer status: PASS.**

- Commands are allowlisted and resolve identity, Board, Workspace, and Task
  through a protected server boundary.
- Progress accepts only 0/25/50/75/100; blocked and delayed require their
  evidence; completion requires 100%.
- Timeout is bounded to 8 seconds with a 10-second hard ceiling. Only an
  explicit transient provider rejection may receive one retry; timeout is not
  retried because delivery is uncertain.
- Atomic idempotency claims prevent duplicate sends and allow validated stale
  pending reclaim.
- Evidence: `tests/task-094-line-task-adapter.test.js`,
  `tests/task-094-line-messaging-adapter.test.js`,
  `docs/30_QA/TASK_094_LINE_TASK_ADAPTER_CONTRACT.md`.

**Human-only gate:** configure LINE provider credentials/webhook deployment
and perform a real LIFF/Messaging API runtime test.

## TASK-101 — Workflow Studio 2.0

**Developer status: PASS.**

- Workspace cards are visual nodes and transitions are visual arrows; the
  canvas never becomes a second workflow SSOT.
- Draft/published separation, add/remove connection, valid zero-connection
  workflows, branch transitions, validation, before/after diff, undo/redo,
  immutable version restore, and runtime overlay are present.
- Restore uses the canonical RPC and creates a new draft from an immutable
  source version rather than editing history.
- Evidence: `tests/workflow-studio.test.js`,
  `docs/supabase/20260926_task_101_workflow_restore_version.sql`.

**Human-only gate:** apply the additive migration and perform authenticated
runtime QA against a controlled workflow; no production workflow is changed by
the Developer QA suite.

## Shared boundaries

All three slices preserve canonical Board/Module C authority, do not use raw
SQL or direct Product Data DML, do not add a second Task/Workflow/Attachment
SSOT, and do not require production deployment for the deterministic tests.
