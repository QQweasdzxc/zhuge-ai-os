# TaskFlow first usable version deployment

TaskFlow is the future formal Zhuge work system, not a separate test product.
It uses the existing Zhuge Supabase project and the dedicated `taskflow`
schema. `public` and `lab_multica` remain outside its data boundary. The Web/API
images build from the pinned local source at `third_party/multica/` and use the
TaskFlow-owned Docker wrappers. The static Zhuge shell is built from this
branch so its shared WORK navigation and TaskFlow entry use the Zhuge login
session.

## Services

- Static shell: `node labs/taskflow/build-dev-shell.mjs`
- TaskFlow Web: `labs/taskflow/Dockerfile.web`, repository-root build context
- TaskFlow API: `labs/taskflow/Dockerfile.backend`, repository-root build context
- Database: existing Supabase project `lenpbbhwxyyfwgvjcozf`, schema `taskflow`

The shell builder requires three HTTPS service origins through
`TASKFLOW_SHELL_ORIGIN`, `TASKFLOW_WEB_URL`, and `TASKFLOW_API_URL`. It emits
only the two public Web/API origins into `labs/taskflow/runtime-config.js`; it
does not include tokens or credentials. It excludes the frozen `third_party`
source tree and test files from the published shell.

## Private runtime configuration

Set these only in the TaskFlow service environment:

- API: `DATABASE_URL`, `JWT_SECRET`, `ZHUGE_SUPABASE_URL`,
  `ZHUGE_SUPABASE_ANON_KEY`, `FRONTEND_ORIGIN`, `CORS_ALLOWED_ORIGINS`,
  `MULTICA_APP_URL`, `MULTICA_PUBLIC_URL`
- Web: `REMOTE_API_URL`, `TASKFLOW_ENTRY_ORIGINS`,
  `NEXT_PUBLIC_ENABLE_CLOUD_RUNTIME=false`, `NEXT_TELEMETRY_DISABLED=1`
- Static shell build: `TASKFLOW_SHELL_ORIGIN`, `TASKFLOW_WEB_URL`,
  `TASKFLOW_API_URL`

The API `DATABASE_URL` must authenticate only as `taskflow_runtime`, whose role
configuration sets `search_path=taskflow,extensions`. The API entrypoint
validates the restricted role and starts the server without applying DDL.
Migrations run as a separate one-shot operator action with
`TASKFLOW_MIGRATION_DATABASE_URL` authenticated as `taskflow_migrator`; its
wrapper verifies the TaskFlow-only boundary before invoking the staged
migrator. The application Auth bridge verifies the Zhuge session through
Supabase Auth `/auth/v1/user` and binds the returned UUID to TaskFlow-owned
workspace membership; it does not call Zhuge public RPCs. All TaskFlow
user/workspace/task data stays in `taskflow`.

No Native Lab service, source, or schema is reused or modified. No existing
Zhuge business tables are changed by TaskFlow migrations. The first TaskFlow
runtime release must use a new Product Version and Build; `.9.27 / 20261009-1733`
remains an undeployed candidate record.

## Runtime limitations

The shell uses the existing Zhuge authentication flow. The currently
configured Supabase Auth redirect allowlist must accept the shell URL; this
deployment does not modify Production Auth configuration. If Google sign-in
rejects that redirect, use the existing approved authentication process rather
than broadening the Production allowlist from this TaskFlow work.

Task/Project/Agent/Run testing must use TaskFlow-owned records. Agent execution
that requires an external model/provider credential remains blocked until that
provider is configured; no secret is added to source or the browser bundle.
