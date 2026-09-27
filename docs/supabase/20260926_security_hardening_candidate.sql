-- SECURITY HARDENING CANDIDATE — NOT APPLIED
--
-- This migration is intentionally conditional because the three Advisor view
-- findings and the legacy identity functions are retained Cloud objects that
-- are not part of the current repository source.  It is safe to dry-run in a
-- controlled database clone and is not a production deployment command.
--
-- Scope:
--   * make the retained legacy Investment views security-invoker views;
--   * remove anonymous/public read access from those views;
--   * pin next_knowledge_id search_path when the function exists;
--   * retire legacy identity claim/link execution while retaining the
--     authenticated read summary only for compatibility review.
--
-- No product rows are inserted, updated, deleted, or migrated.

begin;

do $$
declare
  view_name text;
  function_signature regprocedure;
  function_name text;
begin
  -- Advisor 0010 candidates.  Current source already declares the modern
  -- investment_current_positions_view and current_broker_positions_view as
  -- security-invoker; these names are the retained legacy Cloud objects from
  -- the Advisor evidence and are therefore guarded by existence checks.
  foreach view_name in array array[
    'public.current_positions_view',
    'public.holdings_view',
    'public.my_workspace_view'
  ] loop
    if to_regclass(view_name) is not null then
      execute format('alter view %s set (security_invoker = true)', view_name);
      execute format('revoke all on table %s from public, anon', view_name);
      execute format('grant select on table %s to authenticated', view_name);
    end if;
  end loop;

  -- Advisor mutable-search-path candidate.  Do not assume a signature: the
  -- catalog loop handles an overloaded retained function without exposing or
  -- changing any function body.
  for function_signature in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'next_knowledge_id'
      and p.prokind = 'f'
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, auth, extensions, private, pg_temp',
      function_signature
    );
  end loop;

  -- Advisor 0028/0029 candidates.  Resolve every overload by name so the
  -- candidate cannot leave an unreviewed legacy overload executable.
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
      'revoke execute on function %s from public, anon',
      function_signature
    );

    if function_name = 'get_my_workspace_summary' then
      -- Temporary compatibility only; current source must not introduce new
      -- callers.  The legacy claim/link writers are fully retired below.
      execute format(
        'grant execute on function %s to authenticated',
        function_signature
      );
    else
      execute format(
        'revoke execute on function %s from authenticated',
        function_signature
      );
    end if;
  end loop;
end
$$;

commit;
