# Lab_投資 In-Repository Migration

## Candidate identity

- Candidate Build: `20261001-1801`
- Canonical base Build: `20261001-1509`
- Canonical base branch: `codex/canonical-main-recovery-20261001`
- Canonical base commit: `66e3d44fef68459731c7bf8a9d15761bdfafc351`
- Candidate source commit: recorded in the external Candidate manifest after local commit.
- Release state: local Candidate only; not pushed, deployed, or published.

## What moved

The Zhuge-owned Investment Sandbox source now lives at `labs/investment/`. Only its browser application, first-party provider/domain modules, unit tests, documentation, package lock, and required MIT-licensed browser parser assets are included. The external Genspark repository, upstream snapshots, `.app` launcher, standalone API server, runtime cache, logs, screenshots, and `node_modules` are not copied into the AIOS source tree.

Formal Investment at `modules/investment/` is unchanged. Lab source is not imported or bundled by the formal Investment module. The single Lab Center registry entry points to `./investment/`; the action label is `進入 Lab`. The old `modules/labs/` entry is retained only as a relative compatibility redirect to the canonical `labs/` route.

## Runtime boundary

The intended user route is AIOS → Lab 實驗室 → Lab_投資 → 進入 Lab. The Lab and assets are same-origin static files. There is no required `.app`, localhost service, user Terminal step, separate repository, or standalone API server. The local browser QA harness served static files temporarily for test execution only; this was not part of the Lab runtime and is not a deployment claim.

No Product Data, Cloud, provider credential, formal Investment, or production runtime was mutated. Third-party provider access stays subject to its own CORS, terms, rate limits, and credential requirements.

## Access and data truth

There is no Demo/VIP/License/expiry gate in the Lab UI. This does not remove any provider's own access restrictions. A browser-inaccessible endpoint is rendered as `NOT_CONNECTED` / `SERVER_PROXY_REQUIRED`; no simulated value is substituted. See `LAB_INVESTMENT_RUNTIME_EVIDENCE.md` for the observed source-specific result.

## Candidate disposition

This is Developer QA evidence for GPT Review and PM Review. It is not a formal Investment graduation, Production deployment, or PM Runtime acceptance.
