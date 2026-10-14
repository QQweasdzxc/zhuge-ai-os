\set ON_ERROR_STOP on

DO $$
DECLARE
  access_proc oid := 'storage.taskflow_storage_can_access_object(text)'::regprocedure;
  delete_proc oid := 'storage.taskflow_storage_can_delete_object(text,text)'::regprocedure;
  bucket storage.buckets%ROWTYPE;
  proc record;
BEGIN
  SELECT * INTO bucket FROM storage.buckets WHERE id = 'taskflow-attachments';
  IF NOT FOUND OR bucket.public IS DISTINCT FROM false OR bucket.file_size_limit IS DISTINCT FROM 104857600 THEN
    RAISE EXCEPTION 'private TaskFlow bucket settings do not match the native 100 MiB cap';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION 'Storage object RLS is not enabled';
  END IF;

  FOR proc IN SELECT unnest(ARRAY[access_proc, delete_proc]) AS oid LOOP
    IF NOT (
      SELECT p.prosecdef
         AND p.proowner = 'taskflow_migrator'::regrole
         AND p.proconfig @> ARRAY['search_path=pg_catalog, taskflow, pg_temp']
        FROM pg_catalog.pg_proc p WHERE p.oid = proc.oid
    ) THEN
      RAISE EXCEPTION 'Storage helper owner/security/search_path contract failed for %', proc.oid::regprocedure;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', access_proc, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', delete_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lacks the required helper execute privilege';
  END IF;
  IF has_function_privilege('anon', access_proc, 'EXECUTE')
     OR has_function_privilege('anon', delete_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has Storage helper execution';
  END IF;
  IF has_schema_privilege('taskflow_migrator', 'storage', 'CREATE') THEN
    RAISE EXCEPTION 'taskflow_migrator retained temporary Storage CREATE';
  END IF;
  IF has_table_privilege('taskflow_runtime', 'storage.objects', 'SELECT')
     OR has_table_privilege('taskflow_runtime', 'storage.objects', 'INSERT')
     OR has_table_privilege('taskflow_runtime', 'storage.objects', 'UPDATE')
     OR has_table_privilege('taskflow_runtime', 'storage.objects', 'DELETE') THEN
    RAISE EXCEPTION 'TaskFlow runtime unexpectedly has Storage object DML';
  END IF;
  IF has_table_privilege('anon', 'storage.objects', 'SELECT')
     OR has_table_privilege('anon', 'storage.objects', 'INSERT')
     OR has_table_privilege('anon', 'storage.objects', 'DELETE') THEN
    RAISE EXCEPTION 'anon unexpectedly has Storage object DML';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'legacy-bucket' AND name = 'legacy-object') THEN
    RAISE EXCEPTION 'unrelated legacy bucket fixture changed';
  END IF;
END
$$;

SELECT 'TASKFLOW_STORAGE_SQL_ACL_AND_RLS=PASS' AS result;
