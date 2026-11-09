-- Historical baseline of the SQL deployed ad hoc on 2026-11-06.
-- Filename orders the 17:38:52 Asia/Taipei approval (09:38:52 UTC), NOT
-- a claimed Supabase migration-history version. Main must reconcile history
-- before deployment. This file was added to the repository by ZG-71.
-- Replay safety differs intentionally from the supplied original:
-- ON CONFLICT DO NOTHING preserves the current flag, including false.
begin;
create table if not exists private.app_access_settings (
 key text primary key,
 value jsonb not null,
 updated_at timestamptz not null default now()
);
revoke all on table private.app_access_settings from public, anon, authenticated, service_role;
insert into private.app_access_settings(key,value) values('review_paused','true'::jsonb)
on conflict(key) do nothing;
create or replace function public.app_access_review_paused()
returns boolean language sql stable security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
 select coalesce((select (s.value #>> '{}')::boolean from private.app_access_settings s where s.key='review_paused'),false);
$function$;
CREATE OR REPLACE FUNCTION public.is_app_access_approved()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'private', 'public', 'pg_temp'
AS $function$
  select auth.uid() is not null and (
    public.app_access_review_paused()
    or exists (
      select 1
        from private.app_access_application_events latest
       where latest.applicant_user_id = auth.uid()
         and latest.event_no = (
           select max(current_event.event_no)
             from private.app_access_application_events current_event
            where current_event.applicant_user_id = auth.uid()
         )
         and latest.event_type in ('approved_bootstrap', 'application_approved')
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.resolve_app_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'private', 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_latest private.app_access_application_events%rowtype;
  v_status text := 'NEW';
  v_application_id uuid;
  v_submitted_at timestamptz;
  v_paused boolean := public.app_access_review_paused();
begin
  if v_user is null then
    return jsonb_build_object(
      'status', 'UNAUTHENTICATED',
      'user_id', null,
      'email', null,
      'history', '[]'::jsonb,
      'review_paused', v_paused
    );
  end if;

  select u.email into v_email from auth.users u where u.id = v_user;
  select * into v_latest
    from private.app_access_application_events event
   where event.applicant_user_id = v_user
   order by event.event_no desc
   limit 1;

  if found then
    v_status := case v_latest.event_type
      when 'approved_bootstrap' then 'APPROVED'
      when 'application_approved' then 'APPROVED'
      when 'application_submitted' then 'PENDING'
      when 'application_rejected' then 'REJECTED'
      else 'UNKNOWN'
    end;
    v_application_id := v_latest.application_id;
    select min(event.created_at) into v_submitted_at
      from private.app_access_application_events event
     where event.application_id = v_latest.application_id;
  end if;

  return jsonb_build_object(
    'status', case when v_paused then 'APPROVED' else v_status end,
    'original_status', v_status,
    'review_paused', v_paused,
    'user_id', v_user,
    'email', v_email,
    'application_id', v_application_id,
    'display_name', v_latest.display_name,
    'reason', v_latest.reason,
    'review_note', v_latest.review_note,
    'submitted_at', v_submitted_at,
    'history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'event_no', event.event_no,
          'event_id', event.event_id,
          'application_id', event.application_id,
          'event_type', event.event_type,
          'display_name', event.display_name,
          'reason', event.reason,
          'review_note', event.review_note,
          'created_at', event.created_at
        ) order by event.event_no
      )
        from private.app_access_application_events event
       where event.applicant_user_id = v_user
    ), '[]'::jsonb)
  );
end;
$function$;
create or replace function public.set_app_access_review_paused(paused boolean)
returns jsonb language plpgsql security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
begin
 if auth.uid() is null or not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean,false) then
  raise exception using errcode='42501',message='Creator or owner approval is required.';
 end if;
 insert into private.app_access_settings(key,value) values('review_paused',to_jsonb(coalesce(paused,false)))
 on conflict(key) do update set value=excluded.value,updated_at=now();
 return jsonb_build_object('review_paused',coalesce(paused,false),'updated_at',now());
end;
$function$;
revoke all on function public.app_access_review_paused(), public.is_app_access_approved(),
 public.resolve_app_access(), public.set_app_access_review_paused(boolean) from public, anon;
grant execute on function public.app_access_review_paused(), public.is_app_access_approved(),
 public.resolve_app_access(), public.set_app_access_review_paused(boolean) to authenticated;
commit;
