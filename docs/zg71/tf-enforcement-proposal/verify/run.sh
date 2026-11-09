#!/bin/bash
# Isolated TF App access verification. No network service, no real identity, no token.
# Usage: run.sh <patched-vendored-source-root> <postgres-bin-dir> [tests]
# tests: space list from: scenario active idle outage (default: all). Needs node, psql, go, and the Postgres bin dir (initdb, pg_ctl).
set -uo pipefail
SRC=$(cd "$1" && pwd); PGBIN=$2; TESTS=${3:-"scenario active idle outage"}
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../../../.." && pwd)
WORK=$(mktemp -d); PORT=${PGPORT_TF:-54329}; export PGPORT_TF=$PORT PGHOST_TF=127.0.0.1
STOP="$PGBIN/pg_ctl -D $WORK/pg -m fast stop"
cleanup(){ $STOP >/dev/null 2>&1; rm -rf "$WORK"; }; trap cleanup EXIT
(cd "$REPO" && node docs/zg71/tf-enforcement-proposal/verify/gen-setup.js "$WORK/setup.sql") || exit 1
fresh(){
  $STOP >/dev/null 2>&1; rm -rf "$WORK/pg"
  "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust -E UTF8 >/dev/null 2>&1 || exit 1
  "$PGBIN/pg_ctl" -D "$WORK/pg" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null 2>&1 || { tail "$WORK/pg.log"; exit 1; }
  P="psql -h 127.0.0.1 -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
  $P -f "$WORK/setup.sql" >/dev/null 2>&1 || { echo SETUP_FAIL; exit 1; }
  $P -c "create role taskflow_runtime login password 'tfpw' nosuperuser" >/dev/null || exit 1
  $P -f "$REPO/docs/zg71/tf-enforcement-proposal/taskflow_app_access_decision.sql.draft" >/dev/null 2>&1 || { echo DRAFT_FAIL; exit 1; }
}
RC=0
for t in $TESTS; do
  echo "=== $t"; fresh
  case $t in
    scenario) bash "$HERE/scenario.sh" || RC=1 ;;
    active|idle|outage)
      psql -h 127.0.0.1 -p $PORT -U postgres -qAt -c "select private.activate_app_access_model(6)" >/dev/null || exit 1
      cp "$HERE/tf_app_access_ws_test.go.txt" "$SRC/server/internal/realtime/tf_app_access_ws_test.go"
      case $t in active) R=TestTFWSOffActiveTraffic;; idle) R=TestTFWSOffIdlePing;; outage) R=TestTFWSOutageGrace;; esac
      (cd "$SRC/server" && TF_PG_URL="postgres://taskflow_runtime:tfpw@127.0.0.1:$PORT/postgres" TF_PG_ADMIN_URL="postgres://postgres@127.0.0.1:$PORT/postgres" TF_PG_STOP_CMD="$STOP" go test ./internal/realtime -run "^$R\$" -count=1 -v -timeout 300s 2>&1 | grep -E "ACTIVE|IDLE|OUTAGE|reconnect|^(--- |ok|FAIL|PASS)") || RC=1 ;;
  esac
done
exit $RC
