-- Candidate rollback only; execute only if the migration was explicitly installed.
BEGIN;
DROP FUNCTION IF EXISTS taskflow.stop_dispatch_intent(UUID, BIGINT, TEXT);
DROP FUNCTION IF EXISTS taskflow.record_dispatch_reconciliation(UUID, UUID, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS taskflow.renew_dispatch_lease(UUID, UUID, BIGINT, INTEGER);
DROP FUNCTION IF EXISTS taskflow.claim_dispatch_intent(TEXT, UUID, UUID, TEXT, TEXT, INTEGER);
DROP INDEX IF EXISTS taskflow.dispatch_intent_one_active_writer;
DROP INDEX IF EXISTS taskflow.dispatch_intent_issue_history;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM taskflow.dispatch_intent) THEN
        RAISE EXCEPTION 'refusing destructive rollback: dispatch history exists';
    END IF;
    DROP TABLE IF EXISTS taskflow.dispatch_intent;
END $$;
COMMIT;
