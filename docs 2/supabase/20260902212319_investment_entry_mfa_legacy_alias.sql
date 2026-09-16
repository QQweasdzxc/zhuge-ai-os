begin;

-- Keep the pre-two-layer entry key synchronized for older deployed pages.
-- This changes only the Creator security preference, never Investment data.
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

  if v_setting_key = 'investment_entry_mfa_required' then
    insert into public.user_settings (user_id, setting_key, setting_value, created_at, updated_at)
    values (v_legacy_user_id, 'investment_mfa_required', to_jsonb(v_required), now(), now())
    on conflict (user_id, setting_key)
    do update set setting_value = excluded.setting_value, updated_at = now();
  end if;

  return jsonb_build_object(
    'user_id', v_auth_user_id,
    'setting_key', v_setting_key,
    'required', v_required
  );
end;
$function$;

commit;
