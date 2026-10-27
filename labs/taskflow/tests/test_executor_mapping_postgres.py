"""Assertive PostgreSQL 16 integration test for the G1 executor mapping SQL.

Applies taskflow_executor_mapping_candidate.sql against a disposable
postgres:16 container with a minimal public-schema fixture, then asserts
idempotency, guard behavior, postflight output, and guarded rollback.
Platform roles are simulations, not claims about production.
"""
import subprocess, uuid
from pathlib import Path

ROOT = Path(__file__).parents[1]
NAME = f"tf-g1map-{uuid.uuid4().hex[:10]}"
WS = "01a1247f-520e-78eb-aa58-0a0e458185f6"
OWNER = "ac5afcc7-f045-41a9-8827-eaf085a04c0d"
KEYS = ("CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER")

def run(*args, check=True, input_text=None):
    return subprocess.run(args, check=check, text=True, input=input_text, capture_output=True)

def sql(statement, check=True):
    return run("docker", "exec", "-i", NAME, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1",
               "-U", "postgres", "-d", "tf_test", check=check, input_text=statement)

def expect_error(statement, marker):
    result = sql(statement, check=False)
    assert result.returncode != 0, f"expected failure for: {statement[:80]}"
    assert marker in result.stderr, f"missing {marker!r} in: {result.stderr}"

def install():
    return sql("SET ROLE taskflow_migrator;\n" + (ROOT / "sql/taskflow_executor_mapping_candidate.sql").read_text())

def fixture():
    sql(f"""CREATE ROLE taskflow_migrator;
CREATE TABLE public."user" (id uuid primary key, email text);
CREATE TABLE public.workspace (id uuid primary key, slug text unique not null, name text not null default '');
CREATE TABLE public.member (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, user_id uuid not null, role text not null default 'member');
CREATE TABLE public.agent (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, owner_id uuid, name text not null,
    description text not null default '', instructions text not null default '',
    avatar_url text, runtime_id uuid, runtime_mode text not null,
    runtime_config jsonb not null default '{{}}', visibility text not null default 'workspace',
    status text not null default 'offline', max_concurrent_tasks int not null default 1,
    kind text not null default 'user', system_key text,
    permission_mode text not null default 'private',
    archived_at timestamptz, archived_by uuid,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE TABLE public.project (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, title text not null, description text,
    icon text, status text not null default 'planned',
    lead_type text, lead_id uuid,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE TABLE public.issue (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, title text not null,
    assignee_type text, assignee_id uuid, creator_type text, creator_id uuid,
    project_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE TABLE public.agent_task_queue (id uuid primary key default gen_random_uuid(), agent_id uuid not null);
CREATE TABLE public.agent_invocation_target (id uuid primary key default gen_random_uuid(), agent_id uuid not null, target_type text not null, target_id uuid);
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO public."user" VALUES ('{OWNER}', 'qq.1025@gmail.com');
INSERT INTO public.workspace VALUES ('{WS}', 'zhuge-lab-ac5afcc7', 'Zhuge AI OS');
INSERT INTO public.member (workspace_id, user_id, role) VALUES ('{WS}', '{OWNER}', 'owner');""")

def agent_count():
    return sql(f"SELECT count(*) FROM public.agent WHERE workspace_id='{WS}' AND system_key IS NOT NULL;").stdout.strip()

def project_count():
    return sql(f"SELECT count(*) FROM public.project WHERE workspace_id='{WS}' AND lead_type='agent';").stdout.strip()

def main():
    if run("docker", "info", check=False).returncode != 0:
        print("POSTGRES_RUNTIME_NOT_VERIFIED: Docker unavailable"); return 2
    try:
        run("docker", "run", "--rm", "-d", "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "--name", NAME,
            "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=tf_test", "postgres:16")
        ready = False
        for _ in range(40):
            if run("docker", "exec", NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0:
                ready = True; break
            run("sleep", "1")
        assert ready, "isolated PostgreSQL 16 did not become ready"
        fixture()

        # 1. Role guard: installing without the migrator role fails closed.
        expect_error((ROOT / "sql/taskflow_executor_mapping_candidate.sql").read_text(),
                     "executor mapping requires restricted taskflow_migrator owner")

        # 2. Install: exactly 5 agents + 5 projects, exact field values.
        install()
        assert agent_count() == "5", agent_count()
        assert project_count() == "5", project_count()
        row = sql(f"SELECT runtime_id IS NULL AND runtime_mode='cloud' AND visibility='private' AND status='offline' AND kind='user' AND permission_mode='private' AND owner_id='{OWNER}' AND archived_at IS NULL FROM public.agent WHERE workspace_id='{WS}' AND system_key='CO-01';").stdout.strip()
        assert row == "t", row

        # 3. Idempotent re-install: counts unchanged.
        install()
        assert agent_count() == "5" and project_count() == "5", "re-install must insert nothing"

        # 4. Postflight: 5/5 MAPPED.
        out = sql((ROOT / "sql/taskflow_executor_mapping_postflight.sql").read_text()).stdout.strip().splitlines()
        assert len(out) == 5 and all(line.endswith("|MAPPED") for line in out), out

        # 5. Rollback refuses while an issue references an executor agent.
        sql(f"""INSERT INTO public.issue (workspace_id, title, assignee_type, assignee_id)
SELECT '{WS}', 'x', 'agent', id FROM public.agent WHERE workspace_id='{WS}' AND system_key='CO-01';""")
        expect_error((ROOT / "sql/taskflow_executor_mapping_rollback.sql").read_text(),
                     "refusing rollback: issues reference executor agents")
        sql("DELETE FROM public.issue;")

        # 6. Rollback refuses on field drift (record adopted/edited).
        sql(f"UPDATE public.agent SET permission_mode='public_to' WHERE workspace_id='{WS}' AND system_key='CO-02';")
        expect_error((ROOT / "sql/taskflow_executor_mapping_rollback.sql").read_text(),
                     "refusing rollback: executor agent rows drifted")
        sql(f"UPDATE public.agent SET permission_mode='private' WHERE workspace_id='{WS}' AND system_key='CO-02';")

        # 7. Clean rollback removes exactly the candidate's rows.
        sql((ROOT / "sql/taskflow_executor_mapping_rollback.sql").read_text())
        assert agent_count() == "0" and project_count() == "0", "clean rollback must remove all 10 rows"

        # 8. Rollback on empty state is a no-op success (idempotent cleanup).
        sql((ROOT / "sql/taskflow_executor_mapping_rollback.sql").read_text())
        print("PASS: executor mapping candidate/postflight/rollback isolated verification")
        return 0
    finally:
        run("docker", "rm", "-f", NAME, check=False)

if __name__ == "__main__":
    raise SystemExit(main())
