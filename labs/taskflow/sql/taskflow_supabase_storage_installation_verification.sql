-- READ ONLY. Run after the app-owned helpers, private bucket, and Dashboard
-- policies are installed. It verifies privileges without changing any object.

DO $$
DECLARE
    access_oid oid;
    delete_oid oid;
    storage_owner text;
    bucket_row record;
    policy_count integer;
BEGIN
    IF pg_catalog.has_schema_privilege(current_user, 'storage', 'CREATE') THEN
        RAISE EXCEPTION 'unexpected CREATE on managed Storage schema';
    END IF;
    IF pg_catalog.has_schema_privilege('taskflow_migrator', 'storage', 'USAGE')
       OR pg_catalog.has_schema_privilege('taskflow_migrator', 'storage', 'CREATE')
       OR pg_catalog.has_schema_privilege('taskflow_migrator', 'auth', 'USAGE') THEN
        RAISE EXCEPTION 'taskflow_migrator acquired managed-schema access';
    END IF;
    IF pg_catalog.has_table_privilege('taskflow_migrator', 'storage.objects', 'SELECT')
       OR pg_catalog.has_table_privilege('taskflow_migrator', 'storage.objects', 'INSERT')
       OR pg_catalog.has_table_privilege('taskflow_migrator', 'storage.objects', 'UPDATE')
       OR pg_catalog.has_table_privilege('taskflow_migrator', 'storage.objects', 'DELETE') THEN
        RAISE EXCEPTION 'taskflow_migrator acquired Storage table DML';
    END IF;
    IF pg_catalog.has_table_privilege('taskflow_runtime', 'storage.objects', 'SELECT')
       OR pg_catalog.has_table_privilege('taskflow_runtime', 'storage.objects', 'INSERT')
       OR pg_catalog.has_table_privilege('taskflow_runtime', 'storage.objects', 'UPDATE')
       OR pg_catalog.has_table_privilege('taskflow_runtime', 'storage.objects', 'DELETE') THEN
        RAISE EXCEPTION 'taskflow_runtime acquired Storage table DML';
    END IF;

    SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO storage_owner
      FROM pg_catalog.pg_class AS c WHERE c.oid = 'storage.objects'::regclass;
    IF storage_owner <> 'supabase_storage_admin' THEN
        RAISE EXCEPTION 'storage.objects owner changed: %', storage_owner;
    END IF;
    SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO storage_owner
      FROM pg_catalog.pg_class AS c WHERE c.oid = 'storage.buckets'::regclass;
    IF storage_owner <> 'supabase_storage_admin' THEN
        RAISE EXCEPTION 'storage.buckets owner changed: %', storage_owner;
    END IF;

    SELECT * INTO bucket_row FROM storage.buckets WHERE id = 'taskflow-attachments';
    IF NOT FOUND OR bucket_row.public IS DISTINCT FROM false
       OR (bucket_row.file_size_limit IS NULL OR bucket_row.file_size_limit <= 0 OR bucket_row.file_size_limit > 50000000)
       OR bucket_row.allowed_mime_types IS NOT NULL THEN
        RAISE EXCEPTION 'TaskFlow bucket settings do not match the reviewed private Supabase Free <=50 MB configuration';
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = 'storage.objects'::regclass) THEN
        RAISE EXCEPTION 'Storage object RLS is disabled';
    END IF;

    access_oid := pg_catalog.to_regprocedure('taskflow_storage.taskflow_storage_can_access_object(text)');
    delete_oid := pg_catalog.to_regprocedure('taskflow_storage.taskflow_storage_can_delete_object(text,text)');
    IF access_oid IS NULL OR delete_oid IS NULL THEN
        RAISE EXCEPTION 'TaskFlow helper functions are missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS p
         WHERE p.oid = access_oid AND p.prosecdef
           AND p.proowner = 'taskflow_migrator'::regrole
           AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS p
         WHERE p.oid = delete_oid AND p.prosecdef
           AND p.proowner = 'taskflow_migrator'::regrole
           AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
    ) THEN
        RAISE EXCEPTION 'helper owner, SECURITY DEFINER, or fixed search_path differs from the reviewed contract';
    END IF;
    IF NOT pg_catalog.has_schema_privilege('authenticated', 'taskflow_storage', 'USAGE')
       OR pg_catalog.has_schema_privilege('anon', 'taskflow_storage', 'USAGE')
       OR pg_catalog.has_schema_privilege('taskflow_runtime', 'taskflow_storage', 'USAGE')
       OR NOT pg_catalog.has_schema_privilege('taskflow_migrator', 'taskflow_storage', 'CREATE') THEN
        RAISE EXCEPTION 'helper schema grants do not match the reviewed contract';
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', access_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', delete_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', access_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', delete_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('taskflow_runtime', access_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('taskflow_runtime', delete_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'function EXECUTE ACL does not match authenticated-only use';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc AS p,
               LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
         WHERE p.oid IN (access_oid, delete_oid)
           AND a.grantee = 0
           AND a.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'PUBLIC can execute a TaskFlow helper function';
    END IF;
    SELECT pg_catalog.count(*) INTO policy_count
      FROM pg_catalog.pg_policies AS p
     WHERE p.schemaname = 'storage'
       AND p.tablename = 'objects'
       AND p.policyname IN ('taskflow_attachments_select', 'taskflow_attachments_insert', 'taskflow_attachments_delete');
    IF policy_count <> 3 THEN
        RAISE EXCEPTION 'expected exactly the three reviewed TaskFlow Storage policies; found %', policy_count;
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_policies AS p
         WHERE p.schemaname = 'storage'
           AND p.tablename = 'objects'
           AND p.policyname IN ('taskflow_attachments_select', 'taskflow_attachments_insert', 'taskflow_attachments_delete')
           AND p.roles <> ARRAY['authenticated']::name[]
    ) THEN
        RAISE EXCEPTION 'TaskFlow Storage policy role target is broader than authenticated';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_policies AS p
         WHERE p.schemaname = 'storage'
           AND p.tablename = 'objects'
           AND p.roles && ARRAY['anon', 'public']::name[]
    ) THEN
        RAISE EXCEPTION 'anonymous/public Storage policy exists; review bucket reachability before release';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_policies AS p
         WHERE p.schemaname = 'storage'
           AND p.tablename = 'objects'
           AND (
               p.roles <> ARRAY['authenticated']::name[]
               OR (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) !~* '\mbucket_id\M'
           )
    ) THEN
        RAISE EXCEPTION 'Storage object policy is not authenticated-only and bucket-scoped; review before release';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies AS p
         WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
           AND p.policyname = 'taskflow_attachments_select' AND p.cmd = 'SELECT'
           AND p.qual ILIKE '%bucket_id%' AND p.qual ILIKE '%taskflow-attachments%'
           AND p.qual ILIKE '%taskflow_storage_can_access_object%'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies AS p
         WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
           AND p.policyname = 'taskflow_attachments_insert' AND p.cmd = 'INSERT'
           AND p.with_check ILIKE '%bucket_id%' AND p.with_check ILIKE '%taskflow-attachments%'
           AND p.with_check ILIKE '%auth.uid%' AND p.with_check ILIKE '%taskflow_storage_can_access_object%'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies AS p
         WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
           AND p.policyname = 'taskflow_attachments_delete' AND p.cmd = 'DELETE'
           AND p.qual ILIKE '%bucket_id%' AND p.qual ILIKE '%taskflow-attachments%'
           AND p.qual ILIKE '%taskflow_storage_can_delete_object%'
    ) THEN
        RAISE EXCEPTION 'TaskFlow Storage policy expressions differ from the reviewed bucket-scoped contract';
    END IF;

    RAISE NOTICE 'TASKFLOW_STORAGE_INSTALLATION_VERIFICATION=PASS';
END
$$;

SELECT policyname, cmd, roles, qual, with_check
  FROM pg_catalog.pg_policies
 WHERE schemaname = 'storage'
   AND tablename = 'objects'
   AND policyname LIKE 'taskflow_attachments_%'
 ORDER BY policyname;

SELECT 'TASKFLOW_STORAGE_INSTALLATION_VERIFICATION=PASS' AS result;
