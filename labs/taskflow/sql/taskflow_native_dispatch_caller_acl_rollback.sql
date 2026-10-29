-- Rollback for the caller ACL candidate. Restores the exact reviewed base end state:
-- 8 SECURITY INVOKER functions with the original bodies (including the original
-- record_dispatch_provider_ack), no non-owner EXECUTE, and the 2 report gates dropped.
-- Refuses if any base body is neither the reviewed base nor this overlay's patched ACK.
BEGIN;
DO $caller_acl_rb_pin$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT e.name, e.base_md5, pg_catalog.md5(p.prosrc) AS cur
        FROM (VALUES
        ('claim_dispatch_intent','833ccc09f211c7a2d90b730ea3d17904'),
        ('bind_dispatch_provider_route','8412136b732ebff0ad38fe7d361e7d8d'),
        ('begin_dispatch_provider','3d732a70b7540438ecced37e6420c2e0'),
        ('record_dispatch_provider_ack','760729b50f1144f62a4275b16746d1e6'),
        ('renew_dispatch_lease','9e5260b1c28e81b7e90e1686f2e905be'),
        ('record_dispatch_reconciliation','fb0d14d363df256358c5a0908001f7b4'),
        ('stop_dispatch_intent','319377783a359e5a105ce7cec554c087'),
        ('confirm_dispatch_stop','2e85bbdc3e6f84b49eced1ed5f2cee12')
        ) AS e(name, base_md5)
        LEFT JOIN pg_catalog.pg_proc p ON p.proname = e.name AND p.pronamespace = 'taskflow'::regnamespace
    LOOP
        IF r.cur IS NULL OR (r.cur <> r.base_md5 AND NOT (r.name = 'record_dispatch_provider_ack'
                                                          AND r.cur = '6d5d38eaaadc9c1adec28bfdf981caaa')) THEN
            RAISE EXCEPTION 'rollback refused: % is neither the reviewed base nor the overlay body', r.name;
        END IF;
    END LOOP;
END
$caller_acl_rb_pin$;
DROP FUNCTION IF EXISTS taskflow.lock_dispatch_for_report(UUID, UUID, BIGINT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS taskflow.mark_dispatch_report_committed(UUID, UUID, BIGINT, TEXT, TEXT, TEXT);
-- Original reviewed ACK body (byte-identical to the base candidate).
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
DO $caller_acl_rb$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='taskflow' AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop'])
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM taskflow_runtime', f.oid::regprocedure);
        EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER SET search_path = taskflow, pg_catalog', f.oid::regprocedure);
    END LOOP;
    -- Completeness check: base bodies, invoker, no non-owner ACL, gates gone.
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace='taskflow'::regnamespace
        AND p.proname IN ('lock_dispatch_for_report','mark_dispatch_report_committed')
    ) OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace='taskflow'::regnamespace
          AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=taskflow, pg_catalog']
          AND p.proname = ANY (ARRAY['claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop'])) <> 8
       OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p,
        LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
        WHERE p.pronamespace='taskflow'::regnamespace AND a.grantee <> p.proowner
        AND p.proname = ANY (ARRAY['claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop'])) THEN
        RAISE EXCEPTION 'rollback did not restore the reviewed base end state';
    END IF;
    IF (SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc WHERE proname='record_dispatch_provider_ack'
        AND pronamespace='taskflow'::regnamespace) <> '760729b50f1144f62a4275b16746d1e6' THEN
        RAISE EXCEPTION 'rollback did not restore the original ACK body';
    END IF;
END
$caller_acl_rb$;
COMMIT;
