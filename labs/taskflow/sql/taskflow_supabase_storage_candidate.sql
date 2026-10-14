-- Candidate only. Do NOT run against Production before separate PM approval.
-- Adds one private bucket dedicated to TaskFlow attachments and policies that
-- derive the user UUID from the validated Supabase JWT (auth.uid()). The
-- TaskFlow API separately validates that JWT and matches it to X-User-ID.
-- No existing Storage bucket, attachment row, or object is updated or deleted.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'taskflow_migrator') THEN
        RAISE EXCEPTION 'required TaskFlow migration role is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION 'required Supabase authenticated role is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        RAISE EXCEPTION 'required Supabase anon role is missing';
    END IF;
    IF NOT has_schema_privilege('authenticated', 'storage', 'USAGE') THEN
        RAISE EXCEPTION 'authenticated role must already have Storage schema USAGE';
    END IF;
    IF NOT has_schema_privilege('authenticated', 'auth', 'USAGE')
       OR NOT has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated role must already be able to resolve auth.uid()';
    END IF;
    IF NOT has_schema_privilege('taskflow_migrator', 'storage', 'USAGE') THEN
        RAISE EXCEPTION 'taskflow_migrator must already have Storage schema USAGE';
    END IF;
    IF has_schema_privilege('taskflow_migrator', 'storage', 'CREATE') THEN
        RAISE EXCEPTION 'taskflow_migrator already has Storage CREATE; review before installation';
    END IF;
    IF NOT has_table_privilege('taskflow_migrator', 'taskflow.member', 'SELECT') THEN
        RAISE EXCEPTION 'taskflow_migrator must be able to read TaskFlow membership';
    END IF;
    IF to_regclass('taskflow.member') IS NULL THEN
        RAISE EXCEPTION 'TaskFlow member relation is missing';
    END IF;
    IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
        RAISE EXCEPTION 'Supabase Storage schema is unavailable';
    END IF;
END
$$;

-- auth.uid() is the only cross-schema identity function used. This narrow
-- schema USAGE grant is for the non-runtime migration/function-owner role;
-- it does not grant access to Auth tables or credentials.
GRANT USAGE ON SCHEMA auth TO taskflow_migrator;
GRANT EXECUTE ON FUNCTION auth.uid() TO taskflow_migrator;
-- Avoid granting authenticated USAGE on TaskFlow's whole schema: that schema
-- contains unrelated native functions. Only this two-function Storage boundary
-- is exposed to the authenticated role.
GRANT CREATE ON SCHEMA storage TO taskflow_migrator;

CREATE FUNCTION storage.taskflow_storage_can_access_object(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, taskflow, pg_temp
AS $$
DECLARE
    parts text[];
    v_scope_id uuid;
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL OR object_name IS NULL OR length(object_name) > 1024 THEN
        RETURN false;
    END IF;
    parts := string_to_array(object_name, '/');
    IF cardinality(parts) <> 3 OR parts[3] = '' OR parts[3] IN ('.', '..') THEN
        RETURN false;
    END IF;
    IF parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;
    v_scope_id := parts[2]::uuid;

    IF length(parts[3]) < 38
       OR substring(parts[3] FROM 1 FOR 36) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR substring(parts[3] FROM 37 FOR 1) <> '.' THEN
        RETURN false;
    END IF;

    IF parts[1] = 'users' THEN
        RETURN v_scope_id = v_user_id;
    ELSIF parts[1] = 'workspaces' THEN
        RETURN EXISTS (
            SELECT 1
              FROM taskflow.member m
             WHERE m.workspace_id = v_scope_id
               AND m.user_id = v_user_id
        );
    END IF;
    RETURN false;
END
$$;

CREATE FUNCTION storage.taskflow_storage_can_delete_object(object_name text, object_owner_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, taskflow, pg_temp
AS $$
DECLARE
    parts text[];
    v_scope_id uuid;
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL OR NOT storage.taskflow_storage_can_access_object(object_name) THEN
        RETURN false;
    END IF;
    parts := string_to_array(object_name, '/');
    v_scope_id := parts[2]::uuid;
    IF parts[1] = 'users' THEN
        RETURN v_scope_id = v_user_id AND object_owner_id = v_user_id::text;
    END IF;
    RETURN object_owner_id = v_user_id::text OR EXISTS (
        SELECT 1
          FROM taskflow.member m
         WHERE m.workspace_id = v_scope_id
           AND m.user_id = v_user_id
           AND m.role IN ('owner', 'admin')
    );
END
$$;

ALTER FUNCTION storage.taskflow_storage_can_access_object(text) OWNER TO taskflow_migrator;
ALTER FUNCTION storage.taskflow_storage_can_delete_object(text, text) OWNER TO taskflow_migrator;
REVOKE ALL ON FUNCTION storage.taskflow_storage_can_access_object(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION storage.taskflow_storage_can_delete_object(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION storage.taskflow_storage_can_access_object(text) TO authenticated;
GRANT EXECUTE ON FUNCTION storage.taskflow_storage_can_access_object(text) TO taskflow_migrator;
GRANT EXECUTE ON FUNCTION storage.taskflow_storage_can_delete_object(text, text) TO authenticated;
REVOKE CREATE ON SCHEMA storage FROM taskflow_migrator;

DO $$
DECLARE
    existing storage.buckets%ROWTYPE;
BEGIN
    SELECT * INTO existing
      FROM storage.buckets
     WHERE id = 'taskflow-attachments';
    IF FOUND THEN
        IF existing.name <> 'taskflow-attachments'
           OR existing.public IS DISTINCT FROM false
           OR existing.file_size_limit IS DISTINCT FROM 104857600
           OR existing.allowed_mime_types IS NOT NULL THEN
            RAISE EXCEPTION 'existing taskflow-attachments bucket has unexpected settings; manual review required';
        END IF;
    ELSE
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('taskflow-attachments', 'taskflow-attachments', false, 104857600, NULL);
    END IF;
END
$$;

CREATE POLICY taskflow_attachments_select
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'taskflow-attachments'
        AND storage.taskflow_storage_can_access_object(name)
    );

CREATE POLICY taskflow_attachments_insert
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'taskflow-attachments'
        AND owner_id = auth.uid()::text
        AND storage.taskflow_storage_can_access_object(name)
    );

CREATE POLICY taskflow_attachments_delete
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'taskflow-attachments'
        AND storage.taskflow_storage_can_delete_object(name, owner_id)
    );

COMMIT;
