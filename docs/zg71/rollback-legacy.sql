-- Main-only exact legacy rollback, never called by migration or browser.
-- Fail before any mutation if legacy readers would lose meaning of new decisions.
begin;
lock table private.app_access_application_events in exclusive mode;
do $$ begin
 if exists(select 1 from private.app_access_application_events where event_type in ('access_disabled','access_enabled'))
   or exists(select 1 from private.app_access_settings where key='access_model_cutoff') then
  raise exception 'Unsafe legacy rollback: preserve ZG71 readers/guard for new decisions or active cutoff; rollback UI/Edge first';
 end if;
end $$;
CREATE OR REPLACE FUNCTION public.app_access_review_paused()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'private', 'public', 'pg_temp'
AS $function$
  select coalesce((select (s.value #>> '{}')::boolean from private.app_access_settings s where s.key = 'review_paused'), false);
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

CREATE OR REPLACE FUNCTION public.list_app_access_applications()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'private', 'public', 'pg_temp'
AS $function$
begin
  if not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean, false)
     or not public.is_app_access_approved() then
    raise exception using errcode = '42501', message = 'Creator or owner approval is required.';
  end if;

  return (
    with latest as (
      select distinct on (event.application_id) event.*
        from private.app_access_application_events event
       order by event.application_id, event.event_no desc
    ), submitted as (
      select distinct on (event.application_id)
        event.application_id,
        event.display_name,
        event.reason,
        event.created_at as submitted_at
        from private.app_access_application_events event
       where event.event_type in ('approved_bootstrap', 'application_submitted')
       order by event.application_id, event.event_no asc
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'application_id', latest.application_id,
        'applicant_user_id', latest.applicant_user_id,
        'email', latest.email_snapshot,
        'display_name', coalesce(submitted.display_name, latest.display_name),
        'reason', submitted.reason,
        'status', case latest.event_type
          when 'approved_bootstrap' then 'APPROVED'
          when 'application_approved' then 'APPROVED'
          when 'application_submitted' then 'PENDING'
          when 'application_rejected' then 'REJECTED'
          else 'UNKNOWN'
        end,
        'submitted_at', submitted.submitted_at,
        'decided_at', case when latest.event_type in ('application_approved', 'application_rejected') then latest.created_at else null end,
        'review_note', latest.review_note,
        'latest_event_no', latest.event_no
      ) order by
        case latest.event_type when 'application_submitted' then 0 when 'application_rejected' then 1 else 2 end,
        latest.event_no desc
    ), '[]'::jsonb)
      from latest
      left join submitted using (application_id)
  );
end;
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

CREATE OR REPLACE FUNCTION public.review_app_access_application(p_application_id uuid, p_decision text, p_review_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'private', 'public', 'pg_temp'
AS $function$
declare
  v_reviewer uuid := auth.uid();
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_review_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_applicant uuid;
  v_email text;
  v_submission private.app_access_application_events%rowtype;
  v_latest private.app_access_application_events%rowtype;
begin
  if not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean, false)
     or not public.is_app_access_approved() then
    raise exception using errcode = '42501', message = 'Creator or owner approval is required.';
  end if;
  if v_decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'Decision must be approve or reject.';
  end if;
  if p_application_id is null then
    raise exception using errcode = '22023', message = 'Application identity is required.';
  end if;
  if v_review_note is not null and length(v_review_note) > 2000 then
    raise exception using errcode = '22023', message = 'Review note is too long.';
  end if;

  select event.applicant_user_id into v_applicant
    from private.app_access_application_events event
   where event.application_id = p_application_id
   order by event.event_no asc
   limit 1;
  if v_applicant is null then
    raise exception using errcode = 'P0002', message = 'Application was not found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_applicant::text, 0));
  select * into v_latest
    from private.app_access_application_events event
   where event.application_id = p_application_id
   order by event.event_no desc
   limit 1
   for update;

  if v_idempotency_key is not null and v_latest.idempotency_key = v_idempotency_key
     and v_latest.event_type in ('application_approved', 'application_rejected') then
    return jsonb_build_object(
      'application_id', p_application_id,
      'applicant_user_id', v_applicant,
      'status', case when v_latest.event_type = 'application_approved' then 'APPROVED' else 'REJECTED' end,
      'event_id', v_latest.event_id,
      'event_no', v_latest.event_no,
      'idempotent', true
    );
  end if;
  if v_latest.event_type <> 'application_submitted' then
    raise exception using errcode = '40001', message = 'Application has already been decided.';
  end if;

  select * into v_submission
    from private.app_access_application_events event
   where event.application_id = p_application_id
     and event.event_type = 'application_submitted'
   order by event.event_no asc
   limit 1;
  select u.email into v_email from auth.users u where u.id = v_applicant;

  insert into private.app_access_application_events (
    application_id,
    applicant_user_id,
    event_type,
    email_snapshot,
    display_name,
    reason,
    reviewer_user_id,
    review_note,
    source,
    idempotency_key
  ) values (
    p_application_id,
    v_applicant,
    case when v_decision = 'approve' then 'application_approved' else 'application_rejected' end,
    coalesce(v_email, v_submission.email_snapshot),
    v_submission.display_name,
    v_submission.reason,
    v_reviewer,
    v_review_note,
    'creator_review',
    v_idempotency_key
  ) returning * into v_latest;

  return jsonb_build_object(
    'application_id', p_application_id,
    'applicant_user_id', v_applicant,
    'status', case when v_decision = 'approve' then 'APPROVED' else 'REJECTED' end,
    'event_id', v_latest.event_id,
    'event_no', v_latest.event_no,
    'idempotent', false
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_app_access_review_paused(paused boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'private', 'public', 'pg_temp'
AS $function$
begin
  if not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean, false) then
    raise exception using errcode = '42501', message = 'Creator or owner approval is required.';
  end if;
  insert into private.app_access_settings (key, value)
  values ('review_paused', to_jsonb(coalesce(paused, false)))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('review_paused', coalesce(paused, false), 'updated_at', now());
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_app_access_request(p_display_name text, p_reason text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'auth', 'private', 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_latest private.app_access_application_events%rowtype;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated identity is required.';
  end if;
  if length(v_display_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Name or nickname must be 1 to 120 characters.';
  end if;
  if length(v_reason) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'Application reason must be 1 to 2000 characters.';
  end if;
  if v_idempotency_key is not null and length(v_idempotency_key) > 160 then
    raise exception using errcode = '22023', message = 'Application idempotency key is too long.';
  end if;

  select u.email into v_email from auth.users u where u.id = v_user;
  if length(btrim(coalesce(v_email, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Authenticated Google email is unavailable.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  if v_idempotency_key is not null and exists (
    select 1 from private.app_access_application_events event
     where event.applicant_user_id = v_user
       and event.idempotency_key = v_idempotency_key
  ) then
    return public.resolve_app_access();
  end if;

  select * into v_latest
    from private.app_access_application_events event
   where event.applicant_user_id = v_user
   order by event.event_no desc
   limit 1
   for update;

  if found and v_latest.event_type in ('approved_bootstrap', 'application_approved') then
    raise exception using errcode = '42501', message = 'This Zhuge AI OS identity is already approved.';
  end if;
  if found and v_latest.event_type = 'application_submitted' then
    return public.resolve_app_access();
  end if;

  insert into private.app_access_application_events (
    application_id,
    applicant_user_id,
    event_type,
    email_snapshot,
    display_name,
    reason,
    source,
    idempotency_key
  ) values (
    gen_random_uuid(),
    v_user,
    'application_submitted',
    v_email,
    v_display_name,
    v_reason,
    'user_application',
    v_idempotency_key
  );

  return public.resolve_app_access();
end;
$function$;
drop trigger if exists app_access_switch_guard on private.app_access_application_events;
drop function if exists public.set_app_access_user_enabled(uuid,boolean,text,text);
drop function if exists public.ensure_app_member();
drop function if exists private.activate_app_access_model();
drop function if exists private.guard_app_access_switch();
drop function if exists private.app_access_member_identities();
drop function if exists private.app_access_effective_allowed(uuid);
-- Membership, snapshots and all event rows/expanded constraints are retained.
-- Do not restore the old event CHECK until ALL new event types are absent.
commit;
