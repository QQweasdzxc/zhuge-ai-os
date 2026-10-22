"""Reproducible PostgreSQL integration test for the candidate authority.

Run directly. It uses a disposable PostgreSQL 16 container and synthetic data;
it never connects to a configured application database.
"""
import os
import subprocess
import uuid
from pathlib import Path


ROOT = Path(__file__).parents[1]
NAME = f"tf-authority-{uuid.uuid4().hex[:10]}"


def run(*args, check=True, input_text=None):
    return subprocess.run(args, check=check, text=True, input=input_text, capture_output=True)


def main():
    if run("docker", "info", check=False).returncode != 0:
        print("POSTGRES_RUNTIME_NOT_VERIFIED: Docker unavailable")
        return 2
    try:
        run("docker", "run", "--rm", "-d", "--name", NAME, "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=tf_test", "postgres:16")
        for _ in range(30):
            if run("docker", "exec", NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0:
                break
            run("sleep", "1")
        setup = """CREATE SCHEMA taskflow;
CREATE EXTENSION pgcrypto;
CREATE TABLE taskflow.workspace (id uuid primary key);
CREATE TABLE taskflow.issue (id uuid primary key, workspace_id uuid not null);
INSERT INTO taskflow.workspace VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO taskflow.issue VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
"""
        run("docker", "exec", "-i", NAME, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "tf_test", input_text=setup)
        ddl = (ROOT / "sql/taskflow_native_dispatch_authority_candidate.sql").read_text()
        run("docker", "exec", "-i", NAME, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "tf_test", input_text=ddl)
        checks = """SELECT (taskflow.claim_dispatch_intent('req-1','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CO-01','codex','cto-1',60)).id IS NOT NULL;
SELECT count(*) = 1 FROM taskflow.dispatch_intent;
SELECT taskflow.renew_dispatch_lease(id, lease_id, fencing_epoch, 60) FROM taskflow.dispatch_intent;
SELECT taskflow.stop_dispatch_intent(id, fencing_epoch, 'stop requested') FROM taskflow.dispatch_intent;
SELECT taskflow.confirm_dispatch_stop(id, fencing_epoch, false) = false FROM taskflow.dispatch_intent;
SELECT taskflow.confirm_dispatch_stop(id, fencing_epoch, true) FROM taskflow.dispatch_intent;
"""
        run("docker", "exec", "-i", NAME, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "tf_test", input_text=checks)
        print("POSTGRES_RUNTIME_VERIFIED: PASS")
        return 0
    finally:
        run("docker", "rm", "-f", NAME, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
