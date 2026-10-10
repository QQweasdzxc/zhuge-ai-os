# TaskFlow migration boundary

## Scope

The migration input is the pinned Multica snapshot in `third_party/multica/`.
That directory remains byte-identical. The TaskFlow Docker build stages all
590 `.up.sql` and 590 `.down.sql` files into the runtime migration directory,
applies the exact transforms below, and runs the firewall before an image can
be produced.

Allowed application DDL is resolved through the runtime role's
`taskflow,extensions` search path. PostgreSQL catalog access is read-only.
Qualified access or schema DDL for `public`, `lab_multica`, `cron`, `auth`,
`storage`, `realtime`, and `private` fails the staging build.

## TaskFlow-owned transforms

| Upstream migration | Staged handling | Classification | Product capability |
| --- | --- | --- | --- |
| `001_init.up.sql` | Verify `pgcrypto` is already installed in `extensions`; do not install a database-wide extension from the runtime role. | Existing dependency assertion | UUID generation retained. |
| `032_issue_search_index.down.sql` | Omit only `DROP EXTENSION pg_bigm`; keep TaskFlow-local index rollback. | Shared-extension rollback isolation | Optional bigram extension remains installed for other database consumers. |
| `032_issue_search_index.up.sql` | Check whether optional `pg_bigm` is preinstalled in `taskflow` or `extensions`; do not install it. Its index block already fails closed when the operator class is unavailable. | Optional search enhancement | Search remains available; optional bigram index is skipped truthfully. |
| `076_task_usage_pgcron_extension.up.sql` | Omit only the optional pg_cron extension bootstrap. | Optional scheduler infrastructure | Usage tables/functions remain; registration was already an operator step upstream. |
| `076_task_usage_pgcron_extension.down.sql` | Omit cleanup of the legacy Multica daily job name. | Historical rollback cleanup | No usage capability removed. |
| `102_task_usage_hourly_pipeline.down.sql` | Omit cleanup of the legacy Multica hourly job name. | Historical rollback cleanup | Forward hourly pipeline unchanged. |
| `103_drop_legacy_daily_rollups.up.sql` | Omit only the `cron.job` / `cron.unschedule()` legacy daily cleanup block. | Fresh-install history cleanup | The remainder of migration 103 is retained. |
| `137_search_index_pg_trgm_extension.up.sql` | Verify `pg_trgm` is already installed in `extensions`; do not install an extension from the runtime role. | Existing dependency assertion | Trigram search indexes retained. |

TaskFlow is a fresh schema and has never created the Multica legacy cron job
names. Production readback found no matching jobs at staging review time. The
override does not remove Usage or Rollup capability: the staged migration 102
still creates `task_usage_hourly` and `rollup_task_usage_hourly()`, and migration
103 retains that hourly pipeline while retiring only the older daily pipeline.

## Firewall result

The staging script scans the complete staged up/down SQL set, strips SQL
comments without ignoring quoted/dollar-quoted code, rejects protected-schema
references and schema DDL, rejects migration `search_path` changes, and rejects
direct PostgreSQL system-catalog writes and all extension DDL. The TaskFlow-
owned migration runner overlay also resolves its optional bigram-index guard to
`taskflow.comment` and `taskflow.idx_comment_content_bigm`, not upstream
`public` objects. It is fail-closed on changed upstream hashes or
missing/duplicate transform markers.

## Future replacement record: Usage scheduling

Automatic Usage/Rollup scheduling is not enabled by this migration set. If
TaskFlow enables it later, the scheduler must be TaskFlow-owned, use a
TaskFlow-specific job name, invoke a schema-qualified `taskflow` function, and
never alter Native Lab, `public`, or a Multica legacy job. Evaluate one of:

1. TaskFlow-controlled pg_cron,
2. Render Cron, or
3. a Zhuge Runtime Scheduler.

No scheduler is implemented by this record.

## Accepted shared-database PUBLIC baseline

Read-only Production inspection found `USAGE` on `public` granted to
PostgreSQL's `PUBLIC` pseudo-role and nine existing `public` functions
executable by `PUBLIC`. The PM/GPT decision accepts those inherited baseline
privileges and prohibits changing shared Production ACLs.

TaskFlow's practical boundary is enforced separately: `taskflow_runtime` and
`taskflow_migrator` receive no public table or sequence privileges, no
`public` CREATE, and no membership in Zhuge/Native Lab roles. The runtime and
migration wrappers fail closed on those conditions. Static source and staged
migration tests reject qualified `public.*` references and calls to current
Zhuge public functions. TaskFlow Auth verifies the signed session only through
Supabase Auth `/auth/v1/user`; TaskFlow workspace ownership and access are
scoped to that exact Auth UUID inside `taskflow`.

If Agents ever gain arbitrary SQL execution, this shared-project boundary is
no longer sufficient; reconsider a separate database/project as a product
security requirement. No shared ACL change is authorized by this record.

## Future Security Hardening: Native Lab schema advisor notice

The existing `lab_multica` schema remains unchanged. Current baseline readback
shows schema access is limited to `postgres` and `multica_lab_runtime`; anon and
authenticated have no schema USAGE and no table grants. The previously reported
advisor notice is recorded for a separate future hardening review and does not
block this TaskFlow migration review.
