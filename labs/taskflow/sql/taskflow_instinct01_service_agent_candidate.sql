-- REVIEW CANDIDATE ONLY. No production apply is authorized by this file.
BEGIN;
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
SELECT pg_advisory_xact_lock(179314,502);
-- PENDING REVIEW. Deliberately separate from token DDL; never auto-staged.
-- service-only / 無執行時: NULL runtime_id, empty config, offline. Native
-- runtime_mode='cloud' is a storage enum, not a binding or permission to run.
LOCK TABLE taskflow.agent,taskflow.member IN SHARE ROW EXCLUSIVE MODE;
DO $instinct01$
DECLARE ws constant uuid := '01a1247f-520e-78eb-aa58-0a0e458185f6';
 human constant uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d';
BEGIN
 IF current_setting('taskflow.review_instinct01',true) IS DISTINCT FROM 'approved' THEN
 RAISE EXCEPTION 'INSTINCT-01 pending review; explicit reviewed session required'; END IF;
 IF current_setting('session_replication_role')<>'origin'
 OR current_setting('multica.workspace_teardown',true)='on' THEN
 RAISE EXCEPTION 'INSTINCT-01 unsafe session state'; END IF;
 IF NOT EXISTS(SELECT 1 FROM taskflow.workspace WHERE id=ws AND slug='zhuge-lab-ac5afcc7')
 OR (SELECT count(*) FROM taskflow.member WHERE workspace_id=ws)<>1
 OR NOT EXISTS(SELECT 1 FROM taskflow.member WHERE workspace_id=ws AND user_id=human AND role='owner') THEN
 RAISE EXCEPTION 'INSTINCT-01 audience invariant'; END IF;
 IF EXISTS(SELECT 1 FROM taskflow.agent WHERE workspace_id=ws AND (system_key='INSTINCT-01' OR name='INSTINCT-01')) THEN
 RAISE EXCEPTION 'INSTINCT-01 collision; no adoption or overwrite'; END IF;
 INSERT INTO taskflow.agent(id,workspace_id,owner_id,name,description,runtime_id,runtime_mode,runtime_config,visibility,status,kind,system_key,permission_mode)
 VALUES(gen_random_uuid(),ws,human,'INSTINCT-01','Service-only / 無執行時; API identity only, no runtime binding.',NULL,'cloud','{}','private','offline','user','INSTINCT-01','private');
END $instinct01$;
COMMIT;
