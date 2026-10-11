# UPSTREAM_OFFLINE_ACCEPTANCE

Status: source/config inventory and local isolated subtests only. Full original-author network-denial acceptance is NOT VERIFIED. `.9.31` remains the live baseline.

## Dependency matrix

| Dependency | Evidence/source | Class | Expected behavior if unavailable | Acceptance |
|---|---|---|---|---|
| Multica Cloud/remote runtime | `third_party/multica/server/cmd/cmd_agent.go`; server router; web connect-remote dialog. TaskFlow backend sets `MULTICA_CLOUD_URL=`; web disables cloud runtime UI. | Runtime optional for local Task/Project/Workspace; remote runtime is PM-deferred. | Local TaskFlow core should keep working; cloud/remote features unavailable. | Config/source checked; whole-app egress denial not run. |
| Multica telemetry | `third_party/multica/server/internal/selfhosttelemetry/client.go`; TaskFlow backend sets `DO_NOT_TRACK=1`. | Runtime optional. | No telemetry. | Config checked; packet trace not run. |
| PostHog analytics | `third_party/multica/server/internal/analytics/client.go`; TaskFlow sets `ANALYTICS_DISABLED=true`. | Runtime optional. | No analytics. | Config checked; packet trace not run. |
| Updater/GitHub releases | `third_party/multica/server/internal/cli/update.go`, Daemon update paths. Supports no-auto-update / mirror settings. | CLI/Daemon only, optional; Daemon activation PM-deferred. | Update checks/download unavailable; pinned binary remains usable. | Not exercised. |
| GitHub release metadata/stars | `third_party/multica/apps/web/...` update, landing and stars hooks; API GitHub endpoints. | User-facing optional. | Version/star count omitted or stale; task payload not required. | Source reviewed; no network denial. |
| Docs/attribution links | TaskFlow help launcher plus native view help links and onboarding shims. | User-click-only. | Documentation page unavailable. | Source reviewed. Keep attribution visible. |
| Skill imports | `third_party/multica/server/internal/handler/skill.go`; UI skills page references GitHub/raw GitHub/skills.sh/ClawHub. | User-triggered optional external downloads. | New external skill search/import fails; existing persisted skills remain. | Not exercised. |
| Stock upstream GHCR images | `third_party/multica/docker-compose.selfhost.yml`. | Build/deploy path for stock Multica compose, not TaskFlow wrappers. | Stock compose pull unavailable. TaskFlow wrappers build from vendored source. | Static path check only. |
| TaskFlow source | `labs/taskflow/Dockerfile.backend`, `Dockerfile.web`; both copy `third_party/multica` and assert pinned SHA. | Required build input but locally held. | Build can use held source, subject to dependency/image availability. | Static PASS; vendor tree SHA matches main. |
| Docker Hub bases / Alpine APK / package registries / Google Fonts | TaskFlow Dockerfiles and upstream manifests/lockfiles. DockerHub base images, APK indexes, Go modules, npm/pnpm packages and font fetch are external build dependencies. | Build-time. | Cold build fails without available base images/packages/fonts/cache. | Docker stopped at APK access; offline cold build NOT VERIFIED. |
| GitHub Actions / Zhuge repo | TaskFlow build parity workflow and source repository. | CI/release; not a per-request TaskFlow runtime dependency. | Builds/releases cannot be triggered/read through the current tool path. | Review branch exists; no workflow run. |
| Zhuge Auth / Supabase / Render | Current TaskFlow identity, database and hosting arrangement. | Our platform/provider dependency, not Multica author operation. | Their outage affects login/data/service independent of upstream independence. | Not tested here; this audit does not claim total third-party independence. |
| Multica LICENSE / NOTICE / branding | `third_party/multica/LICENSE`, `NOTICE` and UI brand mark. | Legal/IP obligation, not an online endpoint. | Remains applicable while derivative source is used. | Preserved; not removable by network-denial exercise. |

## Reproducible isolated test plan

1. Build an isolated VM/container from the approved release source/image archive. Keep normal Zhuge/Supabase/Auth and package mirror access separately allowlisted; deny only the inventoried Multica-author service hosts (not all GitHub, which also hosts Zhuge source).
2. Capture DNS and egress logs with destination, process and timestamps; do not include access tokens, cookies or payloads. Confirm no requests to Multica Cloud, telemetry, update or author-controlled APIs during startup and core use.
3. Build API/Web from local source and approved cached base images/packages. If any DockerHub/APK/npm/pnpm/Go/font fetch is required, classify as external build supply-chain dependency; this does not prove author-runtime dependence, but it fails a fully offline rebuild gate.
4. Use an isolated TaskFlow database snapshot or synthetic fixture and a controlled Zhuge test identity. Test Zhuge SSO, Workspace list, QA Project A/ZG-1 and Project B/ZG-2, project switch, Task read/filter, Board/List/Table/Swimlane, refresh/persistence, and error recovery while author hosts are denied.
5. Verify external optional flows fail in a bounded way: docs, stars, updater, skill search/import. Existing local data must not be deleted or silently replaced; offline state must be visible.
6. Re-enable connectivity in the disposable environment, verify recovery, then destroy it. Production DNS/egress, Render, Auth, DB and Native Lab remain untouched.

## Current evidence

- Candidate and remote mirror share the exact Git tree; TaskFlow Docker wrappers use the locally pinned `third_party/multica` source rather than cloning application source.
- The isolated internal Docker network passed local migration and webhook queue tests; synthetic TaskFlow DB restore passed.
- These tests do not exercise the full Web/API against a denied Multica domain set, do not use PM's real session, and do not read QA projects under that denial.
- The Docker images were not produced; the environment failed before app build at Alpine APK package access. No offline image archive exists for `.9.32`.

**Conclusion:** original-author source acquisition is avoidable for TaskFlow build because source is vendored. Original-author core runtime dependency is plausibly disabled by configuration but not certified. Full offline operation, real Zhuge sign-in and project/task usability under upstream denial remain NOT VERIFIED. Package/image mirrors and Zhuge's own hosting/Auth/DB are separate dependencies.
