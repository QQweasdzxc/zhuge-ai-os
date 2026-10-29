#!/usr/bin/env bash
# Builds the isolated real-schema database used by the native agent report writer test.
# It applies the staged TaskFlow migrations and the Dispatch authority candidate SQL exactly as
# written, as the non-superuser taskflow_migrator role. It touches only the database named below.
#
# Required env: PGHOST/PGPORT/PGUSER/PGPASSWORD (an admin role on a LOCAL or CI service container),
#   STAGED_MIGRATIONS (directory of staged *.up.sql), DISPATCH_SQL (dispatch authority candidate SQL).
# Optional: MIGRATOR_PASSWORD,
#   NATIVE_REPORT_LOCAL_NO_EXTENSIONS=1 for a workstation whose PostgreSQL lacks pgcrypto/pg_trgm.
#   That mode edits a temporary copy of two extension assertions and tolerates the trigram index files.
#   It must never be set in CI.
set -euo pipefail
DB=taskflow_native_ai_real_schema_test
: "${STAGED_MIGRATIONS:?staged migration directory is required}"
: "${DISPATCH_SQL:?dispatch authority candidate SQL is required}"
case "${PGHOST:-}" in
  127.0.0.1|localhost|/*) ;;
  *) echo "refusing non-local PostgreSQL host: ${PGHOST:-unset}" >&2; exit 1 ;;
esac
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
  if [ "${NATIVE_REPORT_LOCAL_NO_EXTENSIONS:-}" = "1" ]; then
    echo "NATIVE_REPORT_LOCAL_NO_EXTENSIONS is a workstation-only mode and is refused in CI" >&2
    exit 1
  fi
  if [ -n "${ALLOWED_FAILED_MIGRATIONS:-}" ]; then
    echo "ALLOWED_FAILED_MIGRATIONS overrides are refused in CI" >&2
    exit 1
  fi
fi
MIGRATOR_PASSWORD=${MIGRATOR_PASSWORD:-isolated-ci-only-migrator}
# A migration may fail only for one named missing-extension reason. Any other failure is fatal.
declare -A ALLOWED_REASON=( [446_issue_properties_bigm_index.up.sql]='operator class "gin_bigm_ops" does not exist' )
SRC=$STAGED_MIGRATIONS
if [ "${NATIVE_REPORT_LOCAL_NO_EXTENSIONS:-}" = "1" ]; then
  SRC=$(mktemp -d)
  cp "$STAGED_MIGRATIONS"/*.up.sql "$SRC"/
  python3 - "$SRC" <<'PY'
import re, sys
d = sys.argv[1]
p = d + '/001_init.up.sql'
t = open(p).read()
t = re.sub(r"DO \$\$\nBEGIN\n    IF NOT EXISTS \(.*?\$\$;\n", "-- LOCAL ONLY: pgcrypto assertion removed\n", t, count=1, flags=re.S)
open(p, 'w').write(t)
open(d + '/137_search_index_pg_trgm_extension.up.sql', 'w').write('-- LOCAL ONLY: pg_trgm assertion removed\nSELECT 1;\n')
PY
  for n in 138_issue_title_trgm_index 139_issue_description_trgm_index 140_comment_content_trgm_index 141_project_title_trgm_index 142_project_description_trgm_index; do
    ALLOWED_REASON[$n.up.sql]='operator class "gin_trgm_ops" does not exist'
  done
fi
admin() { psql -v ON_ERROR_STOP=1 -q "$@"; }
admin -d postgres -c "DROP DATABASE IF EXISTS $DB"
admin -d postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taskflow_migrator') THEN CREATE ROLE taskflow_migrator LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taskflow_runtime') THEN CREATE ROLE taskflow_runtime NOLOGIN; END IF;
END \$\$;
ALTER ROLE taskflow_migrator PASSWORD '$MIGRATOR_PASSWORD';
CREATE DATABASE $DB;
SQL
admin -d "$DB" -c "CREATE SCHEMA extensions" -c "GRANT USAGE ON SCHEMA extensions TO taskflow_migrator" \
  -c "CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator" \
  -c "ALTER ROLE taskflow_migrator IN DATABASE $DB SET search_path = taskflow, extensions"
if [ "${NATIVE_REPORT_LOCAL_NO_EXTENSIONS:-}" != "1" ]; then
  admin -d "$DB" -c "CREATE EXTENSION pgcrypto WITH SCHEMA extensions" -c "CREATE EXTENSION pg_trgm WITH SCHEMA extensions"
fi
migrator() { PGOPTIONS="-c client_min_messages=warning" PGUSER=taskflow_migrator PGPASSWORD="$MIGRATOR_PASSWORD" psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
failed=""
for f in $(cd "$SRC" && ls ./*.up.sql | sed 's|^\./||' | sort); do
  if ! out=$(migrator -f "$SRC/$f" 2>&1); then   # one file per call, no single transaction: CONCURRENTLY indexes
    reason="${ALLOWED_REASON[$f]:-}"
    if [ -n "$reason" ] && printf '%s' "$out" | grep -qF "$reason"; then
      echo "allowed failure: $f ($reason)"
    else
      echo "migration failed: $f"; echo "$out" | head -5; failed="$failed $f"
    fi
  fi
done
[ -z "$failed" ] || { echo "unexpected migration failures:$failed" >&2; exit 1; }
migrator -f "$DISPATCH_SQL" >/dev/null
# Optional: the Dispatch caller ACL candidate, applied exactly as written as taskflow_migrator,
# after SOURCE-ASSUMED runtime provisioning (schema USAGE + DML on every table except the
# owner-only ledger; derived from tests/test_executor_mapping_postgres.py and the dispatch
# candidate's comment, NOT verified against any real database). Isolated database only.
if [ -n "${CALLER_ACL_SQL:-}" ]; then
  admin -d "$DB" -c "GRANT USAGE ON SCHEMA taskflow TO taskflow_runtime" \
    -c "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA taskflow TO taskflow_runtime" \
    -c "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA taskflow TO taskflow_runtime" \
    -c "REVOKE ALL ON TABLE taskflow.dispatch_intent FROM taskflow_runtime"
  admin -d "$DB" -c "ALTER ROLE taskflow_runtime PASSWORD '${MIGRATOR_PASSWORD}'"
  migrator -f "$CALLER_ACL_SQL" >/dev/null
  echo "caller ACL candidate applied"
fi
echo "real-schema database $DB ready"
