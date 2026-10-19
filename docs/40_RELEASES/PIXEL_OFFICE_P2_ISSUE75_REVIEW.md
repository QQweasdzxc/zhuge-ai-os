# P2 Issue #75 — GPT Helper Lifecycle Candidate

- Version / Build: `0.9.0-alpha.9.85` / `20261019-1737`
- Parent candidate: #74 `306179accb87742a5afc08802ea968f7969cfd70` (`.9.84`)
- Formal baseline: main `.9.76` `a9db9b2fe3051e22d59e52ad083c8d54d12dba62`

## Candidate boundary

This is a P2-only, stacked review candidate based on the #74 candidate branch. It adds a pure TaskFlow child-Run lifecycle contract and fixture tests. It does not add a provider SDK/API call, dispatch, database migration, authenticated gateway, `OfficeSnapshot` field, Habblaud runtime adapter, UI, character, or live helper projection.

## Verified upstream interface

The pinned Habblaud `OfficeSnapshot` has `AgentInfo[]`; each `AgentInfo` has `kind: 'main' | 'sub'`, optional `parentId`, `sessionId`, provider restricted to `claude | codex`, status, tasks, and timing fields. It does not carry a TaskFlow parent Task/Run ID, child Task/Run ID, PM approval, or a verified GPT provider ACK. The existing protocol therefore cannot safely identify a real GPT child run as an office helper. This candidate deliberately does not fabricate those fields or mutate the snapshot.

## Candidate contract

`zhuge-gpt-helper-lifecycle.ts` accepts only a server-built, authenticated read-only TaskFlow event containing an approved GPT parent Task/Run, matching parent ACK, child Task/Run, explicit helper identity, dependency task IDs, event sequence/attempt, freshness, and matching child Provider ACK for any visible active helper. It reduces the real lifecycle (`created` → `assigned` → `running` → `waiting`/`blocked` → terminal) and requires an explicit new Run link for retry. Terminal entries are not projected as present helpers. Invalid, stale, mismatched, out-of-order, duplicated-conflict, or unauthorized records fail closed.

The `sessionAuthenticated` and `readOnly` values are structural claims, not authentication. A future server endpoint must establish Zhuge Session authorization and construct the record server-side. This TypeScript contract alone does not make the record trusted.

## Live status

**Live helper integration: BLOCKED.** No authenticated TaskFlow parent/child subtask feed or true GPT child Provider ACK is available in the current Habblaud integration. Existing Habblaud `AgentInfo` is not mapped from GitHub issues, PR counts, fixture data, or these contracts. No cloud dispatch or paid provider was activated.

## QA

- Local candidate QA: pinned Habblaud build PASS; 10 Vitest files / 103 tests PASS; P2 Node contract tests 15/15 PASS; TypeScript check PASS; `git diff --check` PASS.
- Candidate contract tests: 9 tests; SIMULATED_TEST_FIXTURE_ONLY.
- Exact-source Habblaud client build, Vitest/typecheck, browser regression, and FullSource artifact gates are required on this SHA before CTO review.
- P3 PRs #64, #65, and #69, main, Production, DB, Auth, secrets, Render, and paid providers are untouched.
