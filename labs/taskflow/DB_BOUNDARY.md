# TaskFlow database boundary

TaskFlow uses the existing Zhuge Supabase project but owns a separate
`taskflow` schema. `public` remains Zhuge AI OS data and `lab_multica` remains
the unchanged Native Lab Golden Baseline. TaskFlow API connections use the
dedicated `taskflow_runtime` role with the exact search path
`taskflow,extensions`. It receives no privileges on Zhuge public tables or
sequences, no CREATE on shared schemas, no table privileges on `lab_multica`,
and no membership in `anon`, `authenticated`, `service_role`, or
`multica_lab_runtime`. PostgreSQL's existing inherited `PUBLIC` schema
USAGE/function EXECUTE baseline is accepted, but TaskFlow source and SQL must
not call or resolve Zhuge public objects.

The API must not create schemas or install extensions at startup. A reviewed,
repository-controlled bootstrap provisions the TaskFlow schema and role. The
runtime role owns only TaskFlow objects. Database credentials stay in private
runtime configuration and never enter source or images.

The TaskFlow migration staging firewall copies the pinned Multica migrations
without changing `third_party/multica/`. It applies narrow TaskFlow-owned
transforms for optional/global extension setup and Multica legacy cron cleanup,
then rejects forbidden schema references before the image can be built. See
[MIGRATION_BOUNDARY.md](MIGRATION_BOUNDARY.md).

Migrations run separately through the controlled `taskflow_migrator` identity.
The API runtime role has no schema DDL privileges and never applies migrations
at service startup.

The API image defaults Multica Cloud integration off, disables workspace
creation, and disables telemetry. Web builds default cloud runtime UI off and
disable Next.js telemetry. Zhuge Human Identity remains the only human identity
entry path through the copied `/auth/zhuge` overlay. Identity verification uses
Supabase Auth `/auth/v1/user` only and carries the exact Auth UUID into
TaskFlow-owned membership; it does not call Zhuge public RPCs. Task, agent, and
run records stay in `taskflow`.
