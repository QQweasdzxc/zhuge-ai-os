#!/bin/sh
# Isolated, disposable SAT parity database. Called by run-parity-tests.sh only
# after native gates, never by a production entrypoint or migration wrapper.
set -eu
SERVER_DIR="$1"
SQL_DIR="$2"
: "${PARITY_DATABASE_URL:?disposable parity PostgreSQL URL required}"
# Use the parity server and credentials, but a separate database/schema so the
# existing native gates' fixtures/search paths are untouched. Collisions fail.
SAT_URL="${PARITY_DATABASE_URL%%\?*}"
SAT_URL="${SAT_URL%/*}/taskflow_sat_parity?sslmode=disable&options=-csearch_path%3Dtaskflow%2Cextensions"
psql "$PARITY_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE DATABASE taskflow_sat_parity;
DO $roles$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='taskflow_migrator') THEN CREATE ROLE taskflow_migrator; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='taskflow_runtime') THEN CREATE ROLE taskflow_runtime; END IF;
END $roles$;
SQL
psql "$SAT_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA taskflow TO taskflow_runtime;
SQL
cd "$SERVER_DIR"
DATABASE_URL="$SAT_URL" /tmp/parity-migrate up
# Native tables are created by the local parity administrator. Production's
# reviewed migrator already owns them. Only this disposable fixture needs this.
psql "$SAT_URL" -X -v ON_ERROR_STOP=1 -c 'GRANT REFERENCES ON ALL TABLES IN SCHEMA taskflow TO taskflow_migrator'
for phase in candidate postflight; do
 { printf 'SET ROLE taskflow_migrator;\n'; cat "$SQL_DIR/taskflow_service_agent_tokens_${phase}.sql"; } |
 psql "$SAT_URL" -X -v ON_ERROR_STOP=1
done
log=/tmp/t-service-agent-token.log
DATABASE_URL="$SAT_URL" CGO_ENABLED=0 go test ./internal/handler -v -run '^TestServiceAgentToken' -count=1 > "$log" 2>&1 || { cat "$log"; exit 1; }
cat "$log"
got=$(grep -cE '^--- PASS: TestServiceAgentToken' "$log")
[ "$got" -eq 10 ] || { echo "SAT expected 10 executed contracts, got $got"; exit 1; }
echo "GATE service_agent_token: 10/10 PASS"
