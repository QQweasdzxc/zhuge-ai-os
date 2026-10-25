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
    provider_start_requested_at TIMESTAMPTZ,
    cto_principal TEXT NOT NULL,
    native_write_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (native_write_state IN ('pending', 'committed', 'failed')),
    stop_reason TEXT,
    stop_requested_at TIMESTAMPTZ,
    provider_stop_verified BOOLEAN NOT NULL DEFAULT false,
    reconciliation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, request_key)
);

ALTER TABLE taskflow.dispatch_intent
    ADD COLUMN IF NOT EXISTS provider_start_requested_at TIMESTAMPTZ;

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
    p_cto_principal TEXT,
    p_lease_seconds INTEGER DEFAULT 300
) RETURNS taskflow.dispatch_intent
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
DECLARE
    existing taskflow.dispatch_intent;
    request_lock_id BIGINT;
    issue_lock_id BIGINT;
BEGIN
    IF p_request_key IS NULL OR btrim(p_request_key) = '' OR length(p_request_key) > 200
       OR btrim(coalesce(p_cto_principal, '')) = ''
       OR btrim(coalesce(p_executor_id, '')) = '' OR btrim(coalesce(p_provider, '')) = ''
       OR p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid dispatch claim request';
    END IF;

    -- Serialize requests that share either an idempotency key or an Issue
    -- before touching the unique indexes. Acquire both transaction locks in
    -- numeric order so concurrent retries cannot deadlock across the request
    -- key and single-active-writer constraints. Hash collisions only serialize
    -- unrelated claims; the unique indexes remain the final integrity guard.
    request_lock_id := pg_catalog.hashtextextended(
        'taskflow.dispatch.request:' || p_workspace_id::text || ':' || p_request_key, 0
    );
    issue_lock_id := pg_catalog.hashtextextended(
        'taskflow.dispatch.issue:' || p_issue_id::text, 0
    );
    IF request_lock_id = issue_lock_id THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(request_lock_id);
    ELSIF request_lock_id < issue_lock_id THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(request_lock_id);
        PERFORM pg_catalog.pg_advisory_xact_lock(issue_lock_id);
    ELSE
        PERFORM pg_catalog.pg_advisory_xact_lock(issue_lock_id);
        PERFORM pg_catalog.pg_advisory_xact_lock(request_lock_id);
    END IF;

    SELECT * INTO existing
      FROM taskflow.dispatch_intent
     WHERE workspace_id = p_workspace_id AND request_key = p_request_key
     FOR UPDATE;
    IF FOUND THEN
        IF existing.request_payload_hash <> encode(sha256(convert_to(
            p_issue_id::text || ':' || p_workspace_id::text || ':' || p_executor_id || ':' || p_provider || ':' || p_cto_principal,
            'UTF8'
        )), 'hex') THEN
            RAISE EXCEPTION 'dispatch request key payload mismatch';
        END IF;
        IF existing.state IN ('failed', 'completed', 'stopped') OR existing.lease_expires_at <= now() THEN
            RAISE EXCEPTION 'dispatch request key is terminal or expired';
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
        request_key, request_payload_hash, issue_id, workspace_id, executor_id, provider, cto_principal,
        lease_expires_at
    ) VALUES (
        p_request_key,
        encode(sha256(convert_to(p_issue_id::text || ':' || p_workspace_id::text || ':' || p_executor_id || ':' || p_provider || ':' || p_cto_principal, 'UTF8')), 'hex'),
        p_issue_id, p_workspace_id, p_executor_id, p_provider, p_cto_principal,
        now() + make_interval(secs => p_lease_seconds)
    )
    ON CONFLICT (workspace_id, request_key) DO NOTHING
    RETURNING * INTO existing;
    IF FOUND THEN
        RETURN existing;
    END IF;

    -- A concurrent retry with the same request key waits on the unique key,
    -- then reads the committed intent and applies the same payload/terminal
    -- checks as a non-concurrent retry. A different request key for this Issue
    -- still fails the one-active-writer unique index below.
    SELECT * INTO existing
      FROM taskflow.dispatch_intent
     WHERE workspace_id = p_workspace_id AND request_key = p_request_key
     FOR UPDATE;
    IF FOUND THEN
        IF existing.request_payload_hash <> encode(sha256(convert_to(
            p_issue_id::text || ':' || p_workspace_id::text || ':' || p_executor_id || ':' || p_provider || ':' || p_cto_principal,
            'UTF8'
        )), 'hex') THEN
            RAISE EXCEPTION 'dispatch request key payload mismatch';
        END IF;
        IF existing.state IN ('failed', 'completed', 'stopped') OR existing.lease_expires_at <= now() THEN
            RAISE EXCEPTION 'dispatch request key is terminal or expired';
        END IF;
        RETURN existing;
    END IF;
    RAISE EXCEPTION 'dispatch issue already has an active writer';
EXCEPTION WHEN unique_violation THEN
    -- A concurrent request for the same issue is a safe refusal, not a second
    -- writer.  The caller must read the existing row and reconcile explicitly.
    RAISE EXCEPTION 'dispatch issue already has an active writer';
END;
$$;

-- The provider boundary may be crossed only by the first caller holding this
-- live claim. Replayed requests receive the same intent but cannot start a
-- second Provider Run. An ambiguous attempt remains fenced for reconciliation.
CREATE OR REPLACE FUNCTION taskflow.begin_dispatch_provider(
    p_dispatch_id UUID,
    p_lease_id UUID,
    p_fencing_epoch BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
BEGIN
    UPDATE taskflow.dispatch_intent
       SET state = 'provider_started', provider_start_requested_at = now(), updated_at = now()
     WHERE id = p_dispatch_id AND lease_id = p_lease_id
       AND fencing_epoch = p_fencing_epoch
       AND lease_expires_at > now()
       AND state = 'claimed'
       AND provider_start_requested_at IS NULL
       AND provider_run_id IS NULL
       AND provider_ack_event_id IS NULL
       AND stop_requested_at IS NULL;
    RETURN FOUND;
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
    IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
        RETURN false;
    END IF;
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
       SET state = 'reconcile_required',
           stop_reason = NULLIF(btrim(p_reason), ''),
           stop_requested_at = now(),
           fencing_epoch = fencing_epoch + 1,
           updated_at = now()
     WHERE id = p_dispatch_id
       AND fencing_epoch = p_fencing_epoch
       AND state IN ('claimed', 'provider_started', 'reconcile_required');
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION taskflow.confirm_dispatch_stop(
    p_dispatch_id UUID, p_fencing_epoch BIGINT, p_provider_run_id TEXT,
    p_provider_stop_event_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
BEGIN
    -- No official Provider STOP verifier is connected in this candidate.
    -- Non-empty caller strings are not attestation and must never release the
    -- active-writer fence. Keep the claim in reconciliation until a verified
    -- server-side provider event adapter is available.
    RETURN false;
END;
$$;

COMMIT;
