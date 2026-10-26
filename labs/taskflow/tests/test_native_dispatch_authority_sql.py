from pathlib import Path


ROOT = Path(__file__).parents[1]
DDL = (ROOT / "sql/taskflow_native_dispatch_authority_candidate.sql").read_text()
ROLLBACK = (ROOT / "sql/taskflow_native_dispatch_authority_rollback.sql").read_text()


def test_candidate_is_server_owned_and_fail_closed_by_default():
    assert "CREATE TABLE IF NOT EXISTS taskflow.dispatch_intent" in DDL
    assert "UNIQUE INDEX IF NOT EXISTS dispatch_intent_one_active_writer" in DDL
    assert "SECURITY INVOKER" in DDL
    assert "SET search_path = taskflow, pg_catalog" in DDL
    assert "p_request_key" in DDL and "fencing_epoch" in DDL
    assert "request_payload_hash" in DDL
    claim_body = DDL.split("CREATE OR REPLACE FUNCTION taskflow.claim_dispatch_intent", 1)[1].split(
        "CREATE OR REPLACE FUNCTION taskflow.bind_dispatch_provider_route", 1
    )[0]
    assert "pg_catalog.hashtextextended" in claim_body
    assert "pg_catalog.pg_advisory_xact_lock" in claim_body
    assert "request_lock_id < issue_lock_id" in claim_body
    assert "provider_start_requested_at" in DDL
    assert "provider_start_requested" in DDL
    assert "provider_acknowledged" in DDL
    assert "begin_dispatch_provider" in DDL
    assert "bind_dispatch_provider_route" in DDL
    assert "record_dispatch_provider_ack" in DDL
    assert "renew_dispatch_lease" in DDL
    assert "record_dispatch_reconciliation" in DDL
    assert "confirm_dispatch_stop" in DDL
    assert "p_lease_seconds > 3600" in DDL
    assert "PROVIDER" not in DDL.upper() or "provider" in DDL
    assert "GRANT" not in DDL.upper()


def test_claim_does_not_accept_client_identity_or_provider_ack():
    claim_body = DDL.split("CREATE OR REPLACE FUNCTION taskflow.claim_dispatch_intent", 1)[1].split(
        "CREATE OR REPLACE FUNCTION taskflow.bind_dispatch_provider_route", 1
    )[0]
    assert "p_dispatch_id" not in claim_body
    assert "p_lease_id" not in claim_body
    assert "p_fencing_epoch" not in claim_body
    assert "provider_ack_event_id" not in claim_body


def test_stop_fences_old_writer_and_rollback_is_explicit():
    assert "fencing_epoch = fencing_epoch + 1" in DDL
    assert "AND fencing_epoch = p_fencing_epoch" in DDL
    assert "DROP TABLE IF EXISTS taskflow.dispatch_intent" in ROLLBACK
    assert "refusing destructive rollback" in ROLLBACK
    assert "provider_stop_verified" in DDL
    stop_body = DDL.split("CREATE OR REPLACE FUNCTION taskflow.confirm_dispatch_stop", 1)[1].split("COMMIT;", 1)[0]
    assert "RETURN false;" in stop_body
    assert "begin_dispatch_provider" in ROLLBACK
    assert "record_dispatch_provider_ack" in ROLLBACK
