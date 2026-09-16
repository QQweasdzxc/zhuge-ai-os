-- Investment projection authenticated-read hotfix v1
--
-- The canonical calculation function is invoked through the public
-- investment_current_positions_view.  Its owner-scoped query already derives
-- v_owner_id from auth.uid() and rejects anonymous calls.  Run it as a fixed
-- search_path SECURITY DEFINER so that it can read the private lifecycle
-- contract without granting authenticated users direct access to that table.
-- This changes no Investment Product Data and does not create another source
-- of truth or calculation authority.

begin;

alter function public.investment_calculated_positions()
  security definer;

alter function public.investment_calculated_positions()
  set search_path = pg_catalog, public, auth, extensions, private, pg_temp;

revoke all on function public.investment_calculated_positions() from public, anon, authenticated;
grant execute on function public.investment_calculated_positions() to authenticated, service_role;

comment on function public.investment_calculated_positions() is
  'Canonical owner-scoped Investment calculation. SECURITY DEFINER is required only to read private lifecycle policy metadata; auth.uid() and owner scoping remain mandatory and anonymous execution is denied.';

commit;
