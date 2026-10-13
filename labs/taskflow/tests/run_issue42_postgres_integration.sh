#!/usr/bin/env bash
set -euo pipefail

# Disposable postgres service only: this runner is intentionally restricted to
# the ephemeral PostgreSQL service created by the Issue #42 GitHub Actions job.
# It refuses external hosts and
# requires an explicitly named, ephemeral CI image.
if [[ "${GITHUB_ACTIONS:-}" != "true" || -z "${TASKFLOW_ISSUE42_TEST_IMAGE:-}" ]]; then
  echo "Issue #42 PostgreSQL integration requires the disposable postgres service and CI-built image" >&2
  exit 2
fi

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly ADMIN_URL="postgres://ci_admin@127.0.0.1:5432/postgres?sslmode=disable"
readonly MIGRATOR_URL="postgres://taskflow_migrator@127.0.0.1:5432/postgres?sslmode=disable"
readonly CONNECTOR_URL="postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable"
readonly RUNTIME_URL="postgres://taskflow_runtime@127.0.0.1:5432/postgres?sslmode=disable"

for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p 5432 -U ci_admin -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
pg_isready -h 127.0.0.1 -p 5432 -U ci_admin -d postgres

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE taskflow_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE taskflow_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE anon LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE service_role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE multica_lab_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA extensions AUTHORIZATION ci_admin;
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION vector WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA extensions TO taskflow_migrator, taskflow_runtime, postgres, anon, authenticated, service_role;
GRANT USAGE, CREATE ON SCHEMA taskflow TO taskflow_migrator;
GRANT USAGE ON SCHEMA taskflow TO taskflow_runtime, postgres, anon, authenticated, service_role;
ALTER ROLE taskflow_migrator IN DATABASE postgres SET search_path = taskflow, extensions;
ALTER ROLE taskflow_runtime IN DATABASE postgres SET search_path = taskflow, extensions;
ALTER ROLE postgres IN DATABASE postgres SET search_path = taskflow, extensions;
ALTER ROLE anon IN DATABASE postgres SET search_path = taskflow, extensions;
ALTER ROLE authenticated IN DATABASE postgres SET search_path = taskflow, extensions;
ALTER ROLE service_role IN DATABASE postgres SET search_path = taskflow, extensions;
SQL

echo "ISSUE42_MIGRATION_START=full-staged-taskflow-migrations image=${TASKFLOW_ISSUE42_TEST_IMAGE}"
docker run --rm --network host \
  -e TASKFLOW_MIGRATION_DATABASE_URL="$MIGRATOR_URL" \
  --entrypoint ./taskflow-migrate.sh \
  "$TASKFLOW_ISSUE42_TEST_IMAGE"
echo "ISSUE42_MIGRATION_RESULT=PASS"

# This grants only isolated-test readback to mimic the Connector's existing
# read-only access and the API role's ability to display TaskFlow issues.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT SELECT ON ALL TABLES IN SCHEMA taskflow TO postgres, taskflow_runtime;
SQL

echo "ISSUE42_INSTALL_AS=taskflow_migrator"
psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$ROOT/labs/taskflow/sql/issue42_connector_create_issue_candidate.sql"
psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$ROOT/labs/taskflow/tests/issue42_postgres_fixtures.sql"

# Only the Connector login can execute the narrow functions. Other logins are
# explicitly given schema USAGE above so this checks function ACL, not merely
# schema visibility.
for role in anon authenticated service_role taskflow_runtime; do
  if [[ "$role" == "taskflow_runtime" ]]; then role_url="$RUNTIME_URL"; else role_url="postgres://${role}@127.0.0.1:5432/postgres?sslmode=disable"; fi
  if psql "$role_url" -v ON_ERROR_STOP=1 -c \
    "SELECT * FROM taskflow.sb_connector_create_issue('40000000-0000-4000-8000-000000000099','30000000-0000-4000-8000-000000000001','unauthorized call',NULL,'todo','none',NULL,NULL)" \
    >/tmp/issue42-role-denial.log 2>&1; then
    echo "Issue #42 unexpected function access for ${role}" >&2
    exit 1
  fi
  if ! grep -Eiq 'permission denied for function|trusted Supabase Connector role required' /tmp/issue42-role-denial.log; then
    cat /tmp/issue42-role-denial.log >&2
    echo "Issue #42 role ${role} failed for an unexpected reason" >&2
    exit 1
  fi
  echo "ISSUE42_EXECUTE_DENIED=${role}"
done

# The function owner is also not an execution channel. Its ownership is needed
# for the narrowly scoped SECURITY DEFINER body, but direct calls are refused.
if psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT * FROM taskflow.sb_connector_create_issue('40000000-0000-4000-8000-000000000098','30000000-0000-4000-8000-000000000001','migrator direct call',NULL,'todo','none',NULL,NULL)" \
  >/tmp/issue42-migrator-denial.log 2>&1; then
  echo "Issue #42 unexpectedly allowed a direct migrator call" >&2
  exit 1
fi
if ! grep -Eiq 'permission denied for function|trusted Supabase Connector role required' /tmp/issue42-migrator-denial.log; then
  cat /tmp/issue42-migrator-denial.log >&2
  echo "Issue #42 migrator call failed for an unexpected reason" >&2
  exit 1
fi
echo "ISSUE42_EXECUTE_DENIED=taskflow_migrator"

psql "$CONNECTOR_URL" -v ON_ERROR_STOP=1 -f "$ROOT/labs/taskflow/tests/issue42_postgres_assertions.sql"
psql "$RUNTIME_URL" -v ON_ERROR_STOP=1 -f "$ROOT/labs/taskflow/tests/issue42_runtime_read.sql"

# Two independent calls against one Workspace exercise the real row-locked
# number allocator under concurrency. Both commits must succeed with unique
# identifiers; output files contain only synthetic QA values.
psql "$CONNECTOR_URL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT issue_identifier FROM taskflow.sb_connector_create_issue('40000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000001','Concurrent allocation A',NULL,'todo','none',NULL,NULL)" \
  >/tmp/issue42-concurrent-a.log & pid_a=$!
psql "$CONNECTOR_URL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT issue_identifier FROM taskflow.sb_connector_create_issue('40000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000002','Concurrent allocation B',NULL,'todo','none',NULL,NULL)" \
  >/tmp/issue42-concurrent-b.log & pid_b=$!
wait "$pid_a"
wait "$pid_b"
identifier_a="$(tr -d '\r\n' </tmp/issue42-concurrent-a.log)"
identifier_b="$(tr -d '\r\n' </tmp/issue42-concurrent-b.log)"
if [[ -z "$identifier_a" || -z "$identifier_b" || "$identifier_a" == "$identifier_b" ]]; then
  echo "Issue #42 concurrent allocation returned invalid/duplicate identifiers: ${identifier_a} ${identifier_b}" >&2
  exit 1
fi
echo "ISSUE42_CONCURRENT_ALLOCATOR=PASS ${identifier_a} ${identifier_b}"

# Simultaneous normalized-title requests must serialize on the same native
# advisory key: one writes, the other receives the duplicate rejection.
psql "$CONNECTOR_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT * FROM taskflow.sb_connector_create_issue('40000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000001','Concurrent same-title QA',NULL,'todo','none',NULL,NULL)" \
  >/tmp/issue42-duplicate-a.out 2>/tmp/issue42-duplicate-a.err & duplicate_a=$!
psql "$CONNECTOR_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT * FROM taskflow.sb_connector_create_issue('40000000-0000-4000-8000-000000000032','30000000-0000-4000-8000-000000000001','  Concurrent   same-title QA  ',NULL,'todo','none',NULL,NULL)" \
  >/tmp/issue42-duplicate-b.out 2>/tmp/issue42-duplicate-b.err & duplicate_b=$!
if wait "$duplicate_a"; then duplicate_status_a=0; else duplicate_status_a=$?; fi
if wait "$duplicate_b"; then duplicate_status_b=0; else duplicate_status_b=$?; fi
if [[ "$duplicate_status_a" == "$duplicate_status_b" ]]; then
  echo "Issue #42 concurrent duplicate requests must have exactly one winner" >&2
  cat /tmp/issue42-duplicate-a.err /tmp/issue42-duplicate-b.err >&2
  exit 1
fi
if [[ "$duplicate_status_a" != "0" ]]; then duplicate_error=/tmp/issue42-duplicate-a.err; else duplicate_error=/tmp/issue42-duplicate-b.err; fi
if ! grep -Fq "active duplicate issue exists" "$duplicate_error"; then
  cat /tmp/issue42-duplicate-a.err /tmp/issue42-duplicate-b.err >&2
  echo "Issue #42 concurrent loser did not fail through the duplicate guard" >&2
  exit 1
fi
duplicate_count="$(psql "$CONNECTOR_URL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM taskflow.issue WHERE project_id='30000000-0000-4000-8000-000000000001' AND lower(btrim(regexp_replace(title, '[[:space:]]+', ' ', 'g')))='concurrent same-title qa'")"
if [[ "$duplicate_count" != "1" ]]; then
  echo "Issue #42 concurrent normalized duplicate count was ${duplicate_count}, expected 1" >&2
  exit 1
fi
echo "ISSUE42_CONCURRENT_DUPLICATE=PASS exactly_one_created"

# Roll back and reinstall on the same isolated DB. The committed issue and
# ledger entry must remain; replay after reinstall must not create another row.
psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$ROOT/labs/taskflow/sql/issue42_connector_create_issue_rollback.sql"
psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF (SELECT count(*) FROM taskflow.issue WHERE title = 'Issue42 updated path') <> 1 THEN
        RAISE EXCEPTION 'rollback removed or duplicated a real Issue row';
    END IF;
    IF (SELECT count(*) FROM taskflow.sb_connector_issue_request
         WHERE request_id = '40000000-0000-4000-8000-000000000004') <> 1 THEN
        RAISE EXCEPTION 'rollback removed the consumed idempotency request';
    END IF;
    IF to_regprocedure('taskflow.sb_connector_create_issue(uuid,uuid,text,text,text,text,date,date)') IS NOT NULL
       OR to_regprocedure('taskflow.sb_connector_update_issue(uuid,uuid,uuid,bigint,text,text,text,text,date,date)') IS NOT NULL THEN
        RAISE EXCEPTION 'rollback left a Connector function installed';
    END IF;
END
$$;
SQL
psql "$MIGRATOR_URL" -v ON_ERROR_STOP=1 -f "$ROOT/labs/taskflow/sql/issue42_connector_create_issue_candidate.sql"
psql "$CONNECTOR_URL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT issue_id::text || '|' || replayed::text FROM taskflow.sb_connector_update_issue('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,'Issue42 updated path','Updated synthetic description','in_progress','high','2026-10-13','2026-10-20')" \
  >/tmp/issue42-reinstall-replay.log
if ! grep -Eq '\|true$' /tmp/issue42-reinstall-replay.log; then
  cat /tmp/issue42-reinstall-replay.log >&2
  echo "Issue #42 rollback/reinstall did not preserve idempotent replay" >&2
  exit 1
fi

echo "ISSUE42_POSTGRES_INTEGRATION=PASS"
