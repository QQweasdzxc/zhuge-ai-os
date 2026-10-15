\set ON_ERROR_STOP on

DO $$
DECLARE
  access_proc oid := 'taskflow_storage.taskflow_storage_can_access_object(text)'::regprocedure;
  delete_proc oid := 'taskflow_storage.taskflow_storage_can_delete_object(text,text)'::regprocedure;
  bucket storage.buckets%ROWTYPE;
  proc record;
  policy_total integer;
  owner_name text;
BEGIN
  SELECT * INTO bucket FROM storage.buckets WHERE id = 'taskflow-attachments';
  IF NOT FOUND OR bucket.public IS DISTINCT FROM false
     OR bucket.file_size_limit IS DISTINCT FROM 50000000
     OR bucket.allowed_mime_types IS NOT NULL THEN
    RAISE EXCEPTION 'private TaskFlow bucket settings do not match the reviewed cap';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION 'Storage object RLS is not enabled';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(relowner) INTO owner_name
    FROM pg_catalog.pg_class WHERE oid = 'storage.objects'::regclass;
  IF owner_name <> 'supabase_storage_admin' THEN
    RAISE EXCEPTION 'managed storage.objects owner changed: %', owner_name;
  END IF;
  SELECT pg_catalog.pg_get_userbyid(relowner) INTO owner_name
    FROM pg_catalog.pg_class WHERE oid = 'storage.buckets'::regclass;
  IF owner_name <> 'supabase_storage_admin' THEN
    RAISE EXCEPTION 'managed storage.buckets owner changed: %', owner_name;
  END IF;

  FOR proc IN SELECT unnest(ARRAY[access_proc, delete_proc]) AS oid LOOP
    IF NOT (
      SELECT p.prosecdef
         AND p.proowner = 'taskflow_migrator'::regrole
         AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
        FROM pg_catalog.pg_proc AS p WHERE p.oid = proc.oid
    ) THEN
      RAISE EXCEPTION 'helper owner/security/search_path contract failed for %', proc.oid::regprocedure;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('taskflow_runtime', proc.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper EXECUTE ACL is broader or narrower than the reviewed contract for %', proc.oid::regprocedure;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS p,
             LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
       WHERE p.oid = proc.oid
         AND a.grantee = 0
         AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'PUBLIC can execute helper %', proc.oid::regprocedure;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_schema_privilege('taskflow_migrator', 'taskflow_storage', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('taskflow_migrator', 'taskflow_storage', 'CREATE')
     OR NOT pg_catalog.has_schema_privilege('authenticated', 'taskflow_storage', 'USAGE')
     OR pg_catalog.has_schema_privilege('anon', 'taskflow_storage', 'USAGE')
     OR pg_catalog.has_schema_privilege('taskflow_runtime', 'taskflow_storage', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('taskflow_bootstrap', 'storage', 'USAGE')
     OR pg_catalog.has_schema_privilege('taskflow_bootstrap', 'storage', 'CREATE') THEN
    RAISE EXCEPTION 'app helper or managed Storage schema ACL contract failed';
  END IF;
  IF pg_catalog.has_schema_privilege('taskflow_migrator', 'storage', 'USAGE')
     OR pg_catalog.has_schema_privilege('taskflow_migrator', 'storage', 'CREATE')
     OR pg_catalog.has_schema_privilege('taskflow_migrator', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'taskflow_migrator acquired managed schema access';
  END IF;
  IF pg_catalog.has_table_privilege('taskflow_migrator', 'storage.objects', 'SELECT')
     OR pg_catalog.has_table_privilege('taskflow_migrator', 'storage.objects', 'INSERT')
     OR pg_catalog.has_table_privilege('taskflow_migrator', 'storage.objects', 'UPDATE')
     OR pg_catalog.has_table_privilege('taskflow_migrator', 'storage.objects', 'DELETE')
     OR pg_catalog.has_table_privilege('taskflow_runtime', 'storage.objects', 'SELECT')
     OR pg_catalog.has_table_privilege('taskflow_runtime', 'storage.objects', 'INSERT')
     OR pg_catalog.has_table_privilege('taskflow_runtime', 'storage.objects', 'UPDATE')
     OR pg_catalog.has_table_privilege('taskflow_runtime', 'storage.objects', 'DELETE') THEN
    RAISE EXCEPTION 'TaskFlow roles acquired Storage table DML';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'storage.objects', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION 'baseline anon Storage grant unexpectedly changed in the fixture';
  END IF;

  SELECT pg_catalog.count(*) INTO policy_total
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('taskflow_attachments_select', 'taskflow_attachments_insert', 'taskflow_attachments_delete');
  IF policy_total <> 3 OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname = 'taskflow_attachments_update'
  ) THEN
    RAISE EXCEPTION 'TaskFlow policy set is not the reviewed SELECT/INSERT/DELETE-only set';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'legacy-bucket' AND name = 'legacy-object') THEN
    RAISE EXCEPTION 'unrelated legacy bucket fixture changed';
  END IF;
END
$$;

SELECT 'TASKFLOW_STORAGE_SQL_RESTRICTED_ROLE_INSTALL=PASS' AS result;
SELECT 'TASKFLOW_STORAGE_MANAGED_OWNER_AND_ACL_UNCHANGED=PASS' AS result;
SELECT 'TASKFLOW_STORAGE_PRIVATE_BUCKET_POLICY_CONTRACT=PASS' AS result;
