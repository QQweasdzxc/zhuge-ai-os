-- REVIEW CANDIDATE ONLY. No production apply is authorized by this file.
-- ZG-56: user-approved (2026-11-03 Slack DM) identity-only GPT engineer
-- record. No account, spend, permission or execution capability: NULL
-- runtime_id, empty config, offline, private - same shape as CO-01..GH-HELPER.
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
SELECT pg_advisory_xact_lock(179314,503);
-- PENDING REVIEW. Native runtime_mode='cloud' is a storage enum, not a
-- binding or permission to run.
LOCK TABLE taskflow.agent,taskflow.member IN SHARE ROW EXCLUSIVE MODE;
DO $cto01gpt$
DECLARE ws constant uuid := '01a1247f-520e-78eb-aa58-0a0e458185f6';
 human constant uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d';
BEGIN
 IF current_setting('taskflow.review_cto01_gpt',true) IS DISTINCT FROM 'approved' THEN
 RAISE EXCEPTION 'CTO-01/GPT pending review; explicit reviewed session required'; END IF;
 IF current_setting('session_replication_role')<>'origin'
 OR current_setting('multica.workspace_teardown',true)='on' THEN
 RAISE EXCEPTION 'CTO-01/GPT unsafe session state'; END IF;
 IF NOT EXISTS(SELECT 1 FROM taskflow.workspace WHERE id=ws AND slug='zhuge-lab-ac5afcc7')
 OR (SELECT count(*) FROM taskflow.member WHERE workspace_id=ws)<>1
 OR NOT EXISTS(SELECT 1 FROM taskflow.member WHERE workspace_id=ws AND user_id=human AND role='owner') THEN
 RAISE EXCEPTION 'CTO-01/GPT audience invariant'; END IF;
 IF EXISTS(SELECT 1 FROM taskflow.agent WHERE workspace_id=ws AND (system_key='CTO-01' OR name='GPT')) THEN
 RAISE EXCEPTION 'CTO-01/GPT collision; no adoption or overwrite'; END IF;
 INSERT INTO taskflow.agent(id,workspace_id,owner_id,name,description,runtime_id,runtime_mode,runtime_config,visibility,status,kind,system_key,permission_mode)
 VALUES(gen_random_uuid(),ws,human,'GPT','STEP2 native identity mapping only; provider unbound (STEP3).',NULL,'cloud','{}','private','offline','user','CTO-01','private');
END $cto01gpt$;
COMMIT;
