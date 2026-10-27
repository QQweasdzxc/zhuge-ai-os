"""CO-01 isolated Docker PG16/17 tests. NOT VERIFIED until actually run.

Platform roles are simulations, not claims about production. CREATE ROLE defaults
are fixture assumptions for the mock application roles. The image's postgres
attributes are discovered, never assigned or assumed. Superuser functional
checks from the existing suite are not evidence of ordinary-role authorization.
No DSN, external DB, Provider, network repair or production installer is used.
"""
import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location(
    "existing_dispatch_tests", Path(__file__).with_name("test_native_dispatch_authority_postgres.py"))
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)
CANDIDATE = (ROOT / "sql/taskflow_native_dispatch_authority_candidate.sql").read_text()
POSTFLIGHT = (ROOT / "sql/taskflow_native_dispatch_authority_postflight.sql").read_text()
ROLLBACK = (ROOT / "sql/taskflow_native_dispatch_authority_rollback.sql").read_text()
ROLES = ("taskflow_runtime", "anon", "authenticated", "service_role", "postgres")
FUNCTIONS = (
    "claim_dispatch_intent", "bind_dispatch_provider_route", "begin_dispatch_provider",
    "record_dispatch_provider_ack", "renew_dispatch_lease", "record_dispatch_reconciliation",
    "stop_dispatch_intent", "confirm_dispatch_stop",
)
original_run, original_sql = base.run, base.sql


def must(statement):
    return original_sql(statement).stdout.strip()


def install():
    # Existing source owner contract; connection is to the disposable container.
    return original_sql("SET ROLE taskflow_migrator;\n" + CANDIDATE)


def postflight():
    result = must(POSTFLIGHT)
    assert "NOT_READY|" in result, result
    assert "rollback_script_requires_isolated_test" in result, result
    return result


def catalog_snapshot():
    return must("""SELECT jsonb_build_object(
      'table', (SELECT to_jsonb(c) FROM pg_class c WHERE oid='taskflow.dispatch_intent'::regclass),
      'columns', (SELECT jsonb_agg(to_jsonb(a) ORDER BY attnum) FROM pg_attribute a
                  WHERE attrelid='taskflow.dispatch_intent'::regclass),
      'constraints', (SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c
                      WHERE conrelid='taskflow.dispatch_intent'::regclass),
      'indexes', (SELECT jsonb_agg(to_jsonb(i) ORDER BY indexrelid) FROM pg_index i
                  WHERE indrelid='taskflow.dispatch_intent'::regclass),
      'functions', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p
                    JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='taskflow'),
      'rows', (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM taskflow.dispatch_intent d));""")


def denied(statement, role):
    # This executes with the ordinary role as session/current identity. Schema
    # denial is also possible in this minimal fixture; effective object ACLs
    # are independently asserted below, never inferred from an admin success.
    result = original_sql(f"SET SESSION AUTHORIZATION {role};\n" + statement, check=False)
    assert result.returncode != 0 and "permission denied" in result.stderr, result.stderr


def security_checks(version):
    count = 0
    initial = postflight()
    for role in ROLES:
        attrs = must(f"SELECT row_to_json(r) FROM pg_roles r WHERE rolname='{role}';")
        print(f"SIMULATION PG{version} {role}: {attrs}")
        for name in FUNCTIONS:
            oid = must(f"SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                       f"WHERE n.nspname='taskflow' AND p.proname='{name}';")
            effective = must(f"SELECT has_function_privilege('{role}',{oid},'EXECUTE');")
            if effective == "t":
                # Observe elevated/inherited authority, not a successful denial.
                assert f"effective_execute:{role}:{name}" in initial
                print(f"UNSAFE_EFFECTIVE_PRIVILEGE PG{version} {role} {name}")
            else:
                args = must(f"SELECT string_agg('NULL::'||format_type(t,NULL),',') "
                            f"FROM pg_proc p, unnest(p.proargtypes::oid[]) t WHERE p.oid={oid};")
                denied(f"SELECT taskflow.{name}({args});", role)
            count += 1
        ledger_priv = must(f"SELECT has_table_privilege('{role}','taskflow.dispatch_intent',"
                          "'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR "
                          f"has_any_column_privilege('{role}','taskflow.dispatch_intent','SELECT,INSERT,UPDATE,REFERENCES');")
        if ledger_priv == "t":
            assert f"effective_ledger:{role}" in initial
        else:
            for statement in ("SELECT * FROM taskflow.dispatch_intent;",
                              "INSERT INTO taskflow.dispatch_intent DEFAULT VALUES;",
                              "UPDATE taskflow.dispatch_intent SET state='completed';",
                              "DELETE FROM taskflow.dispatch_intent;",
                              "TRUNCATE taskflow.dispatch_intent;"):
                denied(statement, role)
        count += 1

    # Deliberate metadata drift is rolled back inside this disposable database.
    metadata_query = POSTFLIGHT.split("BEGIN TRANSACTION READ ONLY;", 1)[1].rsplit("ROLLBACK;", 1)[0]
    for mutation, reason in (
        ("ALTER FUNCTION taskflow.confirm_dispatch_stop(uuid,bigint,text,text) SECURITY DEFINER;", "function_security:"),
        ("ALTER FUNCTION taskflow.confirm_dispatch_stop(uuid,bigint,text,text) SET search_path=public;", "function_security:"),
        ("DROP INDEX taskflow.dispatch_intent_one_active_writer;", "active_writer_index"),
    ):
        observed = must("BEGIN; " + mutation + metadata_query + "ROLLBACK;")
        assert reason in observed, observed
        count += 1
    target = "taskflow.confirm_dispatch_stop(uuid,bigint,text,text)"
    must(f"SET ROLE taskflow_migrator; GRANT EXECUTE ON FUNCTION {target} TO PUBLIC;")
    assert "function_acl:confirm_dispatch_stop" in postflight()
    install()
    must(f"SET ROLE taskflow_migrator; GRANT EXECUTE ON FUNCTION {target} TO anon WITH GRANT OPTION;")
    assert "function_acl:confirm_dispatch_stop" in postflight()
    install()
    assert "function_acl:" not in postflight()
    count += 2
    # Same CREATE OR REPLACE body preserves the grant until explicitly revoked.
    definition = must("SELECT pg_get_functiondef('" + target + "'::regprocedure);")
    must(f"SET ROLE taskflow_migrator; GRANT EXECUTE ON FUNCTION {target} TO authenticated;\n" + definition)
    assert must(f"SELECT has_function_privilege('authenticated','{target}','EXECUTE');") == "t"
    install()
    assert must(f"SELECT has_function_privilege('authenticated','{target}','EXECUTE');") == "f"
    count += 1
    before = catalog_snapshot()
    result = original_sql(ROLLBACK, check=False)
    assert result.returncode != 0 and "refusing destructive rollback" in result.stderr, result.stderr
    assert catalog_snapshot() == before, "rollback changed nonempty Ledger/catalog"
    count += 1
    # Forward-fix: repeat candidate with nonempty reconciliation Ledger. OIDs
    # of a rebuilt index may change; rows, fence and behavior must not change.
    rows = must("SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM taskflow.dispatch_intent d;")
    install()
    install()
    assert must("SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM taskflow.dispatch_intent d;") == rows
    fence = must("SELECT id||','||fencing_epoch||','||issue_id||','||workspace_id FROM taskflow.dispatch_intent "
                 "WHERE state='reconcile_required' AND NOT provider_stop_verified LIMIT 1;")
    dispatch, epoch, issue, workspace = fence.split(',')
    assert must(f"SELECT taskflow.confirm_dispatch_stop('{dispatch}',{epoch},'run','unverified');") == "f"
    base.expect_error(f"SELECT taskflow.claim_dispatch_intent('forward-fix','{issue}','{workspace}',"
                      "'CO-01','codex','cto-1',60);", "active writer")
    count += 1
    must("SET ROLE taskflow_migrator; GRANT SELECT ON taskflow.dispatch_intent TO anon;")
    assert "ledger_acl" in postflight()
    rejected = original_sql("SET ROLE taskflow_migrator;\n" + CANDIDATE, check=False)
    assert rejected.returncode != 0 and "dispatch ledger ACL drift" in rejected.stderr
    # Remove only the deliberately implanted isolated-test Ledger grant.
    must("SET ROLE taskflow_migrator; REVOKE SELECT ON taskflow.dispatch_intent FROM anon;")
    count += 1
    # Missing relation must return NOT_READY rather than error/success.
    # Empty rollback is performed only after the preserved nonempty evidence.
    metadata = must("""SELECT jsonb_agg(jsonb_build_array(p.proname,
      oidvectortypes(p.proargtypes),pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,
      (SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC'
       ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable)
       ORDER BY a.grantee,a.privilege_type) FROM aclexplode(p.proacl) a)) ORDER BY p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='taskflow';""")
    must("TRUNCATE taskflow.dispatch_intent;")
    must(ROLLBACK)
    assert must("SELECT to_regclass('taskflow.dispatch_intent') IS NULL;") == "t"
    assert "ledger_owner_or_kind" in postflight()
    install()
    assert "signature:" not in postflight()
    count += 1
    return count, json.loads(metadata)


def main():
    # No recovery or alternate Docker endpoints. This is a local container test.
    if subprocess.run(["docker", "--host=unix:///var/run/docker.sock", "info"],
                      capture_output=True).returncode != 0:
        print("NOT VERIFIED: local Docker unavailable; PG16=0 PG17=0 tests executed")
        return 2
    results = []
    for version in (16, 17):
        def isolated_run(*args, **kwargs):
            args = list(args)
            if args[:3] == ["docker", "rm", "-f"]:
                return subprocess.CompletedProcess(args, 0, "", "")
            args = [f"postgres:{version}" if a == "postgres:16" else a for a in args]
            if args and args[0] == "docker":
                args[1:1] = ["--host=unix:///var/run/docker.sock"]
            return original_run(*args, **kwargs)

        def fixture_sql(statement, check=True):
            statement = statement.replace("CREATE SCHEMA taskflow;",
                "CREATE ROLE taskflow_migrator; CREATE ROLE taskflow_runtime; "
                "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; "
                "CREATE SCHEMA taskflow AUTHORIZATION taskflow_migrator;")
            if statement == CANDIDATE:
                statement = "SET ROLE taskflow_migrator;\n" + statement
            return original_sql(statement, check=check)

        base.run, base.sql = isolated_run, fixture_sql
        try:
            assert base.main() == 0
            print(f"PG{version}: existing functional suite ran as administrator; not role-denial evidence")
            total, metadata = security_checks(version)
            results.append(metadata)
            print(f"PG{version}: safety scenarios={total} failures=0; overall NOT_READY")
        finally:
            original_run("docker", "--host=unix:///var/run/docker.sock", "rm", "-f", base.NAME, check=False)
    assert results[0] == results[1], "PG16/17 metadata/ACL contracts differ"
    print("PG16/17 metadata/ACL comparison passed; source acceptance remains NOT_READY")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
