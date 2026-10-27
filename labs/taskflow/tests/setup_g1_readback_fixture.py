"""Destructive fixture for an explicitly isolated G1_TEST_SOCKET only, never production."""
import os
import test_executor_mapping_postgres as f
assert os.environ.get('G1_TEST_SOCKET'), 'explicit isolated socket required'
f.sql('DROP SCHEMA IF EXISTS taskflow CASCADE;DROP SCHEMA IF EXISTS extensions CASCADE;DROP ROLE IF EXISTS taskflow_migrator;DROP ROLE IF EXISTS taskflow_runtime;DROP ROLE IF EXISTS anon;DROP ROLE IF EXISTS authenticated;DROP ROLE IF EXISTS service_role;')
f.fixture();f.search_trigger_fixture();f.install()
f.sql("SET search_path=taskflow,extensions;INSERT INTO taskflow.project(workspace_id,title,lead_type,lead_id) SELECT workspace_id,'G1 second project','agent',id FROM taskflow.agent WHERE system_key='CO-01';")
print('READBACK FIXTURE INSTALLED (minimal TaskFlow schema, not full production schema)')
