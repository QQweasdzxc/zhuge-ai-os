-- Generic C Consumer Provisioning
--
-- The existing Universal Board Contract already owns board identity, data
-- isolation and the shared child relations. This migration only composes
-- those primitives into one atomic, authenticated provisioning operation and
-- makes the existing module publish operation registry-aware. It does not
-- backfill or mutate existing business rows.

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
        false
      ),
      updated_at = now()
  where module_id = v_template;

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

-- Existing fixed consumers remain explicit callers; active generic C
-- consumers are added from the registry so future boards need no new RPC or
-- hard-coded consumer branch.
create or replace function public.publish_module_release(
  p_module_id text,
  p_published_version text,
  p_published_build text,
  p_source_commit text,
  p_source_fingerprint text,
  p_consumer_ids jsonb,
  p_development_version text default null,
  p_development_build text default null,
  p_development_source_commit text default null,
  p_development_source_fingerprint text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_module_id text := lower(coalesce(btrim(p_module_id), ''));
  v_version text := coalesce(btrim(p_published_version), '');
  v_build text := coalesce(btrim(p_published_build), '');
  v_commit text := lower(coalesce(btrim(p_source_commit), ''));
  v_fingerprint text := lower(coalesce(btrim(p_source_fingerprint), ''));
  v_development_version text := nullif(btrim(coalesce(p_development_version, v_version)), '');
  v_development_build text := nullif(btrim(coalesce(p_development_build, v_build)), '');
  v_development_commit text := lower(nullif(btrim(coalesce(p_development_source_commit, v_commit)), ''));
  v_development_fingerprint text := lower(nullif(btrim(coalesce(p_development_source_fingerprint, v_fingerprint)), ''));
  v_published_at timestamptz := now();
  v_adoptions jsonb;
  v_consumer_ids jsonb;
  v_result public.module_releases;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to publish a module';
  end if;

  if not exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and lower(trim(au.role)) in ('creator', 'owner')
  ) then
    raise exception 'Creator or owner permission required to publish a module';
  end if;

  if v_module_id = '' or v_version = '' or v_build = '' or v_commit = '' or v_fingerprint = '' then
    raise exception 'Complete module identity required';
  end if;
  if v_build !~ '^[0-9]{8}-[0-9]{4}$' then
    raise exception 'Invalid module build identity';
  end if;
  if v_commit !~* '^[0-9a-f]{40}$' then
    raise exception 'Invalid module source commit';
  end if;
  if v_fingerprint !~* '^[0-9a-f]{64}$' then
    raise exception 'Invalid module source fingerprint';
  end if;
  if v_development_version is null or v_development_build is null or v_development_commit is null or v_development_fingerprint is null then
    raise exception 'Complete development module identity required';
  end if;
  if v_development_build !~ '^[0-9]{8}-[0-9]{4}$' then
    raise exception 'Invalid development module build identity';
  end if;
  if v_development_commit !~* '^[0-9a-f]{40}$' then
    raise exception 'Invalid development module source commit';
  end if;
  if v_development_fingerprint !~* '^[0-9a-f]{64}$' then
    raise exception 'Invalid development module source fingerprint';
  end if;

  if p_consumer_ids is null or jsonb_typeof(p_consumer_ids) <> 'array' or jsonb_array_length(p_consumer_ids) = 0 then
    raise exception 'At least one module consumer is required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_consumer_ids) as item(value)
    where btrim(item.value) = ''
  ) then
    raise exception 'Module consumer id cannot be empty';
  end if;

  select coalesce(jsonb_object_agg(target.consumer_id,
    jsonb_build_object(
      'status', 'published_pending_reload',
      'module_version', v_version,
      'build', v_build,
      'published_at', v_published_at
    )), '{}'::jsonb)
  into v_adoptions
  from (
    select distinct lower(replace(btrim(item.value), '_', '-')) as consumer_id
    from jsonb_array_elements_text(p_consumer_ids) as item(value)
    union
    select bi.id::text
    from public.board_instances bi
    where bi.active = true
      and bi.is_template_instance = false
      and bi.legacy_application_scope is null
      and lower(btrim(bi.template_key)) = v_module_id
  ) as target;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
  into v_consumer_ids
  from jsonb_object_keys(v_adoptions) as keys(key);

  insert into public.module_releases (
    module_id, schema_version,
    development_version, development_build, development_source_commit, development_source_fingerprint,
    published_version, published_build, source_commit, source_fingerprint,
    published_at, published_by, consumer_adoptions, created_at, updated_at
  ) values (
    v_module_id, 1,
    v_development_version, v_development_build, v_development_commit, v_development_fingerprint,
    v_version, v_build, v_commit, v_fingerprint,
    v_published_at, auth.uid(), v_adoptions, v_published_at, v_published_at
  )
  on conflict (module_id) do update set
    schema_version = excluded.schema_version,
    development_version = excluded.development_version,
    development_build = excluded.development_build,
    development_source_commit = excluded.development_source_commit,
    development_source_fingerprint = excluded.development_source_fingerprint,
    published_version = excluded.published_version,
    published_build = excluded.published_build,
    source_commit = excluded.source_commit,
    source_fingerprint = excluded.source_fingerprint,
    published_at = excluded.published_at,
    published_by = excluded.published_by,
    consumer_adoptions = excluded.consumer_adoptions,
    updated_at = now()
  returning * into v_result;

  insert into public.module_release_history (
    module_id,
    development_version, development_build, development_source_commit, development_source_fingerprint,
    published_version, published_build, source_commit, source_fingerprint,
    published_at, published_by, consumer_ids
  ) values (
    v_module_id,
    v_development_version, v_development_build, v_development_commit, v_development_fingerprint,
    v_version, v_build, v_commit, v_fingerprint,
    v_published_at, auth.uid(), v_consumer_ids
  )
  on conflict (module_id, published_build, source_fingerprint) do nothing;

  return to_jsonb(v_result);
end;
$$;

revoke all on function public.publish_module_release(text, text, text, text, text, jsonb, text, text, text, text) from public, anon;
grant execute on function public.publish_module_release(text, text, text, text, text, jsonb, text, text, text, text) to authenticated;

commit;
