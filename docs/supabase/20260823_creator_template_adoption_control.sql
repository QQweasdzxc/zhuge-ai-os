-- Creator-only System Template Adoption Control
--
-- A/B/C remain one canonical presentation framework.  This Cloud preference
-- only records page adoption.  It does not participate in Auth, MFA, RLS,
-- data permissions, or domain data writes.
--
-- Browser table DML is not used.  Both reads and writes go through the guarded
-- RPC boundary and reuse the existing app_users Creator/Owner capability.

begin;

create or replace function public.get_creator_template_adoption_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_legacy_user_id uuid;
  v_policy jsonb;
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

  select setting_value
    into v_policy
  from public.user_settings
  where user_id = v_legacy_user_id
    and setting_key = 'template_adoption_policy_v1'
    and jsonb_typeof(setting_value) = 'object'
  limit 1;

  return jsonb_build_object(
    'user_id', v_auth_user_id,
    'is_creator', true,
    'version', 1,
    'template_adoption', coalesce(v_policy, '{}'::jsonb)
  );
end;
$$;

create or replace function public.set_creator_template_adoption_preference(
  p_page_id text,
  p_template_id text,
  p_enabled boolean default false
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
  v_page_id text := lower(trim(coalesce(p_page_id, '')));
  v_template_id text := lower(trim(coalesce(p_template_id, '')));
  v_policy jsonb;
  v_pages jsonb;
  v_enabled boolean := coalesce(p_enabled, false);
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'Authenticated Session is required';
  end if;

  if v_page_id not in ('dashboard', 'worklog', 'library', 'sync', 'settings', 'investment', 'ai-board', 'tasks-new') then
    raise exception using errcode = '22023', message = 'Unsupported template page';
  end if;
  if v_template_id not in ('navigation', 'workspace', 'board') then
    raise exception using errcode = '22023', message = 'Unsupported system template';
  end if;
  if (v_page_id = 'dashboard' and v_template_id <> 'navigation')
    or (v_page_id in ('worklog', 'library', 'sync', 'settings', 'investment') and v_template_id not in ('navigation', 'workspace'))
    or (v_page_id in ('ai-board', 'tasks-new') and v_template_id not in ('navigation', 'board')) then
    raise exception using errcode = '22023', message = 'Template is not supported by this page';
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

  select setting_value
    into v_policy
  from public.user_settings
  where user_id = v_legacy_user_id
    and setting_key = 'template_adoption_policy_v1'
    and jsonb_typeof(setting_value) = 'object'
  limit 1;

  v_policy := coalesce(v_policy, '{}'::jsonb);
  v_pages := case when jsonb_typeof(v_policy->'pages') = 'object' then v_policy->'pages' else '{}'::jsonb end;
  v_pages := jsonb_set(v_pages, array[v_page_id, v_template_id], to_jsonb(v_enabled), true);
  v_policy := jsonb_set(v_policy, '{version}', '1'::jsonb, true);
  v_policy := jsonb_set(v_policy, '{pages}', v_pages, true);

  insert into public.user_settings (user_id, setting_key, setting_value, created_at, updated_at)
  values (v_legacy_user_id, 'template_adoption_policy_v1', v_policy, now(), now())
  on conflict (user_id, setting_key)
  do update set setting_value = excluded.setting_value, updated_at = now();

  return jsonb_build_object(
    'user_id', v_auth_user_id,
    'page_id', v_page_id,
    'template_id', v_template_id,
    'enabled', v_enabled
  );
end;
$$;

revoke execute on function public.get_creator_template_adoption_preferences() from public, anon;
grant execute on function public.get_creator_template_adoption_preferences() to authenticated;

revoke execute on function public.set_creator_template_adoption_preference(text, text, boolean) from public, anon;
grant execute on function public.set_creator_template_adoption_preference(text, text, boolean) to authenticated;

commit;
