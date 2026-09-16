-- Global Floating Hub + canonical app access approval, Phase 1.
--
-- App approval is an application-access boundary, not a replacement for
-- Supabase Auth or the existing creator resolver.  The event table is private
-- and append-only; the public RPCs below are the only browser-facing surface.

create schema if not exists private;

create table if not exists private.app_access_application_events (
  event_no bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  application_id uuid not null default gen_random_uuid(),
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in (
    'approved_bootstrap',
    'application_submitted',
    'application_approved',
    'application_rejected'
  )),
  email_snapshot text not null check (length(btrim(email_snapshot)) > 0),
  display_name text,
  reason text,
  reviewer_user_id uuid references auth.users(id) on delete restrict,
  review_note text,
  source text not null default 'user_application',
  idempotency_key text,
  created_at timestamptz not null default clock_timestamp(),
  constraint app_access_application_events_submission_fields check (
    event_type <> 'application_submitted'
    or (length(btrim(coalesce(display_name, ''))) between 1 and 120
      and length(btrim(coalesce(reason, ''))) between 1 and 2000)
  ),
  constraint app_access_application_events_bootstrap_fields check (
    event_type <> 'approved_bootstrap'
    or length(btrim(coalesce(display_name, ''))) between 1 and 120
  ),
  constraint app_access_application_events_reviewer_fields check (
    event_type not in ('application_approved', 'application_rejected')
    or reviewer_user_id is not null
  ),
  constraint app_access_application_events_idempotency_key_length check (
    idempotency_key is null or length(btrim(idempotency_key)) between 1 and 160
  ),
  unique (applicant_user_id, idempotency_key)
);

create index if not exists app_access_application_events_applicant_idx
  on private.app_access_application_events (applicant_user_id, event_no desc);
create index if not exists app_access_application_events_application_idx
  on private.app_access_application_events (application_id, event_no);
create index if not exists app_access_application_events_type_idx
  on private.app_access_application_events (event_type, event_no desc);

create table if not exists private.creator_user_notes (
  subject_user_id uuid primary key references auth.users(id) on delete restrict,
  note text not null check (length(btrim(note)) between 1 and 1000),
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  updated_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

-- These tables are evidence and private annotation storage, never direct
-- Data API resources.  SECURITY DEFINER functions below run as the owner.
revoke all on schema private from public, anon, authenticated, service_role;
revoke all on table private.app_access_application_events from public, anon, authenticated, service_role;
revoke all on table private.creator_user_notes from public, anon, authenticated, service_role;
revoke all on sequence private.app_access_application_events_event_no_seq from public, anon, authenticated, service_role;

create or replace function private.prevent_app_access_event_mutation()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, private, pg_temp
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'App access application history is append-only.';
end;
$function$;

drop trigger if exists app_access_application_events_immutable
  on private.app_access_application_events;
create trigger app_access_application_events_immutable
before update or delete on private.app_access_application_events
for each row execute function private.prevent_app_access_event_mutation();

create or replace function public.is_app_access_approved()
returns boolean
language sql
stable
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
  select auth.uid() is not null and exists (
    select 1
      from private.app_access_application_events latest
     where latest.applicant_user_id = auth.uid()
       and latest.event_no = (
         select max(current_event.event_no)
           from private.app_access_application_events current_event
          where current_event.applicant_user_id = auth.uid()
       )
       and latest.event_type in ('approved_bootstrap', 'application_approved')
  );
$function$;

revoke all on function public.is_app_access_approved() from public, anon;
grant execute on function public.is_app_access_approved() to authenticated;

create or replace function public.resolve_app_access()
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_latest private.app_access_application_events%rowtype;
  v_status text := 'NEW';
  v_application_id uuid;
  v_submitted_at timestamptz;
begin
  if v_user is null then
    return jsonb_build_object(
      'status', 'UNAUTHENTICATED',
      'user_id', null,
      'email', null,
      'history', '[]'::jsonb
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
    'status', v_status,
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

revoke all on function public.resolve_app_access() from public, anon;
grant execute on function public.resolve_app_access() to authenticated;

create or replace function public.submit_app_access_request(
  p_display_name text,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
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

revoke all on function public.submit_app_access_request(text, text, text) from public, anon;
grant execute on function public.submit_app_access_request(text, text, text) to authenticated;

create or replace function public.list_app_access_applications()
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
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

revoke all on function public.list_app_access_applications() from public, anon;
grant execute on function public.list_app_access_applications() to authenticated;

create or replace function public.get_app_access_application_history(p_application_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
begin
  if not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean, false)
     or not public.is_app_access_approved() then
    raise exception using errcode = '42501', message = 'Creator or owner approval is required.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'event_no', event.event_no,
        'event_id', event.event_id,
        'application_id', event.application_id,
        'applicant_user_id', event.applicant_user_id,
        'event_type', event.event_type,
        'email', event.email_snapshot,
        'display_name', event.display_name,
        'reason', event.reason,
        'reviewer_user_id', event.reviewer_user_id,
        'review_note', event.review_note,
        'source', event.source,
        'created_at', event.created_at
      ) order by event.event_no
    )
      from private.app_access_application_events event
     where event.application_id = p_application_id
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_app_access_application_history(uuid) from public, anon;
grant execute on function public.get_app_access_application_history(uuid) to authenticated;

create or replace function public.review_app_access_application(
  p_application_id uuid,
  p_decision text,
  p_review_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
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

revoke all on function public.review_app_access_application(uuid, text, text, text) from public, anon;
grant execute on function public.review_app_access_application(uuid, text, text, text) to authenticated;

create or replace function public.get_creator_user_notes()
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
begin
  if not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean, false)
     or not public.is_app_access_approved() then
    raise exception using errcode = '42501', message = 'Creator or owner approval is required.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'subject_user_id', note.subject_user_id,
        'email', user_row.email,
        'google_name', coalesce(user_row.raw_user_meta_data->>'full_name', user_row.raw_user_meta_data->>'name', ''),
        'note', note.note,
        'updated_at', note.updated_at
      ) order by note.updated_at desc
    )
      from private.creator_user_notes note
      join auth.users user_row on user_row.id = note.subject_user_id
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_creator_user_notes() from public, anon;
grant execute on function public.get_creator_user_notes() to authenticated;

create or replace function public.upsert_creator_user_note(
  p_subject_user_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
declare
  v_creator uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean, false)
     or not public.is_app_access_approved() then
    raise exception using errcode = '42501', message = 'Creator or owner approval is required.';
  end if;
  if p_subject_user_id is null or not exists (select 1 from auth.users where id = p_subject_user_id) then
    raise exception using errcode = '22023', message = 'Note subject identity is required.';
  end if;
  if length(v_note) > 1000 then
    raise exception using errcode = '22023', message = 'Creator note is too long.';
  end if;

  if v_note = '' then
    delete from private.creator_user_notes where subject_user_id = p_subject_user_id;
    return jsonb_build_object('subject_user_id', p_subject_user_id, 'deleted', true);
  end if;

  insert into private.creator_user_notes (
    subject_user_id, note, created_by_user_id, updated_by_user_id
  ) values (
    p_subject_user_id, v_note, v_creator, v_creator
  ) on conflict (subject_user_id) do update set
    note = excluded.note,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = clock_timestamp();

  return jsonb_build_object('subject_user_id', p_subject_user_id, 'deleted', false, 'updated', true);
end;
$function$;

revoke all on function public.upsert_creator_user_note(uuid, text) from public, anon;
grant execute on function public.upsert_creator_user_note(uuid, text) to authenticated;

-- One-time approved bootstrap evidence for the four existing Google users.
-- It records evidence only; it does not modify auth.users, app_users, or
-- user_profiles and is not a permanent code-level bypass.
insert into private.app_access_application_events (
  application_id,
  applicant_user_id,
  event_type,
  email_snapshot,
  display_name,
  source,
  idempotency_key
)
select
  gen_random_uuid(),
  user_row.id,
  'approved_bootstrap',
  user_row.email,
  left(btrim(coalesce(user_row.raw_user_meta_data->>'full_name', user_row.raw_user_meta_data->>'name', user_row.email, 'Google user')), 120),
  'pm_approved_bootstrap_evidence',
  'pm-approved-bootstrap-' || user_row.id::text
from auth.users user_row
where user_row.email is not null
  and exists (
    select 1 from auth.identities identity_row
     where identity_row.user_id = user_row.id
       and identity_row.provider = 'google'
  )
  and not exists (
    select 1 from private.app_access_application_events existing
     where existing.applicant_user_id = user_row.id
  );

-- Existing authenticated table policies remain the row-level source of truth;
-- this additional RESTRICTIVE policy adds the canonical app-access gate.
do $policy$
declare
  table_row record;
begin
  for table_row in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relrowsecurity
  loop
    if not exists (
      select 1 from pg_policies policy_row
       where policy_row.schemaname = 'public'
         and policy_row.tablename = table_row.table_name
         and policy_row.policyname = 'zhuge_app_access_approved_gate'
    ) then
      execute format(
        'create policy zhuge_app_access_approved_gate on public.%I as restrictive for all to authenticated using ((select public.is_app_access_approved())) with check ((select public.is_app_access_approved()))',
        table_row.table_name
      );
    end if;
  end loop;
end;
$policy$;

-- Board-backed reads and instance creation are SECURITY DEFINER surfaces, so
-- they also enforce the app-access boundary explicitly.
create or replace function public.board_instance_can_read(p_board_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path to pg_catalog, public, auth, private, pg_temp
as $function$
  select public.is_app_access_approved() and auth.uid() is not null and exists (
    select 1
      from public.board_instances instance
     where instance.id = p_board_instance_id
       and instance.active = true
       and (
         (instance.authorization_mode = 'engineering' and public.is_engineering_member())
         or (instance.authorization_mode = 'owner' and instance.owner_uuid = auth.uid())
       )
  );
$function$;

create or replace function public.board_create_instance(
  p_name text,
  p_task_code_prefix text,
  p_template_key text default 'c'
)
returns public.board_instances
language plpgsql
security definer
set search_path to pg_catalog, public, auth, private, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := upper(btrim(coalesce(p_task_code_prefix, '')));
  v_template text := lower(btrim(coalesce(p_template_key, 'c')));
  v_row public.board_instances;
begin
  if v_user is null or not public.is_app_access_approved() then
    raise exception using errcode = '42501', message = 'Approved Zhuge AI OS access is required.';
  end if;
  if length(v_name) = 0 or v_prefix !~ '^[A-Z][A-Z0-9]{1,15}$' or length(v_template) = 0 then
    raise exception using errcode = '22023', message = 'Board name, task-code prefix, and template key are required';
  end if;
  insert into public.board_instances (
    name, task_code_prefix, template_key, authorization_mode, owner_uuid, created_by
  ) values (
    v_name, v_prefix, v_template, 'owner', v_user, v_user
  ) returning * into v_row;
  return v_row;
end;
$function$;

/* The existing v2 provisioning contract already calls board_create_instance;
   the gated board_create_instance above is the minimal app-access integration.
   Keep the original v2 definition untouched rather than redefining C here.
create or replace function public.board_provision_c_consumer_v2(
  p_name text,
  p_task_code_prefix text,
  p_template_key text default 'c',
  p_application_scope text default null,
  p_workspace_blueprint jsonb default null,
  p_workflow_blueprint jsonb default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public, auth, private, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := upper(btrim(coalesce(p_task_code_prefix, '')));
  v_template text := lower(btrim(coalesce(p_template_key, 'c')));
  v_scope text := nullif(lower(btrim(coalesce(p_application_scope, ''))), '');
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_request_hash text := md5(concat_ws('|', v_name, v_prefix, v_template, coalesce(v_scope, ''), coalesce(p_workspace_blueprint::text, ''), coalesce(p_workflow_blueprint::text, '')));
  v_existing private.board_c_consumer_provision_idempotency%rowtype;
  v_instance public.board_instances%rowtype;
  v_release public.module_releases%rowtype;
  v_workspace jsonb;
  v_workspace_id uuid;
  v_workspace_key text;
  v_workspace_blueprint jsonb := coalesce(
    p_workspace_blueprint,
    jsonb_build_array(
      jsonb_build_object('workspace_key', 'todo', 'name', '待辦', 'sort_order', 10),
      jsonb_build_object('workspace_key', 'working', 'name', '處理中', 'sort_order', 20),
      jsonb_build_object('workspace_key', 'review', 'name', '待驗收', 'sort_order', 30),
      jsonb_build_object('workspace_key', 'completed', 'name', '完成', 'sort_order', 40)
    )
  );
  v_workspace_map jsonb := '{}'::jsonb;
  v_workflow jsonb;
  v_step jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_workflow_response jsonb;
  v_published_workflow_response jsonb;
  v_workflow_version_id uuid;
  v_workspaces jsonb;
  v_adoption jsonb;
  v_response jsonb;
begin
  if v_user is null or not public.is_app_access_approved() then
    raise exception using errcode = '42501', message = 'Approved Zhuge AI OS access is required.';
  end if;
  if not exists (
    select 1 from public.app_users au
    where au.auth_user_id = v_user
      and lower(trim(au.role)) in ('creator', 'owner')
  ) then
    raise exception using errcode = '42501', message = 'Creator or owner permission required to create a C Consumer';
  end if;
  if v_template <> 'c' then
    raise exception using errcode = '22023', message = 'Module C provisioning requires template key C';
  end if;
  if v_name = '' or v_prefix !~ '^[A-Z][A-Z0-9]{1,15}$' then
    raise exception using errcode = '22023', message = 'Board name and task-code prefix are required';
  end if;
  if v_scope is not null and v_scope !~ '^[a-z][a-z0-9_-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Application scope format is invalid';
  end if;
  if v_idempotency_key is null then
    raise exception using errcode = '22023', message = 'C Consumer provisioning requires an idempotency key';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_idempotency_key, 0));
  select * into v_existing
    from private.board_c_consumer_provision_idempotency
   where idempotency_key = v_idempotency_key
     and expires_at > now()
   for update;
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '40001', message = 'C Consumer provisioning Idempotency Key 已用於不同內容。';
    end if;
    return v_existing.response || jsonb_build_object('idempotent', true);
  end if;
  if exists (select 1 from public.board_instances where task_code_prefix = v_prefix) then
    raise exception using errcode = '23505', message = 'Board code is already in use';
  end if;
  if v_scope is not null and exists (select 1 from public.board_instances where legacy_application_scope = v_scope) then
    raise exception using errcode = '23505', message = 'Application scope is already assigned';
  end if;
  select * into v_release
    from public.module_releases
   where module_id = v_template
   for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Published Module C release is unavailable';
  end if;
  v_instance := public.board_create_instance(v_name, v_prefix, v_template);
  if v_scope is not null then
    update public.board_instances
       set legacy_application_scope = v_scope, updated_at = now()
     where id = v_instance.id
     returning * into v_instance;
  end if;
  if jsonb_typeof(v_workspace_blueprint) <> 'array' or jsonb_array_length(v_workspace_blueprint) = 0 then
    raise exception using errcode = '22023', message = 'C Consumer workspace blueprint must be a non-empty array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_workspace_blueprint) entry
     group by lower(btrim(entry->>'workspace_key')) having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'C Consumer workspace blueprint contains duplicate keys';
  end if;
  for v_workspace in select value from jsonb_array_elements(v_workspace_blueprint) loop
    v_workspace_key := lower(btrim(v_workspace->>'workspace_key'));
    if v_workspace_key !~ '^[a-z][a-z0-9_-]{0,63}$' or nullif(btrim(v_workspace->>'name'), '') is null then
      raise exception using errcode = '22023', message = 'C Consumer workspace blueprint contains an invalid workspace';
    end if;
    insert into public.board_workspaces (
      board_instance_id, workspace_key, name, sort_order, active,
      application_scope, owner_uuid, created_by, updated_by
    ) values (
      v_instance.id, v_workspace_key, btrim(v_workspace->>'name'), coalesce((v_workspace->>'sort_order')::integer, 0),
      coalesce((v_workspace->>'active')::boolean, true), v_scope, v_user, v_user, v_user
    ) returning id into v_workspace_id;
    v_workspace_map := v_workspace_map || jsonb_build_object(v_workspace_key, v_workspace_id::text);
  end loop;
  if p_workflow_blueprint is null then
    v_workflow := jsonb_build_object(
      'name', v_name || ' 流程',
      'description', '由 Module C 建立的子板起始流程；流程資料屬於本 Board Instance。',
      'transitions', jsonb_build_array(
        jsonb_build_object('transition_key', 'todo-to-working', 'from_step_key', 'todo', 'to_step_key', 'working', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'todo-to-review', 'from_step_key', 'todo', 'to_step_key', 'review', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'todo-to-completed', 'from_step_key', 'todo', 'to_step_key', 'completed', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'working-to-todo', 'from_step_key', 'working', 'to_step_key', 'todo', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'working-to-review', 'from_step_key', 'working', 'to_step_key', 'review', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'working-to-completed', 'from_step_key', 'working', 'to_step_key', 'completed', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'review-to-todo', 'from_step_key', 'review', 'to_step_key', 'todo', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'review-to-working', 'from_step_key', 'review', 'to_step_key', 'working', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'review-to-completed', 'from_step_key', 'review', 'to_step_key', 'completed', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'completed-to-todo', 'from_step_key', 'completed', 'to_step_key', 'todo', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'completed-to-working', 'from_step_key', 'completed', 'to_step_key', 'working', 'allowed_roles', jsonb_build_array('pm')),
        jsonb_build_object('transition_key', 'completed-to-review', 'from_step_key', 'completed', 'to_step_key', 'review', 'allowed_roles', jsonb_build_array('pm'))
      ),
      'gates', jsonb_build_array(jsonb_build_object('step_key', 'completed', 'gate_key', 'completion-decision', 'name', 'PM Completion Decision', 'required', true, 'human_action_required', true, 'completion_role', 'pm', 'failure_policy', 'stay')),
      'evidence_requirements', jsonb_build_array(jsonb_build_object('gate_key', 'completion-decision', 'evidence_key', 'pm-action-context', 'label', 'PM Completion Decision', 'required', true, 'source_kind', 'pm_action_context'))
    );
    v_steps := jsonb_build_array(
      jsonb_build_object('step_key', 'todo', 'name', '待辦', 'sort_order', 10, 'role_key', 'co', 'workspace_id', v_workspace_map->>'todo', 'status_key', 'ready', 'is_initial', true, 'is_completion', false),
      jsonb_build_object('step_key', 'working', 'name', '處理中', 'sort_order', 20, 'role_key', 'co', 'workspace_id', v_workspace_map->>'working', 'status_key', 'inprogress', 'is_initial', false, 'is_completion', false),
      jsonb_build_object('step_key', 'review', 'name', '待驗收', 'sort_order', 30, 'role_key', 'qjc', 'workspace_id', v_workspace_map->>'review', 'status_key', 'qa', 'is_initial', false, 'is_completion', false),
      jsonb_build_object('step_key', 'completed', 'name', '完成', 'sort_order', 40, 'role_key', 'pm', 'workspace_id', v_workspace_map->>'completed', 'status_key', 'done', 'is_initial', false, 'is_completion', true)
    );
  else
    if jsonb_typeof(p_workflow_blueprint) <> 'object' then
      raise exception using errcode = '22023', message = 'C Consumer workflow blueprint must be an object';
    end if;
    v_workflow := p_workflow_blueprint;
    if jsonb_typeof(coalesce(v_workflow->'steps', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(v_workflow->'steps', '[]'::jsonb)) = 0 then
      raise exception using errcode = '22023', message = 'C Consumer workflow blueprint must contain steps';
    end if;
    for v_step in select value from jsonb_array_elements(v_workflow->'steps') loop
      v_workspace_key := lower(btrim(v_step->>'workspace_key'));
      if not (v_workspace_map ? v_workspace_key) then
        raise exception using errcode = '22023', message = 'C Consumer workflow step references an unknown workspace';
      end if;
      v_step := jsonb_set(v_step - 'workspace_key', '{workspace_id}', to_jsonb(v_workspace_map->>v_workspace_key), true);
      v_steps := v_steps || jsonb_build_array(v_step);
    end loop;
  end if;
  if nullif(btrim(v_workflow->>'name'), '') is null then
    raise exception using errcode = '22023', message = 'C Consumer workflow name is required';
  end if;
  v_workflow_response := public.board_c_workflow_save_draft(v_instance.id, btrim(v_workflow->>'name'), nullif(btrim(v_workflow->>'description'), ''), v_steps, coalesce(v_workflow->'transitions', '[]'::jsonb), coalesce(v_workflow->'gates', '[]'::jsonb), coalesce(v_workflow->'evidence_requirements', '[]'::jsonb), null, 'c-provision-draft-' || v_idempotency_key);
  v_workflow_version_id := (v_workflow_response #>> '{workflow,id}')::uuid;
  if v_workflow_version_id is null then
    raise exception using errcode = 'P0002', message = 'C Consumer workflow draft was not created';
  end if;
  v_published_workflow_response := public.board_c_workflow_publish(v_workflow_version_id, null, 'c-provision-publish-' || v_idempotency_key);
  v_adoption := jsonb_build_object('status', 'adopted', 'module_version', v_release.published_version, 'build', v_release.published_build, 'source_commit', v_release.source_commit, 'source_fingerprint', v_release.source_fingerprint, 'published_at', v_release.published_at, 'adopted_at', now(), 'adopted_by', v_user, 'template_key', 'c', 'workflow_version_id', v_workflow_version_id);
  update public.module_releases
     set consumer_adoptions = jsonb_set(coalesce(consumer_adoptions, '{}'::jsonb), array[v_instance.id::text], v_adoption, true), updated_at = now()
   where module_id = 'c';
  if not found then
    raise exception using errcode = 'P0002', message = 'Published Module C adoption persistence failed';
  end if;
  select coalesce(jsonb_agg(to_jsonb(workspace) order by workspace.sort_order), '[]'::jsonb)
    into v_workspaces from public.board_workspaces workspace
   where workspace.board_instance_id = v_instance.id and workspace.active = true;
  v_response := jsonb_build_object('contract', 'module-c-consumer-provisioning-v2', 'capability', 'c-native-consumer-provisioning', 'contract_version', 'module-c-lifecycle-acceptance-v2', 'board_instance', to_jsonb(v_instance), 'board_instance_id', v_instance.id, 'template_key', 'c', 'application_scope', v_scope, 'workspaces', v_workspaces, 'published_release', to_jsonb(v_release), 'module_adoption', v_adoption, 'workflow', v_published_workflow_response->'workflow', 'workflow_version_id', v_workflow_version_id, 'shared_runtime', 'module-c-golden-master-runtime', 'shared_authority', 'module-c-canonical-contract', 'atomic', true, 'idempotent', false, 'fail_closed', true, 'card_mutation', 0);
  insert into private.board_c_consumer_provision_idempotency (idempotency_key, request_hash, board_instance_id, response, status)
  values (v_idempotency_key, v_request_hash, v_instance.id, v_response, 'completed');
  return v_response;
end;
$function$;

revoke all on function public.board_provision_c_consumer_v2(text, text, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.board_provision_c_consumer_v2(text, text, text, text, jsonb, jsonb, text) to authenticated;
*/

-- Realtime Presence is ephemeral.  Only approved authenticated users may
-- listen to or track the single shared presence topic.
do $presence$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'realtime'
       and tablename = 'messages'
       and policyname = 'zhuge_app_presence_read'
  ) then
    create policy zhuge_app_presence_read
      on realtime.messages for select to authenticated
      using (
        (select public.is_app_access_approved())
        and realtime.topic() = 'zhuge-app-presence-v1'
        and extension = 'presence'
      );
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'realtime'
       and tablename = 'messages'
       and policyname = 'zhuge_app_presence_track'
  ) then
    create policy zhuge_app_presence_track
      on realtime.messages for insert to authenticated
      with check (
        (select public.is_app_access_approved())
        and realtime.topic() = 'zhuge-app-presence-v1'
        and extension = 'presence'
      );
  end if;
end;
$presence$;
