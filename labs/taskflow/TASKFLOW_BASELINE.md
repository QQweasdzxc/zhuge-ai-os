# TaskFlow Development Baseline

## Baseline decision

- Canonical Zhuge `main` baseline: `dab0d2dfb1aaa6bb13d87c0d224c5730ce913027`.
- TaskFlow development branch: `taskflow-dev`, created from that canonical `main` and locally merged with the verified native Multica source snapshot.
- Native Zhuge source branch: `lab/multica-native`, snapshot `43e86b3ef7d5f7372cd6e1ab70786b96b2638c9d`.
- Render Web live deploy: `43e86b3ef7d5f7372cd6e1ab70786b96b2638c9d` (`zhuge-multica-lab`).
- Render API live deploy: `5c96e23bd6bece664e5019e5168c14ea4069a990` (`zhuge-multica-lab-api`), an ancestor of the native source snapshot. The commits after it change the Web readiness path/build and documentation; no backend source changed in that interval.
- Frozen Multica upstream: `multica-ai/multica@8db6cfe19ae6fd5c35ec71bd8fea42a3ef3861ec`, confirmed by `labs/multica/README.md` and both Dockerfiles.
- TaskFlow-owned frozen source: `third_party/multica/`, exported from the exact upstream commit above. All 6,432 tracked files, their content, and executable modes match the pinned Git tree; LICENSE and NOTICE hashes match upstream.

The native branch and canonical `main` diverged from an older common ancestor. This TaskFlow branch is **not** based on that ancestor: it starts at current `main` and merges the verified native snapshot. No reset, rollback, overwrite, or push of `main` was performed. The old Investment Candidate `0a31b1fe6635cf4d23310070c5dd2445af4ea8c5` was not used as the TaskFlow source baseline.

## Zhuge overlay retained from current main

All three requested Multica integration PRs are present in the TaskFlow baseline through current `main`:

| PR | Merge commit | Retained capability |
| --- | --- | --- |
| #35 | `84fb485252c6461d721e0a478cb386204c8898cb` | Lab Center entry and Zhuge session/UUID handoff to the self-hosted Multica runtime. |
| #36 | `baef18cba11e40e5a8b4f10dbec5ba44de1b3ce5` | API/Web warm-up, direct workspace Issues routing, and retry fallback. |
| #37 | `dab0d2dfb1aaa6bb13d87c0d224c5730ce913027` | Automatic entry after a valid Zhuge session is available. |

The launcher and registry overlap between the older native branch and newer `main`. Merge resolution deliberately retains the `main` versions of `labs/multica/index.html` and `labs/registry.json`, preserving the latest warm-up/direct-routing and Investment registry changes. Native build inputs are retained under `labs/multica/`.

## Native runtime inventory

The Render services are configured from the Zhuge repository branch `lab/multica-native`:

- Web service `zhuge-multica-lab`: `labs/multica/Dockerfile.web`, live at `43e86b3...`.
- API service `zhuge-multica-lab-api`: `labs/multica/Dockerfile.backend`, live at `5c96e23...`.

The native snapshot contains the upstream-pinned Web/API Docker builds, UUID and identity overrides, Zhuge handoff pages, readiness route, house-rule patchers, security/house-rule documents, and build workflow. Its existing `labs/multica/Dockerfile.*` files still clone the upstream at build time and are left unchanged as the Native Lab Golden Baseline. TaskFlow builds instead use the frozen local tree and its own upstream Dockerfiles:

```sh
docker build -f third_party/multica/Dockerfile -t taskflow-multica-api:local third_party/multica
docker build -f third_party/multica/Dockerfile.web -t taskflow-multica-web:local third_party/multica
```

Those TaskFlow build commands do not clone Multica source. `lab/multica-native` is a branch/service source name; repository paths are under `labs/multica/`.

Render's control plane reports both deployed services as `live`, and their service configuration points at the expected repository branch and Dockerfiles. Direct HTTP readiness probes from this execution environment returned `403`; this environment-level response is not treated as a runtime failure or as end-user authenticated acceptance.

## TaskFlow implementation gate

**READY FOR IMPLEMENTATION: YES.**

TaskFlow Dev contains current canonical `main`, the exact Multica Native Lab source snapshot used by the live Web deploy, and a complete local vendor copy of the frozen upstream source. Its local TaskFlow build uses the vendor tree and preserves the upstream LICENSE / NOTICE. The license and branding boundary is recorded in `labs/taskflow/THIRD_PARTY_MULTICA.md`. Future TaskFlow work must preserve the PR #35–#37 Zhuge overlay and keep Multica attribution in any derived UI. Do not rebuild from the Investment Candidate or advance the upstream pin without a separate review.

## Zhuge overlay commits

- `84fb485252c6461d721e0a478cb386204c8898cb` — PR #35.
- `baef18cba11e40e5a8b4f10dbec5ba44de1b3ce5` — PR #36.
- `dab0d2dfb1aaa6bb13d87c0d224c5730ce913027` — PR #37 and current main baseline.

This baseline correction adds no TaskFlow application implementation. The full upstream Git history (5,547 reachable commits) remains available through the pinned upstream repository/commit; the vendored source itself is an exact, tree-verified snapshot.
