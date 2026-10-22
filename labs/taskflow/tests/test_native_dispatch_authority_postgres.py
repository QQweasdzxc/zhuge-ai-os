"""Assertive PostgreSQL 16 integration test for the candidate authority."""
import subprocess, threading, uuid
from pathlib import Path

ROOT = Path(__file__).parents[1]
NAME = f"tf-authority-{uuid.uuid4().hex[:10]}"

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
        run("docker", "run", "--rm", "-d", "--name", NAME, "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=tf_test", "postgres:16")
        for _ in range(40):
            if run("docker", "exec", NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0: break
            run("sleep", "1")
        run("sleep", "1")
        sql("""CREATE SCHEMA taskflow; CREATE EXTENSION pgcrypto;
CREATE TABLE taskflow.workspace (id uuid primary key);
CREATE TABLE taskflow.issue (id uuid primary key, workspace_id uuid not null);
INSERT INTO taskflow.workspace VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO taskflow.issue VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');""")
        sql((ROOT / "sql/taskflow_native_dispatch_authority_candidate.sql").read_text())
        claim = "taskflow.claim_dispatch_intent('req-1','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-01','codex','cto-1',60)"
        assert sql(f"SELECT ({claim}).id IS NOT NULL;").stdout.strip() == "t"
        assert sql("SELECT count(*)=1 FROM taskflow.dispatch_intent;").stdout.strip() == "t"
        assert sql(f"SELECT ({claim}).id IS NOT NULL;").stdout.strip() == "t"
        expect_error("SELECT taskflow.claim_dispatch_intent('req-1','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-02','codex','cto-1',60);", "payload mismatch")
        expect_error("SELECT taskflow.claim_dispatch_intent('bad-ws','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','CO-01','codex','cto-1',60);", "issue and workspace mismatch")
        expect_error("SELECT taskflow.claim_dispatch_intent('bad-ttl','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-01','codex','cto-1',3601);", "invalid dispatch claim request")
        dispatch, lease, epoch = sql("SELECT id || ',' || lease_id || ',' || fencing_epoch FROM taskflow.dispatch_intent;").stdout.strip().split(',')
        assert sql(f"SELECT taskflow.renew_dispatch_lease('{dispatch}','{lease}',{epoch},60);").stdout.strip() == "t"
        assert sql(f"SELECT taskflow.stop_dispatch_intent('{dispatch}',{epoch},'requested');").stdout.strip() == "t"
        assert sql(f"SELECT taskflow.confirm_dispatch_stop('{dispatch}',{int(epoch)+1},NULL);").stdout.strip() == "f"
        assert sql(f"SELECT taskflow.confirm_dispatch_stop('{dispatch}',{int(epoch)+1},'provider-event-1');").stdout.strip() == "t"
        expect_error(f"SELECT {claim};", "terminal or expired")
        sql("TRUNCATE taskflow.dispatch_intent;")
        results = []
        def concurrent(key, executor):
            results.append(sql(f"SELECT taskflow.claim_dispatch_intent('{key}','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','{executor}','codex','cto-1',60);", check=False))
        a = threading.Thread(target=concurrent, args=("concurrent-a", "CO-01")); b = threading.Thread(target=concurrent, args=("concurrent-b", "CO-02")); a.start(); b.start(); a.join(); b.join()
        assert sum(result.returncode == 0 for result in results) == 1
        assert sql("SELECT count(*)=1 FROM taskflow.dispatch_intent;").stdout.strip() == "t"
        print("POSTGRES_RUNTIME_VERIFIED: PASS (assertive concurrency/replay/fencing/STOP)"); return 0
    finally:
        run("docker", "rm", "-f", NAME, check=False)

if __name__ == "__main__": raise SystemExit(main())
