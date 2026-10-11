# BOX_BOUNDARY_BASELINE

Status: current-state boundary inventory only; no architecture refactor, data movement, service split or permissions changed.

| BOX | Source / release owner | API / execution boundary | Data and identity boundary | Shared failure points | Recovery boundary / confidence |
|---|---|---|---|---|---|
| TaskFlow | `labs/taskflow/**` plus frozen `third_party/multica/**`; release candidate identity is governed by root product VERSION/BUILD/COMMIT. | Separate TaskFlow API/Web/Shell services; TaskFlow API uses restricted `taskflow_runtime`, schema `taskflow`, search path `taskflow, extensions`. Agent Runtime remains PM-deferred. | TaskFlow task/workspace/project data in `taskflow`; human identity is Zhuge Auth/UUID, not separate Multica human identity. | Shared Supabase project/Supavisor, Zhuge login, Render services, GitHub source/Actions, external build package registries. | Source/schema boundary is documented and local negative tests exist; live full restore/hosting rollback and offline SSO are not verified. |
| WorkLog | `modules/worklog/**` and shared AIOS shell/navigation. | Embedded module/runtime routes within AIOS; exact independently deployable API footprint was not established in this bounded review. | Existing Zhuge shared Auth and canonical WorkLog data; current table/schema ownership must be checked against the specific feature before recovery. | Shared shell, Auth, public database/Supabase, AIOS hosting. | No WorkLog changes or backup/restore exercise in this review; independent recovery boundary NOT VERIFIED. |
| Investment | `modules/investment/**`, `labs/investment/**`; Official Investment is parked, Lab is active per PM direction. | Lab Investment UI runs within the Lab/AIOS surface and consumes canonical provider/data adapters; no service split was introduced here. | Canonical portfolio/watchlist/history are owner-scoped Zhuge data (existing `public` authorities); shared human identity. | Shared shell/Auth/Supabase public data and any market provider used by a feature. | No Investment code/data change or backup/restore exercise in this review; TaskFlow recovery bundle excludes Investment data. |
| Shared Zhuge Core | `shared/**`, application shell/auth and release identity. | Global shell, auth handoff, shared navigation/config. | Zhuge Auth and shared public-domain authorities. | Common login, product hosting, Supabase project. | Cross-BOX dependency; not independently recoverable from a TaskFlow-only bundle. |

## Boundary rules

- TaskFlow's source/image recovery package and `taskflow` DB backup are separate from WorkLog, Investment, `public`, `lab_multica`, Auth and Storage.
- TaskFlow identity uses Zhuge Auth but its runtime DB role must not gain rights to WorkLog/Investment schemas. A successful TaskFlow restore does not restore Zhuge Auth or another BOX.
- Shared shell/Auth/Supabase/Render remain common availability points; BOX separation does not imply infrastructure isolation or zero downtime.
- WorkLog and Investment schema/table-level recovery paths are marked unknown where this review did not verify exact ownership. Do not infer them from module folders.
- No changes to Native Lab, Legacy Board, WorkLog, Investment, Production Auth, shared Cron or Production data were made.
