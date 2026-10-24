#!/usr/bin/env bash
# Protected, schema-scoped TaskFlow backup. This script never installs SQL.
set -Eeuo pipefail
set +x
umask 077

fail() { printf 'TASKFLOW_BACKUP_FAILED stage=%s\n' "$1" >&2; exit 1; }

: "${TASKFLOW_MIGRATION_PG_SERVICE:?missing protected PostgreSQL service name}"
: "${TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT:?missing protected PostgreSQL service configuration}"
: "${TASKFLOW_BACKUP_RESTORE_PG_SERVICE:?missing isolated restore service name}"
: "${TASKFLOW_BACKUP_RESTORE_PGSERVICEFILE_CONTENT:?missing isolated restore service configuration}"
: "${TASKFLOW_BACKUP_AGE_RECIPIENT:?missing PM-owned age public recipient}"
: "${TASKFLOW_BACKUP_EXPECTED_HOST:?missing reviewed source host}"
: "${TASKFLOW_BACKUP_EXPECTED_USER:?missing reviewed source role}"
: "${TASKFLOW_BACKUP_EXPECTED_DATABASE:?missing reviewed source database}"
: "${TASKFLOW_BACKUP_OUTPUT_DIR:?missing encrypted output directory}"
: "${RUNNER_TEMP:?missing ephemeral runner directory}"
: "${CANDIDATE_VERSION:?missing candidate version}"
: "${CANDIDATE_BUILD:?missing candidate build}"
: "${GITHUB_SHA:?missing exact candidate SHA}"

for service in "$TASKFLOW_MIGRATION_PG_SERVICE" "$TASKFLOW_BACKUP_RESTORE_PG_SERVICE"; do
  case "$service" in ''|*[!A-Za-z0-9_.-]*) fail service_name ;; esac
  test "${#service}" -le 63 || fail service_name
done
[[ "$TASKFLOW_BACKUP_EXPECTED_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || fail expected_host
[[ "$TASKFLOW_BACKUP_EXPECTED_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail expected_user
[[ "$TASKFLOW_BACKUP_EXPECTED_DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || fail expected_database
case "$TASKFLOW_BACKUP_OUTPUT_DIR" in "$RUNNER_TEMP"/*) ;; *) fail output_location ;; esac
test ! -e "$TASKFLOW_BACKUP_OUTPUT_DIR" || fail output_not_empty
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || fail candidate_sha
test "$(git rev-parse HEAD 2>/dev/null)" = "$GITHUB_SHA" || fail checkout_sha
mkdir -m 700 "$TASKFLOW_BACKUP_OUTPUT_DIR" || fail output_create
WORK_DIR="$(mktemp -d "$RUNNER_TEMP/taskflow-backup.XXXXXX")" || fail temp_create
cleanup() { rm -rf -- "$WORK_DIR"; }
trap cleanup EXIT
trap 'cleanup; exit 1' HUP INT TERM
chmod 700 "$WORK_DIR"

SOURCE_SERVICE_FILE="$WORK_DIR/source.pg_service.conf"
RESTORE_SERVICE_FILE="$WORK_DIR/restore.pg_service.conf"
printf '%s' "$TASKFLOW_MIGRATION_PGSERVICEFILE_CONTENT" > "$SOURCE_SERVICE_FILE"
printf '%s' "$TASKFLOW_BACKUP_RESTORE_PGSERVICEFILE_CONTENT" > "$RESTORE_SERVICE_FILE"
chmod 600 "$SOURCE_SERVICE_FILE" "$RESTORE_SERVICE_FILE"

python3 - "$SOURCE_SERVICE_FILE" "$TASKFLOW_MIGRATION_PG_SERVICE" \
  "$TASKFLOW_BACKUP_EXPECTED_HOST" "$TASKFLOW_BACKUP_EXPECTED_USER" \
  "$TASKFLOW_BACKUP_EXPECTED_DATABASE" <<'PY'
import configparser, sys
path, name, host, user, database = sys.argv[1:]
parser = configparser.RawConfigParser(interpolation=None, strict=True)
try:
    with open(path, encoding="utf-8") as handle:
        parser.read_file(handle)
    if parser.sections() != [name]:
        raise ValueError()
    section = parser[name]
    allowed = {"host", "port", "dbname", "user", "password", "sslmode",
               "sslrootcert", "connect_timeout", "application_name"}
    if set(section.keys()) - allowed:
        raise ValueError()
    if (section.get("host") != host or section.get("user") != user
            or section.get("dbname") != database or section.get("port") != "5432"
            or section.get("sslmode") != "verify-full" or not section.get("password")):
        raise ValueError()
except Exception:
    print("TASKFLOW_BACKUP_FAILED stage=source_service_validation", file=sys.stderr)
    raise SystemExit(1)
PY

python3 - "$RESTORE_SERVICE_FILE" "$TASKFLOW_BACKUP_RESTORE_PG_SERVICE" <<'PY'
import configparser, sys
path, name = sys.argv[1:]
parser = configparser.RawConfigParser(interpolation=None, strict=True)
try:
    with open(path, encoding="utf-8") as handle:
        parser.read_file(handle)
    if parser.sections() != [name]:
        raise ValueError()
    section = parser[name]
    allowed = {"host", "port", "dbname", "user", "password", "sslmode",
               "connect_timeout", "application_name"}
    if set(section.keys()) - allowed:
        raise ValueError()
    if (section.get("host") != "127.0.0.1" or section.get("port") != "5432"
            or section.get("dbname") != "postgres" or section.get("user") != "postgres"
            or section.get("sslmode") != "disable" or not section.get("password")):
        raise ValueError()
except Exception:
    print("TASKFLOW_BACKUP_FAILED stage=restore_service_validation", file=sys.stderr)
    raise SystemExit(1)
PY

case "$TASKFLOW_BACKUP_AGE_RECIPIENT" in age1[023456789acdefghjklmnpqrstuvwxyz]*) ;; *) fail encryption_recipient ;; esac
test "${#TASKFLOW_BACKUP_AGE_RECIPIENT}" -ge 50 || fail encryption_recipient
for command_name in age pg_dump pg_restore psql createdb; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name"_unavailable
done
pg_dump --version 2>/dev/null | grep -Eq 'PostgreSQL\) 17\.' || fail pg_dump_version
pg_restore --version 2>/dev/null | grep -Eq 'PostgreSQL\) 17\.' || fail pg_restore_version
age --version >/dev/null 2>&1 || fail age_unavailable

SOURCE_CONN="service=$TASKFLOW_MIGRATION_PG_SERVICE"
RESTORE_CONN="service=$TASKFLOW_BACKUP_RESTORE_PG_SERVICE"
export PGSERVICEFILE="$SOURCE_SERVICE_FILE"
identity="$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$SOURCE_CONN" -c \
  "SELECT (session_user = current_user AND session_user = '$TASKFLOW_BACKUP_EXPECTED_USER' AND current_database() = '$TASKFLOW_BACKUP_EXPECTED_DATABASE')::text || '|' || (SELECT ssl::text FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()) || '|' || (SELECT (NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole)::text FROM pg_catalog.pg_roles WHERE rolname = current_user) || '|' || (SELECT (pg_catalog.pg_get_userbyid(nspowner) = '$TASKFLOW_BACKUP_EXPECTED_USER')::text FROM pg_catalog.pg_namespace WHERE nspname = 'taskflow')" 2>"$WORK_DIR/source-identity.err")" || fail source_connection
test "$identity" = 'true|true|true|true' || fail source_identity_or_tls
table_count="$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$SOURCE_CONN" -c \
  "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'taskflow'" 2>"$WORK_DIR/source-schema.err")" || fail source_schema_read
[[ "$table_count" =~ ^[0-9]+$ ]] && test "$table_count" -gt 0 || fail taskflow_schema_missing

DUMP="$WORK_DIR/taskflow-schema.dump"
pg_dump --no-password --format=custom --schema=taskflow --file="$DUMP" \
  --dbname="$SOURCE_CONN" 2>"$WORK_DIR/pg-dump.err" || fail pg_dump
test -s "$DUMP" || fail empty_dump
pg_restore --list "$DUMP" >"$WORK_DIR/archive.list" 2>"$WORK_DIR/pg-restore-list.err" || fail archive_validation
grep -Eq 'SCHEMA - taskflow([[:space:]]|$)' "$WORK_DIR/archive.list" || fail archive_scope

COUNTS_SQL="$WORK_DIR/table-counts.sql"
cat > "$COUNTS_SQL" <<'SQL'
SELECT format(
  'SELECT %L || ''|'' || count(*)::text FROM %I.%I',
  schemaname || '.' || tablename, schemaname, tablename
)
FROM pg_catalog.pg_tables
WHERE schemaname = 'taskflow'
ORDER BY schemaname, tablename;
\gexec
SQL
export PGSERVICEFILE="$SOURCE_SERVICE_FILE"
psql -X -qAt -v ON_ERROR_STOP=1 -d "$SOURCE_CONN" -f "$COUNTS_SQL" \
  >"$WORK_DIR/source-counts.txt" 2>"$WORK_DIR/source-counts.err" || fail source_data_read
test -s "$WORK_DIR/source-counts.txt" || fail source_data_empty

export PGSERVICEFILE="$RESTORE_SERVICE_FILE"
restore_server_version="$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$RESTORE_CONN" \
  -c "SELECT current_setting('server_version_num')::integer" \
  2>"$WORK_DIR/restore-version.err")" || fail restore_server_version
[[ "$restore_server_version" =~ ^[0-9]+$ ]] && \
  test "$restore_server_version" -ge 170000 && test "$restore_server_version" -lt 180000 || \
  fail restore_server_not_postgresql_17
createdb --maintenance-db="$RESTORE_CONN" --template=template0 taskflow_backup_restore \
  >/dev/null 2>"$WORK_DIR/restore-createdb.err" || fail restore_database_create
RESTORE_CONN="service=$TASKFLOW_BACKUP_RESTORE_PG_SERVICE dbname=taskflow_backup_restore"
psql -X -q -v ON_ERROR_STOP=1 -d "$RESTORE_CONN" \
  -c "DO \$roles\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='taskflow_migrator') THEN EXECUTE 'CREATE ROLE taskflow_migrator NOLOGIN'; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='taskflow_runtime') THEN EXECUTE 'CREATE ROLE taskflow_runtime NOLOGIN'; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE 'CREATE ROLE service_role NOLOGIN'; END IF; END \$roles\$; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions" \
  >/dev/null 2>"$WORK_DIR/restore-extensions.err" || fail restore_extension_bootstrap
pg_restore --no-password --exit-on-error --single-transaction \
  --dbname="$RESTORE_CONN" "$DUMP" 2>"$WORK_DIR/pg-restore.err" || fail isolated_restore
psql -X -qAt -v ON_ERROR_STOP=1 -d "$RESTORE_CONN" -f "$COUNTS_SQL" \
  >"$WORK_DIR/restored-counts.txt" 2>"$WORK_DIR/restored-counts.err" || fail restored_data_read
cmp -s "$WORK_DIR/source-counts.txt" "$WORK_DIR/restored-counts.txt" || fail restored_row_counts

export PGSERVICEFILE="$SOURCE_SERVICE_FILE"
pg_dump --no-password --schema-only --schema=taskflow \
  --dbname="$SOURCE_CONN" 2>"$WORK_DIR/source-schema-dump.err" |
  sed -E '/^\\restrict([[:space:]]|$)/d; /^\\unrestrict([[:space:]]|$)/d' \
  >"$WORK_DIR/source-schema.sql" || fail source_schema_signature
export PGSERVICEFILE="$RESTORE_SERVICE_FILE"
pg_dump --no-password --schema-only --schema=taskflow \
  --dbname="$RESTORE_CONN" 2>"$WORK_DIR/restored-schema-dump.err" |
  sed -E '/^\\restrict([[:space:]]|$)/d; /^\\unrestrict([[:space:]]|$)/d' \
  >"$WORK_DIR/restored-schema.sql" || fail restored_schema_signature
cmp -s "$WORK_DIR/source-schema.sql" "$WORK_DIR/restored-schema.sql" || fail restored_schema_diff

CIPHER="$TASKFLOW_BACKUP_OUTPUT_DIR/taskflow-schema-${GITHUB_SHA}.dump.age"
age --encrypt --recipient "$TASKFLOW_BACKUP_AGE_RECIPIENT" --output "$CIPHER" "$DUMP" \
  2>"$WORK_DIR/age-encrypt.err" || fail encryption
test -s "$CIPHER" || fail encrypted_output_empty
sha256sum "$CIPHER" >"$CIPHER.sha256" || fail ciphertext_sha256

TASKFLOW_BACKUP_CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
TASKFLOW_BACKUP_CIPHERTEXT_BYTES="$(stat -c '%s' "$CIPHER")" \
TASKFLOW_BACKUP_CIPHERTEXT_SHA256="$(sha256sum "$CIPHER" | awk '{print $1}')" \
TASKFLOW_BACKUP_PG_DUMP_VERSION="$(pg_dump --version 2>/dev/null)" \
python3 - "$TASKFLOW_BACKUP_OUTPUT_DIR/manifest.json" <<'PY'
import json, os, sys
output_dir = os.path.dirname(sys.argv[1])
cipher_name = next(name for name in os.listdir(output_dir) if name.endswith(".dump.age"))
manifest = {
    "format": "zhuge-taskflow-schema-backup-v1",
    "scope": "taskflow schema only; not a full Supabase project/database backup",
    "project_id": "lenpbbhwxyyfwgvjcozf",
    "candidate_version": os.environ["CANDIDATE_VERSION"],
    "candidate_build": os.environ["CANDIDATE_BUILD"],
    "source_sha": os.environ["GITHUB_SHA"],
    "created_at_utc": os.environ["TASKFLOW_BACKUP_CREATED_AT"],
    "postgres_client": os.environ["TASKFLOW_BACKUP_PG_DUMP_VERSION"],
    "encryption": "age; public recipient only; private identity is not present in the runner",
    "ciphertext_file": cipher_name,
    "ciphertext_bytes": int(os.environ["TASKFLOW_BACKUP_CIPHERTEXT_BYTES"]),
    "ciphertext_sha256": os.environ["TASKFLOW_BACKUP_CIPHERTEXT_SHA256"],
    "isolated_postgres_17_restore": "PASS",
    "table_row_counts_match": "PASS",
    "normalized_taskflow_schema_dump_match": "PASS",
}
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
chmod 600 "$CIPHER" "$CIPHER.sha256" "$TASKFLOW_BACKUP_OUTPUT_DIR/manifest.json"
printf 'TASKFLOW_BACKUP_ONLY_READY scope=taskflow_schema_only encryption=age restore=PASS schema=PASS row_counts=PASS\n'
