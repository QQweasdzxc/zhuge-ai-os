# TaskFlow Alpha 1 Dev deployment

TaskFlow Dev is isolated from Production and from the Multica Native Lab. The
Web/API images build from the pinned local source at `third_party/multica/` and
use the TaskFlow-owned Docker wrappers. The static Zhuge shell is built from
this branch so its shared WORK navigation and TaskFlow entry use the same
origin as the Zhuge login session.

## Services

- Static shell: `node labs/taskflow/build-dev-shell.mjs`
- TaskFlow Web: `labs/taskflow/Dockerfile.web`, repository-root build context
- TaskFlow API: `labs/taskflow/Dockerfile.backend`, repository-root build context
- Database: a dedicated free-tier TaskFlow Dev Postgres instance

The shell builder requires three HTTPS service origins through
`TASKFLOW_SHELL_ORIGIN`, `TASKFLOW_WEB_URL`, and `TASKFLOW_API_URL`. It emits
only the two public Web/API origins into `labs/taskflow/runtime-config.js`; it
does not include tokens or credentials. It excludes the frozen `third_party`
source tree and test files from the published shell.

## Private runtime configuration

Set these only in the Dev service environment:

- API: `DATABASE_URL`, `JWT_SECRET`, `ZHUGE_SUPABASE_URL`,
  `ZHUGE_SUPABASE_ANON_KEY`, `FRONTEND_ORIGIN`, `CORS_ALLOWED_ORIGINS`,
  `MULTICA_APP_URL`, `MULTICA_PUBLIC_URL`
- Web: `REMOTE_API_URL`, `TASKFLOW_ENTRY_ORIGINS`,
  `NEXT_PUBLIC_ENABLE_CLOUD_RUNTIME=false`, `NEXT_TELEMETRY_DISABLED=1`
- Static shell build: `TASKFLOW_SHELL_ORIGIN`, `TASKFLOW_WEB_URL`,
  `TASKFLOW_API_URL`

The API `DATABASE_URL` must include the PostgreSQL connection option
`options=-csearch_path%3Dlab_multica%2Cextensions`. Its TaskFlow-owned entrypoint
creates the isolated schemas and required extensions before applying the
upstream database migrations. The API receives no Zhuge Production database
credential. Its Supabase configuration is used only to verify the authenticated
Zhuge session and the existing app-access result; TaskFlow user/workspace/task
data stays in the dedicated Dev database.

No Native Lab service or database is reused. No Production source, schema, or
business data is changed by this deployment. The free Render Dev database is
temporary and follows Render's free-tier expiry policy; it is not a retention
or backup service.

## Runtime limitations

The Dev shell uses the existing Zhuge authentication flow. The currently
configured Supabase Auth redirect allowlist must accept the Dev shell URL; this
deployment does not modify Production Auth configuration. If Google sign-in
rejects that redirect, use the existing approved authentication process rather
than broadening the Production allowlist from this Dev task.

Task/Project/Agent/Run testing must use Dev-owned TaskFlow data. Agent execution
that requires an external model/provider credential remains blocked until that
provider is configured; no secret is added to source or the browser bundle.
