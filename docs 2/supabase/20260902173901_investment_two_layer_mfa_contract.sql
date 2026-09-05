begin;

-- Investment security settings are deliberately split at the product-policy
-- layer. The legacy key remains readable as an entry-policy alias so older
-- runtimes do not silently change the current Creator setting.
create or replace function public.get_creator_mfa_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_legacy_user_id uuid;
  v_entry_required boolean;
  v_sensitive_write_required boolean;
  v_ai_board_required boolean;
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

  -- New entry policy wins. The old setting is the compatibility fallback,
  -- preserving the current false value for the PM without a data backfill.
  select coalesce(
    (
      select (setting_value #>> '{}')::boolean
      from public.user_settings
      where user_id = v_legacy_user_id
        and setting_key = 'investment_entry_mfa_required'
        and jsonb_typeof(setting_value) = 'boolean'
      limit 1
    ),
    (
      select (setting_value #>> '{}')::boolean
      from public.user_settings
      where user_id = v_legacy_user_id
        and setting_key = 'investment_mfa_required'
        and jsonb_typeof(setting_value) = 'boolean'
      limit 1
    ),
    true
  )
  into v_entry_required;

  select coalesce(
    (
      select (setting_value #>> '{}')::boolean
      from public.user_settings
      where user_id = v_legacy_user_id
        and setting_key = 'investment_sensitive_write_mfa_required'
        and jsonb_typeof(setting_value) = 'boolean'
      limit 1
    ),
    true
  )
  into v_sensitive_write_required;

  select coalesce(
    (
      select (setting_value #>> '{}')::boolean
      from public.user_settings
      where user_id = v_legacy_user_id
        and setting_key = 'ai_board_mfa_required'
        and jsonb_typeof(setting_value) = 'boolean'
      limit 1
    ),
    true
  )
  into v_ai_board_required;

  return jsonb_build_object(
    'user_id', v_auth_user_id,
    'is_creator', true,
    -- Compatibility alias: this now means the Investment entry policy.
    'investment_mfa_required', v_entry_required,
    'investment_entry_mfa_required', v_entry_required,
    'investment_sensitive_write_mfa_required', v_sensitive_write_required,
    'ai_board_mfa_required', v_ai_board_required
  );
end;
$function$;

create or replace function public.set_creator_mfa_preference(
  p_module_id text,
  p_required boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
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
    when 'investment' then 'investment_entry_mfa_required'
    when 'investment-entry' then 'investment_entry_mfa_required'
    when 'investment_entry' then 'investment_entry_mfa_required'
    when 'investment-sensitive-write' then 'investment_sensitive_write_mfa_required'
    when 'investment_sensitive_write' then 'investment_sensitive_write_mfa_required'
    when 'investment-write' then 'investment_sensitive_write_mfa_required'
    when 'investment_write' then 'investment_sensitive_write_mfa_required'
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
$function$;

create or replace function private.investment_mfa_bypassed()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $function$
  select coalesce(
    (
      select (preference.setting_value #>> '{}')::boolean
      from public.user_settings preference
      where preference.user_id = private.investment_current_owner_id()
        and preference.setting_key = 'investment_entry_mfa_required'
        and jsonb_typeof(preference.setting_value) = 'boolean'
      limit 1
    ),
    (
      select (preference.setting_value #>> '{}')::boolean
      from public.user_settings preference
      where preference.user_id = private.investment_current_owner_id()
        and preference.setting_key = 'investment_mfa_required'
        and jsonb_typeof(preference.setting_value) = 'boolean'
      limit 1
    ),
    true
  ) = false;
$function$;

-- The controlled Snapshot RPC intentionally remains independently AAL2-gated
-- as defense in depth. The new sensitive-write preference controls the
-- product's pre-write Step-up UX; it never relaxes owner scope, RLS, or this
-- server-side write gate.

commit;
