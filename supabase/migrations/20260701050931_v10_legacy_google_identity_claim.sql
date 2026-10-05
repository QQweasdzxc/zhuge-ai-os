-- v10 Legacy Google Identity Claim
-- Purpose: bind the current single-user legacy workspace data to the Google/Supabase Auth UUID after first login.

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, setting_key)
);

create table if not exists public.onboarding_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  status text not null default 'pending',
  current_step text,
  payload jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create or replace function public.claim_legacy_workspace(
  target_user_code text default '001',
  target_email text default null,
  target_display_name text default null,
  target_avatar_url text default null
)
returns table(
  user_id uuid,
  auth_user_id uuid,
  user_code text,
  display_name text,
  email text,
  portfolio_count int,
  opening_position_count int,
  transaction_count int,
  watchlist_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_existing_auth uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select u.id, u.auth_user_id
    into v_user_id, v_existing_auth
  from public.app_users u
  where u.user_code = target_user_code
  limit 1;

  if v_user_id is null then
    raise exception 'WORKSPACE_NOT_FOUND';
  end if;

  if v_existing_auth is not null and v_existing_auth <> auth.uid() then
    raise exception 'WORKSPACE_ALREADY_CLAIMED';
  end if;

  update public.app_users u
  set
    auth_user_id = auth.uid(),
    email = coalesce(target_email, u.email),
    display_name = coalesce(target_display_name, u.display_name),
    avatar_url = coalesce(target_avatar_url, u.avatar_url),
    auth_provider = 'google',
    last_login_at = now(),
    updated_at = now()
  where u.id = v_user_id;

  insert into public.onboarding_state(user_id, status, current_step, payload, completed_at)
  values (v_user_id, 'completed', 'legacy_claimed', jsonb_build_object('claimed_at', now(), 'source', 'legacy_workspace'), now())
  on conflict (user_id) do update set
    status = 'completed',
    current_step = 'legacy_claimed',
    payload = onboarding_state.payload || excluded.payload,
    completed_at = coalesce(onboarding_state.completed_at, now()),
    updated_at = now();

  insert into public.user_settings(user_id, setting_key, setting_value)
  values (v_user_id, 'identity', jsonb_build_object('provider','google','claimed_legacy_workspace', true))
  on conflict (user_id, setting_key) do update set
    setting_value = user_settings.setting_value || excluded.setting_value,
    updated_at = now();

  return query
  select
    u.id,
    u.auth_user_id,
    u.user_code,
    u.display_name,
    u.email,
    (select count(*)::int from public.portfolios p where p.user_id = u.id),
    (select count(*)::int from public.opening_positions op where op.user_id = u.id),
    (select count(*)::int from public.transactions t where t.user_id = u.id),
    (select count(*)::int from public.watchlists w where w.user_id = u.id)
  from public.app_users u
  where u.id = v_user_id;
end;
$$;

create or replace function public.get_my_workspace_summary()
returns table(
  user_id uuid,
  auth_user_id uuid,
  user_code text,
  display_name text,
  email text,
  onboarding_status text,
  portfolio_count int,
  opening_position_count int,
  transaction_count int,
  watchlist_count int
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    u.auth_user_id,
    u.user_code,
    u.display_name,
    u.email,
    coalesce(os.status, 'pending') as onboarding_status,
    (select count(*)::int from public.portfolios p where p.user_id = u.id) as portfolio_count,
    (select count(*)::int from public.opening_positions op where op.user_id = u.id) as opening_position_count,
    (select count(*)::int from public.transactions t where t.user_id = u.id) as transaction_count,
    (select count(*)::int from public.watchlists w where w.user_id = u.id) as watchlist_count
  from public.app_users u
  left join public.onboarding_state os on os.user_id = u.id
  where u.auth_user_id = auth.uid();
$$;

comment on function public.claim_legacy_workspace(text,text,text,text) is 'After Google login, bind the existing single-user legacy workspace to the current Supabase Auth UUID without re-entering positions or transactions.';
comment on function public.get_my_workspace_summary() is 'Returns the authenticated user workspace summary using auth.uid().' ;