-- Creator-only MFA Control
--
-- The existing app_users.auth_user_id -> auth.uid() mapping is the only
-- Creator registry source for this task. The existing user_settings table is
-- reused for the two independent Cloud preferences. Browser table DML is not
-- used; all MFA preference reads/writes go through the guarded RPCs below.

begin;

-- Keep the legacy table readable by the existing Investment read path, but
-- remove direct browser writes. The RPCs are the controlled write boundary.
revoke insert, update, delete on table public.user_settings from public;
revoke insert, update, delete on table public.user_settings from anon, authenticated;

create or replace function public.resolve_creator_capability()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_creator', exists (
      select 1
      from public.app_users
      where auth_user_id = auth.uid()
        and lower(trim(coalesce(role, ''))) in ('creator', 'owner')
    )
  );
$$;

create or replace function public.get_creator_mfa_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_legacy_user_id uuid;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'Authenticated Session is required';
  end if;

  select au.id
    into v_legacy_user_id
  from public.app_users au
  where au.auth_user_id = v_auth_user_id
    and lower(trim(coalesce(au.role, ''))) in ('creator', 'owner')
  limit 1;

  if v_legacy_user_id is null then
    raise exception using errcode = '42501', message = 'Creator capability is required';
  end if;

  return jsonb_build_object(
    'user_id', v_auth_user_id,
    'is_creator', true,
    'investment_mfa_required', coalesce((
      select (setting_value #>> '{}')::boolean
      from public.user_settings
      where user_id = v_legacy_user_id
        and setting_key = 'investment_mfa_required'
        and jsonb_typeof(setting_value) = 'boolean'
      limit 1
    ), true),
    'ai_board_mfa_required', coalesce((
      select (setting_value #>> '{}')::boolean
      from public.user_settings
      where user_id = v_legacy_user_id
        and setting_key = 'ai_board_mfa_required'
        and jsonb_typeof(setting_value) = 'boolean'
      limit 1
    ), true)
  );
end;
$$;

create or replace function public.set_creator_mfa_preference(
  p_module_id text,
  p_required boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_legacy_user_id uuid;
  v_setting_key text;
  v_required boolean := coalesce(p_required, true);
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'Authenticated Session is required';
  end if;

  v_setting_key := case lower(trim(coalesce(p_module_id, '')))
    when 'investment' then 'investment_mfa_required'
    when 'ai-board' then 'ai_board_mfa_required'
    else null
  end;
  if v_setting_key is null then
    raise exception using errcode = '22023', message = 'Unsupported MFA module';
  end if;

  select au.id
    into v_legacy_user_id
  from public.app_users au
  where au.auth_user_id = v_auth_user_id
    and lower(trim(coalesce(au.role, ''))) in ('creator', 'owner')
  limit 1;

  if v_legacy_user_id is null then
    raise exception using errcode = '42501', message = 'Creator capability is required';
  end if;

  insert into public.user_settings (user_id, setting_key, setting_value, created_at, updated_at)
  values (v_legacy_user_id, v_setting_key, to_jsonb(v_required), now(), now())
  on conflict (user_id, setting_key)
  do update set setting_value = excluded.setting_value, updated_at = now();

  return jsonb_build_object(
    'user_id', v_auth_user_id,
    'setting_key', v_setting_key,
    'required', v_required
  );
end;
$$;

revoke execute on function public.resolve_creator_capability() from public, anon;
grant execute on function public.resolve_creator_capability() to authenticated;

revoke execute on function public.get_creator_mfa_preferences() from public, anon;
grant execute on function public.get_creator_mfa_preferences() to authenticated;

revoke execute on function public.set_creator_mfa_preference(text, boolean) from public, anon;
grant execute on function public.set_creator_mfa_preference(text, boolean) to authenticated;

commit;
