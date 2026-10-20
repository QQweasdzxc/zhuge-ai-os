# TaskFlow Phase 2 Integration Gap

Review line: `review/co01-phase2-integration-20261020`

Baseline: `0.9.0-alpha.9.101` / `20261020-1930` / `c0ea0e3e1f65acfe2d2f3f02e0e48f3fdee919e8`

## Sources reviewed

| Source | SHA | Decision |
| --- | --- | --- |
| CO-02 PR #108 | `462841745a15e57e1f981bbc4b6d6e3c34515440` (supersedes review candidate `c34af61d8dbde4726e5c19784f2c8e9e7a9f68b1`) | Selective Phase 2 contract integration; the branch is not a safe whole-tree merge because it is based on an older release line. Latest hardening was absorbed as a functional delta only. |
| PR #107 runtime base | `80f61c9ce8ba6f52659dbbec5f3ab9749df0e720` | Functional commits reviewed; release-identity commits excluded. |
| PR #106 runtime base | `ab60ecd10d868b67dafbf2514773a6ce0985db26` | Functional commits reviewed; release-identity commits excluded. |
| CO-03 PR #103 | `f11771e08ab8cd809619bb8dd728dfc82c7a5177` | Read-only workbench/read-model changes selectively absorbed; older app shell retained where it contained newer Phase 1 behavior. |

## Integrated in this review line

Selected functional commits are preserved as separate commits in the review line:

- `97793681` — durable dispatch/provider contracts, schema, authority validation and negative tests.
- `6cace36b` — runtime projector, native persistence adapter contract, fail-closed dispatch overlay and tests.
- `83a19960` — Docker-safe route overlay fix from `fa1fea22`.
- `25405c4a` — provider callback, replay, heartbeat and evidence hardening from `f8202958`.
- `31779f9e` — CO-03 evidence fields and executor/read-model handoff.
- `45f9f6b0` — runtime read-model normalization and tests.
- `d369bdc5` — latest PR #108 hardening: duplicate-ACK rejection, lease release on provider boundary, process-scoped transaction evidence, Workbench envelope schema and Provider decision matrix.

The existing TaskFlow app shell, Phase 1 authentication, Pixel Office, family/pet integration and Production release files remain from the `.9.101` baseline. No Frozen Multica source file is changed and no path is deleted.

## Capability matrix

### Safe to review/integrate now

- Read-only native issue, task-run and GitHub evidence read model.
- Versioned dispatch persistence/replay reducer and fencing contract in isolation.
- Provider callback validation, duplicate/replay rejection and explicit `UNKNOWN`/`BLOCKED`/`STALE` states.
- Server-side CTO authority primitive and a TaskFlow-owned `/dispatch` overlay path that fails closed when the allowlist is absent.
- Desktop/mobile workbench adapter consumes the same native runtime read model without a second task store.

### Still blocked or not verified

- Production CTO allowlist is not configured/read back; no production ACL or Secret was changed.
- No official Codex/Gem/GH provider binding, signed callback, Provider ACK, Provider Run ID or live run readback is available. A native TaskFlow `202`/task ID remains `ACK_PENDING`, not a Provider run.
- The persistence adapter is a tested contract only; it is not connected to a Production database transaction, migration or row lock.
- Real authenticated Production dispatch, provider callback and cross-process race tests are not run in this review line.
- Exact-SHA Docker/Go and Browser CI for the new review SHA are pending; local Docker is blocked by the environment's Alpine APK registry permission error.
- PM Desktop/Mobile runtime acceptance and Production deployment are not authorized in this phase.

## Rollback and boundary

The review line is based on `origin/main` at the `.9.101` SHA. Rollback is a review-branch discard; `main`, Render, Supabase, Auth, Secrets and Production data remain unchanged. Any later promotion must use a new synchronized Version/Build, exact-SHA QA and an independent PM release gate.

