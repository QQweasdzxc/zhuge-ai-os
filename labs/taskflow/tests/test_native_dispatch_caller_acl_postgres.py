"""Real-schema test of the Dispatch caller ACL candidate, run AS taskflow_runtime.

Env-gated (TASKFLOW_CALLER_ACL_REAL_SCHEMA=1). Expects a database already built by
scripts/build-native-agent-report-real-schema.sh (staged migrations + base dispatch
candidate, installed by taskflow_migrator) on a LOCAL/CI throwaway PostgreSQL.
Env: PGHOST/PGPORT, TASKFLOW_CALLER_ACL_DB, TASKFLOW_CALLER_ACL_ADMIN (superuser).
Skipped (exit 2) when not enabled: a skip is not a pass.
"""
import os, re, subprocess, sys, uuid
from pathlib import Path

ROOT = Path(__file__).parents[1]
DB = os.environ.get("TASKFLOW_CALLER_ACL_DB", "taskflow_native_ai_real_schema_test")
ADMIN = os.environ.get("TASKFLOW_CALLER_ACL_ADMIN", "postgres")

def psql(user, text, check=True, tuples=True):
    args = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", DB] + (["-At"] if tuples else [])
    env = dict(os.environ)
    if user != ADMIN and os.environ.get("TASKFLOW_CALLER_ACL_ROLE_PASSWORD"):
        env["PGPASSWORD"] = os.environ["TASKFLOW_CALLER_ACL_ROLE_PASSWORD"]
    r = subprocess.run(args, input=text, text=True, capture_output=True, env=env)
    if check and r.returncode != 0:
        raise AssertionError(f"{user}: {text[:120]!r}: {r.stderr}")
    return r

def val(user, text): return psql(user, text).stdout.strip()
def denied(user, text, marker="permission denied"):
    r = psql(user, text, check=False)
    assert r.returncode != 0 and marker in r.stderr, f"{user} should be denied: {text[:100]!r} -> {r.returncode} {r.stderr}"
def refuses(user, text, marker):
    r = psql(user, text, check=False)
    assert r.returncode != 0 and marker in r.stderr, f"expected {marker!r}: {r.stderr}"

RT, MG = "taskflow_runtime", "taskflow_migrator"
FUNCS = ["claim_dispatch_intent", "bind_dispatch_provider_route", "begin_dispatch_provider",
         "record_dispatch_provider_ack", "renew_dispatch_lease", "record_dispatch_reconciliation",
         "stop_dispatch_intent", "confirm_dispatch_stop", "lock_dispatch_for_report", "mark_dispatch_report_committed"]
FLIST = ",".join(f"'{f}'" for f in FUNCS)
n = 0
def ok(msg):
    global n; n += 1; print(f"  ok {n}: {msg}")

import hashlib
BASE_SQL = (ROOT / "sql/taskflow_native_dispatch_authority_candidate.sql").read_text()
B_SQL = (ROOT / "sql/taskflow_native_dispatch_caller_acl_candidate.sql").read_text()
def base_bodies():
    return {m.group(1): m.group(2) for m in re.finditer(r"CREATE OR REPLACE FUNCTION taskflow\.(\w+)\(.*?AS \$\$(.*?)\$\$;", BASE_SQL, re.S)}
def md5(s): return hashlib.md5(s.encode()).hexdigest()
def cur_md5(name):
    return val(MG, f"SELECT md5(prosrc) FROM pg_proc WHERE proname='{name}' AND pronamespace='taskflow'::regnamespace")

def norm(s): return re.sub(r"\s+", " ", s).strip()

def check_go_fixture_drift():
    sql = norm((ROOT / "sql/taskflow_native_dispatch_caller_acl_candidate.sql").read_text())
    go = norm((ROOT / "overrides/taskflow_native_agent_reporting_write_test.go").read_text())
    for fn in ("lock_dispatch_for_report", "mark_dispatch_report_committed"):
        start = go.index(f"CREATE OR REPLACE FUNCTION taskflow.{fn}")
        body = go[start:go.index("`", start)]
        assert body.rstrip("; ") in sql, f"Go fixture copy of {fn} drifted from the SQL candidate"

def main():
    if os.environ.get("PGHOST", "") not in ("127.0.0.1", "localhost") and not os.environ.get("PGHOST", "").startswith("/"):
        print("refusing non-local PostgreSQL host"); return 1
    check_go_fixture_drift()
    if os.environ.get("TASKFLOW_CALLER_ACL_REAL_SCHEMA") != "1":
        print("CALLER_ACL_NOT_VERIFIED: TASKFLOW_CALLER_ACL_REAL_SCHEMA=1 not set"); return 2
    for role in ("anon", "authenticated", "service_role", "ci_other_role"):
        psql(ADMIN, f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {role} LOGIN; END IF; END $$;")
        psql(ADMIN, f"GRANT USAGE ON SCHEMA taskflow TO {role}")
        if os.environ.get("TASKFLOW_CALLER_ACL_ROLE_PASSWORD"):
            psql(ADMIN, f"ALTER ROLE {role} PASSWORD '{os.environ['TASKFLOW_CALLER_ACL_ROLE_PASSWORD']}'")
    # SOURCE-ASSUMED runtime provisioning (tests/test_executor_mapping_postgres.py + the base
    # candidate's comment): schema USAGE and DML on every table except the owner-only ledger.
    # Not verified against any real database.
    psql(ADMIN, f"GRANT USAGE ON SCHEMA taskflow TO {'taskflow_runtime'}; "
         "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA taskflow TO taskflow_runtime; "
         "REVOKE ALL ON TABLE taskflow.dispatch_intent FROM taskflow_runtime;")
    ws, usr, proj, issue = (str(uuid.uuid4()) for _ in range(4))
    psql(ADMIN, f"""SET search_path=taskflow,public;
INSERT INTO taskflow.workspace(id,name,slug) VALUES ('{ws}','w','w-{ws[:8]}');
INSERT INTO taskflow.issue(id,workspace_id,title,creator_id,creator_type) VALUES ('{issue}','{ws}','t','{usr}','member');""")
    claim = f"taskflow.claim_dispatch_intent('rk-{ws[:8]}','{issue}','{ws}','CO-01','codex','cto-1',60)"

    # Start from the base-candidate end state by running the shipped rollback (also tests it).
    psql(MG, (ROOT / "sql/taskflow_native_dispatch_caller_acl_rollback.sql").read_text())
    assert val(MG, f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='taskflow' AND p.proname IN ({FLIST}) AND p.prosecdef") == "0"
    assert val(MG, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='taskflow' AND p.proname IN ('lock_dispatch_for_report','mark_dispatch_report_committed')") == "0"
    assert val(MG, f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, LATERAL aclexplode(p.proacl) a WHERE n.nspname='taskflow' AND p.proname IN ({FLIST}) AND a.grantee='{RT}'::regrole") == "0"
    for name, body in base_bodies().items():
        assert cur_md5(name) == md5(body), f"{name} body is not the reviewed base after rollback"
    assert len(base_bodies()) == 8
    ok("rollback restores base end state (8 invoker fns with byte-identical reviewed bodies, no runtime EXECUTE, 2 gates dropped)")
    # The overlay's only change to a base body is ONE added predicate on the ACK UPDATE.
    m = re.search(r"CREATE OR REPLACE FUNCTION taskflow\.record_dispatch_provider_ack\(.*?AS \$\$(.*?)\$\$;", B_SQL, re.S)
    ack_base = base_bodies()["record_dispatch_provider_ack"]
    added = [l for l in m.group(1).split("\n") if l not in ack_base.split("\n")]
    removed = [l for l in ack_base.split("\n") if l not in m.group(1).split("\n")]
    assert added == ["       AND provider_session_id = p_provider_session_id"] and removed == [], (added, removed)
    ok("overlay ACK body = reviewed base body + exactly one predicate line")
    # Baseline: before the candidate the runtime role cannot reach the ledger or the functions.
    denied(RT, f"SELECT 1 FROM {claim}", "permission denied for function")
    denied(RT, "SELECT 1 FROM taskflow.dispatch_intent", "permission denied for table")
    assert val(RT, "SELECT count(*) FROM taskflow.issue") is not None  # schema usable, only the ledger is closed
    ok("baseline: runtime denied on functions and ledger before install")

    # Install as the restricted migrator, twice (idempotent), after verifying a non-migrator is refused.
    sqltext = (ROOT / "sql/taskflow_native_dispatch_caller_acl_candidate.sql").read_text()
    refuses(ADMIN, sqltext, "restricted taskflow_migrator owner")
    psql(MG, sqltext); psql(MG, sqltext)
    ok("installed as taskflow_migrator; re-run does not drop grants and succeeds")

    # Catalog contract
    assert val(MG, f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='taskflow' AND p.proname IN ({FLIST}) AND p.prosecdef AND p.proconfig=ARRAY['search_path=taskflow, pg_catalog, pg_temp']") == "10"
    assert val(MG, f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, LATERAL aclexplode(p.proacl) a WHERE n.nspname='taskflow' AND p.proname IN ({FLIST}) AND a.grantee=0") == "0", "PUBLIC EXECUTE"
    assert val(MG, f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, LATERAL aclexplode(p.proacl) a WHERE n.nspname='taskflow' AND p.proname IN ({FLIST}) AND a.grantee='{RT}'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable") == "10"
    assert val(MG, f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, LATERAL aclexplode(p.proacl) a WHERE n.nspname='taskflow' AND p.proname IN ({FLIST}) AND a.grantee NOT IN (0,p.proowner,'{RT}'::regrole)") == "0"
    assert val(MG, "SELECT relacl::text FROM pg_class WHERE oid='taskflow.dispatch_intent'::regclass") == "{taskflow_migrator=arwdDxt/taskflow_migrator}"
    ok("catalog: 10 definer fns, fixed search_path (temp last), only runtime EXECUTE, ledger ACL still owner-only")

    # Static check: every relation reference in the 10 bodies is schema-qualified.
    rows = [x for x in psql(MG, f"SELECT p.proname||chr(31)||replace(p.prosrc,chr(10),' ') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='taskflow' AND p.proname IN ({FLIST})").stdout.split("\n") if x]
    assert len(rows) == 10
    for row in rows:
        name, src = row.split("\x1f", 1)
        src = re.sub(r"--[^\n]*", "", src)
        for m in re.finditer(r"\b(FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([A-Za-z_][\w.]*)", src, re.I):
            assert m.group(2).startswith("taskflow.") or m.group(2).lower() in ("existing",), f"{name}: unqualified relation {m.group(2)}"
    ok("static: all relation references in function bodies are taskflow-qualified")

    # Direct ledger DML denied for runtime and every other role.
    for role in (RT, "anon", "authenticated", "service_role", "ci_other_role"):
        for stmt in ("SELECT 1 FROM taskflow.dispatch_intent", "UPDATE taskflow.dispatch_intent SET state='failed'",
                     "DELETE FROM taskflow.dispatch_intent", "TRUNCATE taskflow.dispatch_intent"):
            denied(role, stmt)
    ok("direct ledger SELECT/UPDATE/DELETE/TRUNCATE denied for runtime and 4 other roles")
    denied(RT, "INSERT INTO taskflow.dispatch_intent(request_key,request_payload_hash,issue_id,workspace_id,executor_id,provider,cto_principal,lease_expires_at) VALUES ('x','x',gen_random_uuid(),gen_random_uuid(),'a','b','c',now())")
    # Other roles cannot execute any of the 10 functions.
    for role in ("anon", "authenticated", "service_role", "ci_other_role"):
        denied(role, f"SELECT 1 FROM {claim}"); denied(role, f"SELECT * FROM taskflow.lock_dispatch_for_report('{ws}','{ws}',1,'a','b','c')")
        denied(role, f"SELECT taskflow.mark_dispatch_report_committed('{ws}','{ws}',1,'a','b','c')")
    ok("non-runtime roles cannot EXECUTE claim/lock/mark")
    # runtime cannot rewrite or add functions in taskflow
    denied(RT, "ALTER FUNCTION taskflow.claim_dispatch_intent(text,uuid,uuid,text,text,text,integer) SECURITY INVOKER", "must be owner")
    denied(RT, "CREATE FUNCTION taskflow.evil() RETURNS int LANGUAGE sql AS 'SELECT 1'", "permission denied for schema")
    ok("runtime cannot alter the definer functions")

    # Full chain as runtime.
    first = val(RT, f"SELECT c.id||','||c.lease_id||','||c.fencing_epoch FROM {claim} c")
    dispatch, lease, epoch = first.split(",")
    assert val(RT, f"SELECT c.id||','||c.lease_id||','||c.fencing_epoch FROM {claim} c") == first
    refuses(RT, f"SELECT 1 FROM taskflow.claim_dispatch_intent('rk-{ws[:8]}','{issue}','{ws}','CO-02','codex','cto-1',60)", "payload mismatch")
    refuses(RT, f"SELECT 1 FROM taskflow.claim_dispatch_intent('other','{issue}','{ws}','CO-01','codex','cto-1',60)", "active writer")
    ok("runtime claim, exact replay returns same intent, payload mismatch and second writer refused")
    def call(fn, args): return val(RT, f"SELECT taskflow.{fn}({args})")
    D = f"'{dispatch}','{lease}',{epoch}"
    assert call("begin_dispatch_provider", D + ",'codex','s1'") == "f"
    assert call("bind_dispatch_provider_route", D + ",'codex','s1'") == "t"
    assert call("begin_dispatch_provider", D + ",'codex','s1'") == "t"
    assert call("begin_dispatch_provider", D + ",'codex','s1'") == "f"
    assert call("renew_dispatch_lease", D + ",60") == "t"
    ok("runtime bind -> begin -> renew; begin replay refused")
    # Forgery-shaped inputs: wrong lease / wrong epoch / wrong provider / wrong session all refused.
    bad_lease = f"'{dispatch}','{uuid.uuid4()}',{epoch}"
    bad_epoch = f"'{dispatch}','{lease}',{int(epoch)+5}"
    assert call("record_dispatch_provider_ack", bad_lease + ",'codex','s1','r1','a1'") == "f"
    assert call("record_dispatch_provider_ack", bad_epoch + ",'codex','s1','r1','a1'") == "f"
    assert call("record_dispatch_provider_ack", D + ",'gemini','s1','r1','a1'") == "f"
    assert call("record_dispatch_provider_ack", D + ",'codex','s2','r1','a1'") == "f", "ACK with a session other than the bound one"
    assert val(MG, f"SELECT provider_session_id||'|'||state FROM taskflow.dispatch_intent WHERE id='{dispatch}'") == "s1|provider_start_requested"
    assert call("record_dispatch_provider_ack", D + ",'codex','s1','r1','a1'") == "t"
    assert call("record_dispatch_provider_ack", D + ",'codex','s1','r1','a1'") == "t"
    assert call("record_dispatch_provider_ack", D + ",'codex','s1','r2','a2'") == "f", "ACK mutation after ack"
    ok("ACK: forged lease/epoch/provider/unbound-session refused (state and bound session unchanged); exact replay idempotent; mutation refused")
    # Report gate 1: capability-free. Needs the claim's own ids; returns four scope fields only.
    G = lambda d=dispatch, l=lease, e=epoch, r="r1", s="s1", a="a1": f"'{d}','{l}',{e},'{r}','{s}','{a}'"
    row = val(RT, f"SELECT workspace_id||'|'||issue_id||'|'||executor_id||'|'||provider FROM taskflow.lock_dispatch_for_report({G()})")
    assert row == f"{ws}|{issue}|CO-01|codex", row
    assert val(RT, "SELECT count(*) FROM (SELECT * FROM taskflow.lock_dispatch_for_report('%s','%s',1,'r','s','a')) x" % (uuid.uuid4(), uuid.uuid4())) == "0"
    assert val(MG, "SELECT array_to_string(proargnames,',') FROM pg_proc WHERE proname='lock_dispatch_for_report' AND pronamespace='taskflow'::regnamespace").endswith("workspace_id,issue_id,executor_id,provider")
    for bad in (G(d=str(uuid.uuid4())), G(l=str(uuid.uuid4())), G(e=int(epoch)+1), G(r="rX"), G(s="sX"), G(a="aX")):
        assert val(RT, f"SELECT count(*) FROM taskflow.lock_dispatch_for_report({bad})") == "0", bad
    ok("lock gate: needs claim ids; right ids return 4 scope fields; unknown dispatch/lease/epoch/run/session/ack return 0 rows")
    M = lambda l=lease, e=epoch, r="r1", s="s1", a="a1": f"'{dispatch}','{l}',{e},'{r}','{s}','{a}'"
    assert call("mark_dispatch_report_committed", M(l=str(uuid.uuid4()))) == "f"
    assert call("mark_dispatch_report_committed", M(e=int(epoch)+1)) == "f"
    assert call("mark_dispatch_report_committed", M(r="rX")) == "f"
    assert call("mark_dispatch_report_committed", M(a="aX")) == "f"
    assert val(MG, f"SELECT native_write_state FROM taskflow.dispatch_intent WHERE id='{dispatch}'") == "pending"
    ok("mark gate: forged lease/epoch/run/ack cannot mark committed")
    # Lock really is held for the transaction: a second session cannot lock until commit.
    import threading, time
    holder = subprocess.Popen(["psql", "-X", "-U", RT, "-d", DB, "-At"], stdin=subprocess.PIPE, text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env={**os.environ, **({"PGPASSWORD": os.environ["TASKFLOW_CALLER_ACL_ROLE_PASSWORD"]} if os.environ.get("TASKFLOW_CALLER_ACL_ROLE_PASSWORD") else {})})
    holder.stdin.write(f"BEGIN; SELECT 1 FROM taskflow.lock_dispatch_for_report({G()}); SELECT pg_sleep(2); SELECT taskflow.mark_dispatch_report_committed({M()}); COMMIT;\n"); holder.stdin.close()
    time.sleep(0.7)
    # A forged/unknown call must NOT wait on (or take) the lock while the real holder has it.
    t1 = time.time()
    for bad in (G(l=str(uuid.uuid4())), G(e=int(epoch)+1), G(d=str(uuid.uuid4())), G(a="aX")):
        val(RT, f"BEGIN; SELECT count(*) FROM taskflow.lock_dispatch_for_report({bad}); COMMIT;")
    forged_wait = time.time() - t1
    assert forged_wait < 0.6, f"forged gate calls waited {forged_wait:.2f}s (they must not take or wait on the lock)"
    t0 = time.time()
    val(RT, f"BEGIN; SELECT 1 FROM taskflow.lock_dispatch_for_report({G()}); COMMIT;")
    waited = time.time() - t0
    holder.wait()
    assert waited > 0.8, f"second locker did not wait ({waited:.2f}s)"
    assert val(MG, f"SELECT native_write_state FROM taskflow.dispatch_intent WHERE id='{dispatch}'") == "committed"
    ok(f"lock held to transaction end (matching second locker waited {waited:.1f}s; forged callers did not wait: {forged_wait:.2f}s); mark committed in same tx")
    # Rollback of the caller tx leaves state unchanged.
    # (new dispatch for another issue)
    issue2 = str(uuid.uuid4())
    psql(ADMIN, f"SET search_path=taskflow,public; INSERT INTO taskflow.issue(id,workspace_id,number,title,creator_id,creator_type) VALUES ('{issue2}','{ws}',2,'t2','{usr}','member')")
    c2 = val(RT, f"SELECT c.id||','||c.lease_id||','||c.fencing_epoch FROM taskflow.claim_dispatch_intent('rk2-{ws[:8]}','{issue2}','{ws}','CO-01','codex','cto-1',60) c")
    d2, l2, e2 = c2.split(",")
    D2 = f"'{d2}','{l2}',{e2}"
    call("bind_dispatch_provider_route", D2 + ",'codex','s9'"); call("begin_dispatch_provider", D2 + ",'codex','s9'")
    call("record_dispatch_provider_ack", D2 + ",'codex','s9','r9','a9'")
    val(RT, f"BEGIN; SELECT taskflow.mark_dispatch_report_committed('{d2}','{l2}',{e2},'r9','s9','a9'); ROLLBACK;")
    assert val(MG, f"SELECT native_write_state FROM taskflow.dispatch_intent WHERE id='{d2}'") == "pending"
    ok("caller rollback leaves ledger unchanged")
    # Stop / fence / replay.
    assert val(RT, f"SELECT taskflow.stop_dispatch_intent('{d2}',{e2},'user stop')") == "t"
    assert val(RT, f"SELECT taskflow.stop_dispatch_intent('{d2}',{e2},'again')") == "f", "stale epoch replay"
    assert val(RT, f"SELECT taskflow.mark_dispatch_report_committed('{d2}','{l2}',{e2},'r9','s9','a9')") == "f"
    assert val(RT, f"SELECT taskflow.renew_dispatch_lease('{d2}','{l2}',{e2},60)") == "f"
    assert val(RT, f"SELECT taskflow.confirm_dispatch_stop('{d2}',{int(e2)+1},'r9','stop-evt')") == "f", "confirm stop must stay stub false"
    assert val(MG, f"SELECT state||'|'||provider_stop_verified FROM taskflow.dispatch_intent WHERE id='{d2}'") == "reconcile_required|false"
    ok("stop bumps fence; old-epoch replay/mark/renew refused; confirm_dispatch_stop stays false")
    # Expired lease cannot commit.
    psql(MG, f"UPDATE taskflow.dispatch_intent SET lease_expires_at=now()-interval '1 second' WHERE id='{dispatch}'")
    assert call("mark_dispatch_report_committed", M()) == "f"
    assert val(RT, f"SELECT count(*) FROM taskflow.lock_dispatch_for_report({G()})") == "0", "expired lease must not lock"
    d2ack = f"'{d2}','{l2}',{int(e2)+1},'r9','s9','a9'"
    assert val(RT, f"SELECT count(*) FROM taskflow.lock_dispatch_for_report({d2ack})") == "0", "stopped claim must not lock"
    ok("expired lease and stopped claim: mark refused and lock gate returns 0 rows")

    # pg_temp shadowing cannot redirect the definer bodies.
    before = val(MG, "SELECT count(*) FROM taskflow.dispatch_intent")
    shadow = """CREATE TEMP TABLE dispatch_intent (id uuid, state text);
CREATE TEMP TABLE issue (id uuid, workspace_id uuid);
CREATE FUNCTION pg_temp.now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() - interval '100 years' $$;
"""
    iss3 = str(uuid.uuid4())
    psql(ADMIN, f"SET search_path=taskflow,public; INSERT INTO taskflow.issue(id,workspace_id,number,title,creator_id,creator_type) VALUES ('{iss3}','{ws}',3,'t3','{usr}','member')")
    out = val(RT, shadow + f"SELECT c.id FROM taskflow.claim_dispatch_intent('rk3-{ws[:8]}','{iss3}','{ws}','CO-01','codex','cto-1',60) c; SELECT count(*) FROM pg_temp.dispatch_intent;").split("\n")
    assert out[-1] == "0", "temp ledger must stay empty"
    assert val(MG, "SELECT count(*) FROM taskflow.dispatch_intent") == str(int(before) + 1), "row must land in the real ledger"
    assert val(MG, f"SELECT lease_expires_at > now() FROM taskflow.dispatch_intent WHERE request_key='rk3-{ws[:8]}'") == "t", "pg_temp.now() must not shadow"
    # The temp 'issue' would have made a bogus claim succeed if it were used.
    refuses(RT, shadow.replace("CREATE TEMP TABLE issue (id uuid, workspace_id uuid);", f"CREATE TEMP TABLE issue (id uuid, workspace_id uuid); INSERT INTO pg_temp.issue VALUES ('{uuid.uuid4()}','{ws}');") +
            f"SELECT 1 FROM taskflow.claim_dispatch_intent('rk4','{uuid.uuid4()}','{ws}','CO-01','codex','cto-1',60);", "issue and workspace mismatch")
    ok("pg_temp shadow (ledger, issue, now()) cannot redirect definer functions")
    # Postflight and ordering safety.
    post = (ROOT / "sql/taskflow_native_dispatch_caller_acl_postflight.sql").read_text()
    psql(MG, post)
    ok("B postflight passes on the installed end state")
    # Re-running the BASE candidate dismantles B; the B postflight must catch it, B re-run must restore.
    psql(MG, BASE_SQL)
    assert val(MG, "SELECT count(*) FROM pg_proc WHERE pronamespace='taskflow'::regnamespace AND proname IN ('lock_dispatch_for_report','mark_dispatch_report_committed')") == "2", "half-state: gates linger"
    refuses(MG, post, "POSTFLIGHT FAIL")
    denied(RT, f"SELECT 1 FROM taskflow.claim_dispatch_intent('after-base-rerun','{issue}','{ws}','CO-01','codex','cto-1',60)", "permission denied for function")
    psql(MG, sqltext); psql(MG, post)
    ok("base re-run is detected by the B postflight (runtime loses EXECUTE); B re-run restores and passes")
    # Drift: a changed base body is refused by install and by rollback (no silent overwrite).
    tampered = base_bodies()["renew_dispatch_lease"].replace("p_lease_seconds > 3600", "p_lease_seconds > 99999")
    assert tampered != base_bodies()["renew_dispatch_lease"]
    psql(MG, "CREATE OR REPLACE FUNCTION taskflow.renew_dispatch_lease(p_dispatch_id UUID, p_lease_id UUID, p_fencing_epoch BIGINT, p_lease_seconds INTEGER DEFAULT 300) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = taskflow, pg_catalog AS $$" + tampered + "$$;")
    refuses(MG, sqltext, "does not match the reviewed base body")
    refuses(MG, (ROOT / "sql/taskflow_native_dispatch_caller_acl_rollback.sql").read_text(), "rollback refused")
    refuses(MG, post, "POSTFLIGHT FAIL")
    psql(MG, BASE_SQL); psql(MG, sqltext); psql(MG, post)
    ok("tampered base body: install and rollback refuse; recovery via base then B passes postflight")
    # Wrong order: B before base on a database without the 8 functions is refused by the owner guard.
    # (Covered by the guard text; exercised here by the missing-function refusal in a scratch schema is not
    # possible without dropping the ledger, so the guard is asserted by source.)
    assert "requires the 8 migrator-owned dispatch functions" in B_SQL
    print(f"CALLER_ACL: {n} scenario groups, failures=0; overall NOT_PRODUCTION_VERIFIED (source assumptions: roles/owner)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
