-- Candidate rollback only; execute only if the migration was explicitly installed.
BEGIN;
-- Serialize the emptiness check with writers before any destructive DDL.
DO $dispatch_rollback_guard$
BEGIN
    IF pg_catalog.to_regclass('taskflow.dispatch_intent') IS NOT NULL THEN
        LOCK TABLE taskflow.dispatch_intent IN ACCESS EXCLUSIVE MODE;
        IF EXISTS (SELECT 1 FROM taskflow.dispatch_intent) THEN
            RAISE EXCEPTION 'refusing destructive rollback: dispatch history exists';
        END IF;
    END IF;
END
$dispatch_rollback_guard$;
DROP FUNCTION IF EXISTS taskflow.stop_dispatch_intent(UUID, BIGINT, TEXT);
DROP FUNCTION IF EXISTS taskflow.confirm_dispatch_stop(UUID, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS taskflow.record_dispatch_reconciliation(UUID, UUID, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS taskflow.record_dispatch_provider_ack(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS taskflow.renew_dispatch_lease(UUID, UUID, BIGINT, INTEGER);
DROP FUNCTION IF EXISTS taskflow.begin_dispatch_provider(UUID, UUID, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS taskflow.bind_dispatch_provider_route(UUID, UUID, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS taskflow.claim_dispatch_intent(TEXT, UUID, UUID, TEXT, TEXT, TEXT, INTEGER);
DROP INDEX IF EXISTS taskflow.dispatch_intent_one_active_writer;
DROP INDEX IF EXISTS taskflow.dispatch_intent_issue_history;
DO $$
BEGIN
    DROP TABLE IF EXISTS taskflow.dispatch_intent;
END $$;
COMMIT;
