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

-- Conservative: any schema table addition or any row edit refuses rollback.
-- Lock ALL TaskFlow base tables before scanning, including CASCADE/SET NULL
-- targets and polymorphic/JSON/array/text references. Never cascade cleanup.
DO $rollback$
DECLARE t record; e record; inventory jsonb; actual jsonb; hits bigint; needle text;
BEGIN
 IF to_regclass('taskflow.g1_executor_mapping_provenance') IS NULL THEN
  RAISE EXCEPTION 'G1 no provenance; refuse name-based deletion';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE k.contype='f' AND k.confrelid IN('taskflow.agent'::regclass,'taskflow.project'::regclass) AND n.nspname<>'taskflow') THEN
  RAISE EXCEPTION 'G1 external-schema FK; refuse rollback';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN('taskflow.agent'::regclass,'taskflow.project'::regclass) AND NOT tgisinternal AND tgenabled<>'D' AND (tgtype::int & 8)>0) THEN
  RAISE EXCEPTION 'G1 delete trigger present; refuse rollback';
 END IF;
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='taskflow' AND c.relkind IN ('r','p') ORDER BY c.relname LOOP
  EXECUTE format('LOCK TABLE taskflow.%I IN SHARE ROW EXCLUSIVE MODE',t.relname);
 END LOOP;
 SELECT jsonb_agg(c.relname ORDER BY c.relname) INTO inventory FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='taskflow' AND c.relkind IN ('r','p');
 FOR e IN SELECT * FROM taskflow.g1_executor_mapping_provenance LOOP
  IF e.table_inventory IS DISTINCT FROM inventory THEN RAISE EXCEPTION 'G1 table inventory drift; refuse rollback'; END IF;
  SELECT to_jsonb(a) INTO actual FROM taskflow.agent a WHERE id=e.agent_id;
  IF actual IS DISTINCT FROM e.agent_snapshot THEN RAISE EXCEPTION 'G1 agent full-row drift; refuse rollback'; END IF;
  SELECT to_jsonb(p) INTO actual FROM taskflow.project p WHERE id=e.project_id;
  IF actual IS DISTINCT FROM e.project_snapshot THEN RAISE EXCEPTION 'G1 project full-row drift; refuse rollback'; END IF;
 END LOOP;
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='taskflow' AND c.relkind IN ('r','p') AND c.relname<>'g1_executor_mapping_provenance' LOOP
  FOR e IN SELECT agent_id,project_id FROM taskflow.g1_executor_mapping_provenance LOOP
   FOREACH needle IN ARRAY ARRAY[e.agent_id::text,e.project_id::text] LOOP
    -- JSON text scan intentionally errs toward refusal: covers ordinary FK,
    -- polymorphic UUID columns, UUID arrays and JSON/text references alike.
    EXECUTE format('SELECT count(*) FROM taskflow.%I x WHERE position($1 in to_jsonb(x)::text)>0 %s',t.relname,
      CASE WHEN t.relname='agent' THEN 'AND x.id NOT IN (SELECT agent_id FROM taskflow.g1_executor_mapping_provenance)'
           WHEN t.relname='project' THEN 'AND x.id NOT IN (SELECT project_id FROM taskflow.g1_executor_mapping_provenance)' ELSE '' END)
      INTO hits USING needle;
    IF hits>0 THEN RAISE EXCEPTION 'G1 adopted/reference data exists; refuse rollback'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 DELETE FROM taskflow.project WHERE id IN(SELECT project_id FROM taskflow.g1_executor_mapping_provenance);
 DELETE FROM taskflow.agent WHERE id IN(SELECT agent_id FROM taskflow.g1_executor_mapping_provenance);
 DELETE FROM taskflow.g1_executor_mapping_provenance;
 -- Empty private provenance table retained, never DROP CASCADE.
END $rollback$;
COMMIT;
