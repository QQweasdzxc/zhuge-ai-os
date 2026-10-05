-- v11 Identity Edition - restore RPC parameter names expected by deployed frontend
-- Frontend currently calls claim_legacy_workspace with target_* keys.
-- PostgREST resolves functions by named parameters, so the function must expose target_* parameter names.

drop function if exists public.claim_legacy_workspace(text,text,text,text);

create or replace function public.claim_legacy_workspace(
  target_user_code text default '001',
  target_email text default null,
  target_display_name text default null,
  target_avatar_url text default null
)
returns table(
  workspace_user_id uuid,
  workspace_auth_user_id uuid,
  workspace_user_code text,
  workspace_display_name text,
  workspace_email text,
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
  v_workspace_user_id uuid;
  v_existing_auth_user_id uuid;
  v_auth_user_id uuid;
begin
  v_auth_user_id := auth.uid();

  if v_auth_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select au.id, au.auth_user_id
    into v_workspace_user_id, v_existing_auth_user_id
  from public.app_users as au
  where au.user_code = claim_legacy_workspace.target_user_code
  limit 1;

  if v_workspace_user_id is null then
    raise exception 'WORKSPACE_NOT_FOUND';
  end if;

  if v_existing_auth_user_id is not null and v_existing_auth_user_id <> v_auth_user_id then
    raise exception 'WORKSPACE_ALREADY_CLAIMED';
  end if;

  update public.app_users as au
  set
    auth_user_id = v_auth_user_id,
    email = coalesce(claim_legacy_workspace.target_email, au.email),
    display_name = coalesce(claim_legacy_workspace.target_display_name, au.display_name),
    avatar_url = coalesce(claim_legacy_workspace.target_avatar_url, au.avatar_url),
    auth_provider = 'google',
    last_login_at = now(),
    updated_at = now()
  where au.id = v_workspace_user_id;

  insert into public.onboarding_state as os (
    user_id,
    status,
    current_step,
    payload,
    completed_at,
    updated_at
  )
  values (
    v_workspace_user_id,
    'completed',
    'legacy_claimed',
    jsonb_build_object('claimed_at', now(), 'source', 'legacy_workspace'),
    now(),
    now()
  )
  on conflict (user_id) do update set
    status = excluded.status,
    current_step = excluded.current_step,
    payload = os.payload || excluded.payload,
    completed_at = coalesce(os.completed_at, excluded.completed_at),
    updated_at = now();

  insert into public.user_settings as us (
    user_id,
    setting_key,
    setting_value,
    updated_at
  )
  values (
    v_workspace_user_id,
    'identity',
    jsonb_build_object('provider','google','claimed_legacy_workspace', true),
    now()
  )
  on conflict (user_id, setting_key) do update set
    setting_value = us.setting_value || excluded.setting_value,
    updated_at = now();

  insert into public.identity_claim_logs (
    workspace_user_id,
    auth_user_id,
    user_code,
    email,
    claim_status,
    payload
  )
  values (
    v_workspace_user_id,
    v_auth_user_id,
    claim_legacy_workspace.target_user_code,
    claim_legacy_workspace.target_email,
    'success',
    jsonb_build_object('source','legacy_workspace','claimed_at', now())
  );

  return query
  select
    au.id as workspace_user_id,
    au.auth_user_id as workspace_auth_user_id,
    au.user_code as workspace_user_code,
    au.display_name as workspace_display_name,
    au.email as workspace_email,
    (select count(*)::int from public.portfolios as pf where pf.user_id = au.id) as portfolio_count,
    (select count(*)::int from public.opening_positions as op where op.user_id = au.id) as opening_position_count,
    (select count(*)::int from public.transactions as tx where tx.user_id = au.id) as transaction_count,
    (select count(*)::int from public.watchlists as wl where wl.user_id = au.id) as watchlist_count
  from public.app_users as au
  where au.id = v_workspace_user_id;
end;
$$;

comment on function public.claim_legacy_workspace(text,text,text,text) is 'v11 Identity certified claim function with frontend-compatible target_* parameter names and fully-qualified SQL.';