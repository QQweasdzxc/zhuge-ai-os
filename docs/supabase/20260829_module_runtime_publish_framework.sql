-- Shared Module Publish / Update Framework
-- Scope: generic persistent module release state, publish history, and
-- consumer adoption acknowledgement. C is the first consumer; this contract
-- must not encode a C-only consumer list or a product-data migration.

-- The first C pilot created a template-specific table. Preserve its rows and
-- evolve the table boundary to the reusable module-level contract.
do $$
begin
  if to_regclass('public.template_releases') is not null
     and to_regclass('public.module_releases') is null then
    alter table public.template_releases rename to module_releases;
  elsif to_regclass('public.template_releases') is not null
        and to_regclass('public.module_releases') is not null then
    raise exception 'Both template_releases and module_releases exist; resolve release state before migration';
  end if;
end
$$;

create table if not exists public.module_releases (
  module_id text primary key check (btrim(module_id) <> ''),
  schema_version integer not null default 1,
  development_version text,
  development_build text,
  development_source_commit text,
  development_source_fingerprint text,
  published_version text not null check (btrim(published_version) <> ''),
  published_build text not null check (published_build ~ '^[0-9]{8}-[0-9]{4}$'),
  source_commit text not null check (source_commit ~* '^[0-9a-f]{40}$'),
  source_fingerprint text not null check (source_fingerprint ~* '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  published_by uuid not null references auth.users(id) on delete restrict,
  consumer_adoptions jsonb not null default '{}'::jsonb check (jsonb_typeof(consumer_adoptions) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'module_releases' and column_name = 'template_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'module_releases' and column_name = 'module_id'
  ) then
    alter table public.module_releases rename column template_id to module_id;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'module_releases' and column_name = 'template_id'
  ) then
    raise exception 'Both template_id and module_id exist on module_releases; resolve release identity before migration';
  end if;
end
$$;

alter table public.module_releases add column if not exists schema_version integer not null default 1;
alter table public.module_releases add column if not exists development_version text;
alter table public.module_releases add column if not exists development_build text;
alter table public.module_releases add column if not exists development_source_commit text;
alter table public.module_releases add column if not exists development_source_fingerprint text;

create table if not exists public.module_release_history (
  id bigint generated always as identity primary key,
  module_id text not null check (btrim(module_id) <> ''),
  development_version text,
  development_build text,
  development_source_commit text,
  development_source_fingerprint text,
  published_version text not null check (btrim(published_version) <> ''),
  published_build text not null check (published_build ~ '^[0-9]{8}-[0-9]{4}$'),
  source_commit text not null check (source_commit ~* '^[0-9a-f]{40}$'),
  source_fingerprint text not null check (source_fingerprint ~* '^[0-9a-f]{64}$'),
  published_at timestamptz not null,
  published_by uuid not null references auth.users(id) on delete restrict,
  consumer_ids jsonb not null check (jsonb_typeof(consumer_ids) = 'array'),
  created_at timestamptz not null default now(),
  unique (module_id, published_build, source_fingerprint)
);

alter table public.module_releases enable row level security;
alter table public.module_release_history enable row level security;

revoke all on table public.module_releases from public, anon, authenticated;
grant select on table public.module_releases to authenticated;
revoke all on table public.module_release_history from public, anon, authenticated;
grant select on table public.module_release_history to authenticated;

drop policy if exists template_releases_authenticated_read on public.module_releases;
drop policy if exists module_releases_authenticated_read on public.module_releases;
create policy module_releases_authenticated_read
  on public.module_releases
  for select
  to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists module_release_history_authenticated_read on public.module_release_history;
create policy module_release_history_authenticated_read
  on public.module_release_history
  for select
  to authenticated
  using ((select auth.uid()) is not null);

drop function if exists public.get_published_template_release(text);
drop function if exists public.publish_template_release(text, text, text, text, text);

create or replace function public.get_published_module_release(p_module_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select to_jsonb(r)
  from public.module_releases r
  where r.module_id = lower(btrim(p_module_id))
$$;

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
    updated_at = excluded.updated_at
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

create or replace function public.record_module_adoption(
  p_module_id text,
  p_consumer_id text,
  p_published_version text,
  p_published_build text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_module_id text := lower(coalesce(btrim(p_module_id), ''));
  v_consumer_id text := lower(replace(coalesce(btrim(p_consumer_id), ''), '_', '-'));
  v_version text := coalesce(btrim(p_published_version), '');
  v_build text := coalesce(btrim(p_published_build), '');
  v_release public.module_releases;
  v_adoption jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to acknowledge module adoption';
  end if;
  if not exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
  ) then
    raise exception 'Registered application user required to acknowledge module adoption';
  end if;
  if v_module_id = '' or v_consumer_id = '' or v_version = '' or v_build = '' then
    raise exception 'Complete module adoption identity required';
  end if;

  select * into v_release
  from public.module_releases
  where module_id = v_module_id;
  if not found then
    raise exception 'Published module release not found';
  end if;
  if v_release.published_version <> v_version or v_release.published_build <> v_build then
    raise exception 'Module adoption identity does not match the published release';
  end if;
  if not (coalesce(v_release.consumer_adoptions, '{}'::jsonb) ? v_consumer_id) then
    raise exception 'Consumer is not a target of this module release';
  end if;

  v_adoption := jsonb_build_object(
    'status', 'adopted',
    'module_version', v_release.published_version,
    'build', v_release.published_build,
    'published_at', v_release.published_at,
    'adopted_at', now(),
    'adopted_by', auth.uid()
  );

  update public.module_releases
  set consumer_adoptions = jsonb_set(
        coalesce(consumer_adoptions, '{}'::jsonb),
        array[v_consumer_id],
        v_adoption,
        false
      ),
      updated_at = now()
  where module_id = v_module_id
  returning * into v_release;

  return to_jsonb(v_release);
end;
$$;

revoke all on function public.get_published_module_release(text) from public, anon;
grant execute on function public.get_published_module_release(text) to authenticated;

revoke all on function public.publish_module_release(text, text, text, text, text, jsonb, text, text, text, text) from public, anon;
grant execute on function public.publish_module_release(text, text, text, text, text, jsonb, text, text, text, text) to authenticated;

revoke all on function public.record_module_adoption(text, text, text, text) from public, anon;
grant execute on function public.record_module_adoption(text, text, text, text) to authenticated;
