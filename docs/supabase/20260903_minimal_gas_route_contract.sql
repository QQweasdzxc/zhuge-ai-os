-- Minimal GAS Consumer Route Contract
--
-- This migration is intentionally limited to the two RPCs needed to route
-- the existing PM-created GAS C Consumer to WorkLog / 庶務行政. It does not
-- provision, rename, archive, delete, or create another Board Instance.
-- Existing board_instance_id, child rows, card identity, and business data
-- remain unchanged.

begin;

-- The route assignment RPC records a board_instance audit event. Extend only
-- the existing audit vocabulary required for that event; no audit rows are
-- rewritten.
alter table public.engineering_activity_log
  drop constraint if exists engineering_activity_log_entity_type_check;

alter table public.engineering_activity_log
  add constraint engineering_activity_log_entity_type_check
  check (entity_type = any (array[
    'knowledge', 'feature', 'work_item', 'qa', 'member', 'board_task',
    'engineering_checklist_item', 'engineering_governance_authorization',
    'engineering_artifact', 'board_workspace', 'board_instance'
  ]));

-- Read the active, non-template C Consumer for one canonical application
-- route. Access remains owner/engineering scoped by the existing predicate.
create or replace function public.board_resolve_consumer_instance(
  p_application_scope text
)
returns public.board_instances
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
  select instance.*
  from public.board_instances instance
  where instance.active = true
    and instance.is_template_instance = false
    and lower(btrim(instance.legacy_application_scope)) = lower(btrim(p_application_scope))
    and lower(btrim(instance.template_key)) = 'c'
    and public.board_instance_can_read(instance.id)
  limit 1;
$function$;

-- Assign or move one existing C Consumer to a route. The Board Instance UUID
-- is never changed. A transaction advisory lock plus the normalized conflict
-- check makes route assignment deterministic under concurrent submissions.
create or replace function public.board_assign_consumer_scope(
  p_board_instance_id uuid,
  p_application_scope text
)
returns public.board_instances
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $function$
declare
  v_scope text := lower(btrim(coalesce(p_application_scope, '')));
  v_instance public.board_instances%rowtype;
  v_existing public.board_instances%rowtype;
  v_before_scope text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated Board Consumer owner is required';
  end if;
  if v_scope !~ '^[a-z][a-z0-9_-]{1,63}$' then
    raise exception using errcode = '22023', message = 'Board Consumer route must be a 2-64 character lowercase slug';
  end if;
  if v_scope in ('ai_board', 'worktodo') then
    raise exception using errcode = '42501', message = 'Canonical compatibility Board route cannot be reassigned';
  end if;

  perform pg_advisory_xact_lock(hashtext('board:consumer-route:' || v_scope));

  select * into v_instance
  from public.board_instances
  where id = p_board_instance_id
  for update;

  if not found or not v_instance.active or v_instance.is_template_instance
     or lower(v_instance.template_key) <> 'c' then
    raise exception using errcode = 'P0002', message = 'Active C Board Consumer was not found';
  end if;
  if not public.board_instance_can_write(v_instance.id) then
    raise exception using errcode = '42501', message = 'Board Consumer owner authorization is required';
  end if;
  if lower(coalesce(v_instance.legacy_application_scope, '')) in ('ai_board', 'worktodo') then
    raise exception using errcode = '42501', message = 'Canonical compatibility Board route cannot be reassigned';
  end if;

  select * into v_existing
  from public.board_instances
  where active = true
    and is_template_instance = false
    and lower(btrim(legacy_application_scope)) = v_scope
    and id <> v_instance.id
  for update;
  if found then
    raise exception using errcode = '23505', message = 'Board Consumer route is already occupied';
  end if;

  if lower(coalesce(v_instance.legacy_application_scope, '')) = v_scope then
    return v_instance;
  end if;

  v_before_scope := v_instance.legacy_application_scope;
  update public.board_instances
  set legacy_application_scope = v_scope,
      updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_instance', v_instance.id::text, 'board_consumer_route_assigned',
    jsonb_build_object('legacy_application_scope', v_before_scope),
    jsonb_build_object('legacy_application_scope', v_scope),
    'C Consumer route assigned through the authenticated Board route contract',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return v_instance;
end;
$function$;

revoke all on function public.board_resolve_consumer_instance(text) from public, anon;
grant execute on function public.board_resolve_consumer_instance(text) to authenticated;
revoke all on function public.board_assign_consumer_scope(uuid, text) from public, anon;
grant execute on function public.board_assign_consumer_scope(uuid, text) to authenticated;

commit;
