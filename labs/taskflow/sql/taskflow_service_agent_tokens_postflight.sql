-- REVIEW CANDIDATE ONLY. No production apply is authorized by this file.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
SET LOCAL idle_in_transaction_session_timeout='5s';
-- STEP1 migration connection role guard. Runs before EVERY privileged or
-- read-only migration-path action (backup, apply, postflight, rollback).
-- Fails closed at the database layer: any violation raises an exception and
-- aborts the session statement, so psql exits non-zero under ON_ERROR_STOP.
DO $taskflow_migration_role_guard$
BEGIN
    IF current_user <> 'taskflow_migrator' THEN
        RAISE EXCEPTION 'migration path requires taskflow_migrator, got %', current_user;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user
          AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
        RAISE EXCEPTION 'taskflow_migrator holds elevated attributes';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace
        WHERE nspname = 'taskflow' AND nspowner = current_user::regrole
    ) THEN
        RAISE EXCEPTION 'taskflow schema owner is not taskflow_migrator';
    END IF;
END
$taskflow_migration_role_guard$;

SET LOCAL search_path=taskflow,extensions;

DO $sat_postflight$
BEGIN
 IF (SELECT relowner<>current_user::regrole OR relkind<>'r' OR relrowsecurity OR relforcerowsecurity
 FROM pg_class WHERE oid='taskflow.service_agent_tokens'::regclass) THEN
 RAISE EXCEPTION 'SAT table owner/kind/rls mismatch'; END IF;
 IF (SELECT array_agg(attname::text||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text ORDER BY attnum)
 FROM pg_attribute WHERE attrelid='taskflow.service_agent_tokens'::regclass AND attnum>0 AND NOT attisdropped)
 IS DISTINCT FROM ARRAY['id:uuid:true','agent_id:uuid:true','workspace_id:uuid:true','name:text:true','token_hash:text:true','created_by:uuid:true','created_at:timestamp with time zone:true','last_used_at:timestamp with time zone:false','expires_at:timestamp with time zone:true','revoked_at:timestamp with time zone:false'] THEN
 RAISE EXCEPTION 'SAT column shape mismatch'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass)<>8
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='p' AND conkey=ARRAY[1]::smallint[])
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='u' AND conkey=ARRAY[5]::smallint[])
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='f' AND conkey=ARRAY[2]::smallint[] AND confrelid='taskflow.agent'::regclass AND confdeltype='c')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='f' AND conkey=ARRAY[3]::smallint[] AND confrelid='taskflow.workspace'::regclass AND confdeltype='c')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='f' AND conkey=ARRAY[3,6]::smallint[] AND confrelid='taskflow.member'::regclass AND confdeltype='c')
 THEN RAISE EXCEPTION 'SAT constraint shape mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND NOT convalidated)
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='c')<>3
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='c' AND pg_get_constraintdef(oid)='CHECK ((expires_at > created_at))')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='c' AND pg_get_constraintdef(oid)='CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200)))')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.service_agent_tokens'::regclass AND contype='c' AND pg_get_constraintdef(oid)='CHECK ((token_hash ~ ''^[0-9a-f]{64}$''::text))') THEN
 RAISE EXCEPTION 'SAT check constraint mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 WHERE i.indrelid='taskflow.service_agent_tokens'::regclass AND c.relname='service_agent_tokens_agent_workspace_idx'
 AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indexprs IS NULL
 AND i.indkey::text='2 3') THEN RAISE EXCEPTION 'SAT agent/workspace index mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='taskflow.service_agent_tokens'::regclass AND a.attname='expires_at'
 AND pg_get_expr(d.adbin,d.adrelid)='(now() + ''90 days''::interval)') THEN
 RAISE EXCEPTION 'SAT expiry default mismatch'; END IF;
 IF NOT has_table_privilege('taskflow_runtime','taskflow.service_agent_tokens','SELECT')
 OR NOT has_table_privilege('taskflow_runtime','taskflow.service_agent_tokens','INSERT')
 OR NOT has_table_privilege('taskflow_runtime','taskflow.service_agent_tokens','UPDATE')
 OR has_table_privilege('taskflow_runtime','taskflow.service_agent_tokens','DELETE')
 OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
 WHERE c.oid='taskflow.service_agent_tokens'::regclass AND x.grantee<>c.relowner
 AND (x.grantee<>'taskflow_runtime'::regrole OR x.privilege_type NOT IN('SELECT','INSERT','UPDATE') OR x.is_grantable))
 OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
 WHERE a.attrelid='taskflow.service_agent_tokens'::regclass AND x.grantee<>current_user::regrole)
 THEN RAISE EXCEPTION 'SAT ACL mismatch'; END IF;
END $sat_postflight$;
COMMIT;
