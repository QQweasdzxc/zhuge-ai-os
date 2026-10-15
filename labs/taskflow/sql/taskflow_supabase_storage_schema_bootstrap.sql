-- One-time TaskFlow-owned helper schema bootstrap.
-- In Production, execute using the existing Supabase `postgres` login after a
-- read-only preflight. The isolated CI fixture uses a restricted bootstrap
-- login with the same database CREATE privilege and no managed-schema access.
-- This grants narrowly scoped privileges on a NEW Zhuge-owned schema; it never
-- changes storage/auth owners or ACLs.

BEGIN;

DO $$
DECLARE
    role_row record;
    managed_owner text;
    member_rel oid;
    objects_rel oid;
    buckets_rel oid;
    auth_uid_proc oid;
BEGIN
    IF session_user <> current_user THEN
        RAISE EXCEPTION 'connect directly as the authorized bootstrap login; SET ROLE is not accepted';
    END IF;
    SELECT rolsuper INTO role_row
      FROM pg_catalog.pg_roles WHERE rolname = current_user;
    IF role_row.rolsuper THEN
        RAISE EXCEPTION 'bootstrap requires a non-superuser login';
    END IF;
    IF current_user IN ('taskflow_migrator', 'taskflow_runtime', 'anon', 'authenticated', 'service_role', 'multica_lab_runtime') THEN
        RAISE EXCEPTION 'application runtime roles cannot bootstrap the TaskFlow helper schema';
    END IF;
    IF NOT pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'postgres lacks database CREATE needed for a Zhuge-owned helper schema';
    END IF;
    IF pg_catalog.has_schema_privilege(current_user, 'storage', 'CREATE') THEN
        RAISE EXCEPTION 'postgres unexpectedly has managed Storage schema CREATE; stop for review';
    END IF;
    IF pg_catalog.to_regnamespace('taskflow_storage') IS NOT NULL THEN
        RAISE EXCEPTION 'taskflow_storage already exists; inspect its owner and ACL before continuing';
    END IF;
    SELECT c.oid INTO member_rel
      FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'taskflow' AND c.relname = 'member';
    SELECT c.oid INTO objects_rel
      FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'objects';
    SELECT c.oid INTO buckets_rel
      FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'buckets';
    SELECT p.oid INTO auth_uid_proc
      FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'auth' AND p.proname = 'uid' AND p.pronargs = 0;
    IF member_rel IS NULL OR objects_rel IS NULL OR buckets_rel IS NULL OR auth_uid_proc IS NULL THEN
        RAISE EXCEPTION 'required TaskFlow or Supabase Storage relation is missing';
    END IF;
    IF NOT pg_catalog.has_table_privilege('taskflow_migrator', member_rel, 'SELECT') THEN
        RAISE EXCEPTION 'taskflow_migrator must retain its existing TaskFlow membership read privilege';
    END IF;
    IF pg_catalog.has_schema_privilege('taskflow_migrator', 'storage', 'USAGE')
       OR pg_catalog.has_schema_privilege('taskflow_migrator', 'storage', 'CREATE')
       OR pg_catalog.has_schema_privilege('taskflow_migrator', 'auth', 'USAGE') THEN
        RAISE EXCEPTION 'taskflow_migrator managed-schema access differs from the reviewed baseline';
    END IF;
    IF NOT pg_catalog.has_schema_privilege('authenticated', 'storage', 'USAGE')
       OR NOT pg_catalog.has_schema_privilege('authenticated', 'auth', 'USAGE')
       OR NOT pg_catalog.has_function_privilege('authenticated', auth_uid_proc, 'EXECUTE')
       OR NOT pg_catalog.has_table_privilege('authenticated', objects_rel, 'SELECT')
       OR NOT pg_catalog.has_table_privilege('authenticated', objects_rel, 'INSERT')
       OR NOT pg_catalog.has_table_privilege('authenticated', objects_rel, 'DELETE') THEN
        RAISE EXCEPTION 'existing authenticated Storage access differs from the reviewed baseline';
    END IF;
    SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO managed_owner
      FROM pg_catalog.pg_class AS c WHERE c.oid = objects_rel;
    IF managed_owner = current_user OR managed_owner = 'taskflow_migrator' THEN
        RAISE EXCEPTION 'Storage object owner is unexpected; do not alter managed object ownership';
    END IF;
    SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO managed_owner
      FROM pg_catalog.pg_class AS c WHERE c.oid = buckets_rel;
    IF managed_owner = current_user OR managed_owner = 'taskflow_migrator' THEN
        RAISE EXCEPTION 'Storage bucket owner is unexpected; do not alter managed object ownership';
    END IF;
END
$$;

CREATE SCHEMA taskflow_storage;
REVOKE ALL ON SCHEMA taskflow_storage FROM PUBLIC;
REVOKE ALL ON SCHEMA taskflow_storage FROM anon, taskflow_runtime;
GRANT USAGE, CREATE ON SCHEMA taskflow_storage TO taskflow_migrator;
GRANT USAGE ON SCHEMA taskflow_storage TO authenticated;

COMMIT;
