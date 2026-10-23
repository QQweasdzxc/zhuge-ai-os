-- Optional helper-schema cleanup, only after the Dashboard policies have been
-- removed and helper-function rollback has succeeded. It deletes an empty
-- TaskFlow-owned schema only; it never addresses managed Supabase schemas.

BEGIN;

DO $$
DECLARE
    schema_owner text;
    object_count bigint;
BEGIN
    IF session_user <> 'postgres' OR current_user <> 'postgres'
       OR session_user <> current_user THEN
        RAISE EXCEPTION 'connect directly as the existing postgres login; SET ROLE is not accepted';
    END IF;
    SELECT pg_catalog.pg_get_userbyid(n.nspowner) INTO schema_owner
      FROM pg_catalog.pg_namespace AS n
     WHERE n.nspname = 'taskflow_storage';
    IF schema_owner IS NULL THEN
        RAISE NOTICE 'taskflow_storage is already absent';
        RETURN;
    END IF;
    IF schema_owner <> 'postgres' THEN
        RAISE EXCEPTION 'taskflow_storage has an unexpected owner; manual review required';
    END IF;
    SELECT pg_catalog.count(*) INTO object_count
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'taskflow_storage';
    IF object_count <> 0 OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'taskflow_storage'
    ) THEN
        RAISE EXCEPTION 'taskflow_storage is not empty; refusing schema removal';
    END IF;
END
$$;

DROP SCHEMA IF EXISTS taskflow_storage;

COMMIT;
