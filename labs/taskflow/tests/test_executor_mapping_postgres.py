"""Assertive PostgreSQL 16 integration test for the G1 executor mapping SQL.

Applies taskflow_executor_mapping_candidate.sql against a disposable
postgres:16 container with a isolated TaskFlow-schema fixture, then asserts
idempotency, guard behavior, postflight output, and whole-transaction failure rollback; post-commit retention.
Platform roles are simulations, not claims about production.
"""
import subprocess, uuid, os, time, threading
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
    if os.environ.get("G1_TEST_SOCKET"):
        return run("psql", "-h", os.environ["G1_TEST_SOCKET"], "-p", os.environ.get("G1_TEST_PORT", "55439"),
                   "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1",check=check,input_text=statement)
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


    # Finite reference-column fixture, verified against current production catalog.
    sql("SET ROLE taskflow_migrator;CREATE TABLE IF NOT EXISTS taskflow.activity_log (actor_id uuid);CREATE TABLE IF NOT EXISTS taskflow.attachment (uploader_id uuid);CREATE TABLE IF NOT EXISTS taskflow.autopilot (assignee_id uuid, created_by_id uuid, project_id uuid);CREATE TABLE IF NOT EXISTS taskflow.autopilot_collaborator (user_id uuid, granted_by uuid);CREATE TABLE IF NOT EXISTS taskflow.autopilot_rule_version (published_by_id uuid);CREATE TABLE IF NOT EXISTS taskflow.autopilot_subscriber (user_id uuid);CREATE TABLE IF NOT EXISTS taskflow.autopilot_trigger (published_by_id uuid, created_by_id uuid);CREATE TABLE IF NOT EXISTS taskflow.channel_installation (agent_id uuid);CREATE TABLE IF NOT EXISTS taskflow.chat_pinned_agent (agent_id uuid);CREATE TABLE IF NOT EXISTS taskflow.comment (author_id uuid, resolved_by_id uuid);CREATE TABLE IF NOT EXISTS taskflow.comment_reaction (actor_id uuid);CREATE TABLE IF NOT EXISTS taskflow.dingtalk_group_route (agent_id uuid);CREATE TABLE IF NOT EXISTS taskflow.inbox_item (recipient_id uuid, actor_id uuid);CREATE TABLE IF NOT EXISTS taskflow.issue_pr_automation (updated_by_id uuid);CREATE TABLE IF NOT EXISTS taskflow.issue_pull_request (linked_by_id uuid);CREATE TABLE IF NOT EXISTS taskflow.issue_pull_request_exclusion (excluded_by_id uuid);CREATE TABLE IF NOT EXISTS taskflow.issue_reaction (actor_id uuid);CREATE TABLE IF NOT EXISTS taskflow.issue_subscriber (user_id uuid);CREATE TABLE IF NOT EXISTS taskflow.issue_vcs_pull_request (linked_by_id uuid);CREATE TABLE IF NOT EXISTS taskflow.issue_wakeup (agent_id uuid, filter_agent_id uuid, filter_actor_id uuid);CREATE TABLE IF NOT EXISTS taskflow.pinned_item (item_id uuid);CREATE TABLE IF NOT EXISTS taskflow.quick_action (assignee_id uuid, created_by_id uuid);CREATE TABLE IF NOT EXISTS taskflow.squad_member (member_id uuid);CREATE TABLE IF NOT EXISTS taskflow.task_supplement (author_id uuid);CREATE TABLE IF NOT EXISTS taskflow.agent_mcp_server (agent_id uuid);CREATE TABLE IF NOT EXISTS taskflow.agent_to_label (agent_id uuid);CREATE TABLE IF NOT EXISTS taskflow.task_usage_hourly (agent_id uuid);CREATE TABLE IF NOT EXISTS taskflow.task_usage_hourly_dirty (agent_id uuid);")
    sql("ALTER TABLE taskflow.agent_task_queue ADD COLUMN cancelled_by_id uuid;")

def agent_count():
    return sql(f"SELECT count(*) FROM taskflow.agent WHERE workspace_id='{WS}' AND system_key IS NOT NULL;").stdout.strip()

def project_count():
    return sql(f"SELECT count(*) FROM taskflow.project WHERE workspace_id='{WS}' AND lead_type='agent';").stdout.strip()

def main():
    if os.environ.get("G1_TEST_SOCKET"):
        # Only the explicitly selected disposable local test cluster.
        sql("DROP SCHEMA IF EXISTS taskflow CASCADE;DROP SCHEMA IF EXISTS extensions CASCADE;"
            "DROP ROLE IF EXISTS taskflow_migrator;DROP ROLE IF EXISTS taskflow_runtime;"
            "DROP ROLE IF EXISTS anon;DROP ROLE IF EXISTS authenticated;DROP ROLE IF EXISTS service_role;")
        fixture(); checks(); return 0
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



def search_trigger_fixture():
    """Exact trigger/function definition captured in live catalog readback.
    Only the outbox table DDL is a minimal test fixture, not full production.
    """
    sql("SET ROLE taskflow_migrator;SET search_path=taskflow,extensions;" +
        "CREATE TABLE taskflow.search_index_change(entity_type text NOT NULL,entity_id uuid NOT NULL,"
        "workspace_id uuid NOT NULL,change_xid xid8 NOT NULL,changed_at timestamptz NOT NULL DEFAULT now(),CHECK(entity_type IN ('issue','comment','project')),"
        "PRIMARY KEY(entity_type,entity_id));CREATE INDEX idx_search_index_change_workspace_xid ON taskflow.search_index_change(workspace_id,change_xid,entity_type,entity_id);CREATE INDEX idx_search_index_change_changed_at ON taskflow.search_index_change(changed_at);" + TRIGGER_FUNCTION +
        "CREATE TRIGGER trg_project_search_index_change AFTER INSERT OR DELETE OR UPDATE ON taskflow.project "
        "FOR EACH ROW WHEN ((current_setting('multica.workspace_teardown',true) IS DISTINCT FROM 'on')) "
        "EXECUTE FUNCTION taskflow.record_search_index_change('project');")

TRIGGER_FUNCTION = "CREATE OR REPLACE FUNCTION taskflow.record_search_index_change()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nDECLARE\n    changed_id UUID;\n    changed_workspace_id UUID;\nBEGIN\n    IF TG_OP = 'DELETE' THEN\n        changed_id := OLD.id;\n        changed_workspace_id := OLD.workspace_id;\n    ELSE\n        changed_id := NEW.id;\n        changed_workspace_id := NEW.workspace_id;\n    END IF;\n\n    INSERT INTO search_index_change (entity_type, entity_id, workspace_id, change_xid, changed_at)\n    VALUES (TG_ARGV[0], changed_id, changed_workspace_id, pg_current_xact_id(), now())\n    ON CONFLICT (entity_type, entity_id) DO UPDATE\n        SET workspace_id = EXCLUDED.workspace_id,\n            change_xid = EXCLUDED.change_xid,\n            changed_at = EXCLUDED.changed_at;\n    RETURN NULL;\nEND\n$function$;"

def checks():
    candidate=(ROOT/"sql/taskflow_executor_mapping_candidate.sql").read_text()
    post=(ROOT/"sql/taskflow_executor_mapping_postflight.sql").read_text()
    rollback=(ROOT/"sql/taskflow_executor_mapping_rollback.sql").read_text()
    def apply():return sql("SET ROLE taskflow_migrator;"+candidate)
    def readback():return sql("SET ROLE taskflow_migrator;"+post)
    def reset():
        sql("DROP SCHEMA taskflow CASCADE;DROP SCHEMA extensions CASCADE;DROP ROLE taskflow_migrator;DROP ROLE taskflow_runtime;DROP ROLE anon;DROP ROLE authenticated;DROP ROLE service_role;")
        fixture();search_trigger_fixture()
    def count(t):return sql("SELECT count(*) FROM taskflow."+t).stdout.strip()
    expect_error(candidate,"requires taskflow_migrator");search_trigger_fixture()
    oldaid="9a8b5560-909c-5f30-82d7-9e330f5d28fc"
    sql("SET search_path=taskflow,extensions;INSERT INTO taskflow.project(workspace_id,title,lead_type,lead_id) VALUES('"+WS+"','old project','agent','"+oldaid+"');INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id) VALUES('"+WS+"','old issue','agent','"+oldaid+"');")
    oldrows=sql("SELECT to_jsonb(t) FROM taskflow.project t UNION ALL SELECT to_jsonb(i) FROM taskflow.issue i;").stdout
    apply();assert readback().stdout.count('MAPPED_UNBOUND_PRIVATE')==5
    assert sql("SELECT count(*) FROM taskflow.agent WHERE id='"+oldaid+"';").stdout.strip()=='0'
    assert oldrows==sql("SELECT to_jsonb(t) FROM taskflow.project t WHERE title='old project' UNION ALL SELECT to_jsonb(i) FROM taskflow.issue i;").stdout
    print('PASS random native IDs do not adopt old reserved UUID lead/assignee; old data unchanged')
    reset();apply()
    assert count('agent')=='5' and count('project')=='5' and count('search_index_change')=='5'
    assert sql("SELECT count(DISTINCT xmin::text) FROM (SELECT xmin FROM taskflow.agent UNION ALL SELECT xmin FROM taskflow.project UNION ALL SELECT xmin FROM taskflow.g1_executor_mapping_provenance) x;").stdout.strip()=='1'
    assert sql("SELECT bool_and(change_xid::text=xmin::text) FROM taskflow.search_index_change;").stdout.strip()=='t'
    print('PASS fixed five keys, random 5+5 IDs, single xmin and captured native trigger/outbox complete DDL')
    before=sql("SELECT to_jsonb(t),xmin FROM taskflow.agent t UNION ALL SELECT to_jsonb(p),xmin FROM taskflow.project p UNION ALL SELECT to_jsonb(v),xmin FROM taskflow.g1_executor_mapping_provenance v UNION ALL SELECT to_jsonb(o),xmin FROM taskflow.search_index_change o;").stdout
    apply();assert before==sql("SELECT to_jsonb(t),xmin FROM taskflow.agent t UNION ALL SELECT to_jsonb(p),xmin FROM taskflow.project p UNION ALL SELECT to_jsonb(v),xmin FROM taskflow.g1_executor_mapping_provenance v UNION ALL SELECT to_jsonb(o),xmin FROM taskflow.search_index_change o;").stdout
    print('PASS idempotent rerun unchanged IDs/snapshots/xmin/outbox')
    for role in ('taskflow_runtime','anon','authenticated','service_role'):
        expect_error('SET ROLE '+role+';SELECT executor_key FROM taskflow.g1_executor_mapping_provenance;','permission denied')
    defaultacl=sql('SELECT * FROM pg_default_acl;').stdout
    sql('SET ROLE taskflow_migrator;GRANT SELECT(executor_key) ON taskflow.g1_executor_mapping_provenance TO taskflow_runtime;')
    expect_error('SET ROLE taskflow_migrator;'+candidate,'ACL mismatch');expect_error('SET ROLE taskflow_migrator;'+post,'ACL mismatch')
    sql('SET ROLE taskflow_migrator;REVOKE SELECT(executor_key) ON taskflow.g1_executor_mapping_provenance FROM taskflow_runtime;')
    assert defaultacl==sql('SELECT * FROM pg_default_acl;').stdout
    print('PASS four nonowner roles denied; polluted column ACL rejected, no default ACL change')
    sql("INSERT INTO taskflow.agent(workspace_id,name,runtime_mode,system_key) VALUES('"+WS+"','duplicate key','cloud','CO-01');")
    expect_error('SET ROLE taskflow_migrator;'+candidate,'hard unique/private/unbound');expect_error('SET ROLE taskflow_migrator;'+post,'hard unique/private/unbound')
    sql("DELETE FROM taskflow.agent WHERE name='duplicate key';")
    for mutation in ("visibility='workspace'","permission_mode='public_to'","owner_id='00000000-0000-0000-0000-000000000001'","runtime_id='00000000-0000-0000-0000-000000000001'"):
        sql("UPDATE taskflow.agent SET "+mutation+" WHERE system_key='CO-01';UPDATE taskflow.g1_executor_mapping_provenance v SET agent_snapshot=to_jsonb(a) FROM taskflow.agent a WHERE a.id=v.agent_id;")
        expect_error('SET ROLE taskflow_migrator;'+candidate,'hard unique/private/unbound');expect_error('SET ROLE taskflow_migrator;'+post,'hard unique/private/unbound')
        sql("UPDATE taskflow.agent SET visibility='private',permission_mode='private',owner_id='"+OWNER+"',runtime_id=NULL WHERE system_key='CO-01';UPDATE taskflow.g1_executor_mapping_provenance v SET agent_snapshot=to_jsonb(a) FROM taskflow.agent a WHERE a.id=v.agent_id;")
    print('PASS duplicate key plus matching-ledger owner/private/permission/runtime drift hard RAISE rerun and postflight')
    aid=sql("SELECT id FROM taskflow.agent WHERE system_key='CO-01';").stdout.strip()
    sql("SET search_path=taskflow,extensions;INSERT INTO taskflow.project(workspace_id,title,lead_type,lead_id) VALUES('"+WS+"','later legitimate project','agent','"+aid+"');INSERT INTO taskflow.issue(workspace_id,title,assignee_type,assignee_id) VALUES('"+WS+"','later legitimate issue','agent','"+aid+"');")
    apply();assert readback().stdout.count('MAPPED_UNBOUND_PRIVATE')==5
    expect_error('SET ROLE taskflow_migrator;'+rollback,'POST_COMMIT_RETAIN')
    assert count('project')=='6' and count('issue')=='1'
    print('PASS legitimate later project+issue adoption retained and healthy; no deleting compensation')
    # Native UPSERT overwrites xid without another outbox entity.
    n=count('search_index_change');old=sql("SELECT change_xid FROM taskflow.search_index_change WHERE entity_id=(SELECT project_id FROM taskflow.g1_executor_mapping_provenance WHERE executor_key='CO-01');").stdout
    sql("SET search_path=taskflow,extensions;UPDATE taskflow.project SET title=title WHERE id=(SELECT project_id FROM taskflow.g1_executor_mapping_provenance WHERE executor_key='CO-01');")
    assert count('search_index_change')==n and old!=sql("SELECT change_xid FROM taskflow.search_index_change WHERE entity_id=(SELECT project_id FROM taskflow.g1_executor_mapping_provenance WHERE executor_key='CO-01');").stdout
    print('PASS captured native outbox UPSERT new xid no duplicate')
    reset();sql("CREATE FUNCTION taskflow.fail_last() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity_id=(SELECT id FROM taskflow.project WHERE title='GH-HELPER 原生專案') THEN RAISE EXCEPTION 'last outbox rejected';END IF;RETURN NEW;END$$;CREATE TRIGGER fail_last BEFORE INSERT ON taskflow.search_index_change FOR EACH ROW EXECUTE FUNCTION taskflow.fail_last();")
    expect_error('SET ROLE taskflow_migrator;'+candidate,'last outbox rejected')
    assert count('agent')=='0' and count('project')=='0' and count('search_index_change')=='0'
    assert sql("SELECT to_regclass('taskflow.g1_executor_mapping_provenance') IS NULL;").stdout.strip()=='t'
    print('PASS last native outbox error rolls whole transaction+DDL+ACL back')
    reset();sql("INSERT INTO taskflow.agent(workspace_id,name,runtime_mode,system_key) VALUES('"+WS+"','CO-01','cloud','CO-01');")
    expect_error('SET ROLE taskflow_migrator;'+candidate,'collision');assert count('agent')=='1' and count('project')=='0'
    print('PASS first-install key/name conflict refuses adoption no partial writes')
    reset();apply();sql("DELETE FROM taskflow.g1_executor_mapping_provenance WHERE executor_key='CO-02';")
    expect_error('SET ROLE taskflow_migrator;'+candidate,'exact-five');expect_error('SET ROLE taskflow_migrator;'+post,'exact-five')
    print('PASS partial ledger rejected nonzero rerun and postflight')
    reset();apply();sql("ALTER TABLE taskflow.g1_executor_mapping_provenance DROP CONSTRAINT g1_executor_mapping_provenance_pkey;")
    expect_error('SET ROLE taskflow_migrator;'+candidate,'constraint shape');expect_error('SET ROLE taskflow_migrator;'+post,'constraint shape')
    print('PASS provenance DDL drift rejected, not silently repaired')
    reset();apply()
    for setting in ("SET multica.workspace_teardown='on';", "SET session_replication_role='replica';"):
        expect_error(setting+'SET ROLE taskflow_migrator;'+candidate,'unsafe session trigger state')
        expect_error(setting+'SET ROLE taskflow_migrator;'+post,'unsafe session trigger state')
    sql('ALTER TABLE taskflow.project DISABLE TRIGGER trg_project_search_index_change;')
    expect_error('SET ROLE taskflow_migrator;'+candidate,'trigger baseline mismatch');expect_error('SET ROLE taskflow_migrator;'+post,'trigger baseline mismatch')
    sql('ALTER TABLE taskflow.project ENABLE TRIGGER trg_project_search_index_change;')
    print('PASS teardown on, replica inherited session, disabled native trigger all RAISE apply+postflight')
    sql("CREATE OR REPLACE FUNCTION taskflow.record_search_index_change() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$;")
    expect_error('SET ROLE taskflow_migrator;'+candidate,'function baseline mismatch')
    print('PASS native trigger function replacement refused')
    reset()
    # An additional native outbox trigger that suppresses inserts is not our
    # expected project trigger; the precommit xid assertion must still stop it.
    sql("CREATE FUNCTION taskflow.suppress_outbox() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL;END$$;CREATE TRIGGER suppress_outbox BEFORE INSERT ON taskflow.search_index_change FOR EACH ROW EXECUTE FUNCTION taskflow.suppress_outbox();")
    expect_error('SET ROLE taskflow_migrator;'+candidate,'outbox transaction mismatch')
    assert count('agent')=='0' and count('project')=='0'
    print('PASS first-install precommit outbox xid assertion catches suppressed outbox and rolls whole transaction back')
    print('PASS G1 v7 isolated tests complete; production NOT EXECUTED')

if __name__ == "__main__":
    raise SystemExit(main())
