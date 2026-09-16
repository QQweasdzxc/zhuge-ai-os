-- C Consumer creation: project assignment + canonical A+C composition metadata
-- PM-QA source migration. Apply through the normal Supabase migration path before testing creation.

begin;

create or replace function public.board_provision_consumer(
  p_name text,
  p_task_code_prefix text,
  p_template_key text default 'c',
  p_application_scope text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := upper(btrim(coalesce(p_task_code_prefix, '')));
  v_template text := lower(btrim(coalesce(p_template_key, 'c')));
  v_scope text := nullif(lower(btrim(coalesce(p_application_scope, ''))), '');
  v_instance public.board_instances;
  v_release public.module_releases;
  v_adoption jsonb;
  v_workspaces jsonb;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated governance identity is required';
  end if;

  if not exists (
    select 1
    from public.app_users au
    where au.auth_user_id = v_user
      and lower(trim(au.role)) in ('creator', 'owner')
  ) then
    raise exception using errcode = '42501', message = 'Creator or owner permission required to create a board';
  end if;

  if v_name = '' or v_prefix !~ '^[A-Z][A-Z0-9]{1,15}$' or v_template = '' then
    raise exception using errcode = '22023', message = 'Board name, task-code prefix, and template key are required';
  end if;

  if v_scope is not null and v_scope not in ('worklog', 'investment') then
    raise exception using errcode = '22023', message = 'Unsupported board project scope';
  end if;

  if exists (
    select 1
    from public.board_instances instance
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

  -- board_create_instance is itself authenticated and owner-scoped. Calling
  -- it inside this function keeps the existing identity validation and makes
  -- the complete provisioning sequence one transaction.
  v_instance := public.board_create_instance(v_name, v_prefix, v_template);

  update public.board_instances
  set legacy_application_scope = v_scope,
      updated_at = now()
  where id = v_instance.id
    and owner_uuid = v_user
  returning * into v_instance;

  if not found then
    raise exception using errcode = 'P0002', message = 'Board project assignment failed';
  end if;

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
        array[v_instance.id::text],
        v_adoption,
        true
      ),
      updated_at = now()
  where module_id = v_template;

  if not found then
    raise exception using errcode = 'P0002', message = 'Published module adoption persistence failed';
  end if;

  if not exists (
    select 1
    from public.module_releases release
    where release.module_id = v_template
      and coalesce(release.consumer_adoptions, '{}'::jsonb) ? v_instance.id::text
  ) then
    raise exception using errcode = 'P0002', message = 'Published module adoption was not persisted';
  end if;

  select coalesce(jsonb_agg(to_jsonb(workspace) order by workspace.sort_order), '[]'::jsonb)
  into v_workspaces
  from public.board_workspaces workspace
  where workspace.board_instance_id = v_instance.id
    and workspace.active = true;

  return jsonb_build_object(
    'board_instance', to_jsonb(v_instance),
    'workspaces', v_workspaces,
    'published_release', to_jsonb(v_release),
    'consumer_id', v_instance.id::text,
    'adoption', v_adoption
  );
end;
$$;

revoke all on function public.board_provision_consumer(text, text, text, text) from public, anon;
grant execute on function public.board_provision_consumer(text, text, text, text) to authenticated;

commit;
