#!/usr/bin/env python3
"""G1 workflow adapter. No standalone authorization. Never retries unknown COMMIT."""
import argparse, base64, gzip, hashlib, os, subprocess, sys
from pathlib import Path
import psycopg2

ROOT=Path(__file__).resolve().parents[3]
SQL=ROOT/'labs/taskflow/sql'
WS='01a1247f-520e-78eb-aa58-0a0e458185f6'
OWNER='ac5afcc7-f045-41a9-8827-eaf085a04c0d'
KEYS=['CO-01','CO-02','CO-03','GEM-01','GH-HELPER']


def connect(readonly=True):
    c=psycopg2.connect(service=os.environ['PGSERVICE'],connect_timeout=5)
    c.set_session(readonly=readonly)
    q=c.cursor();q.execute("SET LOCAL search_path=taskflow,extensions;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='5s'")
    q.execute((SQL/'taskflow_migration_role_guard.sql').read_text())
    q.execute("SELECT current_user=session_user,current_setting('session_replication_role')='origin',coalesce(current_setting('multica.workspace_teardown',true),'')<>'on',current_setting('default_transaction_read_only')='off',EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)")
    if q.fetchone()!=(True,True,True,True,True):c.close();raise ValueError('effective session mismatch')
    return c,q


def owner_only(q,name,columns):
    q.execute("SELECT c.oid,c.relowner=current_user::regrole,c.relkind,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='taskflow' AND c.relname=%s",(name,))
    row=q.fetchone()
    if not row or row[1:]!=(True,'r',False,False):raise ValueError('backup object mismatch')
    oid=row[0]
    q.execute("SELECT attname,format_type(atttypid,atttypmod),attnotnull FROM pg_attribute WHERE attrelid=%s AND attnum>0 AND NOT attisdropped ORDER BY attnum",(oid,))
    if q.fetchall()!=columns:raise ValueError('backup shape mismatch')
    q.execute("SELECT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid=%s AND x.grantee<>c.relowner) OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=%s AND x.grantee<>current_user::regrole)",(oid,oid))
    if q.fetchone()[0]:raise ValueError('backup ACL mismatch')


def preflight():
    c,q=connect()
    try:
        q.execute((SQL/'taskflow_migration_role_guard.sql').read_text())
        q.execute("SELECT session_user=current_user,current_setting('session_replication_role')='origin',coalesce(current_setting('multica.workspace_teardown',true),'')<>'on',EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl),current_setting('server_version_num')::int/10000")
        if q.fetchone()!=(True,True,True,True,17):raise ValueError('session mismatch')
        q.execute("SELECT count(*) FROM pg_auth_members WHERE member=current_user::regrole")
        if q.fetchone()[0]:raise ValueError('unexpected role membership')
        q.execute("SELECT count(*) FROM taskflow.member WHERE workspace_id=%s",(WS,))
        if q.fetchone()[0]!=1:raise ValueError('audience drift')
        q.execute("SELECT count(*) FROM taskflow.member m JOIN taskflow.workspace w ON w.id=m.workspace_id WHERE w.id=%s AND w.slug='zhuge-lab-ac5afcc7' AND m.user_id=%s AND m.role='owner'",(WS,OWNER))
        if q.fetchone()[0]!=1:raise ValueError('owner/workspace mismatch')
        # Execute the unchanged reviewed trigger guard, with the same default
        # pg_get_triggerdef and search_path, but no candidate writes or locks.
        candidate=(SQL/'taskflow_executor_mapping_candidate.sql').read_text()
        guard=candidate[candidate.index('DO $native_trigger_guard$'):candidate.index('DO $install$')]
        q.execute(guard)
        for name in ('agent','project','member','workspace','search_index_change'):
            q.execute("SELECT c.relowner=current_user::regrole,c.relkind,c.relrowsecurity,c.relforcerowsecurity,EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee NOT IN(current_user::regrole,'taskflow_runtime'::regrole)),EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL) FROM pg_class c WHERE c.oid=to_regclass(%s)",('taskflow.'+name,))
            if q.fetchone()!=(True,'r',False,False,False,False):raise ValueError('native catalog/ACL drift')
            q.execute("SELECT array_agg(x.privilege_type ORDER BY x.privilege_type),bool_or(x.is_grantable) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x WHERE c.oid=to_regclass(%s) AND x.grantee='taskflow_runtime'::regrole",('taskflow.'+name,))
            if q.fetchone()!=(['DELETE','INSERT','SELECT','UPDATE'],False):raise ValueError('runtime ACL drift')
        # Existing same-domain backup objects only. No DDL or ACL repair.
        owner_only(q,'step1_schema_backup',[('dump_id','bigint',True),('line_no','integer',True),('line','text',True)])
        owner_only(q,'step1_schema_backup_meta',[('dump_id','bigint',True),('taken_at','timestamp with time zone',True),('sha256','text',True),('gz_bytes','bigint',True),('note','text',True)])
        q.execute("SELECT to_regclass('taskflow.g1_executor_mapping_provenance') IS NOT NULL")
        exists=q.fetchone()[0]
        if not exists:
            q.execute("SELECT count(*) FROM taskflow.agent WHERE workspace_id=%s AND (system_key=ANY(%s) OR name=ANY(%s))",(WS,KEYS,KEYS))
            if q.fetchone()[0]:raise ValueError('identity collision')
            q.execute("SELECT count(*) FROM taskflow.project WHERE workspace_id=%s AND title=ANY(%s)",(WS,[k+' 原生專案' for k in KEYS]))
            if q.fetchone()[0]:raise ValueError('project collision')
        c.rollback();return exists
    finally:c.close()


def sql_runner(name,pin):
    return subprocess.run([sys.executable,str(ROOT/'labs/taskflow/scripts/run-g1-reviewed-sql.py'),'--sql',str(SQL/name),'--sha256',pin],check=False).returncode


def backup():
    # Server17, toolchain17 checked before this. Full schema, backup tables
    # excluded. Dump never printed/uploaded, and is removed by workflow trap.
    path=Path(os.environ['RUNNER_TEMP'])/'g1-backup.sql'
    with open(os.devnull,'wb') as err:
        subprocess.run(['pg_dump','--schema=taskflow','--exclude-table=taskflow.step1_schema_backup','--exclude-table=taskflow.step1_schema_backup_meta','--file',str(path)],stderr=err,check=True,timeout=120)
    body=path.read_bytes();digest=hashlib.sha256(body).hexdigest();packed=gzip.compress(body);encoded=base64.b64encode(packed).decode()
    c,q=connect(False)
    try:
        q.execute("LOCK TABLE taskflow.step1_schema_backup,taskflow.step1_schema_backup_meta IN SHARE ROW EXCLUSIVE MODE")
        # Recheck under native locks before persisting any private content.
        owner_only(q,'step1_schema_backup',[('dump_id','bigint',True),('line_no','integer',True),('line','text',True)])
        owner_only(q,'step1_schema_backup_meta',[('dump_id','bigint',True),('taken_at','timestamp with time zone',True),('sha256','text',True),('gz_bytes','bigint',True),('note','text',True)])
        q.execute('SELECT coalesce(max(dump_id),0)+1 FROM taskflow.step1_schema_backup_meta');ident=q.fetchone()[0]
        q.execute('INSERT INTO taskflow.step1_schema_backup VALUES(%s,0,%s)',(ident,encoded))
        q.execute("INSERT INTO taskflow.step1_schema_backup_meta(dump_id,sha256,gz_bytes,note) VALUES(%s,%s,%s,'G1 pre-mapping full taskflow schema; same-DB backup, not disaster recovery')",(ident,digest,len(packed)))
        q.execute('SELECT line FROM taskflow.step1_schema_backup WHERE dump_id=%s ORDER BY line_no',(ident,));read=''.join(row[0] for row in q)
        if hashlib.sha256(gzip.decompress(base64.b64decode(read))).hexdigest()!=digest:raise ValueError('backup readback mismatch')
        c.commit()
        # Reconnect read-only after ACK to verify durable stored metadata+bytes.
        d,r=connect()
        try:
            r.execute('SELECT m.sha256,m.gz_bytes,b.line FROM taskflow.step1_schema_backup_meta m JOIN taskflow.step1_schema_backup b USING(dump_id) WHERE m.dump_id=%s AND b.line_no=0',(ident,));v=r.fetchone()
            if not v or v[0]!=digest or v[1]!=len(packed) or hashlib.sha256(gzip.decompress(base64.b64decode(v[2]))).hexdigest()!=digest:raise ValueError('durable backup mismatch')
            d.rollback()
        finally:d.close()
        print('G1_BACKUP_STORED_AND_READBACK_VERIFIED')
    finally:
        c.close();path.unlink(missing_ok=True)


def main():
    a=argparse.ArgumentParser();a.add_argument('--action',choices=['apply+postflight','readonly-reconcile'],required=True);args=a.parse_args()
    if args.action=='readonly-reconcile':
        # Ledger absence cannot prove absence of randomly identified native rows.
        # Do not use key/name/title conflict checks to make a rollback claim.
        c,q=connect()
        try:
            q.execute("SELECT to_regclass('taskflow.g1_executor_mapping_provenance') IS NOT NULL")
            if not q.fetchone()[0]:
                print('G1_LEDGER_ABSENT_UNRESOLVED_NATIVE_IDS_NOT_PROVEN');return 3
            c.rollback()
        finally:c.close()
    exists=preflight()
    if args.action=='readonly-reconcile':
        if not exists:print('G1_LEDGER_ABSENT_UNRESOLVED_NATIVE_IDS_NOT_PROVEN');return 3
        rc=sql_runner('taskflow_executor_mapping_postflight.sql',os.environ['PIN_POSTFLIGHT_SHA256'])
        print('G1_READONLY_COMMITTED_EXACT' if rc==0 else 'G1_STOPPED_RECONCILE_MISMATCH');return rc
    # Never use reconciliation as implicit permission to retry an earlier run.
    if exists:raise ValueError('already installed; readonly-reconcile required')
    print('G1_BACKUP_APPEND_ATTEMPT_START_SEPARATE_COMMIT')
    try:backup()
    except Exception:
        print('G1_BACKUP_COMMIT_STATE_UNRESOLVED_READONLY_BACKUP_RECONCILE_REQUIRED_NO_MAPPING_ATTEMPT');return 4
    print('G1_BACKUP_APPEND_CONFIRMED_MAPPING_NOT_YET_ATTEMPTED')
    preflight()
    rc=sql_runner('taskflow_executor_mapping_candidate.sql',os.environ['PIN_CANDIDATE_SHA256'])
    if rc:print('G1_STOPPED_COMMIT_UNKNOWN_READONLY_RECONCILE_REQUIRED');return rc
    rc=sql_runner('taskflow_executor_mapping_postflight.sql',os.environ['PIN_POSTFLIGHT_SHA256'])
    print('G1_COMMITTED_POSTFLIGHT_PASS_RETAIN' if rc==0 else 'G1_STOPPED_POSTFLIGHT_FAILED_RETAIN');return rc

if __name__=='__main__':
    try:sys.exit(main())
    except Exception:
        # Exceptions may contain coordinates/query values. Do not expose them.
        print('G1_STOPPED_OPERATION_ERROR_NO_RETRY_RETAIN_OR_READONLY_RECONCILE');sys.exit(1)
