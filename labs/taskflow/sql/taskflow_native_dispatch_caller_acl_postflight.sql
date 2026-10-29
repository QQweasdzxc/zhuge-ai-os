-- Postflight for the caller ACL candidate END STATE (metadata only, read-only, no ledger rows).
-- Raises an error (psql ON_ERROR_STOP) unless the database is in the B end state. Run it after the
-- install, and after ANY re-run of the base candidate: a base re-run silently dismantles B.
-- The original taskflow_native_dispatch_authority_postflight.sql describes the BASE end state
-- (no runtime EXECUTE) and must not be used to judge B.
BEGIN TRANSACTION READ ONLY;
DO $caller_acl_post$
BEGIN
    IF (SELECT count(*) FROM (VALUES
        ('claim_dispatch_intent','833ccc09f211c7a2d90b730ea3d17904'),
        ('bind_dispatch_provider_route','8412136b732ebff0ad38fe7d361e7d8d'),
        ('begin_dispatch_provider','3d732a70b7540438ecced37e6420c2e0'),
        ('record_dispatch_provider_ack','6d5d38eaaadc9c1adec28bfdf981caaa'),
        ('renew_dispatch_lease','9e5260b1c28e81b7e90e1686f2e905be'),
        ('record_dispatch_reconciliation','fb0d14d363df256358c5a0908001f7b4'),
        ('stop_dispatch_intent','319377783a359e5a105ce7cec554c087'),
        ('confirm_dispatch_stop','2e85bbdc3e6f84b49eced1ed5f2cee12')
        ) AS e(name, md5)
        JOIN pg_catalog.pg_proc p ON p.proname = e.name AND p.pronamespace = 'taskflow'::regnamespace
        WHERE pg_catalog.md5(p.prosrc) = e.md5 AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=taskflow, pg_catalog, pg_temp']) <> 8 THEN
        RAISE EXCEPTION 'POSTFLIGHT FAIL: 8 base functions are not the pinned definer bodies (base re-run or drift?)';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace='taskflow'::regnamespace
        AND p.prosecdef AND p.proconfig = ARRAY['search_path=taskflow, pg_catalog, pg_temp']
        AND p.proname IN ('lock_dispatch_for_report','mark_dispatch_report_committed')) <> 2 THEN
        RAISE EXCEPTION 'POSTFLIGHT FAIL: report gates missing or not definer with fixed search_path';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(p.proacl) a
        WHERE p.pronamespace='taskflow'::regnamespace AND a.grantee = 'taskflow_runtime'::regrole
        AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
        AND p.proname = ANY (ARRAY['claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop','lock_dispatch_for_report','mark_dispatch_report_committed'])) <> 10
       OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
        WHERE p.pronamespace='taskflow'::regnamespace AND a.grantee NOT IN (p.proowner, 'taskflow_runtime'::regrole)
        AND p.proname = ANY (ARRAY['claim_dispatch_intent','bind_dispatch_provider_route','begin_dispatch_provider',
            'record_dispatch_provider_ack','renew_dispatch_lease','record_dispatch_reconciliation',
            'stop_dispatch_intent','confirm_dispatch_stop','lock_dispatch_for_report','mark_dispatch_report_committed'])) THEN
        RAISE EXCEPTION 'POSTFLIGHT FAIL: runtime must hold EXECUTE on exactly the 10 functions and nobody else';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r',c.relowner))) a
        WHERE c.oid='taskflow.dispatch_intent'::regclass AND a.grantee <> c.relowner
    ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='taskflow.dispatch_intent'::regclass AND a.attacl IS NOT NULL) THEN
        RAISE EXCEPTION 'POSTFLIGHT FAIL: dispatch ledger is not owner-only';
    END IF;
    RAISE NOTICE 'caller ACL postflight metadata checks passed (not production verification)';
END
$caller_acl_post$;
COMMIT;
