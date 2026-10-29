-- TaskFlow Native Dispatch caller ACL (candidate only, NOT installed by any overlay).
--
-- Purpose: let the existing application role taskflow_runtime reach the owner-only
-- Dispatch ledger ONLY through ten reviewed functions. The ledger table stays
-- owner-only. Requires taskflow_native_dispatch_authority_candidate.sql to be
-- installed first. Do NOT re-run that file after this one: its CREATE OR REPLACE
-- resets the functions to SECURITY INVOKER and its ACL block revokes the grants.
-- Re-running THIS file is safe and idempotent.
--
-- Hard coupling: the md5 pins of the 8 base function bodies, the overlay ACK body, the rollback and
-- the postflight are tied to the exact reviewed base candidate. ANY change to the base SQL must update
-- these pins, the overlay and the rollback together, and be re-reviewed. When the base itself later
-- carries the ACK session predicate, remove this duplicate overlay and re-review the pins against the
-- new base; never loosen a guard to make an install pass.
--
-- Limits (read before approving):
--  * SECURITY DEFINER narrows the ledger path; it does NOT authenticate the caller.
--    taskflow_runtime already has DML on issue/comment/queue/activity. A compromised
--    runtime can still call these functions with forged arguments. Provider/ACK
--    identity proof is a separate, still-missing verifier and is not added here.
--  * confirm_dispatch_stop stays the original stub that returns false.
--  * No new role, password, connection or secret. Role existence/ownership is a
--    source assumption until checked against the real database before install.
--  * search_path is fixed to taskflow, pg_catalog, pg_temp (temp LAST). Every
--    relation and type in the function bodies is schema-qualified.
BEGIN;

DO $caller_acl_owner$
BEGIN
    IF current_user <> 'taskflow_migrator' OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user
        AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
        RAISE EXCEPTION 'caller ACL requires restricted taskflow_migrator owner';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'taskflow_runtime') THEN
        RAISE EXCEPTION 'caller ACL requires existing taskflow_runtime role';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace
        WHERE nspname = 'taskflow' AND nspowner = current_user::regrole) THEN
        RAISE EXCEPTION 'caller ACL schema owner mismatch';
    END IF;
    IF pg_catalog.to_regclass('taskflow.dispatch_intent') IS NULL OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'taskflow.dispatch_intent'::regclass
        AND c.relowner = current_user::regrole) THEN
        RAISE EXCEPTION 'caller ACL requires migrator-owned dispatch_intent ledger';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='taskflow' AND p.proowner = current_user::regrole AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop'])) <> 8 THEN
        RAISE EXCEPTION 'caller ACL requires the 8 migrator-owned dispatch functions';
    END IF;
    -- Refuse if the ledger already carries any non-owner ACL (no table ACL changes authorized).
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c,
        LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r',c.relowner))) a
        WHERE c.oid='taskflow.dispatch_intent'::regclass AND a.grantee <> c.relowner
    ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='taskflow.dispatch_intent'::regclass AND a.attacl IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'dispatch ledger ACL drift; no table ACL changes authorized';
    END IF;
END
$caller_acl_owner$;


-- Pin the reviewed base: every one of the 8 function bodies must be byte-identical (md5 of
-- prosrc) to the reviewed base candidate, except record_dispatch_provider_ack which may already
-- carry this overlay's one-predicate patch. Any other body is refused (drift or wrong order).
DO $caller_acl_pin$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT e.name, e.base_md5, p.oid, pg_catalog.md5(p.prosrc) AS cur
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
        LEFT JOIN pg_catalog.pg_proc p ON p.proname = e.name
            AND p.pronamespace = 'taskflow'::regnamespace
    LOOP
        IF r.cur IS NULL OR (r.cur <> r.base_md5 AND NOT (r.name = 'record_dispatch_provider_ack'
                                                          AND r.cur = '6d5d38eaaadc9c1adec28bfdf981caaa')) THEN
            RAISE EXCEPTION 'dispatch base function % does not match the reviewed base body', r.name;
        END IF;
    END LOOP;
END
$caller_acl_pin$;

-- The ONLY change to a base body: Provider ACK must come from the session bound earlier by
-- bind_dispatch_provider_route (base body plus one predicate, provider_session_id = p_provider_session_id).
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
       AND provider_session_id = p_provider_session_id
       AND provider_run_id IS NULL AND provider_ack_event_id IS NULL;
    RETURN FOUND;
END;
$$;

-- 8 existing state transitions: bodies unchanged, execution identity -> owner.
ALTER FUNCTION taskflow.claim_dispatch_intent(TEXT, UUID, UUID, TEXT, TEXT, TEXT, INTEGER)
    SECURITY DEFINER SET search_path = taskflow, pg_catalog, pg_temp;
ALTER FUNCTION taskflow.bind_dispatch_provider_route(UUID, UUID, BIGINT, TEXT, TEXT)
    SECURITY DEFINER SET search_path = taskflow, pg_catalog, pg_temp;
ALTER FUNCTION taskflow.begin_dispatch_provider(UUID, UUID, BIGINT, TEXT, TEXT)
    SECURITY DEFINER SET search_path = taskflow, pg_catalog, pg_temp;
ALTER FUNCTION taskflow.record_dispatch_provider_ack(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT)
    SECURITY DEFINER SET search_path = taskflow, pg_catalog, pg_temp;
ALTER FUNCTION taskflow.renew_dispatch_lease(UUID, UUID, BIGINT, INTEGER)
    SECURITY DEFINER SET search_path = taskflow, pg_catalog, pg_temp;
ALTER FUNCTION taskflow.record_dispatch_reconciliation(UUID, UUID, BIGINT, TEXT, TEXT)
    SECURITY DEFINER SET search_path = taskflow, pg_catalog, pg_temp;
ALTER FUNCTION taskflow.stop_dispatch_intent(UUID, BIGINT, TEXT)
    SECURITY DEFINER SET search_path = taskflow, pg_catalog, pg_temp;
ALTER FUNCTION taskflow.confirm_dispatch_stop(UUID, BIGINT, TEXT, TEXT)
    SECURITY DEFINER SET search_path = taskflow, pg_catalog, pg_temp;

-- Report gate 1: lock the claim's ledger row for the writer transaction. The caller must present
-- the claim's own lease, fence, Provider run/session and ACK ids. Only a live, acknowledged,
-- unstopped, unverified-stop match is locked (until the caller's transaction ends) and returns four
-- scope fields. Unknown/stale/forged input returns zero rows and takes no lock, so this is not a
-- way to discover or fence someone else's claim from a dispatch id alone.
CREATE OR REPLACE FUNCTION taskflow.lock_dispatch_for_report(
    p_dispatch_id UUID, p_lease_id UUID, p_fencing_epoch BIGINT,
    p_provider_run_id TEXT, p_provider_session_id TEXT, p_provider_ack_event_id TEXT
)
RETURNS TABLE (workspace_id TEXT, issue_id TEXT, executor_id TEXT, provider TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = taskflow, pg_catalog, pg_temp
AS $$
    SELECT d.workspace_id::text, d.issue_id::text, d.executor_id, d.provider
      FROM taskflow.dispatch_intent AS d
     WHERE d.id = p_dispatch_id AND d.lease_id = p_lease_id AND d.fencing_epoch = p_fencing_epoch
       AND d.provider_run_id = p_provider_run_id AND d.provider_session_id = p_provider_session_id
       AND d.provider_ack_event_id = p_provider_ack_event_id
       AND d.state IN ('provider_acknowledged', 'provider_started')
       AND d.lease_expires_at > pg_catalog.now() AND d.stop_requested_at IS NULL
       AND NOT d.provider_stop_verified
       FOR UPDATE
$$;

-- Report gate 2: the single conditional UPDATE the writer commits with.
CREATE OR REPLACE FUNCTION taskflow.mark_dispatch_report_committed(
    p_dispatch_id UUID, p_lease_id UUID, p_fencing_epoch BIGINT,
    p_provider_run_id TEXT, p_provider_session_id TEXT, p_provider_ack_event_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = taskflow, pg_catalog, pg_temp
AS $$
BEGIN
    UPDATE taskflow.dispatch_intent AS d
       SET native_write_state = 'committed', updated_at = pg_catalog.now()
     WHERE d.id = p_dispatch_id AND d.lease_id = p_lease_id AND d.fencing_epoch = p_fencing_epoch
       AND d.provider_run_id = p_provider_run_id AND d.provider_session_id = p_provider_session_id
       AND d.provider_ack_event_id = p_provider_ack_event_id
       AND d.state IN ('provider_acknowledged', 'provider_started')
       AND d.lease_expires_at > pg_catalog.now() AND d.stop_requested_at IS NULL;
    RETURN FOUND;
END;
$$;

-- ACL: same transaction as CREATE, so there is no PUBLIC-EXECUTE window.
DO $caller_acl$
DECLARE f record; recipient record;
BEGIN
    FOR f IN
        SELECT p.oid, p.proowner FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='taskflow' AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop',
            'lock_dispatch_for_report','mark_dispatch_report_committed'])
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
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO taskflow_runtime', f.oid::regprocedure);
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proname = 'record_dispatch_provider_ack'
        AND p.pronamespace = 'taskflow'::regnamespace AND pg_catalog.md5(p.prosrc) <> '6d5d38eaaadc9c1adec28bfdf981caaa') THEN
        RAISE EXCEPTION 'record_dispatch_provider_ack is not the pinned session-bound body';
    END IF;
    -- Guard: exactly 10 functions, definer, fixed search_path, runtime-only EXECUTE.
    IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='taskflow' AND p.prosecdef AND p.proowner = current_user::regrole
        AND p.proconfig = ARRAY['search_path=taskflow, pg_catalog, pg_temp']
        AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop',
            'lock_dispatch_for_report','mark_dispatch_report_committed'])) <> 10 THEN
        RAISE EXCEPTION 'dispatch caller functions are not the expected 10 definer functions';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
        LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE n.nspname='taskflow' AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop',
            'lock_dispatch_for_report','mark_dispatch_report_committed'])
        AND a.grantee <> p.proowner
        AND NOT (a.grantee = 'taskflow_runtime'::regrole AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable)
    ) THEN
        RAISE EXCEPTION 'dispatch caller ACL has a grantee other than taskflow_runtime EXECUTE';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace,
        LATERAL pg_catalog.aclexplode(p.proacl) a
        WHERE n.nspname='taskflow' AND a.grantee = 'taskflow_runtime'::regrole
        AND p.proname = ANY (ARRAY[
            'claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop',
            'lock_dispatch_for_report','mark_dispatch_report_committed'])) <> 10 THEN
        RAISE EXCEPTION 'taskflow_runtime must hold EXECUTE on exactly the 10 dispatch caller functions';
    END IF;
END
$caller_acl$;

COMMIT;
