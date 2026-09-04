-- Canonical C Consumer route and lifecycle contract.
--
-- A route is an association to an existing C Board Instance, not a second
-- Board implementation. This migration preserves the PM-created GAS C
-- Consumer, provides generic authenticated lifecycle operations, and does not
-- copy, migrate, or delete business data except an explicitly empty Consumer
-- requested through the controlled delete RPC.

begin;

alter table public.board_instances
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

-- Route identity is normalized case-insensitively for the generic lifecycle;
-- fail closed if legacy rows already contain a conflicting normalized scope.
create unique index if not exists board_instances_route_scope_lower_idx
  on public.board_instances (lower(btrim(legacy_application_scope)))
  where legacy_application_scope is not null;

-- Keep the audit vocabulary explicit before the compatibility backfill below
-- writes the first board_instance event.
alter table public.engineering_activity_log
  drop constraint if exists engineering_activity_log_entity_type_check;
alter table public.engineering_activity_log
  add constraint engineering_activity_log_entity_type_check
  check (entity_type = any (array[
    'knowledge', 'feature', 'work_item', 'qa', 'member', 'board_task',
    'engineering_checklist_item', 'engineering_governance_authorization',
    'engineering_artifact', 'board_workspace', 'board_instance'
  ]));

-- One-time association for the exact PM-created GAS C Consumer already
-- recorded by the continuation audit. No name/email heuristic or broad prefix
-- update is allowed. This is a compatibility backfill, not a GAS-specific
-- runtime branch.
do $$
declare
  v_instance public.board_instances%rowtype;
  v_before_scope text;
begin
  select * into v_instance
  from public.board_instances
  where id = '38d8d4b1-6d01-4d58-835b-b2beb61fc6b9'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PM-created GAS Board Instance was not found';
  end if;
  if not v_instance.active or v_instance.is_template_instance
     or lower(v_instance.template_key) <> 'c'
     or upper(v_instance.task_code_prefix) <> 'GAS'
     or v_instance.name <> '庶務行政' then
    raise exception using errcode = '23514', message = 'PM-created GAS Board Instance identity does not match the approved Consumer';
  end if;
  if v_instance.legacy_application_scope is not null
     and lower(v_instance.legacy_application_scope) <> 'procurement' then
    raise exception using errcode = '23514', message = 'PM-created GAS Board Instance already has a different route';
  end if;
  if v_instance.legacy_application_scope is null then
    v_before_scope := v_instance.legacy_application_scope;
    update public.board_instances
    set legacy_application_scope = 'procurement', updated_at = now()
    where id = v_instance.id;
    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_instance', v_instance.id::text, 'board_consumer_route_assigned',
      jsonb_build_object('legacy_application_scope', v_before_scope),
      jsonb_build_object('legacy_application_scope', 'procurement'),
      'Approved PM-created GAS Consumer compatibility route association',
      null, 'system', 'System', 'system_activity'
    );
  end if;
end $$;

-- Generic Consumer provisioning. Ownership/route is supplied at creation time
-- so a successful response can never represent an unowned C Consumer. The
-- registry row, four structural workspaces, and Published C adoption are one
-- transaction; the older unscoped three-argument RPC is revoked below.
create or replace function public.board_provision_consumer(
  p_name text,
  p_task_code_prefix text,
  p_template_key text,
  p_application_scope text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := upper(btrim(coalesce(p_task_code_prefix, '')));
  v_template text := lower(btrim(coalesce(p_template_key, 'c')));
  v_scope text := lower(btrim(coalesce(p_application_scope, '')));
  v_instance public.board_instances%rowtype;
  v_release public.module_releases%rowtype;
  v_adoption jsonb;
  v_workspaces jsonb;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated governance identity is required';
  end if;
  if not exists (
    select 1 from public.app_users au
    where au.auth_user_id = v_user
      and lower(trim(au.role)) in ('creator', 'owner')
  ) then
    raise exception using errcode = '42501', message = 'Creator or owner permission required to create a board';
  end if;
  if v_name = '' or v_prefix !~ '^[A-Z][A-Z0-9]{1,15}$' or v_template <> 'c' then
    raise exception using errcode = '22023', message = 'C Consumer name, prefix, and template key are required';
  end if;
  if v_scope !~ '^[a-z][a-z0-9_-]{1,63}$' or v_scope in ('ai_board', 'worktodo') then
    raise exception using errcode = '22023', message = 'A non-reserved Consumer route is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('board:consumer-route:' || v_scope));
  if exists (
    select 1 from public.board_instances instance
    where lower(coalesce(instance.legacy_application_scope, '')) = v_scope
  ) then
    raise exception using errcode = '23505', message = 'Board Consumer route is already occupied';
  end if;
  if exists (
    select 1 from public.board_instances instance
    where instance.task_code_prefix = v_prefix
  ) then
    raise exception using errcode = '23505', message = 'Board code is already in use';
  end if;

  select * into v_release
  from public.module_releases release
  where release.module_id = v_template
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Published module release is unavailable';
  end if;

  v_instance := public.board_create_instance(v_name, v_prefix, v_template);
  update public.board_instances
  set legacy_application_scope = v_scope, updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  insert into public.board_workspaces (
    board_instance_id, workspace_key, name, sort_order, active,
    application_scope, owner_uuid, created_by, updated_by
  ) values
    (v_instance.id, lower(v_prefix) || '-todo', '待辦', 10, true, null, v_user, v_user, v_user),
    (v_instance.id, lower(v_prefix) || '-in-progress', '進行中', 20, true, null, v_user, v_user, v_user),
    (v_instance.id, lower(v_prefix) || '-acceptance', '待驗收', 30, true, null, v_user, v_user, v_user),
    (v_instance.id, lower(v_prefix) || '-completed', '已完成', 40, true, null, v_user, v_user, v_user);

  v_adoption := jsonb_build_object(
    'status', 'adopted',
    'module_version', v_release.published_version,
    'build', v_release.published_build,
    'published_at', v_release.published_at,
    'adopted_at', now(),
    'adopted_by', v_user
  );
  update public.module_releases
  set consumer_adoptions = jsonb_set(
        coalesce(consumer_adoptions, '{}'::jsonb),
        array[v_instance.id::text], v_adoption, true
      ),
      updated_at = now()
  where module_id = v_template;
  if not found then
    raise exception using errcode = 'P0002', message = 'Published module adoption persistence failed';
  end if;
  if not exists (
    select 1 from public.module_releases release
    where release.module_id = v_template
      and coalesce(release.consumer_adoptions, '{}'::jsonb) ? v_instance.id::text
  ) then
    raise exception using errcode = 'P0002', message = 'Published module adoption was not persisted';
  end if;

  select coalesce(jsonb_agg(to_jsonb(workspace) order by workspace.sort_order), '[]'::jsonb)
    into v_workspaces
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance.id and workspace.active = true;
  return jsonb_build_object(
    'board_instance', to_jsonb(v_instance),
    'workspaces', v_workspaces,
    'published_release', to_jsonb(v_release),
    'consumer_id', v_instance.id::text,
    'adoption', v_adoption
  );
end;
$function$;

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

  if not found or not v_instance.active or v_instance.is_template_instance or lower(v_instance.template_key) <> 'c' then
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
    and lower(legacy_application_scope) = v_scope
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
    'C Consumer route assigned or moved through the authenticated Board lifecycle contract',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return v_instance;
end;
$function$;

create or replace function public.board_rename_instance(
  p_board_instance_id uuid,
  p_name text
)
returns public.board_instances
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_instance public.board_instances%rowtype;
  v_before_name text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated Board lifecycle owner is required';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception using errcode = '22023', message = 'Board name must contain 1-80 characters';
  end if;

  select * into v_instance
  from public.board_instances
  where id = p_board_instance_id
  for update;
  if not found or not v_instance.active or v_instance.is_template_instance
     or lower(v_instance.template_key) <> 'c' then
    raise exception using errcode = 'P0002', message = 'Active non-template Board Consumer was not found';
  end if;
  if lower(coalesce(v_instance.legacy_application_scope, '')) in ('ai_board', 'worktodo') then
    raise exception using errcode = '42501', message = 'Canonical compatibility Board Instance cannot be renamed here';
  end if;
  if not public.board_instance_can_write(v_instance.id) then
    raise exception using errcode = '42501', message = 'Board Consumer owner authorization is required';
  end if;

  if v_instance.name = v_name then
    return v_instance;
  end if;
  v_before_name := v_instance.name;
  update public.board_instances
  set name = v_name, updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_instance', v_instance.id::text, 'board_instance_renamed',
    jsonb_build_object('name', v_before_name),
    jsonb_build_object('name', v_name),
    'C Consumer renamed through the authenticated Board lifecycle contract',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );
  return v_instance;
end;
$function$;

create or replace function public.board_archive_instance(
  p_board_instance_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated Board lifecycle owner is required';
  end if;

  select * into v_instance
  from public.board_instances
  where id = p_board_instance_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board Instance was not found';
  end if;
  if v_instance.is_template_instance
     or lower(v_instance.template_key) <> 'c'
     or lower(coalesce(v_instance.legacy_application_scope, '')) in ('ai_board', 'worktodo') then
    raise exception using errcode = '42501', message = 'Canonical or compatibility Board Instance cannot be archived here';
  end if;
  if not public.board_instance_can_write(v_instance.id) then
    raise exception using errcode = '42501', message = 'Board Instance owner authorization is required';
  end if;
  if not v_instance.active then
    return jsonb_build_object('status', 'already_archived', 'board_instance_id', v_instance.id, 'active', false);
  end if;

  update public.board_instances
  set active = false,
      archived_at = now(),
      archived_by = auth.uid(),
      updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_instance', v_instance.id::text, 'board_instance_archived',
    jsonb_build_object('active', true),
    jsonb_build_object('active', false, 'archived_at', v_instance.archived_at),
    'Board Instance archived through the authenticated lifecycle contract; child records are preserved',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return jsonb_build_object(
    'status', 'archived',
    'board_instance_id', v_instance.id,
    'active', v_instance.active,
    'archived_at', v_instance.archived_at
  );
end;
$function$;

create or replace function public.board_delete_instance(
  p_board_instance_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_workspace_count integer;
  v_task_count integer;
  v_link_count integer := 0;
  v_claim_count integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated Board lifecycle owner is required';
  end if;

  select * into v_instance
  from public.board_instances
  where id = p_board_instance_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board Instance was not found';
  end if;
  if v_instance.is_template_instance
     or lower(v_instance.template_key) <> 'c'
     or lower(coalesce(v_instance.legacy_application_scope, '')) in ('ai_board', 'worktodo') then
    raise exception using errcode = '42501', message = 'Canonical or compatibility Board Instance cannot be deleted here';
  end if;
  if not (
    (v_instance.authorization_mode = 'engineering' and public.is_engineering_member())
    or (v_instance.authorization_mode = 'owner' and v_instance.owner_uuid = auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'Board Instance owner authorization is required';
  end if;
  if v_instance.active then
    raise exception using errcode = '55000', message = 'Board Instance must be archived before deletion';
  end if;

  select count(*) into v_workspace_count
  from public.board_workspaces where board_instance_id = v_instance.id;
  select count(*) into v_task_count
  from public.board_tasks where board_instance_id = v_instance.id;
  if to_regclass('public.investment_ivtk_card_links') is not null then
    execute 'select count(*) from public.investment_ivtk_card_links where board_instance_id = $1'
      into v_link_count using v_instance.id;
  end if;
  if v_task_count > 0 or v_link_count > 0 then
    raise exception using
      errcode = '55000',
      message = 'BOARD_INSTANCE_DELETE_REQUIRES_EMPTY';
  end if;
  if to_regclass('private.board_task_claims') is not null then
    execute 'select count(*) from private.board_task_claims where board_instance_id = $1'
      into v_claim_count using v_instance.id;
  end if;
  if v_claim_count > 0 then
    raise exception using
      errcode = '55000',
      message = 'BOARD_INSTANCE_DELETE_REQUIRES_NO_CLAIMS';
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_instance', v_instance.id::text, 'board_instance_deleted',
    jsonb_build_object('active', false, 'name', v_instance.name, 'task_code_prefix', v_instance.task_code_prefix),
    jsonb_build_object('deleted', true),
    'Empty Board Instance deleted through the authenticated lifecycle contract',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  -- Provisioning creates structural default workspaces. They are safe to
  -- remove only after the board has no tasks, links, or claims; task identity
  -- and business data are never cascaded by this contract.
  delete from public.board_workspaces where board_instance_id = v_instance.id;
  update public.module_releases
  set consumer_adoptions = coalesce(consumer_adoptions, '{}'::jsonb) - v_instance.id::text,
      updated_at = now()
  where module_id = v_instance.template_key
    and coalesce(consumer_adoptions, '{}'::jsonb) ? v_instance.id::text;
  delete from public.board_instances where id = v_instance.id;
  return jsonb_build_object('status', 'deleted', 'board_instance_id', v_instance.id);
end;
$function$;

revoke all on function public.board_provision_consumer(text, text, text) from public, anon, authenticated;
revoke all on function public.board_provision_consumer(text, text, text, text) from public, anon;
grant execute on function public.board_provision_consumer(text, text, text, text) to authenticated;
revoke all on function public.board_resolve_consumer_instance(text) from public, anon;
grant execute on function public.board_resolve_consumer_instance(text) to authenticated;
revoke all on function public.board_assign_consumer_scope(uuid, text) from public, anon;
grant execute on function public.board_assign_consumer_scope(uuid, text) to authenticated;
revoke all on function public.board_rename_instance(uuid, text) from public, anon;
grant execute on function public.board_rename_instance(uuid, text) to authenticated;
revoke all on function public.board_archive_instance(uuid) from public, anon;
grant execute on function public.board_archive_instance(uuid) to authenticated;
revoke all on function public.board_delete_instance(uuid) from public, anon;
grant execute on function public.board_delete_instance(uuid) to authenticated;

commit;
