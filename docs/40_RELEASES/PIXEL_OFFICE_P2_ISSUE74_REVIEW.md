# Pixel Office P2 Issue #74 — TaskFlow Run Status Contract

## Candidate identity and boundary

- Main baseline: `0.9.0-alpha.9.76` / `20261018-1932` / `a9db9b2fe3051e22d59e52ad083c8d54d12dba62`.
- Candidate parent: Issue #73 `0.9.0-alpha.9.83` / `20261019-1715` / `701e279ea8f9045c4cc130d2398ea5f77942b711`.
- Issue #74 candidate identity: `0.9.0-alpha.9.84` / `20261019-1724`; exact commit is recorded by the review branch and FullSource Manifest.
- Habblaud remains pinned to MIT upstream `faa1a012b5fbf632c66dc6801c5383e53a542406`; upstream/vendor files are not changed.
- No TaskFlow endpoint, provider, dispatch, account, database, secret, Production, or P3 surface is enabled or modified.

## Verified source boundary

The current Habblaud bridge reads the static `docs/status/project-status.json` for the HUD and uses its native same-origin `/api/snapshot` + `/api/stream` path for Habblaud session snapshots. Static project status, GitHub PRs, and issue counts do not become people or work status. The fixed Jackal/GPT/Codex/Gem cast remains informational and idle unless the existing Habblaud session source independently verifies a live native agent.

TaskFlow's existing AI Engineering panel still says settings are ephemeral, dispatch is unavailable, and no TaskFlow-verified Run exists. This source snapshot contains no authenticated TaskFlow Run read endpoint/provider ACK feed wired to the pixel office. Therefore Issue #74 Live Integration remains **BLOCKED**; no working character is enabled by this candidate.

## Candidate implementation

`integrations/habblaud/overrides/client/src/adapters/zhuge-taskflow-run-status.ts` adds a pure, read-only projection contract for a future authenticated TaskFlow Run read model. It performs no fetch, write, dispatch, or `OfficeSnapshot` mutation and is not wired into `zhuge-entry.ts`.

The contract requires a server-authenticated, read-only TaskFlow source, PM-approved Run, exact contributor/provider/task/Run identity, monotonic sequence and attempt, and bounded timestamps. `working` requires a matching accepted Provider ACK and a fresh heartbeat. Missing/mismatched ACK, unapproved Run, stale/future event, role mismatch, duplicate/out-of-order updates, overlapping Run, cancelled Run, or unavailable walk-grid route resolves to unknown/blocked/waiting rather than fabricated work. A client-supplied provenance flag is not an authorization proof; a future server gateway must enforce Zhuge session and TaskFlow read permission before constructing this response.

Synthetic fixtures are confined to `zhuge-taskflow-run-status.test.ts` and are explicitly labelled **SIMULATED**. They test contract and state-machine logic only and are not loaded by the runtime. The actual display remains unchanged.

## Local Developer QA

- P2 focused Habblaud Vitest: 9 files, 94 tests PASS.
- Habblaud TypeScript `tsc --noEmit`: PASS.
- Zhuge pixel office contract/furnishings/P2 Node suite: 15/15 PASS.
- Existing Habblaud bridge provenance check: PASS.
- Fresh pinned-upstream client build: PASS. Local Playwright Canvas smoke: BLOCKED because the environment had no Chromium binary and the Playwright CDN returned HTTP 403 while downloading it; exact-SHA GitHub Actions Canvas smoke must pass before CTO review.
- No iPhone Safari, live TaskFlow Session, live Run, or Provider ACK runtime test was possible or claimed.

## Next gate

Before connecting this read-only adapter to a person animation, the backend must expose an approved authenticated read-only Run feed with real Task ID, Run ID, PM approval, matching Provider ACK, heartbeat/freshness, and retry/cancel terminal states. The server-side auth/role policy and C09 contract must be independently verified. Until then, keep live integration disabled and display no verifiable state.

## Release state

Candidate only. No main push, Production deployment, database migration, Provider activation, or P3 work was performed. Review and Browser Regression Actions must pass against the exact candidate SHA; PM acceptance remains outstanding.
