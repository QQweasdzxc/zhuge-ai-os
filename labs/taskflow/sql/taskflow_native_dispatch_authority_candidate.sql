-- TaskFlow Native Durable Dispatch Authority (candidate only)
--
-- This migration is intentionally not installed by the overlay.  It is the
-- smallest server-owned persistence boundary required by CTODispatchIssue.
-- Installation requires the TaskFlow migrator owner and a separately approved
-- ACL review; the public runtime remains fail-closed until then.

BEGIN;

CREATE TABLE IF NOT EXISTS taskflow.dispatch_intent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_key TEXT NOT NULL,
    request_payload_hash TEXT NOT NULL,
    issue_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    executor_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'claimed'
        CHECK (state IN ('claimed', 'provider_started', 'stopped', 'failed', 'reconcile_required', 'completed')),
    lease_id UUID NOT NULL DEFAULT gen_random_uuid(),
    lease_expires_at TIMESTAMPTZ NOT NULL,
    fencing_epoch BIGINT NOT NULL DEFAULT 1 CHECK (fencing_epoch > 0),
    provider_run_id TEXT,
    provider_ack_event_id TEXT,
    native_write_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (native_write_state IN ('pending', 'committed', 'failed')),
    stop_reason TEXT,
    reconciliation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, request_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_intent_one_active_writer
    ON taskflow.dispatch_intent (issue_id)
    WHERE state IN ('claimed', 'provider_started', 'reconcile_required');

CREATE INDEX IF NOT EXISTS dispatch_intent_issue_history
    ON taskflow.dispatch_intent (workspace_id, issue_id, created_at DESC);

-- The caller must be the authenticated server-side TaskFlow authority.  The
-- function never accepts a client-supplied dispatch/lease/fencing identity.
CREATE OR REPLACE FUNCTION taskflow.claim_dispatch_intent(
    p_request_key TEXT,
    p_issue_id UUID,
    p_workspace_id UUID,
    p_executor_id TEXT,
    p_provider TEXT,
    p_lease_seconds INTEGER DEFAULT 300
) RETURNS taskflow.dispatch_intent
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
DECLARE
    existing taskflow.dispatch_intent;
BEGIN
    IF p_request_key IS NULL OR btrim(p_request_key) = '' OR p_lease_seconds <= 0 THEN
        RAISE EXCEPTION 'invalid dispatch claim request';
    END IF;

    SELECT * INTO existing
      FROM taskflow.dispatch_intent
     WHERE workspace_id = p_workspace_id AND request_key = p_request_key
     FOR UPDATE;
    IF FOUND THEN
        IF existing.request_payload_hash <> encode(sha256(convert_to(
            p_issue_id::text || ':' || p_workspace_id::text || ':' || p_executor_id || ':' || p_provider,
            'UTF8'
        )), 'hex') THEN
            RAISE EXCEPTION 'dispatch request key payload mismatch';
        END IF;
        RETURN existing;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM taskflow.issue i
        WHERE i.id = p_issue_id AND i.workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION 'issue and workspace mismatch';
    END IF;

    INSERT INTO taskflow.dispatch_intent (
        request_key, request_payload_hash, issue_id, workspace_id, executor_id, provider,
        lease_expires_at
    ) VALUES (
        p_request_key,
        encode(sha256(convert_to(p_issue_id::text || ':' || p_workspace_id::text || ':' || p_executor_id || ':' || p_provider, 'UTF8')), 'hex'),
        p_issue_id, p_workspace_id, p_executor_id, p_provider,
        now() + make_interval(secs => p_lease_seconds)
    )
    RETURNING * INTO existing;
    RETURN existing;
EXCEPTION WHEN unique_violation THEN
    -- A concurrent request for the same issue is a safe refusal, not a second
    -- writer.  The caller must read the existing row and reconcile explicitly.
    RAISE EXCEPTION 'dispatch issue already has an active writer';
END;
$$;

CREATE OR REPLACE FUNCTION taskflow.renew_dispatch_lease(
    p_dispatch_id UUID, p_lease_id UUID, p_fencing_epoch BIGINT,
    p_lease_seconds INTEGER DEFAULT 300
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
BEGIN
    UPDATE taskflow.dispatch_intent
       SET lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
     WHERE id = p_dispatch_id AND lease_id = p_lease_id
       AND fencing_epoch = p_fencing_epoch AND lease_expires_at > now()
       AND state IN ('claimed', 'provider_started', 'reconcile_required');
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION taskflow.record_dispatch_reconciliation(
    p_dispatch_id UUID, p_lease_id UUID, p_fencing_epoch BIGINT,
    p_reason TEXT, p_native_write_state TEXT DEFAULT 'failed'
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
BEGIN
    UPDATE taskflow.dispatch_intent
       SET state = 'reconcile_required', native_write_state = p_native_write_state,
           reconciliation_reason = NULLIF(btrim(p_reason), ''), updated_at = now()
     WHERE id = p_dispatch_id AND lease_id = p_lease_id
       AND fencing_epoch = p_fencing_epoch
       AND state IN ('claimed', 'provider_started', 'reconcile_required');
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION taskflow.stop_dispatch_intent(
    p_dispatch_id UUID,
    p_fencing_epoch BIGINT,
    p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
BEGIN
    UPDATE taskflow.dispatch_intent
       SET state = 'stopped',
           stop_reason = NULLIF(btrim(p_reason), ''),
           fencing_epoch = fencing_epoch + 1,
           updated_at = now()
     WHERE id = p_dispatch_id
       AND fencing_epoch = p_fencing_epoch
       AND state IN ('claimed', 'provider_started', 'reconcile_required');
    RETURN FOUND;
END;
$$;

COMMIT;
