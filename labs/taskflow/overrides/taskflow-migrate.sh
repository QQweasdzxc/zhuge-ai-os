#!/bin/sh
set -eu

: "${TASKFLOW_MIGRATION_DATABASE_URL:?Use the one-shot taskflow_migrator connection; never use the runtime DATABASE_URL}"

# Fail closed before invoking the pinned Multica migrator. The bootstrap
# identity creates the schema/roles; this one-shot role may create objects
# inside taskflow only.
psql "$TASKFLOW_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    protected_schema TEXT;
    protected_table_privilege TEXT;
BEGIN
    IF current_user <> 'taskflow_migrator' THEN
        RAISE EXCEPTION 'TaskFlow migration must use taskflow_migrator';
    END IF;
    IF current_schema() <> 'taskflow'
       OR current_schemas(false) <> ARRAY['taskflow', 'extensions']::NAME[] THEN
        RAISE EXCEPTION 'TaskFlow migration search_path must be exactly taskflow, extensions; got %', current_schemas(false);
    END IF;
    IF NOT has_schema_privilege(current_user, 'taskflow', 'USAGE')
       OR NOT has_schema_privilege(current_user, 'taskflow', 'CREATE') THEN
        RAISE EXCEPTION 'TaskFlow migrator requires CREATE and USAGE only in taskflow';
    END IF;
    IF NOT has_schema_privilege(current_user, 'extensions', 'USAGE') THEN
        RAISE EXCEPTION 'TaskFlow migrator requires extensions USAGE';
    END IF;
    IF has_schema_privilege(current_user, 'extensions', 'CREATE') THEN
        RAISE EXCEPTION 'TaskFlow migrator must not have extensions CREATE';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_roles r
         WHERE r.rolname = current_user
           AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'TaskFlow migrator must not have elevated role attributes';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_roles target
         WHERE target.rolname = ANY(ARRAY['anon', 'authenticated', 'service_role', 'multica_lab_runtime'])
           AND pg_catalog.pg_has_role(current_user, target.oid, 'MEMBER')
    ) THEN
        RAISE EXCEPTION 'TaskFlow migrator has forbidden role membership';
    END IF;

    FOREACH protected_schema IN ARRAY ARRAY['public', 'lab_multica', 'cron'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = protected_schema)
           AND has_schema_privilege(current_user, protected_schema, 'CREATE') THEN
            RAISE EXCEPTION 'TaskFlow migrator has forbidden CREATE on schema %', protected_schema;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'lab_multica')
       AND has_schema_privilege(current_user, 'lab_multica', 'USAGE') THEN
        RAISE EXCEPTION 'TaskFlow migrator must not have lab_multica schema access';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron')
       AND has_schema_privilege(current_user, 'cron', 'USAGE') THEN
        RAISE EXCEPTION 'TaskFlow migrator must not have cron schema access';
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
            RAISE EXCEPTION 'TaskFlow migrator has forbidden % privilege on public/lab_multica tables', protected_table_privilege;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'cron'
           AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
           AND (has_table_privilege(current_user, c.oid, 'INSERT')
             OR has_table_privilege(current_user, c.oid, 'UPDATE')
             OR has_table_privilege(current_user, c.oid, 'DELETE')
             OR has_table_privilege(current_user, c.oid, 'TRUNCATE'))
    ) THEN
        RAISE EXCEPTION 'TaskFlow migrator has cron mutation privileges';
    END IF;

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
        RAISE EXCEPTION 'TaskFlow migrator has forbidden privileges on public/lab_multica sequences';
    END IF;
END
$$;
SQL

export DATABASE_URL="$TASKFLOW_MIGRATION_DATABASE_URL"
exec /app/migrate up
