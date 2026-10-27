-- G1 v4 post-commit compensation is NOT routine rollback.
-- An error before COMMIT rolls back the complete transaction automatically.
-- Once committed, retain identities, projects, adoption, and native search events.
-- A future delete/compensation requires a separately reviewed explicit operation.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $taskflow_migration_role_guard$
BEGIN
    IF current_user <> 'taskflow_migrator' THEN
        RAISE EXCEPTION 'migration path requires taskflow_migrator, got %', current_user;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user
          AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
        RAISE EXCEPTION 'taskflow_migrator holds elevated attributes';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace
        WHERE nspname = 'taskflow' AND nspowner = current_user::regrole
    ) THEN
        RAISE EXCEPTION 'taskflow schema owner is not taskflow_migrator';
    END IF;
END
$taskflow_migration_role_guard$;

DO $retention$
BEGIN
 RAISE EXCEPTION 'G1 POST_COMMIT_RETAIN: no automatic deletion; explicit compensation review required';
END $retention$;
ROLLBACK;
