-- G1 native mapping v2. TaskFlow-only. No runtime/provider binding or shared ACL change.
BEGIN;
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

SET LOCAL search_path = taskflow, extensions;

DO $identity$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM taskflow.workspace WHERE id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND slug='zhuge-lab-ac5afcc7')
 OR NOT EXISTS (SELECT 1 FROM taskflow.member WHERE workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND user_id='ac5afcc7-f045-41a9-8827-eaf085a04c0d' AND role='owner')
 OR (SELECT count(*) FROM taskflow.member WHERE workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6') <> 1 THEN
  RAISE EXCEPTION 'G1 workspace/sole-owner audience mismatch';
 END IF;
END $identity$;

-- Exact creation provenance, not a name-based deletion heuristic.
CREATE TABLE IF NOT EXISTS taskflow.g1_executor_mapping_provenance (
 executor_key text PRIMARY KEY,
 agent_id uuid NOT NULL UNIQUE,
 project_id uuid NOT NULL UNIQUE,
 agent_snapshot jsonb NOT NULL,
 project_snapshot jsonb NOT NULL,
 table_inventory jsonb NOT NULL
);
-- Existing per-schema defaults grant runtime table access. Remove grants on
-- THIS NEW TABLE ONLY in the creation transaction, never shared defaults.
DO $acl$
DECLARE g record;
BEGIN
 IF (SELECT relowner FROM pg_class WHERE oid='taskflow.g1_executor_mapping_provenance'::regclass) <> current_user::regrole THEN
  RAISE EXCEPTION 'G1 provenance owner mismatch';
 END IF;
 FOR g IN SELECT DISTINCT x.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
 WHERE c.oid='taskflow.g1_executor_mapping_provenance'::regclass AND x.grantee<>c.relowner LOOP
  IF g.grantee=0 THEN REVOKE ALL ON taskflow.g1_executor_mapping_provenance FROM PUBLIC;
  ELSE EXECUTE format('REVOKE ALL ON taskflow.g1_executor_mapping_provenance FROM %I',pg_get_userbyid(g.grantee)); END IF;
 END LOOP;
END $acl$;
LOCK TABLE taskflow.agent,taskflow.project,taskflow.g1_executor_mapping_provenance IN SHARE ROW EXCLUSIVE MODE;
DO $install$
DECLARE e record; a jsonb; p jsonb; old record; inventory jsonb;
BEGIN
 SELECT jsonb_agg(c.relname ORDER BY c.relname) INTO inventory FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='taskflow' AND c.relkind IN ('r','p');
 FOR e IN SELECT * FROM (VALUES
('CO-01','9a8b5560-909c-5f30-82d7-9e330f5d28fc'::uuid,'343d7763-39f2-5017-9497-4a560cbce86b'::uuid),
('CO-02','13da7c54-a38a-59fd-a5b5-ae2c4cd38c03'::uuid,'b21a79c1-7113-5b01-adc2-9a11021f536f'::uuid),
('CO-03','119020a1-6e15-527e-afea-b26f1c56a1f2'::uuid,'fa3c6847-fca0-5633-81f4-00a3470ce537'::uuid),
('GEM-01','3407ad25-1ef2-5c28-9328-0b443a4b557f'::uuid,'4cb445b1-1a88-51c9-9e2a-1b97e4adbe09'::uuid),
('GH-HELPER','b0f8b919-eeb8-5c5a-a159-d768691b1dc5'::uuid,'cf02ae8d-38a4-5f35-923a-e9cafab87537'::uuid)
 ) AS expected(key,aid,pid) LOOP
  SELECT * INTO old FROM taskflow.g1_executor_mapping_provenance WHERE executor_key=e.key;
  IF FOUND THEN
   SELECT to_jsonb(t) INTO a FROM taskflow.agent t WHERE id=old.agent_id;
   SELECT to_jsonb(t) INTO p FROM taskflow.project t WHERE id=old.project_id;
   IF old.agent_id<>e.aid OR old.project_id<>e.pid OR a IS DISTINCT FROM old.agent_snapshot OR p IS DISTINCT FROM old.project_snapshot THEN
    RAISE EXCEPTION 'G1 prior provenance drift; no overwrite';
   END IF;
   CONTINUE;
  END IF;
  IF EXISTS(SELECT 1 FROM taskflow.agent WHERE id=e.aid OR (workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND (system_key=e.key OR name=e.key)))
  OR EXISTS(SELECT 1 FROM taskflow.project WHERE id=e.pid OR (workspace_id='01a1247f-520e-78eb-aa58-0a0e458185f6' AND title=e.key||' 原生專案')) THEN
   RAISE EXCEPTION 'G1 existing identity collision; no adoption';
  END IF;
  INSERT INTO taskflow.agent(id,workspace_id,owner_id,name,description,runtime_id,runtime_mode,visibility,status,kind,system_key,permission_mode)
  VALUES(e.aid,'01a1247f-520e-78eb-aa58-0a0e458185f6','ac5afcc7-f045-41a9-8827-eaf085a04c0d',e.key,'STEP2 native identity mapping only; provider unbound (STEP3).',NULL,'cloud','private','offline','user',e.key,'private');
  INSERT INTO taskflow.project(id,workspace_id,title,description,lead_type,lead_id)
  VALUES(e.pid,'01a1247f-520e-78eb-aa58-0a0e458185f6',e.key||' 原生專案','STEP2 native executor mapping only.','agent',e.aid);
  SELECT to_jsonb(t) INTO a FROM taskflow.agent t WHERE id=e.aid;
  SELECT to_jsonb(t) INTO p FROM taskflow.project t WHERE id=e.pid;
  INSERT INTO taskflow.g1_executor_mapping_provenance VALUES(e.key,e.aid,e.pid,a,p,inventory);
 END LOOP;
END $install$;
COMMIT;
