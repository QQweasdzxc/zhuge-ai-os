-- SECURITY HARDENING CANDIDATE ROLLBACK — MANUAL PM/DBA APPROVAL ONLY
--
-- Never run automatically.  This restores the historical Cloud grants and
-- mutable view/search_path posture only when a controlled rollback decision is
-- recorded.  It does not restore or alter product rows.

begin;

do $$
declare
  view_name text;
  function_signature regprocedure;
  function_name text;
begin
  foreach view_name in array array[
    'public.current_positions_view',
    'public.holdings_view',
    'public.my_workspace_view'
  ] loop
    if to_regclass(view_name) is not null then
      execute format('alter view %s reset (security_invoker)', view_name);
      execute format('grant select on table %s to anon, authenticated', view_name);
    end if;
  end loop;

  for function_signature in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'next_knowledge_id'
      and p.prokind = 'f'
  loop
    execute format('alter function %s reset search_path', function_signature);
  end loop;

  for function_signature, function_name in
    select p.oid::regprocedure, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_legacy_workspace',
        'get_my_workspace_summary',
        'link_workspace_identity'
      )
      and p.prokind = 'f'
  loop
    execute format(
      'grant execute on function %s to anon, authenticated',
      function_signature
    );
  end loop;
end
$$;

commit;
