# Repository / Runtime Recovery — Candidate Developer QA

- Canonical TASK ID: `5d641a7d-565c-44c8-a606-29a37cf1c335`
- Current TASK: `Repository / Runtime Recovery`
- Stage at Startup Gate: `recovery_planning / ready_for_engineering`
- Product Version: `v0.9.0-alpha.9.13`
- Candidate Build ID: `20260814-1549` (Asia/Taipei)
- Recovery Workspace: `/Users/qq/Documents/Zhuge AI OS/Worktrees/recovery-5d641a7d-20260814`
- Recovery Branch: `recovery/task-5d641a7d-20260814`
- Recovery Source Commit: `c5c30c513fb9b1df97c7efb01eb49d8e5e5c5665`

## Recovery source boundary

- Current dirty Worktree remained the Code Truth and was copied into this
  isolated Recovery Workspace; the original Worktree was not rolled back,
  reset, or overwritten.
- Recovery Reference was read from the canonical Artifact Root only as an
  immutable historical diff reference:
  `20260812_2215_Candidate.zip`
- Recovery Reference SHA-256:
  `490cee1da5a013c183b4dba5578fdd15c4b8bddfaaacff78e9739a2a5585b9d7`
- The historical Reference is `v0.9.0-alpha.9.12 / 20260812-2215` and was
  not used to overwrite Current Source.

## Scoped integration

- Preserved existing Product Source, Creator Resolver / Creator MFA,
  Trusted Agent Read, PM-authorized Governance Write, Artifact Governance,
  Engineering Memory, WorkLog, Investment, AI Board, and Shared OS Shell.
- Applied only the PM-approved Recovery identity integration: Version
  `v0.9.0-alpha.9.13`, new Build `20260814-1549`, matching runtime metadata,
  entry-point cache-busting, and the corresponding release-test fixtures.
- No unrelated Feature, UI redesign, architecture expansion, GitHub restore,
  Production Runtime change, or PM Accepted Product Baseline write.

## Developer QA evidence

- `BROWSER_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome node --test tests/*.test.js tests/investment/*.test.js`
  — **121 pass, 0 fail, 0 skipped**.
- `find . -type f -name '*.js' ... | xargs ... node --check` — **PASS**.
- Recursive JSON parse for source manifests — **PASS**.
- `git diff --check` — **PASS**.
- Root, WorkLog, Investment, shared runtime metadata and cache-busting —
  **PASS**, all aligned to `v0.9.0-alpha.9.13 / 20260814-1549`.
- Candidate package must be generated only after these checks and registered
  only through the PM-authorized `register_artifact` path as `candidate`.

## PM / QJC handoff boundary

- Candidate is not PM Accepted Product Baseline.
- PM/QJC Runtime QA remains required; Creator MFA PM QA resumes after a trusted
  Runtime/Preview exists.
- GitHub Product Repository and Production Runtime remain unchanged.
