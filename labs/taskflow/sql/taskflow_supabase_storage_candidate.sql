-- TaskFlow-owned Supabase Storage identity helpers.
--
-- Run only after taskflow_supabase_storage_schema_bootstrap.sql has created
-- the app-owned taskflow_storage schema, and connect as taskflow_migrator.
-- This file does not access or modify the managed storage/auth schemas. Bucket
-- creation and storage.objects RLS policies are managed through the Supabase
-- Dashboard, as documented in labs/taskflow/docs/SUPABASE_STORAGE_CANDIDATE.md.

BEGIN;

DO $$
DECLARE
    migrator_oid oid;
    member_rel oid;
    storage_objects_rel oid;
    storage_buckets_rel oid;
BEGIN
    IF session_user <> 'taskflow_migrator' OR current_user <> 'taskflow_migrator'
       OR session_user <> current_user THEN
        RAISE EXCEPTION 'connect directly as taskflow_migrator; SET ROLE and other identities are not accepted';
    END IF;

    SELECT oid INTO migrator_oid FROM pg_catalog.pg_roles WHERE rolname = 'taskflow_migrator';
    IF migrator_oid IS NULL OR (SELECT rolsuper OR rolcreaterole FROM pg_catalog.pg_roles WHERE oid = migrator_oid) THEN
        RAISE EXCEPTION 'taskflow_migrator must remain a non-superuser without role-management privileges';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_auth_members am
          JOIN pg_catalog.pg_roles r ON r.oid = am.roleid
         WHERE am.member = migrator_oid
           AND r.rolname IN ('anon', 'authenticated', 'service_role', 'taskflow_runtime', 'multica_lab_runtime')
    ) THEN
        RAISE EXCEPTION 'taskflow_migrator has an unexpected role membership';
    END IF;
    IF NOT pg_catalog.has_schema_privilege('taskflow_migrator', 'taskflow_storage', 'USAGE')
       OR NOT pg_catalog.has_schema_privilege('taskflow_migrator', 'taskflow_storage', 'CREATE') THEN
        RAISE EXCEPTION 'the TaskFlow-owned helper schema bootstrap is missing';
    END IF;
    IF NOT pg_catalog.has_schema_privilege('authenticated', 'taskflow_storage', 'USAGE')
       OR pg_catalog.has_schema_privilege('anon', 'taskflow_storage', 'USAGE')
       OR pg_catalog.has_schema_privilege('taskflow_runtime', 'taskflow_storage', 'USAGE') THEN
        RAISE EXCEPTION 'TaskFlow helper schema ACL differs from the reviewed least-privilege setup';
    END IF;
    IF pg_catalog.has_schema_privilege('taskflow_migrator', 'storage', 'USAGE')
       OR pg_catalog.has_schema_privilege('taskflow_migrator', 'storage', 'CREATE')
       OR pg_catalog.has_schema_privilege('taskflow_migrator', 'auth', 'USAGE') THEN
        RAISE EXCEPTION 'taskflow_migrator must not use Supabase managed schemas';
    END IF;
    SELECT c.oid INTO member_rel
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'taskflow' AND c.relname = 'member';
    IF member_rel IS NULL OR NOT pg_catalog.has_table_privilege('taskflow_migrator', member_rel, 'SELECT') THEN
        RAISE EXCEPTION 'TaskFlow membership read access is required for workspace-scoped objects';
    END IF;
    SELECT c.oid INTO storage_objects_rel
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'objects';
    SELECT c.oid INTO storage_buckets_rel
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'buckets';
    IF storage_objects_rel IS NULL OR storage_buckets_rel IS NULL THEN
        RAISE EXCEPTION 'Supabase Storage relations are missing';
    END IF;
    IF pg_catalog.has_table_privilege('taskflow_migrator', storage_objects_rel, 'SELECT')
       OR pg_catalog.has_table_privilege('taskflow_migrator', storage_objects_rel, 'INSERT')
       OR pg_catalog.has_table_privilege('taskflow_migrator', storage_objects_rel, 'UPDATE')
       OR pg_catalog.has_table_privilege('taskflow_migrator', storage_objects_rel, 'DELETE')
       OR pg_catalog.has_table_privilege('taskflow_runtime', storage_objects_rel, 'SELECT')
       OR pg_catalog.has_table_privilege('taskflow_runtime', storage_objects_rel, 'INSERT')
       OR pg_catalog.has_table_privilege('taskflow_runtime', storage_objects_rel, 'UPDATE')
       OR pg_catalog.has_table_privilege('taskflow_runtime', storage_objects_rel, 'DELETE') THEN
        RAISE EXCEPTION 'TaskFlow roles must not have direct Storage table DML';
    END IF;
END
$$;

-- Supabase PostgREST installs JWT claims in request.jwt.claim.sub. Support the
-- JSON claims GUC as a compatibility fallback without calling auth.uid() or
-- requiring taskflow_migrator to use the managed auth schema.
CREATE OR REPLACE FUNCTION taskflow_storage.taskflow_storage_can_access_object(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    parts text[];
    claims_json text;
    subject text;
    v_scope_id uuid;
    v_user_id uuid;
BEGIN
    IF object_name IS NULL OR pg_catalog.length(object_name) > 1024 THEN
        RETURN false;
    END IF;

    subject := NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '');
    IF subject IS NULL THEN
        claims_json := NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '');
        IF claims_json IS NULL THEN
            RETURN false;
        END IF;
        BEGIN
            subject := NULLIF((claims_json::jsonb ->> 'sub'), '');
        EXCEPTION WHEN others THEN
            RETURN false;
        END;
    END IF;
    BEGIN
        v_user_id := subject::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN false;
    END;
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    parts := pg_catalog.string_to_array(object_name, '/');
    IF pg_catalog.cardinality(parts) <> 3 OR parts[3] = '' OR parts[3] IN ('.', '..') THEN
        RETURN false;
    END IF;
    IF parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;
    v_scope_id := parts[2]::uuid;

    IF pg_catalog.length(parts[3]) < 38
       OR pg_catalog.substr(parts[3], 1, 36) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR pg_catalog.substr(parts[3], 37, 1) <> '.' THEN
        RETURN false;
    END IF;

    IF parts[1] = 'users' THEN
        RETURN v_scope_id = v_user_id;
    ELSIF parts[1] = 'workspaces' THEN
        RETURN EXISTS (
            SELECT 1
              FROM taskflow.member AS m
             WHERE m.workspace_id = v_scope_id
               AND m.user_id = v_user_id
        );
    END IF;
    RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION taskflow_storage.taskflow_storage_can_delete_object(object_name text, object_owner_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    claims_json text;
    subject text;
    parts text[];
    v_scope_id uuid;
    v_user_id uuid;
BEGIN
    subject := NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '');
    IF subject IS NULL THEN
        claims_json := NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '');
        IF claims_json IS NULL THEN
            RETURN false;
        END IF;
        BEGIN
            subject := NULLIF((claims_json::jsonb ->> 'sub'), '');
        EXCEPTION WHEN others THEN
            RETURN false;
        END;
    END IF;
    BEGIN
        v_user_id := subject::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN false;
    END;
    IF v_user_id IS NULL
       OR NOT taskflow_storage.taskflow_storage_can_access_object(object_name) THEN
        RETURN false;
    END IF;

    parts := pg_catalog.string_to_array(object_name, '/');
    v_scope_id := parts[2]::uuid;
    IF parts[1] = 'users' THEN
        RETURN v_scope_id = v_user_id AND object_owner_id = v_user_id::text;
    END IF;
    RETURN object_owner_id = v_user_id::text OR EXISTS (
        SELECT 1
          FROM taskflow.member AS m
         WHERE m.workspace_id = v_scope_id
           AND m.user_id = v_user_id
           AND m.role IN ('owner', 'admin')
    );
END
$$;

REVOKE ALL ON FUNCTION taskflow_storage.taskflow_storage_can_access_object(text) FROM PUBLIC, anon, taskflow_runtime;
REVOKE ALL ON FUNCTION taskflow_storage.taskflow_storage_can_delete_object(text, text) FROM PUBLIC, anon, taskflow_runtime;
GRANT EXECUTE ON FUNCTION taskflow_storage.taskflow_storage_can_access_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION taskflow_storage.taskflow_storage_can_delete_object(text, text) TO authenticated;

COMMIT;
