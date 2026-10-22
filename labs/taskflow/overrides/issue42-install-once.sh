#!/bin/sh
# Issue #42 INSTALL ONLY runner. This never invokes /app/migrate or any other
# migration. It is intentionally manual and requires an explicit SQL file.
set -eu

: "${TASKFLOW_MIGRATION_PG_SERVICE:?Set a private libpq service name; never pass a DSN on the command line}"
SQL_PATH=labs/taskflow/sql/issue42_connector_create_issue_candidate.sql
EXPECTED_SHA=50b716e38fe2703607fe19880f60c298c7af1bac
test "$(git cat-file -t "$EXPECTED_SHA")" = commit
EXPECTED_FILE_SHA=b2a8fa1f986efab3e27997fd02b04613fef3d31aea68665f77192ba8a227b6cc
SQL_FILE=$(mktemp)
BASELINE_FILE=$(mktemp)
trap 'rm -f "$SQL_FILE" "$BASELINE_FILE"' EXIT
git show "$EXPECTED_SHA:$SQL_PATH" > "$SQL_FILE"
test "$(sha256sum "$SQL_FILE" | awk '{print $1}')" = "$EXPECTED_FILE_SHA"

# Never print the connection URL. The preflight is read-only and rejects the
# runtime role, superuser/bypass roles, shared-schema access and bad search path.
psql_migrator() { PGSERVICE="$TASKFLOW_MIGRATION_PG_SERVICE" psql -X -v ON_ERROR_STOP=1 "$@"; }

psql_migrator -At <<'SQL'
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

# Capture existing runtime DML ACLs before installation; these are expected
# TaskFlow API privileges and must remain unchanged, not be revoked.
psql_migrator -Atc "SELECT has_table_privilege('taskflow_runtime','taskflow.issue','INSERT'), has_table_privilege('taskflow_runtime','taskflow.issue','UPDATE')" > "$BASELINE_FILE"

# The candidate SQL performs its own owner/SECURITY DEFINER/ACL assertions.
if ! psql_migrator -f "$SQL_FILE" >/dev/null; then
  echo "INSTALL_FAILED: SQL transaction rolled back" >&2
  exit 1
fi

# Read-only postflight; output contains metadata only, never secrets or data.
if ! psql_migrator -At <<'SQL'
DO $$
DECLARE f record; ledger_owner text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_userbyid(p.proowner) owner,
           p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='taskflow'
       AND p.proname IN ('sb_connector_create_issue','sb_connector_update_issue')
  LOOP
    IF f.owner <> 'taskflow_migrator' OR NOT f.prosecdef
       OR NOT (f.proconfig @> ARRAY['search_path=pg_catalog, taskflow, extensions, pg_temp']) THEN
      RAISE EXCEPTION 'POSTFLIGHT_FAILED: function security contract';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='taskflow' AND p.proname IN ('sb_connector_create_issue','sb_connector_update_issue')) <> 2 THEN
    RAISE EXCEPTION 'POSTFLIGHT_FAILED: controlled function count';
  END IF;
  SELECT pg_get_userbyid(c.relowner) INTO ledger_owner FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='taskflow' AND c.relname='sb_connector_issue_request';
  IF ledger_owner <> 'taskflow_migrator' THEN RAISE EXCEPTION 'POSTFLIGHT_FAILED: ledger owner'; END IF;
  IF NOT has_function_privilege('postgres','taskflow.sb_connector_create_issue(uuid,uuid,text,text,text,text,date,date)','EXECUTE')
     OR NOT has_function_privilege('postgres','taskflow.sb_connector_update_issue(uuid,uuid,uuid,bigint,text,text,text,text,date,date)','EXECUTE')
     OR has_function_privilege('public','taskflow.sb_connector_create_issue(uuid,uuid,text,text,text,text,date,date)','EXECUTE')
     OR has_function_privilege('taskflow_runtime','taskflow.sb_connector_create_issue(uuid,uuid,text,text,text,text,date,date)','EXECUTE')
     OR has_function_privilege('taskflow_migrator','taskflow.sb_connector_create_issue(uuid,uuid,text,text,text,text,date,date)','EXECUTE')
     OR has_table_privilege('taskflow_runtime','taskflow.sb_connector_issue_request','INSERT')
     OR has_table_privilege('postgres','taskflow.sb_connector_issue_request','SELECT') THEN
    RAISE EXCEPTION 'POSTFLIGHT_FAILED: function/ledger ACL boundary';
  END IF;
END $$;
SQL
then
  echo "INSTALLED_BUT_POSTFLIGHT_FAILED: SQL committed; do not claim rollback" >&2
  exit 2
fi
if [ "$(cat "$BASELINE_FILE")" != "$(psql_migrator -Atc "SELECT has_table_privilege('taskflow_runtime','taskflow.issue','INSERT'), has_table_privilege('taskflow_runtime','taskflow.issue','UPDATE')")" ]; then
  echo "INSTALLED_BUT_POSTFLIGHT_FAILED: existing runtime DML ACL changed" >&2
  exit 2
fi
echo "ISSUE42_INSTALL_ONLY_READY: no card creation performed"
