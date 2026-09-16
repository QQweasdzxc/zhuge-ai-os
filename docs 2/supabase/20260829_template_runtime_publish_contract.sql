-- C Mother Template Runtime Publish Contract
-- Scope: persistent C release state plus consumer adoption metadata.
-- No existing product data is changed by this migration.

create table if not exists public.template_releases (
  template_id text primary key,
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

alter table public.template_releases enable row level security;

revoke all on table public.template_releases from public, anon, authenticated;
grant select on table public.template_releases to authenticated;

drop policy if exists template_releases_authenticated_read on public.template_releases;
create policy template_releases_authenticated_read
  on public.template_releases
  for select
  to authenticated
  using (auth.uid() is not null);

create or replace function public.get_published_template_release(p_template_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select to_jsonb(r)
  from public.template_releases r
  where r.template_id = btrim(p_template_id)
$$;

create or replace function public.publish_template_release(
  p_template_id text,
  p_published_version text,
  p_published_build text,
  p_source_commit text,
  p_source_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_template_id text := btrim(p_template_id);
  v_version text := btrim(p_published_version);
  v_build text := btrim(p_published_build);
  v_commit text := lower(btrim(p_source_commit));
  v_fingerprint text := lower(btrim(p_source_fingerprint));
  v_adoptions jsonb;
  v_result public.template_releases;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to publish a template';
  end if;

  if v_template_id <> 'c' then
    raise exception 'Only the canonical C template may be published';
  end if;

  if not exists (
    select 1
    from public.app_users au
    where au.auth_user_id = auth.uid()
      and lower(trim(au.role)) in ('creator', 'owner')
  ) then
    raise exception 'Creator or owner permission required to publish a template';
  end if;

  if v_version = '' or v_build = '' or v_commit = '' or v_fingerprint = '' then
    raise exception 'Complete template identity required';
  end if;
  if v_build !~ '^[0-9]{8}-[0-9]{4}$' then
    raise exception 'Invalid template build identity';
  end if;
  if v_commit !~* '^[0-9a-f]{40}$' then
    raise exception 'Invalid template source commit';
  end if;
  if v_fingerprint !~* '^[0-9a-f]{64}$' then
    raise exception 'Invalid template source fingerprint';
  end if;

  v_adoptions := jsonb_build_object(
    'c', jsonb_build_object('status', 'adopted', 'template_version', v_version, 'build', v_build, 'adopted_at', now()),
    'worktodo', jsonb_build_object('status', 'adopted', 'template_version', v_version, 'build', v_build, 'adopted_at', now()),
    'ai-board', jsonb_build_object('status', 'adopted', 'template_version', v_version, 'build', v_build, 'adopted_at', now())
  );

  insert into public.template_releases (
    template_id, published_version, published_build, source_commit, source_fingerprint,
    published_at, published_by, consumer_adoptions, created_at, updated_at
  ) values (
    v_template_id, v_version, v_build, v_commit, v_fingerprint,
    now(), auth.uid(), v_adoptions, now(), now()
  )
  on conflict (template_id) do update set
    published_version = excluded.published_version,
    published_build = excluded.published_build,
    source_commit = excluded.source_commit,
    source_fingerprint = excluded.source_fingerprint,
    published_at = excluded.published_at,
    published_by = excluded.published_by,
    consumer_adoptions = excluded.consumer_adoptions,
    updated_at = excluded.updated_at
  returning * into v_result;

  return to_jsonb(v_result);
end;
$$;

revoke all on function public.get_published_template_release(text) from public, anon;
grant execute on function public.get_published_template_release(text) to authenticated;

revoke all on function public.publish_template_release(text, text, text, text, text) from public, anon;
grant execute on function public.publish_template_release(text, text, text, text, text) to authenticated;
