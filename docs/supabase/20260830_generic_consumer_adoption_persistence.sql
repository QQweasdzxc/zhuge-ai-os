-- Generic Consumer Adoption Persistence Fix
--
-- The provisioning contract already performs registry creation, default
-- workspace initialization, and Published C adoption in one transaction.
-- jsonb_set(..., false) silently skipped a missing generic consumer key,
-- which could return an adopted response without persisting the adoption.
-- This patch creates the missing key and asserts persistence before success.

begin;

create or replace function public.board_provision_consumer(
  p_name text,
  p_task_code_prefix text,
  p_template_key text default 'c'
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

revoke all on function public.board_provision_consumer(text, text, text) from public, anon;
grant execute on function public.board_provision_consumer(text, text, text) to authenticated;

-- One-time, non-destructive repair of the already-created QAT consumer.
-- Existing registry/workspace rows and all existing consumer adoption keys are
-- preserved; only the missing QAT adoption record is added.
do $$
declare
  v_instance_id uuid := '81f49fc7-ac0f-428e-8fcd-5ee612c52993';
  v_rows integer;
begin
  if not exists (
    select 1
    from public.board_instances instance
    where instance.id = v_instance_id
      and instance.active = true
      and instance.template_key = 'c'
      and instance.task_code_prefix = 'QAT'
  ) then
    raise exception using errcode = 'P0002', message = 'Approved QAT registry identity was not found';
  end if;

  if exists (
    select 1
    from public.module_releases release
    where release.module_id = 'c'
      and coalesce(release.consumer_adoptions, '{}'::jsonb) ? v_instance_id::text
  ) then
    return;
  end if;

  update public.module_releases release
  set consumer_adoptions = jsonb_set(
        coalesce(release.consumer_adoptions, '{}'::jsonb),
        array[v_instance_id::text],
        jsonb_build_object(
          'status', 'adopted',
          'module_version', release.published_version,
          'build', release.published_build,
          'published_at', release.published_at,
          'adopted_at', now(),
          'adopted_by', instance.owner_uuid
        ),
        true
      ),
      updated_at = now()
  from public.board_instances instance
  where release.module_id = 'c'
    and instance.id = v_instance_id;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception using errcode = 'P0002', message = 'Approved QAT adoption repair did not update exactly one release';
  end if;
end;
$$;

commit;
