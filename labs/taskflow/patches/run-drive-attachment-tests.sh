#!/bin/sh
# Disposable build fixtures only. Never run at production startup.
set -eu
SERVER_DIR="$1"
SQL_DIR="$2"
: "${PARITY_DATABASE_URL:?isolated parity PostgreSQL URL required}"
LEDGER_URL="${PARITY_DATABASE_URL%%\?*}"
LEDGER_URL="${LEDGER_URL%/*}/taskflow_drive_parity?sslmode=disable"
psql "$PARITY_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE taskflow_drive_parity;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='taskflow_migrator') THEN CREATE ROLE taskflow_migrator; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='taskflow_runtime') THEN CREATE ROLE taskflow_runtime; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
SQL
psql "$LEDGER_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;
GRANT USAGE ON SCHEMA taskflow TO taskflow_runtime;
SET ROLE taskflow_migrator;
CREATE TABLE taskflow.attachment(id text PRIMARY KEY,url text NOT NULL);
GRANT SELECT,INSERT,DELETE ON taskflow.attachment TO taskflow_runtime;
SQL
{ printf 'SET ROLE taskflow_migrator;\n'; cat "$SQL_DIR/taskflow_drive_metadata_candidate.sql"; } | psql "$LEDGER_URL" -X -v ON_ERROR_STOP=1
# Qualify the same migration against the full native schema too. The local
# migrator runner creates native tables as postgres; match the verified existing
# production attachment owner only in this disposable database.
NATIVE_URL="${LEDGER_URL%%\?*}"
NATIVE_URL="${NATIVE_URL%/*}/taskflow_drive_native_parity?sslmode=disable&options=-csearch_path%3Dtaskflow%2Cextensions"
psql "$PARITY_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE taskflow_drive_native_parity'
psql "$NATIVE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA taskflow TO taskflow_runtime;
SQL
cd "$SERVER_DIR"
DATABASE_URL="$NATIVE_URL" /tmp/parity-migrate up
psql "$NATIVE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE taskflow.attachment OWNER TO taskflow_migrator;
GRANT SELECT,INSERT,DELETE ON taskflow.attachment TO taskflow_runtime;
-- Existing native wakeup triggers read these tables even for empty fixtures.
GRANT SELECT ON taskflow.agent_task_queue,taskflow.issue_wakeup TO taskflow_runtime;
SQL
INSTALL_URL="${NATIVE_URL}&options=-crole%3Dtaskflow_migrator"
TASKFLOW_DRIVE_INSTALL_METADATA=1 TASKFLOW_MIGRATION_DATABASE_URL="$INSTALL_URL" TASKFLOW_DRIVE_METADATA_FILE="$SQL_DIR/taskflow_drive_metadata_candidate.sql" sh /tmp/taskflow-drive-install-metadata.sh
TASKFLOW_DRIVE_INSTALL_METADATA=1 TASKFLOW_MIGRATION_DATABASE_URL="$INSTALL_URL" TASKFLOW_DRIVE_METADATA_FILE="$SQL_DIR/taskflow_drive_metadata_candidate.sql" sh /tmp/taskflow-drive-install-metadata.sh
if TASKFLOW_DRIVE_INSTALL_METADATA=1 TASKFLOW_MIGRATION_DATABASE_URL="$NATIVE_URL" TASKFLOW_DRIVE_METADATA_FILE="$SQL_DIR/taskflow_drive_metadata_candidate.sql" sh /tmp/taskflow-drive-install-metadata.sh; then
 echo 'elevated metadata installer unexpectedly passed';exit 1
fi
echo 'GATE private_drive_installer: first/repeat/restricted-role PASS'
psql "$NATIVE_URL" -X -v ON_ERROR_STOP=1 -f /tmp/test-drive-native-schema.sql
log=/tmp/taskflow-drive-storage.log
TASKFLOW_DRIVE_TEST_DATABASE_URL="$LEDGER_URL" GOMEMLIMIT=256MiB CGO_ENABLED=0 go test ./internal/storage -run '^TestTaskFlowDrive' -count=1 -v > "$log" 2>&1 || { cat "$log";exit 1; }
cat "$log"
count=$(grep -cE '^--- PASS: TestTaskFlowDrive' "$log")
[ "$count" -eq 10 ] || { echo "Drive storage expected10executed contracts, got$count";exit 1; }
log=/tmp/taskflow-drive-http.log
DATABASE_URL="$PARITY_DATABASE_URL" GOMEMLIMIT=256MiB CGO_ENABLED=0 go test ./internal/handler -run '^TestTaskFlowDrive' -count=1 -v > "$log" 2>&1 || { cat "$log";exit 1; }
cat "$log"
count=$(grep -cE '^--- PASS: TestTaskFlowDrive' "$log")
[ "$count" -eq 3 ] || { echo "Drive native HTTP expected3executed contracts, got$count";exit 1; }
log=/tmp/taskflow-drive-router.log
TASKFLOW_ROUTER_CONTRACT_ONLY=1 CGO_ENABLED=0 go test ./cmd/server -run '^TestTaskFlowDriveFinalRouter$' -count=1 -v > "$log" 2>&1 || { cat "$log";exit 1; }
cat "$log"
count=$(grep -cE '^--- PASS: TestTaskFlowDriveFinalRouter' "$log")
[ "$count" -eq 1 ] || { echo 'Drive final-router contract did not execute';exit 1; }
echo 'GATE private_drive: storage10/nativeHTTP3/finalRouter1 PASS'
