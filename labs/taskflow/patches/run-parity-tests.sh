#!/bin/sh
# run-parity-tests.sh <server-dir> [profile: full|dispatch]
# Phase-2 Go parity gates with proof of real execution: every gate fails the
# build unless the exact number of expected tests reports --- PASS. A skipped
# TestMain (exit 0 with zero executed tests) fails the count assertion.
set -u
SERVER_DIR="${1:-/src/server}"

if [ -z "${PARITY_DATABASE_URL:-}" ]; then
  export PATH="/usr/libexec/postgresql16:$PATH"
  su -s /bin/sh nobody -c "initdb -D /tmp/pgdata -A trust -U postgres" || exit 1
  su -s /bin/sh nobody -c "pg_ctl -D /tmp/pgdata -o '-c listen_addresses=127.0.0.1 -p 5432 -k /tmp' -l /tmp/pg.log -w -t 60 start" || exit 1
  psql "postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable" -c "CREATE DATABASE multica" || exit 1
  PARITY_DATABASE_URL="postgres://postgres@127.0.0.1:5432/multica?sslmode=disable"
  export PARITY_DATABASE_URL
fi

cd "$SERVER_DIR" || exit 1
# Apply migrations through the repo-owned migrate runner. It carries the
# existing environment guards (e.g. migration 446 pg_bigm operator-class
# condition), so no second skip semantics are introduced here.
CGO_ENABLED=0 go build -o /tmp/parity-migrate ./cmd/migrate || exit 1
DATABASE_URL="$PARITY_DATABASE_URL" /tmp/parity-migrate up || { echo "MIGRATE RUNNER FAILED"; exit 1; }
echo "vendored migrations applied via repo migrate runner"

export DATABASE_URL="$PARITY_DATABASE_URL"

run_gate() {
  name="$1"; want="$2"; shift 2
  log="/tmp/t-${name}.log"
  "$@" > "$log" 2>&1
  rc=$?
  cat "$log"
  if [ "$rc" -ne 0 ]; then echo "GATE ${name}: go test exited ${rc}"; exit 1; fi
  got=$(grep -cE '^--- PASS' "$log")
  if [ "$got" -ne "$want" ]; then echo "GATE ${name}: expected ${want} PASS lines, got ${got}"; exit 1; fi
  echo "GATE ${name}: ${got}/${want} PASS"
}

# Gate profiles: full (default, image build) runs every gate against the fully
# patched tree. dispatch runs only the Postgres dispatch gates, for CI jobs that
# stage only the dispatch overlay files on top of the vendored server.
PROFILE="${2:-full}"

run_dispatch_gate() {
  run_gate dispatch 18 env TASKFLOW_LOCALE_CONTRACT_ONLY=1 CGO_ENABLED=0 go test ./internal/handler -v -run 'DispatchToProvider|NativeDispatch|NativePostgresAdapter|ProviderDispatcher|ProviderBinding|CodexCloudHandoff|AuthorizeCTODispatch' -count=1
}

case "$PROFILE" in
  full)
    run_gate pool 7 env CGO_ENABLED=0 go test ./cmd/server -v -run '^TestTaskFlowPoolBudget' -count=1
    run_gate webhook 3 env CGO_ENABLED=0 go test ./internal/handler -v -run '^TestTaskFlowWebhook' -count=1
    run_gate router 1 env TASKFLOW_ROUTER_CONTRACT_ONLY=1 CGO_ENABLED=0 go test ./cmd/server -v -run '^TestTaskFlowZhugeRoutesInFinalRouter$' -count=1
    run_gate locale 1 env TASKFLOW_LOCALE_CONTRACT_ONLY=1 CGO_ENABLED=0 go test ./internal/handler -v -run '^TestTaskFlowSupportedLocaleReplacement$' -count=1
    run_gate backlog_planning 3 env CGO_ENABLED=0 go test ./internal/handler -v -run '^TestTaskFlowBacklog' -count=1
    run_dispatch_gate
    run_gate cli_auth 2 env CGO_ENABLED=0 go test ./internal/auth -v -run TestZhugeCLIAuthorizationCode -count=1
    run_gate cli_mw 2 env CGO_ENABLED=0 go test ./internal/middleware -v -run TestZhugeCLIAuthorizationCode -count=1
    run_gate cli_token 1 env CGO_ENABLED=0 go test ./internal/handler -v -run TestZhugeIssueCliToken -count=1
    echo "ALL PARITY GATES PASSED (profile=full pool=7 webhook=3 router=1 locale=1 dispatch=18 cli_auth=2 cli_mw=2 cli_token=1)"
    ;;
  dispatch)
    run_dispatch_gate
    echo "ALL PARITY GATES PASSED (profile=dispatch dispatch=18)"
    ;;
  *)
    echo "unknown parity gate profile: $PROFILE"
    exit 1
    ;;
esac
