-- Read-only consistent-snapshot assertion. Every safety mismatch RAISEs.
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
DO $native_trigger_guard$
DECLARE t record; f record;
BEGIN
 IF current_setting('multica.workspace_teardown',true)='on' OR current_setting('session_replication_role')<>'origin' THEN RAISE EXCEPTION 'G1 unsafe session trigger state'; END IF;
 SELECT * INTO t FROM pg_trigger WHERE tgrelid='taskflow.project'::regclass AND tgname='trg_project_search_index_change' AND NOT tgisinternal;
 IF NOT FOUND OR t.tgenabled<>'O' OR t.tgtype<>29 OR t.tgnargs<>1 OR encode(t.tgargs,'escape')<>E'project\\000' THEN RAISE EXCEPTION 'G1 native trigger baseline mismatch'; END IF;
 IF pg_get_triggerdef(t.oid) NOT IN(
 'CREATE TRIGGER trg_project_search_index_change AFTER INSERT OR DELETE OR UPDATE ON taskflow.project FOR EACH ROW WHEN ((current_setting(''multica.workspace_teardown''::text, true) IS DISTINCT FROM ''on''::text)) EXECUTE FUNCTION record_search_index_change(''project'')',
 'CREATE TRIGGER trg_project_search_index_change AFTER INSERT OR DELETE OR UPDATE ON taskflow.project FOR EACH ROW WHEN ((current_setting(''multica.workspace_teardown''::text, true) IS DISTINCT FROM ''on''::text)) EXECUTE FUNCTION taskflow.record_search_index_change(''project'')') THEN RAISE EXCEPTION 'G1 native trigger definition mismatch'; END IF;
 SELECT p.*,l.lanname INTO f FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=t.tgfoid;
 IF f.pronamespace<>'taskflow'::regnamespace OR f.proname<>'record_search_index_change' OR f.prosecdef OR f.proconfig IS NOT NULL OR f.lanname<>'plpgsql'
 OR f.prosrc IS DISTINCT FROM $source$
DECLARE
    changed_id UUID;
    changed_workspace_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        changed_id := OLD.id;
        changed_workspace_id := OLD.workspace_id;
    ELSE
        changed_id := NEW.id;
        changed_workspace_id := NEW.workspace_id;
    END IF;

    INSERT INTO search_index_change (entity_type, entity_id, workspace_id, change_xid, changed_at)
    VALUES (TG_ARGV[0], changed_id, changed_workspace_id, pg_current_xact_id(), now())
    ON CONFLICT (entity_type, entity_id) DO UPDATE
        SET workspace_id = EXCLUDED.workspace_id,
            change_xid = EXCLUDED.change_xid,
            changed_at = EXCLUDED.changed_at;
    RETURN NULL;
END
$source$ THEN RAISE EXCEPTION 'G1 native function baseline mismatch'; END IF;
END $native_trigger_guard$;

DO $shape_acl$
BEGIN
 IF (SELECT relowner<>current_user::regrole OR relkind<>'r' OR relrowsecurity OR relforcerowsecurity FROM pg_class WHERE oid='taskflow.g1_executor_mapping_provenance'::regclass) THEN RAISE EXCEPTION 'G1 provenance owner/kind/rls mismatch'; END IF;
 IF (SELECT array_agg(attname::text||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='taskflow.g1_executor_mapping_provenance'::regclass AND attnum>0 AND NOT attisdropped)
 IS DISTINCT FROM ARRAY['executor_key:text:true','agent_id:uuid:true','project_id:uuid:true','agent_snapshot:jsonb:true','project_snapshot:jsonb:true'] THEN RAISE EXCEPTION 'G1 provenance shape mismatch'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE conrelid='taskflow.g1_executor_mapping_provenance'::regclass AND contype IN('p','u'))<>3
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.g1_executor_mapping_provenance'::regclass AND contype='p' AND conkey=ARRAY[1]::smallint[])
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.g1_executor_mapping_provenance'::regclass AND contype='u' AND conkey=ARRAY[2]::smallint[])
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='taskflow.g1_executor_mapping_provenance'::regclass AND contype='u' AND conkey=ARRAY[3]::smallint[])
 THEN RAISE EXCEPTION 'G1 provenance constraint shape mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='taskflow.g1_executor_mapping_provenance'::regclass AND x.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid='taskflow.g1_executor_mapping_provenance'::regclass AND x.grantee<>current_user::regrole)
 THEN RAISE EXCEPTION 'G1 provenance table/column ACL mismatch'; END IF;
END $shape_acl$;
DO $hard_invariants$
DECLARE e record; v record; a jsonb; p jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM taskflow.workspace WHERE id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND slug='zhuge-lab-ac5afcc7')
 OR (SELECT count(*) FROM taskflow.member WHERE workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6')<>1
 OR NOT EXISTS(SELECT 1 FROM taskflow.member WHERE workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND user_id='ac5afcc7-f045-41a9-8827-eaf085a04c0d' AND role='owner')
 THEN RAISE EXCEPTION 'G1 hard audience invariant'; END IF;
 IF (SELECT count(*) FROM taskflow.g1_executor_mapping_provenance)<>5
 OR (SELECT count(DISTINCT executor_key) FROM taskflow.g1_executor_mapping_provenance)<>5
 OR (SELECT count(DISTINCT agent_id) FROM taskflow.g1_executor_mapping_provenance)<>5
 OR (SELECT count(DISTINCT project_id) FROM taskflow.g1_executor_mapping_provenance)<>5
 OR EXISTS(SELECT 1 FROM taskflow.g1_executor_mapping_provenance WHERE executor_key NOT IN('CO-01','CO-02','CO-03','GEM-01','GH-HELPER'))
 THEN RAISE EXCEPTION 'G1 hard exact-five provenance invariant'; END IF;
 FOR e IN SELECT * FROM (VALUES ('CO-01'),('CO-02'),('CO-03'),('GEM-01'),('GH-HELPER')) expected(key) LOOP
  SELECT * INTO STRICT v FROM taskflow.g1_executor_mapping_provenance WHERE executor_key=e.key;
  IF (SELECT count(*) FROM taskflow.agent WHERE id=v.agent_id OR (workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND (system_key=e.key OR name=e.key)))<>1
  OR NOT EXISTS(SELECT 1 FROM taskflow.agent WHERE id=v.agent_id AND workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND owner_id='ac5afcc7-f045-41a9-8827-eaf085a04c0d'
   AND name=e.key AND system_key=e.key AND runtime_id IS NULL AND runtime_mode='cloud' AND visibility='private'
   AND permission_mode='private' AND kind='user' AND status='offline' AND archived_at IS NULL AND archived_by IS NULL
   AND runtime_config='{}'::jsonb AND custom_env='{}'::jsonb AND custom_args='[]'::jsonb AND mcp_config IS NULL)
  OR NOT EXISTS(SELECT 1 FROM taskflow.project WHERE id=v.project_id AND workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND title=e.key||' 原生專案' AND lead_type='agent' AND lead_id=v.agent_id)
  THEN RAISE EXCEPTION 'G1 hard unique/private/unbound/source-pair invariant: %',e.key; END IF;
  SELECT to_jsonb(t) INTO a FROM taskflow.agent t WHERE id=v.agent_id;
  SELECT to_jsonb(t) INTO p FROM taskflow.project t WHERE id=v.project_id;
  IF a IS DISTINCT FROM v.agent_snapshot OR p IS DISTINCT FROM v.project_snapshot THEN RAISE EXCEPTION 'G1 source row snapshot drift'; END IF;
 END LOOP;
END $hard_invariants$;
SELECT executor_key,'MAPPED_UNBOUND_PRIVATE' FROM taskflow.g1_executor_mapping_provenance ORDER BY executor_key;
COMMIT;
