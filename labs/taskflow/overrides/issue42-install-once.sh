#!/bin/sh
# Issue #42 INSTALL ONLY runner. This never invokes /app/migrate or any other
# migration. It is intentionally manual and requires an explicit SQL file.
set -eu

: "${TASKFLOW_MIGRATION_DATABASE_URL:?Set the one-shot migrator URL in a private runtime only}"
SQL_PATH=labs/taskflow/sql/issue42_connector_create_issue_candidate.sql
EXPECTED_SHA=50b716e38fe2703607fe19880f60c298c7af1bac
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
EXPECTED_FILE_SHA=b2a8fa1f986efab3e27997fd02b04613fef3d31aea68665f77192ba8a227b6cc
SQL_FILE=$(mktemp)
trap 'rm -f "$SQL_FILE"' EXIT
git show "$EXPECTED_SHA:$SQL_PATH" > "$SQL_FILE"
test "$(sha256sum "$SQL_FILE" | awk '{print $1}')" = "$EXPECTED_FILE_SHA"

# Never print the connection URL. The preflight is read-only and rejects the
# runtime role, superuser/bypass roles, shared-schema access and bad search path.
psql "$TASKFLOW_MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At <<'SQL'
DO $$
BEGIN
  IF session_user <> 'taskflow_migrator' OR current_user <> 'taskflow_migrator' THEN
    RAISE EXCEPTION 'INSTALL BLOCKED: migrator identity mismatch';
  END IF;
  IF current_schemas(false) <> ARRAY['taskflow','extensions']::name[] THEN
    RAISE EXCEPTION 'INSTALL BLOCKED: search_path mismatch';
  END IF;
  IF NOT has_schema_privilege(current_user,'taskflow','USAGE')
     OR NOT has_schema_privilege(current_user,'taskflow','CREATE')
     OR has_schema_privilege(current_user,'public','CREATE') THEN
    RAISE EXCEPTION 'INSTALL BLOCKED: schema privileges mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user
             AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN
    RAISE EXCEPTION 'INSTALL BLOCKED: elevated migrator role';
  END IF;
END $$;
SQL

# The candidate SQL performs its own owner/SECURITY DEFINER/ACL assertions.
psql "$TASKFLOW_MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$SQL_FILE" >/dev/null

# Read-only postflight; output contains metadata only, never secrets or data.
psql "$TASKFLOW_MIGRATION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'INSTALL_ONLY_POSTFLIGHT',
       count(*) FILTER (WHERE p.proname='sb_connector_create_issue'),
       count(*) FILTER (WHERE p.proname='sb_connector_update_issue')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='taskflow';
SELECT 'LEDGER_EXISTS', to_regclass('taskflow.sb_connector_issue_request') IS NOT NULL;
SQL
echo "ISSUE42_INSTALL_ONLY_READY: no card creation performed"
