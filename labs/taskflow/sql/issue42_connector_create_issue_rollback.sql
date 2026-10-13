-- Candidate rollback only. Execute only after a separately approved install.
-- This disables the connector entry points but intentionally retains the
-- idempotency ledger so request IDs cannot be reused after rollback/reinstall.
BEGIN;
REVOKE ALL ON FUNCTION taskflow.sb_connector_create_issue(UUID, UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM postgres;
REVOKE ALL ON FUNCTION taskflow.sb_connector_update_issue(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE) FROM postgres;
DROP FUNCTION taskflow.sb_connector_create_issue(UUID, UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE);
DROP FUNCTION taskflow.sb_connector_update_issue(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, DATE, DATE);
-- Retain taskflow.sb_connector_issue_request and its rows. Do not delete
-- connector-created issues as part of code rollback; those are product data.
COMMIT;
