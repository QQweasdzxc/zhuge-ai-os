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
    result = subprocess.run(args, text=True, input=input_text, capture_output=True)
    if check and result.returncode: raise RuntimeError(f"isolated command failed rc={result.returncode}: {result.stderr}")
    return result

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
CREATE ROLE taskflow_runtime;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA taskflow TO taskflow_runtime;
SET ROLE taskflow_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA taskflow GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO taskflow_runtime;
SET search_path=taskflow,extensions;
CREATE TABLE taskflow."user" (id uuid primary key, email text);
CREATE TABLE taskflow.workspace (id uuid primary key, slug text unique not null, name text not null default '');
CREATE TABLE taskflow.member (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, user_id uuid not null, role text not null default 'member');
CREATE TABLE taskflow.agent (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, owner_id uuid, name text not null,
    description text not null default '', instructions text not null default '',
    avatar_url text, runtime_id uuid, runtime_mode text not null,
    runtime_config jsonb not null default '{{}}', visibility text not null default 'workspace',
    status text not null default 'offline', max_concurrent_tasks int not null default 6,
    kind text not null default 'user', system_key text,
    permission_mode text not null default 'private',
    archived_at timestamptz, archived_by uuid,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    custom_env jsonb not null default '{{}}', custom_args jsonb not null default '[]',mcp_config jsonb, model text,thinking_level text,composio_toolkit_allowlist text[],disabled_runtime_skills jsonb not null default '[]',service_tier text,conversation_starters jsonb not null default '[]',
    UNIQUE(workspace_id,name));
CREATE TABLE taskflow.project (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, title text not null, description text,
    icon text, status text not null default 'planned',
    lead_type text, lead_id uuid, priority text not null default 'none',start_date date,due_date date,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE TABLE taskflow.issue (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, title text not null,
    assignee_type text, assignee_id uuid, creator_type text, creator_id uuid,
    project_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE TABLE taskflow.agent_task_queue (id uuid primary key default gen_random_uuid(), agent_id uuid not null);
CREATE TABLE taskflow.agent_invocation_target (id uuid primary key default gen_random_uuid(), agent_id uuid not null, target_type text not null, target_id uuid);
RESET ROLE;
INSERT INTO taskflow."user" VALUES ('{OWNER}', 'qq.1025@gmail.com');
INSERT INTO taskflow.workspace VALUES ('{WS}', 'zhuge-lab-ac5afcc7', 'Zhuge AI OS');
INSERT INTO taskflow.member (workspace_id, user_id, role) VALUES ('{WS}', '{OWNER}', 'owner');""")

def agent_count():
    return sql(f"SELECT count(*) FROM taskflow.agent WHERE workspace_id='{WS}' AND system_key IS NOT NULL;").stdout.strip()

def project_count():
    return sql(f"SELECT count(*) FROM taskflow.project WHERE workspace_id='{WS}' AND lead_type='agent';").stdout.strip()

def main():
    if run("docker", "info", check=False).returncode != 0:
        print("POSTGRES_RUNTIME_NOT_VERIFIED: Docker unavailable"); return 2
    try:
        run("docker", "run", "--rm", "-d", "--tmpfs", "/var/lib/postgresql/data:rw,size=1g", "--name", NAME,
            "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=tf_test", "postgres:16")
        import time
        for _ in range(40):
            if run("docker", "exec", NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0: break
            time.sleep(1)
        fixture()
        checks()
        return 0
    finally:
        run("docker", "rm", "-f", NAME, check=False)

def checks():
    candidate=(ROOT/"sql/taskflow_executor_mapping_candidate.sql").read_text()
    rollback=(ROOT/"sql/taskflow_executor_mapping_rollback.sql").read_text()
    post=(ROOT/"sql/taskflow_executor_mapping_postflight.sql").read_text()
    def rb(): return sql("SET ROLE taskflow_migrator;\n"+rollback)
    def reject_rb(marker): expect_error("SET ROLE taskflow_migrator;\n"+rollback,marker)
    expect_error(candidate,"requires taskflow_migrator")
    print("PASS role-denial")
    install()
    assert agent_count()=="5" and project_count()=="5"
    print("PASS exact-five-plus-five")
    install()
    assert agent_count()=="5" and project_count()=="5"
    print("PASS idempotent")
    out=sql(post).stdout
    assert out.count("|MAPPED_UNBOUND_PRIVATE")==5,out
    print("PASS postflight-private-unbound")
    for role in ("taskflow_runtime","anon","authenticated","service_role"):
        out=sql(f"SELECT has_table_privilege('{role}','taskflow.g1_executor_mapping_provenance','SELECT'),has_table_privilege('{role}','taskflow.g1_executor_mapping_provenance','INSERT'),has_table_privilege('{role}','taskflow.g1_executor_mapping_provenance','DELETE');").stdout.strip()
        assert out=="f|f|f",(role,out)
    print("PASS provenance-private-default-acl")
    aid=sql("SELECT id FROM taskflow.agent WHERE system_key='CO-01';").stdout.strip()
    pid=sql("SELECT id FROM taskflow.project WHERE lead_id='"+aid+"';").stdout.strip()
    for field,value in (("name","changed"),("permission_mode","public_to"),("description","adopted")):
        old=sql(f"SELECT {field} FROM taskflow.agent WHERE id='{aid}';").stdout.strip()
        sql(f"UPDATE taskflow.agent SET {field}='{value}' WHERE id='{aid}';")
        reject_rb("full-row drift")
        sql(f"UPDATE taskflow.agent SET {field}='{old}' WHERE id='{aid}';")
    sql(f"UPDATE taskflow.project SET title='edited' WHERE id='{pid}';")
    reject_rb("full-row drift")
    sql(f"UPDATE taskflow.project SET title='CO-01 原生專案' WHERE id='{pid}';")
    print("PASS full-agent-project-drift")
    # Every live FK relation type plus polymorphic and JSON/array adoption.
    adoption = {
      'daemon_connection': ('agent_id', 'uuid REFERENCES taskflow.agent(id) ON DELETE CASCADE',aid),
      'agent_skill': ('agent_id','uuid REFERENCES taskflow.agent(id) ON DELETE CASCADE',aid),
      'chat_session': ('agent_id','uuid REFERENCES taskflow.agent(id) ON DELETE CASCADE',aid),
      'task_token': ('agent_id','uuid REFERENCES taskflow.agent(id) ON DELETE CASCADE',aid),
      'lark_installation': ('agent_id','uuid REFERENCES taskflow.agent(id) ON DELETE CASCADE',aid),
      'squad': ('leader_id','uuid REFERENCES taskflow.agent(id) ON DELETE RESTRICT',aid),
      'autopilot': ('project_id','uuid REFERENCES taskflow.project(id) ON DELETE SET NULL',pid),
      'project_resource': ('project_id','uuid REFERENCES taskflow.project(id) ON DELETE CASCADE',pid),
      'polymorphic': ('actor_id','uuid',aid),
      'json_adoption': ('metadata','jsonb',aid),
    }
    # Add fixtures before install inventory; clean rollback then re-install.
    rb()
    for table,(col,typ,_) in adoption.items(): sql(f"SET ROLE taskflow_migrator; CREATE TABLE taskflow.{table} ({col} {typ});")
    install()
    for table,(col,typ,val) in adoption.items():
        payload = ('{"agent_id":"'+val+'"}') if typ=='jsonb' else val
        sql(f"INSERT INTO taskflow.{table} VALUES ('{payload}');")
        reject_rb("adopted/reference")
        assert sql(f"SELECT count(*) FROM taskflow.{table};").stdout.strip()=="1"
        sql(f"DELETE FROM taskflow.{table};")
    for insert in (
      f"INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id) VALUES('{WS}','adopt','agent','{aid}');",
      f"INSERT INTO taskflow.issue(workspace_id,title,creator_type,creator_id) VALUES('{WS}','adopt','agent','{aid}');",
      f"INSERT INTO taskflow.issue(workspace_id,title,project_id) VALUES('{WS}','adopt','{pid}');",
      f"INSERT INTO taskflow.agent_task_queue(agent_id) VALUES('{aid}');",
      f"INSERT INTO taskflow.agent_invocation_target(agent_id,target_type) VALUES('{aid}','workspace');"):
        sql(insert);reject_rb("adopted/reference")
        sql("DELETE FROM taskflow.issue;DELETE FROM taskflow.agent_task_queue;DELETE FROM taskflow.agent_invocation_target;")
    print("PASS all-live-FK-and-polymorphic-adoption-preserved")
    sql("SET ROLE taskflow_migrator;CREATE TABLE taskflow.new_schema_table(id uuid);")
    reject_rb("table inventory drift")
    sql("DROP TABLE taskflow.new_schema_table;")
    print("PASS unknown-table-refusal")
    sql("CREATE SCHEMA outsider;CREATE TABLE outsider.ref (agent_id uuid REFERENCES taskflow.agent(id) ON DELETE CASCADE);")
    reject_rb("external-schema FK")
    sql("DROP SCHEMA outsider CASCADE;")
    sql("SET ROLE taskflow_migrator;CREATE FUNCTION taskflow.g1_test_delete_hook() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN OLD;END$$;CREATE TRIGGER g1_delete_test BEFORE DELETE ON taskflow.agent FOR EACH ROW EXECUTE FUNCTION taskflow.g1_test_delete_hook();")
    reject_rb("delete trigger present")
    sql("DROP TRIGGER g1_delete_test ON taskflow.agent;DROP FUNCTION taskflow.g1_test_delete_hook();")
    print("PASS cross-schema-FK-and-trigger-refusal")
    rb();assert agent_count()=="0" and project_count()=="0"
    rb()
    print("PASS clean-rollback-idempotent")
    # Existing name collision is never adopted into provenance.
    sql(f"INSERT INTO taskflow.agent(workspace_id,name,runtime_mode,system_key) VALUES('{WS}','CO-01','cloud','CO-01');")
    expect_error("SET ROLE taskflow_migrator;\n"+candidate,"identity collision")
    assert agent_count()=="1"
    print("PASS preexisting-identity-preserved")
    print("PASS G1 isolated verification: 11 groups, no production")

if __name__ == "__main__":
    raise SystemExit(main())
