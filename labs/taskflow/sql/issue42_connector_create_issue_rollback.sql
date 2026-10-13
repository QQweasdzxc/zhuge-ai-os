-- Candidate rollback only. Run through taskflow_migrator after an approved
-- install. This removes the Connector entry points only; it never deletes
-- TaskFlow cards, activities, subscriptions, or idempotency request records.
BEGIN;

DO $rollback_preflight$
DECLARE
    v_owner TEXT;
BEGIN
    IF session_user <> 'taskflow_migrator' OR current_user <> 'taskflow_migrator' THEN
        RAISE EXCEPTION 'Issue #42 rollback must be run by taskflow_migrator';
    END IF;
    SELECT pg_catalog.pg_get_userbyid(p.proowner)
      INTO v_owner
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'taskflow'
       AND p.proname IN ('sb_connector_create_issue', 'sb_connector_update_issue')
       AND pg_catalog.pg_get_userbyid(p.proowner) <> 'taskflow_migrator'
     LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'refusing to remove Issue #42 function owned by %', v_owner;
    END IF;
END
$rollback_preflight$;

DROP FUNCTION IF EXISTS taskflow.sb_connector_create_issue(UUID, UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE);
DROP FUNCTION IF EXISTS taskflow.sb_connector_update_issue(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE);

-- Keep taskflow.sb_connector_issue_request as a tombstone ledger. Request IDs
-- remain consumed after rollback/reinstall, and already-created product data is
-- not undone by disabling this administrative write path.
COMMIT;
