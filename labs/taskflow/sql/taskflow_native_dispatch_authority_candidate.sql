-- TaskFlow Native Durable Dispatch Authority (candidate only)
--
-- This migration is intentionally not installed by the overlay.  It is the
-- smallest server-owned persistence boundary required by CTODispatchIssue.
-- Installation requires the TaskFlow migrator owner and a separately approved
-- ACL review; the public runtime remains fail-closed until then.

BEGIN;

-- CO-01: no Dispatch caller has been approved. Ownership is administrative,
-- not a runtime caller grant. Do not borrow the Issue #42 Connector grant.
DO $dispatch_owner$
BEGIN
    IF current_user <> 'taskflow_migrator' OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user
        AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
        RAISE EXCEPTION 'dispatch requires restricted taskflow_migrator owner';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace
        WHERE nspname = 'taskflow' AND nspowner = current_user::regrole) THEN
        RAISE EXCEPTION 'dispatch schema owner mismatch';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='taskflow' AND c.relname='dispatch_intent'
        AND c.relowner <> current_user::regrole
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='taskflow' AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop'])
        AND p.proowner <> current_user::regrole
    ) THEN
        RAISE EXCEPTION 'dispatch existing object owner mismatch';
    END IF;
END
$dispatch_owner$;

CREATE TABLE IF NOT EXISTS taskflow.dispatch_intent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_key TEXT NOT NULL,
    request_payload_hash TEXT NOT NULL,
    issue_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    executor_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'claimed'
        CHECK (state IN ('claimed', 'provider_start_requested', 'provider_acknowledged', 'provider_started', 'stopped', 'failed', 'reconcile_required', 'completed')),
    lease_id UUID NOT NULL DEFAULT gen_random_uuid(),
    lease_expires_at TIMESTAMPTZ NOT NULL,
    fencing_epoch BIGINT NOT NULL DEFAULT 1 CHECK (fencing_epoch > 0),
    provider_run_id TEXT,
    provider_session_id TEXT,
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
ALTER TABLE taskflow.dispatch_intent
    ADD COLUMN IF NOT EXISTS provider_session_id TEXT;

-- Preserve compatibility with a previously installed candidate while making
-- the state distinction explicit: start authorization is not Provider ACK.
ALTER TABLE taskflow.dispatch_intent
    DROP CONSTRAINT IF EXISTS dispatch_intent_state_check;
ALTER TABLE taskflow.dispatch_intent
    ADD CONSTRAINT dispatch_intent_state_check
    CHECK (state IN ('claimed', 'provider_start_requested', 'provider_acknowledged', 'provider_started', 'stopped', 'failed', 'reconcile_required', 'completed'));

DROP INDEX IF EXISTS taskflow.dispatch_intent_one_active_writer;
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_intent_one_active_writer
    ON taskflow.dispatch_intent (issue_id)
    WHERE state IN ('claimed', 'provider_start_requested', 'provider_acknowledged', 'provider_started', 'reconcile_required');

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
    request_payload_hash TEXT;
BEGIN
    IF p_request_key IS NULL OR btrim(p_request_key) = '' OR length(p_request_key) > 200
       OR btrim(coalesce(p_cto_principal, '')) = ''
       OR btrim(coalesce(p_executor_id, '')) = '' OR btrim(coalesce(p_provider, '')) = ''
       OR p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid dispatch claim request';
    END IF;

    request_payload_hash := encode(sha256(convert_to(
        p_issue_id::text || ':' || p_workspace_id::text || ':' || p_executor_id || ':' || p_provider || ':' || p_cto_principal,
        'UTF8'
    )), 'hex');

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
        IF existing.request_payload_hash <> request_payload_hash THEN
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
        request_payload_hash,
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
        IF existing.request_payload_hash <> request_payload_hash THEN
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

CREATE OR REPLACE FUNCTION taskflow.bind_dispatch_provider_route(
    p_dispatch_id UUID,
    p_lease_id UUID,
    p_fencing_epoch BIGINT,
    p_provider TEXT,
    p_provider_session_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
BEGIN
    IF p_dispatch_id IS NULL OR p_lease_id IS NULL OR p_fencing_epoch IS NULL OR p_fencing_epoch <= 0
       OR btrim(coalesce(p_provider, '')) = '' OR btrim(coalesce(p_provider_session_id, '')) = '' THEN
        RETURN false;
    END IF;
    UPDATE taskflow.dispatch_intent
       SET provider_session_id = p_provider_session_id, updated_at = now()
     WHERE id = p_dispatch_id AND lease_id = p_lease_id AND fencing_epoch = p_fencing_epoch
       AND provider = p_provider AND state = 'claimed' AND lease_expires_at > now()
       AND stop_requested_at IS NULL AND provider_start_requested_at IS NULL
       AND provider_run_id IS NULL AND provider_ack_event_id IS NULL
       AND (provider_session_id IS NULL OR provider_session_id = p_provider_session_id);
    RETURN FOUND;
END;
$$;

-- The provider boundary may be crossed only by the first caller holding this
-- live claim and the same server-verified session bound above. Replays receive
-- the same intent but cannot start a second Provider Run.
DROP FUNCTION IF EXISTS taskflow.begin_dispatch_provider(UUID, UUID, BIGINT);
CREATE OR REPLACE FUNCTION taskflow.begin_dispatch_provider(
    p_dispatch_id UUID,
    p_lease_id UUID,
    p_fencing_epoch BIGINT,
    p_provider TEXT,
    p_provider_session_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
BEGIN
    UPDATE taskflow.dispatch_intent
       SET state = 'provider_start_requested', provider_start_requested_at = now(), updated_at = now()
     WHERE id = p_dispatch_id AND lease_id = p_lease_id
       AND fencing_epoch = p_fencing_epoch
       AND provider = p_provider AND provider_session_id = p_provider_session_id
       AND lease_expires_at > now()
       AND state = 'claimed'
       AND provider_start_requested_at IS NULL
       AND provider_run_id IS NULL
       AND provider_ack_event_id IS NULL
       AND stop_requested_at IS NULL;
    RETURN FOUND;
END;
$$;

-- Provider ACK is persisted only after the trusted server-side Provider
-- adapter returns a verified Run/Event pair. This row is not written by UI or
-- client metadata. Replaying the exact ACK is idempotent.
CREATE OR REPLACE FUNCTION taskflow.record_dispatch_provider_ack(
    p_dispatch_id UUID,
    p_lease_id UUID,
    p_fencing_epoch BIGINT,
    p_provider TEXT,
    p_provider_session_id TEXT,
    p_provider_run_id TEXT,
    p_provider_ack_event_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = taskflow, pg_catalog
AS $$
BEGIN
    IF p_dispatch_id IS NULL OR p_lease_id IS NULL OR p_fencing_epoch IS NULL OR p_fencing_epoch <= 0
       OR btrim(coalesce(p_provider, '')) = '' OR btrim(coalesce(p_provider_session_id, '')) = ''
       OR btrim(coalesce(p_provider_run_id, '')) = '' OR btrim(coalesce(p_provider_ack_event_id, '')) = '' THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1 FROM taskflow.dispatch_intent
         WHERE id = p_dispatch_id AND lease_id = p_lease_id AND fencing_epoch = p_fencing_epoch
           AND state = 'provider_acknowledged' AND lease_expires_at > now()
           AND provider = p_provider AND provider_session_id = p_provider_session_id
           AND provider_run_id = p_provider_run_id AND provider_ack_event_id = p_provider_ack_event_id
    ) THEN
        RETURN true;
    END IF;

    UPDATE taskflow.dispatch_intent
       SET state = 'provider_acknowledged', provider_session_id = p_provider_session_id, provider_run_id = p_provider_run_id,
           provider_ack_event_id = p_provider_ack_event_id, updated_at = now()
     WHERE id = p_dispatch_id AND lease_id = p_lease_id AND fencing_epoch = p_fencing_epoch
       AND state = 'provider_start_requested' AND provider_start_requested_at IS NOT NULL
       AND lease_expires_at > now() AND stop_requested_at IS NULL
       AND provider = p_provider
       AND provider_run_id IS NULL AND provider_ack_event_id IS NULL;
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
       AND state IN ('claimed', 'provider_start_requested', 'provider_acknowledged', 'provider_started', 'reconcile_required');
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
       AND state IN ('claimed', 'provider_start_requested', 'provider_acknowledged', 'provider_started', 'reconcile_required');
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
       AND state IN ('claimed', 'provider_start_requested', 'provider_acknowledged', 'provider_started', 'reconcile_required');
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

-- CREATE OR REPLACE preserves existing ACLs. Remove PUBLIC and every
-- explicit non-owner function ACL, including unexpected prior recipients.
-- This block touches only the eight Dispatch function names. No GRANT follows.
DO $dispatch_acl$
DECLARE f record; recipient record;
BEGIN
    FOR f IN
        SELECT p.oid, p.proowner FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='taskflow' AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop'])
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.oid::regprocedure);
        FOR recipient IN
            SELECT DISTINCT a.grantee FROM pg_catalog.pg_proc p,
            LATERAL pg_catalog.aclexplode(p.proacl) a
            WHERE p.oid=f.oid AND a.grantee <> 0 AND a.grantee <> f.proowner
        LOOP
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I CASCADE',
                f.oid::regprocedure, pg_catalog.pg_get_userbyid(recipient.grantee));
        END LOOP;
    END LOOP;
    -- Ledger ACL drift is a refusal, not permission to alter table/shared ACLs.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
        LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r',c.relowner))) a
        WHERE n.nspname='taskflow' AND c.relname='dispatch_intent' AND a.grantee <> c.relowner
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='taskflow.dispatch_intent'::regclass AND a.attacl IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(a.attacl) x
                    WHERE x.grantee <> current_user::regrole)
    ) THEN
        RAISE EXCEPTION 'dispatch ledger ACL drift; no table ACL changes authorized';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
        LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE n.nspname='taskflow' AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop']) AND a.grantee <> p.proowner
    ) THEN
        RAISE EXCEPTION 'dispatch function ACL did not close';
    END IF;
END
$dispatch_acl$;

COMMIT;
