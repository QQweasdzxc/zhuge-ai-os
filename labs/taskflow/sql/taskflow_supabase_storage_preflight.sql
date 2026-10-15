-- READ ONLY. Run before the one-time storage installation using the existing
-- postgres login. No URLs, credentials, tokens, or application data are read.

SELECT
    current_user AS inspected_as,
    session_user AS session_identity,
    current_database() AS database_name,
    r.rolsuper AS postgres_is_superuser,
    r.rolcreaterole AS postgres_has_create_role_baseline,
    pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_app_schema,
    pg_catalog.has_schema_privilege(current_user, 'storage', 'USAGE') AS postgres_storage_usage,
    pg_catalog.has_schema_privilege(current_user, 'storage', 'CREATE') AS postgres_storage_create
  FROM pg_catalog.pg_roles AS r
 WHERE r.rolname = current_user;

SELECT role_name,
       pg_catalog.has_schema_privilege(role_name, 'taskflow', 'USAGE') AS taskflow_usage,
       pg_catalog.has_schema_privilege(role_name, 'taskflow', 'CREATE') AS taskflow_create,
       CASE WHEN pg_catalog.to_regnamespace('taskflow_storage') IS NULL
            THEN FALSE
            ELSE pg_catalog.has_schema_privilege(role_name, 'taskflow_storage', 'USAGE')
       END AS helper_schema_usage,
       pg_catalog.has_schema_privilege(role_name, 'storage', 'USAGE') AS storage_usage,
       pg_catalog.has_schema_privilege(role_name, 'storage', 'CREATE') AS storage_create,
       pg_catalog.has_schema_privilege(role_name, 'auth', 'USAGE') AS auth_usage,
       pg_catalog.has_table_privilege(role_name, 'taskflow.member', 'SELECT') AS member_select,
       pg_catalog.has_table_privilege(role_name, 'storage.objects', 'SELECT') AS storage_select,
       pg_catalog.has_table_privilege(role_name, 'storage.objects', 'INSERT') AS storage_insert,
       pg_catalog.has_table_privilege(role_name, 'storage.objects', 'UPDATE') AS storage_update,
       pg_catalog.has_table_privilege(role_name, 'storage.objects', 'DELETE') AS storage_delete
  FROM (VALUES ('taskflow_migrator'), ('taskflow_runtime'), ('authenticated'), ('anon')) AS roles(role_name)
 ORDER BY role_name;

SELECT n.nspname AS managed_schema,
       c.relname AS managed_relation,
       pg_catalog.pg_get_userbyid(c.relowner) AS current_owner,
       c.relrowsecurity AS row_level_security
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
 WHERE n.nspname = 'storage'
   AND c.relname IN ('buckets', 'objects')
 ORDER BY c.relname;

SELECT pg_catalog.to_regnamespace('taskflow_storage') AS helper_schema_before_install,
       pg_catalog.to_regprocedure('taskflow_storage.taskflow_storage_can_access_object(text)') AS access_helper_before_install,
       pg_catalog.to_regprocedure('taskflow_storage.taskflow_storage_can_delete_object(text,text)') AS delete_helper_before_install,
       pg_catalog.to_regclass('storage.buckets') AS buckets_relation,
       pg_catalog.to_regclass('storage.objects') AS objects_relation,
       current_setting('pgrst.db_schemas', true) AS session_postgrest_exposed_schemas;

SELECT id, name, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
 WHERE id = 'taskflow-attachments';

SELECT policyname, roles, cmd, qual, with_check
  FROM pg_catalog.pg_policies
 WHERE schemaname = 'storage'
   AND tablename = 'objects'
 ORDER BY policyname;

-- The session setting above is not authoritative when PostgREST reads its
-- configuration from service settings. Before release, separately verify in
-- Supabase Dashboard > API Settings that taskflow_storage is NOT exposed.
-- Verify the project-wide upload limit is at least 50 MB (or reduce the app cap accordingly) in Storage settings.
