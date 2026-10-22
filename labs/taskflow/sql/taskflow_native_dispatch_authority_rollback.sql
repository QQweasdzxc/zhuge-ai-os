-- Candidate rollback only; execute only if the migration was explicitly installed.
BEGIN;
DROP FUNCTION IF EXISTS taskflow.stop_dispatch_intent(UUID, BIGINT, TEXT);
DROP FUNCTION IF EXISTS taskflow.claim_dispatch_intent(TEXT, UUID, UUID, TEXT, TEXT, INTEGER);
DROP INDEX IF EXISTS taskflow.dispatch_intent_one_active_writer;
DROP INDEX IF EXISTS taskflow.dispatch_intent_issue_history;
DROP TABLE IF EXISTS taskflow.dispatch_intent;
COMMIT;
