-- CO-01 metadata only. No Ledger rows, DDL, DML, Provider or installer access.
-- READY means metadata checks only, never production or STEP1_SOURCE_READY.
-- An external rollback script cannot be attested from database metadata.
BEGIN TRANSACTION READ ONLY;
WITH expected_functions(name, args) AS (VALUES
 ('claim_dispatch_intent','text, uuid, uuid, text, text, text, integer'),
 ('bind_dispatch_provider_route','uuid, uuid, bigint, text, text'),
 ('begin_dispatch_provider','uuid, uuid, bigint, text, text'),
 ('record_dispatch_provider_ack','uuid, uuid, bigint, text, text, text, text'),
 ('renew_dispatch_lease','uuid, uuid, bigint, integer'),
 ('record_dispatch_reconciliation','uuid, uuid, bigint, text, text'),
 ('stop_dispatch_intent','uuid, bigint, text'),
 ('confirm_dispatch_stop','uuid, bigint, text, text')
), expected_roles(name) AS (VALUES
 ('taskflow_migrator'),('taskflow_runtime'),('anon'),('authenticated'),('service_role'),('postgres')
), expected_columns(name, typ, required) AS (VALUES
 ('id','uuid',true),('request_key','text',true),('request_payload_hash','text',true),
 ('issue_id','uuid',true),('workspace_id','uuid',true),('executor_id','text',true),
 ('provider','text',true),('state','text',true),('lease_id','uuid',true),
 ('lease_expires_at','timestamp with time zone',true),('fencing_epoch','bigint',true),
 ('provider_run_id','text',false),('provider_session_id','text',false),
 ('provider_ack_event_id','text',false),('provider_start_requested_at','timestamp with time zone',false),
 ('cto_principal','text',true),('native_write_state','text',true),('stop_reason','text',false),
 ('stop_requested_at','timestamp with time zone',false),('provider_stop_verified','boolean',true),
 ('reconciliation_reason','text',false),('created_at','timestamp with time zone',true),
 ('updated_at','timestamp with time zone',true)
), ledger AS (
 SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='taskflow' AND c.relname='dispatch_intent'
), functions AS (
 SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='taskflow' AND p.proname IN (SELECT name FROM expected_functions)
), roles AS (
 SELECT r.* FROM pg_catalog.pg_roles r JOIN expected_roles e ON e.name=r.rolname
), problems(reason) AS (
 SELECT 'missing_role:'||e.name FROM expected_roles e
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.rolname=e.name)
 UNION ALL
 SELECT 'schema_owner' WHERE NOT EXISTS (
 SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='taskflow'
 AND pg_catalog.pg_get_userbyid(nspowner)='taskflow_migrator')
 UNION ALL
 SELECT 'ledger_owner_or_kind' WHERE NOT EXISTS (SELECT 1 FROM ledger
 WHERE relkind='r' AND relpersistence='p' AND pg_catalog.pg_get_userbyid(relowner)='taskflow_migrator')
 UNION ALL
 SELECT 'column:'||e.name FROM expected_columns e WHERE NOT EXISTS (
 SELECT 1 FROM ledger l JOIN pg_catalog.pg_attribute a ON a.attrelid=l.oid
 WHERE a.attname=e.name AND NOT a.attisdropped AND a.attnotnull=e.required
 AND pg_catalog.format_type(a.atttypid,a.atttypmod)=e.typ)
 UNION ALL
 SELECT 'function_count' WHERE (SELECT count(*) FROM functions)<>8
 UNION ALL
 SELECT 'signature:'||e.name FROM expected_functions e WHERE NOT EXISTS (
 SELECT 1 FROM functions f WHERE f.proname=e.name
 AND pg_catalog.oidvectortypes(f.proargtypes)=e.args AND f.prokind='f'
 AND pg_catalog.format_type(f.prorettype,NULL)=CASE WHEN e.name='claim_dispatch_intent'
 THEN 'taskflow.dispatch_intent' ELSE 'boolean' END)
 UNION ALL
 SELECT 'function_security:'||f.proname FROM functions f
 WHERE pg_catalog.pg_get_userbyid(f.proowner)<>'taskflow_migrator' OR f.prosecdef
 OR f.proconfig IS DISTINCT FROM ARRAY['search_path=taskflow, pg_catalog']::text[]
 UNION ALL
 SELECT 'function_acl:'||f.proname FROM functions f,
 LATERAL pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
 WHERE a.grantee<>f.proowner
 UNION ALL
 SELECT 'ledger_acl' FROM ledger l,
 LATERAL pg_catalog.aclexplode(coalesce(l.relacl,pg_catalog.acldefault('r',l.relowner))) a
 WHERE a.grantee<>l.relowner
 UNION ALL
 SELECT 'column_acl:'||a.attname FROM ledger l JOIN pg_catalog.pg_attribute a ON a.attrelid=l.oid,
 LATERAL pg_catalog.aclexplode(a.attacl) x WHERE x.grantee<>l.relowner
 UNION ALL
 SELECT 'effective_execute:'||r.rolname||':'||f.proname FROM roles r CROSS JOIN functions f
 WHERE r.rolname<>'taskflow_migrator' AND pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')
 UNION ALL
 SELECT 'effective_ledger:'||r.rolname FROM roles r CROSS JOIN ledger l
 WHERE r.rolname<>'taskflow_migrator' AND (
 pg_catalog.has_table_privilege(r.oid,l.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 OR pg_catalog.has_any_column_privilege(r.oid,l.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
 UNION ALL
 SELECT 'owner_role_contract' FROM roles r WHERE r.rolname='taskflow_migrator'
 AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
 UNION ALL
 SELECT 'runtime_role_contract' FROM roles r WHERE r.rolname='taskflow_runtime'
 AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
 UNION ALL
 SELECT 'owner_membership:'||r.rolname FROM roles r CROSS JOIN roles owner_role
 WHERE r.rolname<>'taskflow_migrator' AND owner_role.rolname='taskflow_migrator'
 AND pg_catalog.pg_has_role(r.oid,owner_role.oid,'MEMBER')
 UNION ALL
 SELECT 'primary_key' WHERE NOT EXISTS (
 SELECT 1 FROM ledger l JOIN pg_catalog.pg_constraint c ON c.conrelid=l.oid
 WHERE c.contype='p' AND c.convalidated AND pg_catalog.pg_get_constraintdef(c.oid)='PRIMARY KEY (id)')
 UNION ALL
 SELECT 'request_unique' WHERE NOT EXISTS (
 SELECT 1 FROM ledger l JOIN pg_catalog.pg_constraint c ON c.conrelid=l.oid
 WHERE c.contype='u' AND c.convalidated
 AND pg_catalog.pg_get_constraintdef(c.oid)='UNIQUE (workspace_id, request_key)')
 UNION ALL
 SELECT 'fencing_check' WHERE NOT EXISTS (
 SELECT 1 FROM ledger l JOIN pg_catalog.pg_constraint c ON c.conrelid=l.oid
 WHERE c.contype='c' AND c.convalidated
 AND pg_catalog.pg_get_constraintdef(c.oid)='CHECK ((fencing_epoch > 0))')
 UNION ALL
 SELECT 'state_check' WHERE NOT EXISTS (
 SELECT 1 FROM ledger l JOIN pg_catalog.pg_constraint c ON c.conrelid=l.oid
 WHERE c.conname='dispatch_intent_state_check' AND c.contype='c' AND c.convalidated
 AND pg_catalog.pg_get_constraintdef(c.oid) =
 $$CHECK ((state = ANY (ARRAY['claimed'::text, 'provider_start_requested'::text, 'provider_acknowledged'::text, 'provider_started'::text, 'stopped'::text, 'failed'::text, 'reconcile_required'::text, 'completed'::text])))$$)
 UNION ALL
 SELECT 'native_write_check' WHERE NOT EXISTS (
 SELECT 1 FROM ledger l JOIN pg_catalog.pg_constraint c ON c.conrelid=l.oid
 WHERE c.contype='c' AND c.convalidated AND pg_catalog.pg_get_constraintdef(c.oid) =
 $$CHECK ((native_write_state = ANY (ARRAY['pending'::text, 'committed'::text, 'failed'::text])))$$)
 UNION ALL
 SELECT 'active_writer_index' WHERE NOT EXISTS (
 SELECT 1 FROM ledger l JOIN pg_catalog.pg_index i ON i.indrelid=l.oid
 JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
 WHERE idx.relname='dispatch_intent_one_active_writer' AND i.indisunique AND i.indisvalid AND i.indisready
 AND i.indnkeyatts=1 AND i.indnatts=1
 AND pg_catalog.pg_get_indexdef(i.indexrelid,1,true)='issue_id'
 AND pg_catalog.pg_get_expr(i.indpred,i.indrelid) =
 $$(state = ANY (ARRAY['claimed'::text, 'provider_start_requested'::text, 'provider_acknowledged'::text, 'provider_started'::text, 'reconcile_required'::text]))$$)
 UNION ALL
 SELECT 'stop_verifier' WHERE NOT EXISTS (SELECT 1 FROM functions
 WHERE proname='confirm_dispatch_stop' AND prosrc LIKE '%RETURN false;%'
 AND prosrc NOT ILIKE '%UPDATE taskflow.dispatch_intent%')
 UNION ALL
 -- Metadata cannot prove the contents/transaction handling of a client-side
 -- rollback file. Keep this separate evidence gap explicit and fail closed.
 SELECT 'rollback_script_requires_isolated_test'
)
SELECT CASE WHEN count(*)=0 THEN 'READY' ELSE 'NOT_READY' END AS status,
 coalesce(array_agg(DISTINCT reason ORDER BY reason) FILTER (WHERE reason IS NOT NULL),ARRAY[]::text[]) AS reasons
FROM problems;
ROLLBACK;
