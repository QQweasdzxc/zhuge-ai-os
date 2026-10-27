"""Assertive PostgreSQL 16 integration test for the candidate authority."""
import subprocess, threading, uuid
from pathlib import Path

ROOT = Path(__file__).parents[1]
NAME = f"tf-authority-{uuid.uuid4().hex[:10]}"
workspaceA = "00000000-0000-0000-0000-000000000001"

def run(*args, check=True, input_text=None):
    return subprocess.run(args, check=check, text=True, input=input_text, capture_output=True)

def sql(statement, check=True):
    return run("docker", "exec", "-i", NAME, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "tf_test", check=check, input_text=statement)

def expect_error(statement, marker):
    result = sql(statement, check=False)
    assert result.returncode != 0
    assert marker in result.stderr, result.stderr

def main():
    if run("docker", "info", check=False).returncode != 0:
        print("POSTGRES_RUNTIME_NOT_VERIFIED: Docker unavailable"); return 2
    try:
        run("docker", "run", "--rm", "-d", "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "--name", NAME,
            "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=tf_test", "postgres:16")
        ready = False
        for _ in range(40):
            if run("docker", "exec", NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0:
                ready = True
                break
            running = run("docker", "inspect", "--format", "{{.State.Running}}", NAME, check=False)
            if running.returncode != 0 or running.stdout.strip() != "true":
                logs = run("docker", "logs", NAME, check=False)
                raise AssertionError(f"isolated PostgreSQL 16 container exited before readiness: {logs.stdout}{logs.stderr}")
            run("sleep", "1")
        if not ready:
            logs = run("docker", "logs", NAME, check=False)
            raise AssertionError(f"isolated PostgreSQL 16 did not become ready: {logs.stdout}{logs.stderr}")
        sql("""CREATE SCHEMA taskflow; CREATE EXTENSION pgcrypto;
CREATE TABLE taskflow.workspace (id uuid primary key);
CREATE TABLE taskflow.issue (id uuid primary key, workspace_id uuid not null);
INSERT INTO taskflow.workspace VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO taskflow.issue VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');""")
        sql((ROOT / "sql/taskflow_native_dispatch_authority_candidate.sql").read_text())
        claim = "taskflow.claim_dispatch_intent('req-1','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-01','codex','cto-1',60)"
        first = sql(f"SELECT id || ',' || lease_id || ',' || fencing_epoch FROM {claim} AS c;").stdout.strip()
        assert first.count(',') == 2, first
        assert sql("SELECT count(*)=1 FROM taskflow.dispatch_intent;").stdout.strip() == "t"
        replay = sql(f"SELECT id || ',' || lease_id || ',' || fencing_epoch FROM {claim} AS c;").stdout.strip()
        assert replay == first, f"same request key and payload must return the same durable claim: {replay} != {first}"
        expect_error("SELECT taskflow.claim_dispatch_intent('req-1','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-02','codex','cto-1',60);", "payload mismatch")
        expect_error("SELECT taskflow.claim_dispatch_intent('req-1','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-01','codex','cto-2',60);", "payload mismatch")
        expect_error("SELECT taskflow.claim_dispatch_intent('bad-ws','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','CO-01','codex','cto-1',60);", "issue and workspace mismatch")
        expect_error("SELECT taskflow.claim_dispatch_intent('bad-ttl','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-01','codex','cto-1',3601);", "invalid dispatch claim request")
        dispatch, lease, epoch = first.split(',')
        assert sql(f"SELECT taskflow.begin_dispatch_provider('{dispatch}','{lease}',{epoch},'codex','session-1');").stdout.strip() == "f", "start without binding a verified route must fail"
        assert sql(f"SELECT taskflow.bind_dispatch_provider_route('{dispatch}','{lease}',{epoch},'codex','session-1');").stdout.strip() == "t"
        assert sql(f"SELECT taskflow.bind_dispatch_provider_route('{dispatch}','{lease}',{epoch},'codex','session-1');").stdout.strip() == "t", "exact route replay must be idempotent"
        assert sql(f"SELECT taskflow.bind_dispatch_provider_route('{dispatch}','{lease}',{epoch},'codex','session-other');").stdout.strip() == "f", "route mutation after binding must be rejected"
        assert sql(f"SELECT taskflow.begin_dispatch_provider('{dispatch}','{lease}',{epoch},'codex','session-1');").stdout.strip() == "t"
        assert sql(f"SELECT taskflow.begin_dispatch_provider('{dispatch}','{lease}',{epoch},'codex','session-1');").stdout.strip() == "f"
        replay_after_start = sql(f"SELECT id || ',' || lease_id || ',' || fencing_epoch FROM {claim} AS c;").stdout.strip()
        assert replay_after_start == first, "retry after Provider start must resolve to the same durable intent"
        assert sql(f"SELECT taskflow.begin_dispatch_provider('{dispatch}','{lease}',{epoch},'codex','session-1');").stdout.strip() == "f"
        assert sql(f"SELECT state='provider_start_requested' AND provider_run_id IS NULL AND provider_ack_event_id IS NULL FROM taskflow.dispatch_intent WHERE id='{dispatch}';").stdout.strip() == "t", "start permission must not be reported as Provider ACK/Run"
        assert sql(f"SELECT taskflow.renew_dispatch_lease('{dispatch}','{lease}',{epoch},60);").stdout.strip() == "t"
        assert sql(f"SELECT taskflow.record_dispatch_provider_ack('{dispatch}','{lease}',{epoch},'codex','session-1','run-1','ack-1');").stdout.strip() == "t"
        assert sql(f"SELECT taskflow.record_dispatch_provider_ack('{dispatch}','{lease}',{epoch},'codex','session-1','run-1','ack-1');").stdout.strip() == "t", "exact ACK replay must be idempotent"
        assert sql(f"SELECT taskflow.record_dispatch_provider_ack('{dispatch}','{lease}',{epoch},'gemini','session-1','run-2','ack-2');").stdout.strip() == "f", "wrong provider ACK must be rejected"
        assert sql(f"SELECT taskflow.record_dispatch_provider_ack('{dispatch}','{lease}',{epoch},'codex','session-2','run-2','ack-2');").stdout.strip() == "f", "wrong session ACK must be rejected"
        assert sql(f"SELECT state='provider_acknowledged' AND provider='codex' AND provider_session_id='session-1' AND provider_run_id='run-1' AND provider_ack_event_id='ack-1' FROM taskflow.dispatch_intent WHERE id='{dispatch}';").stdout.strip() == "t"
        assert sql(f"SELECT taskflow.stop_dispatch_intent('{dispatch}',{epoch},'requested');").stdout.strip() == "t"
        assert sql(f"SELECT taskflow.confirm_dispatch_stop('{dispatch}',{int(epoch)+1},NULL,NULL);").stdout.strip() == "f"
        assert sql(f"SELECT taskflow.confirm_dispatch_stop('{dispatch}',{int(epoch)+1},'run-1','unverified-client-event');").stdout.strip() == "f"
        assert sql(f"SELECT provider_stop_verified=false AND state='reconcile_required' FROM taskflow.dispatch_intent WHERE id='{dispatch}';").stdout.strip() == "t"
        assert sql(f"SELECT provider_start_requested_at IS NOT NULL FROM taskflow.dispatch_intent WHERE id='{dispatch}';").stdout.strip() == "t"
        expect_error("SELECT taskflow.claim_dispatch_intent('new-after-stop','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-02','codex','cto-1',60);", "active writer")
        replay_after_stop = sql(f"SELECT id || ',' || lease_id || ',' || fencing_epoch FROM {claim} AS c;").stdout.strip()
        assert replay_after_stop == f"{dispatch},{lease},{int(epoch)+1}", "STOP replay must retain the fenced reconciliation record"
        assert sql(f"SELECT taskflow.begin_dispatch_provider('{dispatch}','{lease}',{int(epoch)+1},'codex','session-1');").stdout.strip() == "f"

        # The provider start boundary is a compare-and-set. Two concurrent
        # requests using the same idempotency key may both read the intent, but
        # only one can cross into a Provider Run.
        issue_concurrent = "00000000-0000-0000-0000-000000000011"
        sql(f"INSERT INTO taskflow.issue VALUES ('{issue_concurrent}','{workspaceA}');")
        concurrent_statement = (
            "WITH c AS MATERIALIZED (SELECT taskflow.claim_dispatch_intent("
            f"'same-key','{issue_concurrent}','{workspaceA}','CO-01','codex','cto-1',60) AS claim), "
            "b AS MATERIALIZED (SELECT claim, taskflow.bind_dispatch_provider_route((claim).id,(claim).lease_id,(claim).fencing_epoch,'codex','session-1') AS bound FROM c), "
            "s AS (SELECT CASE WHEN bound THEN taskflow.begin_dispatch_provider((claim).id,(claim).lease_id,(claim).fencing_epoch,'codex','session-1') ELSE false END AS started FROM b) "
            "SELECT started FROM s;"
        )
        sql("TRUNCATE taskflow.dispatch_intent;")
        results = []
        def concurrent_start():
            results.append(sql(concurrent_statement, check=False))
        a = threading.Thread(target=concurrent_start); b = threading.Thread(target=concurrent_start); a.start(); b.start(); a.join(); b.join()
        assert all(result.returncode == 0 for result in results), [result.stderr for result in results]
        assert sorted(result.stdout.strip() for result in results) == ["f", "t"], [result.stdout for result in results]
        assert sql("SELECT count(*)=1 FROM taskflow.dispatch_intent;").stdout.strip() == "t"

        # Different idempotency keys cannot acquire a second writer for one
        # Issue, and expired/stale fencing tokens cannot start work.
        expect_error(f"SELECT taskflow.claim_dispatch_intent('other-key','{issue_concurrent}','{workspaceA}','CO-02','codex','cto-1',60);", "active writer")
        concurrent_id, concurrent_lease, concurrent_epoch = sql("SELECT id || ',' || lease_id || ',' || fencing_epoch FROM taskflow.dispatch_intent;").stdout.strip().split(',')
        sql(f"SELECT taskflow.stop_dispatch_intent('{concurrent_id}',{concurrent_epoch},'test-stop');")
        assert sql(f"SELECT taskflow.begin_dispatch_provider('{concurrent_id}','{concurrent_lease}',{concurrent_epoch},'codex','session-1');").stdout.strip() == "f"
        assert sql(f"SELECT taskflow.begin_dispatch_provider('{concurrent_id}','{concurrent_lease}',{int(concurrent_epoch)+1},'codex','session-1');").stdout.strip() == "f"

        issue_expired = "00000000-0000-0000-0000-000000000012"
        sql(f"INSERT INTO taskflow.issue VALUES ('{issue_expired}','{workspaceA}');")
        expired_id, expired_lease, expired_epoch = sql(
            "SELECT id || ',' || lease_id || ',' || fencing_epoch "
            "FROM taskflow.claim_dispatch_intent('expired-key','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','CO-01','codex','cto-1',1);"
        ).stdout.strip().split(',')
        assert sql(f"SELECT taskflow.bind_dispatch_provider_route('{expired_id}','{expired_lease}',{expired_epoch},'codex','session-expired');").stdout.strip() == "t"
        run("sleep", "2")
        assert sql(f"SELECT taskflow.begin_dispatch_provider('{expired_id}','{expired_lease}',{expired_epoch},'codex','session-expired');").stdout.strip() == "f"
        print("POSTGRES_RUNTIME_VERIFIED: PASS (idempotent claim, route binding, single-start CAS, ACK provider/session/run persistence, ACK replay/conflict, concurrent replay, active writer, expiry, fencing, STOP fail-closed)"); return 0
    finally:
        run("docker", "rm", "-f", NAME, check=False)

if __name__ == "__main__": raise SystemExit(main())
