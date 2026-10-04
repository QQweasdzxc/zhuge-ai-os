-- V9.2 Auth Identity Foundation
-- Goal: prepare SaaS identity mapping: Supabase Auth UUID -> app_users.auth_user_id -> user-owned data.

alter table public.app_users
  add column if not exists auth_provider text,
  add column if not exists avatar_url text,
  add column if not exists last_login_at timestamptz;

create unique index if not exists idx_app_users_auth_user_id
  on public.app_users(auth_user_id)
  where auth_user_id is not null;

create index if not exists idx_app_users_user_code
  on public.app_users(user_code);

-- Auth-aware helper view. This does not expose secrets; it only shows the row mapped to auth.uid().
create or replace view public.my_workspace_view as
select
  u.id as user_id,
  u.auth_user_id,
  u.user_code,
  u.display_name,
  u.email,
  u.role,
  p.id as portfolio_id,
  p.name as portfolio_name,
  p.base_currency,
  p.is_default
from public.app_users u
left join public.portfolios p on p.user_id = u.id and p.is_default = true
where u.auth_user_id = auth.uid();

-- Safe bootstrap function for linking an existing workspace after Google login.
-- Phase 1 keeps manual control: only links if the target workspace is not already linked.
create or replace function public.link_workspace_identity(
  target_user_code text,
  target_email text default null,
  target_display_name text default null,
  target_avatar_url text default null,
  target_provider text default 'google'
)
returns table(user_id uuid, user_code text, display_name text, email text, auth_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.app_users u
  set
    auth_user_id = auth.uid(),
    email = coalesce(target_email, u.email),
    display_name = coalesce(target_display_name, u.display_name),
    avatar_url = coalesce(target_avatar_url, u.avatar_url),
    auth_provider = coalesce(target_provider, u.auth_provider),
    last_login_at = now(),
    updated_at = now()
  where u.user_code = target_user_code
    and (u.auth_user_id is null or u.auth_user_id = auth.uid());

  return query
  select u.id, u.user_code, u.display_name, u.email, u.auth_user_id
  from public.app_users u
  where u.user_code = target_user_code
    and u.auth_user_id = auth.uid();
end;
$$;

-- Phase 2 strict RLS policies prepared but not activated yet.
-- Current phase1 policies remain in place until Google OAuth is configured and tested.
-- When ready, remove phase1_* policies and create policies using auth.uid() = app_users.auth_user_id.

comment on column public.app_users.auth_user_id is 'Supabase Auth UUID. This is the SaaS identity key. Every user reads data through this mapping.';
comment on function public.link_workspace_identity(text,text,text,text,text) is 'Links current Supabase Auth user UUID to an existing workspace user_code during auth bootstrap.';