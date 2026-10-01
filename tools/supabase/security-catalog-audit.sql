-- READ-ONLY Supabase security catalog audit.
-- Run only against a controlled target with an approved read-only connection.
-- This file contains no DDL/DML and never returns secret values.

select
  schemaname,
  viewname,
  viewowner,
  definition
from pg_catalog.pg_views
where schemaname = 'public'
  and viewname in ('current_positions_view', 'holdings_view', 'my_workspace_view');

select
  n.nspname as schema_name,
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as runtime_config,
  coalesce(array_to_string(p.proacl, E'\n'), '') as grants
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname = 'next_knowledge_id'
    or p.proname in ('claim_legacy_workspace', 'get_my_workspace_summary', 'link_workspace_identity')
  );

select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_catalog.pg_policies
where schemaname = 'public'
order by tablename, policyname;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_catalog.pg_indexes
where schemaname = 'public'
order by tablename, indexname;
