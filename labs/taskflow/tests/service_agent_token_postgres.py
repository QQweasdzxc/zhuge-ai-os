"""SQL migration contracts on an isolated postgres:16 database (never production).

Usage: python3 labs/taskflow/tests/service_agent_token_postgres.py CONTAINER
The container must be the disposable PostgreSQL fixture owned by this test run.
"""
from pathlib import Path
import subprocess
import sys
import uuid

SQL = Path(__file__).resolve().parents[1] / 'sql'


def main(container):
    database = 'sat_sql_' + uuid.uuid4().hex[:12]

    def run(statement, success=True, marker=None):
        result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres',
                                 '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'],
                                input=statement, text=True, capture_output=True)
        if success and result.returncode:
            raise AssertionError(result.stderr)
        if not success:
            assert result.returncode, 'expected SQL rejection'
            if marker:
                assert marker in result.stderr, result.stderr
        return result.stdout.strip()

    subprocess.run(['docker', 'exec', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
                    '-c', 'CREATE DATABASE ' + database], check=True, capture_output=True)
    run('''DO $roles$ BEGIN
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='taskflow_migrator') THEN CREATE ROLE taskflow_migrator; END IF;
    IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='taskflow_runtime') THEN CREATE ROLE taskflow_runtime; END IF;
    END $roles$;
    CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;
    CREATE SCHEMA extensions;
    GRANT USAGE ON SCHEMA taskflow TO taskflow_runtime;
    SET ROLE taskflow_migrator;
    CREATE TABLE taskflow.workspace(id uuid primary key,slug text);
    CREATE TABLE taskflow.member(id uuid primary key default gen_random_uuid(),workspace_id uuid,user_id uuid,role text,unique(workspace_id,user_id));
    CREATE TABLE taskflow.agent(id uuid primary key,workspace_id uuid,owner_id uuid,name text,description text,runtime_id uuid,runtime_mode text,runtime_config jsonb,visibility text,status text,kind text,system_key text,permission_mode text);
    INSERT INTO taskflow.workspace VALUES('01a1247f-520e-78eb-aa58-0a0e458185f6','zhuge-lab-ac5afcc7');
    INSERT INTO taskflow.member(workspace_id,user_id,role) VALUES('01a1247f-520e-78eb-aa58-0a0e458185f6','ac5afcc7-f045-41a9-8827-eaf085a04c0d','owner');
    INSERT INTO taskflow.agent(id,workspace_id,name) VALUES('11111111-1111-4111-8111-111111111111','01a1247f-520e-78eb-aa58-0a0e458185f6','fixture');''')

    def phase(name, success=True, marker=None, prefix='SET ROLE taskflow_migrator;\n'):
        return run(prefix + (SQL / ('taskflow_service_agent_tokens_' + name + '.sql')).read_text(), success, marker)

    phase('candidate', False, 'requires taskflow_migrator', prefix='')
    phase('candidate')
    phase('postflight')
    phase('candidate', False, 'already exists')  # no adoption or silent repair
    for name in ('postflight', 'rollback'):
        phase(name, False, 'requires taskflow_migrator', prefix='SET ROLE taskflow_runtime;\n')
    run('ALTER ROLE taskflow_migrator BYPASSRLS;')
    phase('postflight', False, 'elevated attributes')
    run('ALTER ROLE taskflow_migrator NOBYPASSRLS;')
    run('SET ROLE taskflow_migrator; GRANT SELECT ON taskflow.service_agent_tokens TO PUBLIC;')
    phase('postflight', False, 'ACL mismatch')
    run('SET ROLE taskflow_migrator; REVOKE SELECT ON taskflow.service_agent_tokens FROM PUBLIC;')
    phase('postflight')
    insert = '''INSERT INTO taskflow.service_agent_tokens(agent_id,workspace_id,name,token_hash,created_by)
    VALUES('11111111-1111-4111-8111-111111111111','01a1247f-520e-78eb-aa58-0a0e458185f6','sql fixture',repeat('a',64),'ac5afcc7-f045-41a9-8827-eaf085a04c0d');'''
    run('SET ROLE taskflow_runtime;' + insert)
    assert run("SELECT expires_at-created_at=interval '90 days' FROM taskflow.service_agent_tokens") == 't'
    run('SET ROLE taskflow_runtime;' + insert, False, 'duplicate key')
    run('SET ROLE taskflow_runtime;' + insert.replace("repeat('a',64)", "'sat_plaintext'"), False, 'check constraint')
    run('SET ROLE taskflow_runtime;' + insert.replace("repeat('a',64)", "repeat('b',64)").replace(
        'ac5afcc7-f045-41a9-8827-eaf085a04c0d', '22222222-2222-4222-8222-222222222222'), False, 'foreign key constraint')

    run('SET ROLE taskflow_runtime; DELETE FROM taskflow.service_agent_tokens', False, 'permission denied')
    phase('rollback', False, 'refuses token history loss')
    run("SET ROLE taskflow_runtime; UPDATE taskflow.service_agent_tokens SET revoked_at=now();")
    phase('rollback', False, 'refuses token history loss')
    # Only discard fixture rows in this disposable test database.
    run('SET ROLE taskflow_migrator; DELETE FROM taskflow.service_agent_tokens;')
    phase('rollback')
    assert run("SELECT to_regclass('taskflow.service_agent_tokens') IS NULL") == 't'
    phase('candidate')
    phase('postflight')
    instinct = (SQL / 'taskflow_instinct01_service_agent_candidate.sql').read_text()
    run('SET ROLE taskflow_migrator;' + instinct, False, 'pending review')
    run("SET ROLE taskflow_migrator; SET taskflow.review_instinct01='approved';" + instinct)
    assert run("SELECT runtime_id IS NULL AND runtime_config='{}'::jsonb AND status='offline' AND permission_mode='private' FROM taskflow.agent WHERE system_key='INSTINCT-01'") == 't'
    run("SET ROLE taskflow_migrator; SET taskflow.review_instinct01='approved';" + instinct, False, 'collision')
    print('SAT SQL contracts: PASS (role, elevated-role, ACL, expiry, uniqueness, retention, rollback, INSTINCT review/unbound/collision)')
    print('Disposable database retained for inspection: ' + database)


if __name__ == '__main__':
    main(sys.argv[1])
