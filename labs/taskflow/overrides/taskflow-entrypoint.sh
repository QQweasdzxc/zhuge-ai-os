#!/bin/sh
set -eu

: "${DATABASE_URL:?TaskFlow requires its restricted runtime database role}"

# Normal API starts never apply DDL. Migrations are a separate, controlled
# one-shot action using taskflow_migrator.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    protected_schema TEXT;
    protected_table_privilege TEXT;
BEGIN
    IF current_user <> 'taskflow_runtime' THEN
        RAISE EXCEPTION 'TaskFlow API must use taskflow_runtime';
    END IF;
    IF current_schema() <> 'taskflow'
       OR current_schemas(false) <> ARRAY['taskflow', 'extensions']::NAME[] THEN
        RAISE EXCEPTION 'TaskFlow runtime search_path must be exactly taskflow, extensions; got %', current_schemas(false);
    END IF;
    IF NOT has_schema_privilege(current_user, 'taskflow', 'USAGE')
       OR has_schema_privilege(current_user, 'taskflow', 'CREATE') THEN
        RAISE EXCEPTION 'TaskFlow runtime requires taskflow USAGE and must not have taskflow CREATE';
    END IF;
    IF NOT has_schema_privilege(current_user, 'extensions', 'USAGE') THEN
        RAISE EXCEPTION 'TaskFlow runtime requires extensions USAGE';
    END IF;
    IF has_schema_privilege(current_user, 'extensions', 'CREATE') THEN
        RAISE EXCEPTION 'TaskFlow runtime must not have extensions CREATE';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_roles r
         WHERE r.rolname = current_user
           AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'TaskFlow runtime role must not have elevated role attributes';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_roles target
         WHERE target.rolname = ANY(ARRAY['anon', 'authenticated', 'service_role', 'multica_lab_runtime'])
           AND pg_catalog.pg_has_role(current_user, target.oid, 'MEMBER')
    ) THEN
        RAISE EXCEPTION 'TaskFlow runtime role has forbidden role membership';
    END IF;

    FOREACH protected_schema IN ARRAY ARRAY['public', 'lab_multica', 'cron'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = protected_schema)
           AND has_schema_privilege(current_user, protected_schema, 'CREATE') THEN
            RAISE EXCEPTION 'TaskFlow runtime has forbidden CREATE on schema %', protected_schema;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'lab_multica')
       AND has_schema_privilege(current_user, 'lab_multica', 'USAGE') THEN
        RAISE EXCEPTION 'TaskFlow runtime must not have lab_multica schema access';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron')
       AND has_schema_privilege(current_user, 'cron', 'USAGE') THEN
        RAISE EXCEPTION 'TaskFlow runtime must not have cron schema access';
    END IF;

    FOREACH protected_table_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
        IF EXISTS (
            SELECT 1
              FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ('public', 'lab_multica')
               AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
               AND has_table_privilege(current_user, c.oid, protected_table_privilege)
        ) THEN
            RAISE EXCEPTION 'TaskFlow runtime has forbidden % privilege on public/lab_multica tables', protected_table_privilege;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('public', 'lab_multica')
           AND c.relkind = 'S'
           AND (has_sequence_privilege(current_user, c.oid, 'USAGE')
             OR has_sequence_privilege(current_user, c.oid, 'SELECT')
             OR has_sequence_privilege(current_user, c.oid, 'UPDATE'))
    ) THEN
        RAISE EXCEPTION 'TaskFlow runtime has forbidden privileges on public/lab_multica sequences';
    END IF;

    -- The Supabase baseline has a limited PUBLIC ACL on cron.job_run_details.
    -- Without cron schema USAGE (checked above), that relation ACL cannot be
    -- exercised. Do not alter the shared cron ACL to change this baseline.
END
$$;
SQL

exec /app/server "$@"
