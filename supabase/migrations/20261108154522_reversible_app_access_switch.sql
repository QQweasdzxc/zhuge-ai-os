-- ZG-71. Deploy separately after review. No data writes/backfill/default changes.
-- Requires deployed 2026-11-06 pause functions; fail before DDL if absent.
begin;
do $$ begin
  if to_regprocedure('public.app_access_review_paused()') is null then
    raise exception 'Deploy the existing review-pause migration first';
  end if;
end $$;
alter table private.app_access_application_events
  drop constraint app_access_application_events_event_type_check,
  add constraint app_access_application_events_event_type_check check (event_type in
    ('approved_bootstrap','application_submitted','application_approved','application_rejected','access_disabled','access_enabled')),
  drop constraint app_access_application_events_reviewer_fields,
  add constraint app_access_application_events_reviewer_fields check (
    event_type not in ('application_approved','application_rejected','access_disabled','access_enabled')
    or reviewer_user_id is not null);

-- Server-owned membership and one-time App-scoped compatibility snapshot.
create table if not exists private.app_access_members (
 user_id uuid primary key references auth.users(id), email text not null,
 display_name text, first_seen_at timestamptz not null default clock_timestamp()
);
create table if not exists private.app_access_grandfathers (
 user_id uuid primary key references auth.users(id), captured_at timestamptz not null default clock_timestamp()
);
alter table private.app_access_members enable row level security;
alter table private.app_access_grandfathers enable row level security;
revoke all on private.app_access_members, private.app_access_grandfathers from public, anon, authenticated, service_role;

create or replace function private.app_access_effective_allowed(p_user_id uuid)
returns boolean language sql stable security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
 select p_user_id is not null and coalesce((
  select case when e.event_type='access_disabled' then false
   when e.event_type in ('approved_bootstrap','application_approved','access_enabled') then true
   else public.app_access_review_paused() and (
    not exists(select 1 from private.app_access_settings where key='access_model_cutoff')
    or (exists(select 1 from private.app_access_grandfathers g where g.user_id=p_user_id)
     and not (e.event_type in ('application_submitted','application_rejected') and e.created_at >=
       (select (value #>> '{}')::timestamptz from private.app_access_settings where key='access_model_cutoff')))
   ) end
  from private.app_access_application_events e where e.applicant_user_id=p_user_id
  order by e.event_no desc limit 1
 ), public.app_access_review_paused() and (
   not exists(select 1 from private.app_access_settings where key='access_model_cutoff')
   or exists(select 1 from private.app_access_grandfathers g where g.user_id=p_user_id)
 ));
$function$;
revoke all on function private.app_access_effective_allowed(uuid) from public, anon, authenticated, service_role;
create or replace function public.is_app_access_approved()
returns boolean language sql stable security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
 select private.app_access_effective_allowed(auth.uid());
$function$;

-- No parameters: callers cannot select a target or supply/backdate evidence.
create or replace function public.ensure_app_member()
returns jsonb language plpgsql security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
declare v_user uuid := auth.uid();
begin
 if v_user is null then raise exception using errcode='42501',message='Authenticated identity is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('app_access_model_activation',0));
 insert into private.app_access_members(user_id,email,display_name)
 select id,coalesce(email,''),coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name','')
 from auth.users where id=v_user on conflict(user_id) do nothing;
 return jsonb_build_object('user_id',v_user);
end;
$function$;
revoke all on function public.ensure_app_member() from public, anon, service_role;
grant execute on function public.ensure_app_member() to authenticated;

create or replace FUNCTION public.resolve_app_access()
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
      'effective_allowed', false,
      'enabled', false,
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
      when 'access_disabled' then 'REJECTED'
      when 'access_enabled' then 'APPROVED'
      else 'UNKNOWN'
    end;
    v_application_id := v_latest.application_id;
    select min(event.created_at) into v_submitted_at
      from private.app_access_application_events event
     where event.application_id = v_latest.application_id;
  end if;

  return jsonb_build_object(
    'status', case when private.app_access_effective_allowed(v_user) then 'APPROVED' when v_latest.event_type='access_disabled' then 'REJECTED' else v_status end,
    'effective_allowed', private.app_access_effective_allowed(v_user),
    'access_model_active', exists(select 1 from private.app_access_settings where key='access_model_cutoff'),
    'access_disabled', coalesce(v_latest.event_type = 'access_disabled', false),
    'enabled', public.is_app_access_approved(),
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


-- App evidence only. Never enumerate auth.users as a membership source.
create or replace function private.app_access_member_identities()
returns table(user_id uuid, display_name text, email text, member_since timestamptz)
language sql stable security definer
set search_path to pg_catalog, public, private, pg_temp
as $function$
  select distinct on (s.user_id) s.user_id, s.display_name, s.email, s.member_since
  from (
    select auth_user_id as user_id, display_name, email, created_at as member_since, 1 as priority from public.app_users
    union all select user_uuid, display_name, email, created_at, 2 from public.user_profiles
    union all select auth_user_id, display_name, email, created_at, 3 from public.worklog_users
    union all select applicant_user_id, display_name, email_snapshot, created_at, 4 from private.app_access_application_events
    union all select user_id, display_name, email, first_seen_at, 5 from private.app_access_members
  ) s where s.user_id is not null
  order by s.user_id, s.priority, s.member_since;
$function$;
revoke all on function private.app_access_member_identities() from public, anon, authenticated, service_role;

-- One row per person. Existing fields retain their meaning; history RPC stays intact.
create or replace function public.list_app_access_applications()
returns jsonb language plpgsql stable security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
begin
  if auth.uid() is null
    or not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean,false)
    or not public.is_app_access_approved() then
    raise exception using errcode='42501', message='Creator or owner approval is required.';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'application_id', e.application_id, 'applicant_user_id', m.user_id,
      'display_name', coalesce(e.display_name,m.display_name), 'email', coalesce(u.email,m.email,e.email_snapshot),
      'reason', e.reason, 'review_note', e.review_note,
      'status', case e.event_type when 'application_submitted' then 'PENDING'
        when 'application_rejected' then 'REJECTED' when 'access_disabled' then 'REJECTED'
        when 'access_enabled' then 'APPROVED' when 'application_approved' then 'APPROVED'
        when 'approved_bootstrap' then 'APPROVED' else 'NEW' end,
      'effective_allowed', private.app_access_effective_allowed(m.user_id),
      'enabled', private.app_access_effective_allowed(m.user_id),
      'access_disabled', coalesce(e.event_type='access_disabled',false),
      'submitted_at', (select min(h.created_at) from private.app_access_application_events h
        where h.application_id=e.application_id and h.event_type='application_submitted'),
      'bootstrap', exists(select 1 from private.app_access_application_events h
        where h.applicant_user_id=m.user_id and h.event_type='approved_bootstrap'),
      'member_since', m.member_since,
      'decided_at', case when e.event_type in ('application_approved','application_rejected','access_disabled','access_enabled') then e.created_at end,
      'latest_event_no', e.event_no,
      'is_creator', exists(select 1 from public.app_users c where c.auth_user_id=m.user_id and lower(btrim(coalesce(c.role,''))) in ('creator','owner'))
    ) order by m.member_since, m.user_id),'[]'::jsonb)
    from private.app_access_member_identities() m
    join auth.users u on u.id=m.user_id
    left join lateral (select * from private.app_access_application_events h where h.applicant_user_id=m.user_id order by h.event_no desc limit 1) e on true
  );
end;
$function$;

create or replace function public.set_app_access_user_enabled(
  p_applicant_user_id uuid, p_enabled boolean, p_note text default null, p_idempotency_key text default null
)
returns jsonb language plpgsql security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
declare
  v_reviewer uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_latest private.app_access_application_events%rowtype;
  v_prior private.app_access_application_events%rowtype;
  v_member record;
  v_event text;
begin
  if v_reviewer is null
    or not coalesce((public.resolve_creator_capability()->>'is_creator')::boolean,false)
    or not public.is_app_access_approved() then
    raise exception using errcode='42501', message='Creator or owner approval is required.';
  end if;
  if p_applicant_user_id is null or p_enabled is null or length(coalesce(v_note,''))>2000
    or length(coalesce(v_key,''))>160 then
    raise exception using errcode='22023', message='Invalid user, enabled, note or idempotency key.';
  end if;
  if not p_enabled and (p_applicant_user_id=v_reviewer or exists(
    select 1 from public.app_users c where c.auth_user_id=p_applicant_user_id and lower(btrim(coalesce(c.role,''))) in ('creator','owner')
  )) then
    raise exception using errcode='42501', message='Cannot disable yourself or a creator.';
  end if;
  select * into v_member from private.app_access_member_identities() where user_id=p_applicant_user_id;
  if not found then raise exception using errcode='P0002', message='App member not found.'; end if;

  -- Same serialization key as legacy submit/review.
  perform pg_advisory_xact_lock(hashtextextended(p_applicant_user_id::text,0));
  if v_key is not null then
    select * into v_prior from private.app_access_application_events
      where applicant_user_id=p_applicant_user_id and idempotency_key=v_key;
    if found then
      if v_prior.source<>'creator_access_switch' or v_prior.reviewer_user_id<>v_reviewer
        or (v_prior.event_type in ('access_enabled','application_approved'))<>p_enabled
        or v_prior.review_note is distinct from v_note then
        raise exception using errcode='22023', message='Idempotency key was used for another action.';
      end if;
      return jsonb_build_object('event_no',v_prior.event_no,'idempotent',true);
    end if;
  end if;
  select * into v_latest from private.app_access_application_events
    where applicant_user_id=p_applicant_user_id order by event_no desc limit 1;
  v_event := case when not p_enabled then 'access_disabled'
    when v_latest.event_type='application_submitted' then 'application_approved' else 'access_enabled' end;
  insert into private.app_access_application_events(
    application_id, applicant_user_id, event_type, email_snapshot, display_name, reason,
    reviewer_user_id, review_note, source, idempotency_key
  ) values (
    coalesce(v_latest.application_id,gen_random_uuid()),p_applicant_user_id,v_event,
    coalesce((select email from auth.users where id=p_applicant_user_id),v_latest.email_snapshot,v_member.email),
    coalesce(v_latest.display_name,v_member.display_name),v_latest.reason,
    v_reviewer,v_note,'creator_access_switch',v_key
  ) returning * into v_prior;
  return jsonb_build_object('event_no',v_prior.event_no,'application_id',v_prior.application_id,'enabled',p_enabled,'idempotent',false);
end;
$function$;

-- Prevent a legacy re-application or stale legacy review from replacing explicit Off.
-- No existing row is touched. All public writers already use this same lock.
create or replace function private.guard_app_access_switch()
returns trigger language plpgsql security definer
set search_path to pg_catalog, private, pg_temp
as $function$
declare v_latest private.app_access_application_events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.applicant_user_id::text,0));
  select * into v_latest from private.app_access_application_events
    where applicant_user_id=new.applicant_user_id order by event_no desc limit 1;
  if new.event_type='application_submitted' and v_latest.event_type in ('access_disabled','access_enabled') then
    raise exception using errcode='42501', message='Only an administrator can change this access decision.';
  end if;
  if new.event_type in ('application_approved','application_rejected') and new.source<>'creator_access_switch'
    and (v_latest.event_type<>'application_submitted' or v_latest.application_id<>new.application_id) then
    raise exception using errcode='40001', message='Application has already been decided.';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_app_access_switch() from public, anon, authenticated, service_role;
drop trigger if exists app_access_switch_guard on private.app_access_application_events;
create trigger app_access_switch_guard before insert on private.app_access_application_events
for each row execute function private.guard_app_access_switch();

revoke all on function public.is_app_access_approved() from public, anon;
revoke all on function public.resolve_app_access() from public, anon;
revoke all on function public.list_app_access_applications() from public, anon;
revoke all on function public.set_app_access_user_enabled(uuid,boolean,text,text) from public, anon, service_role;
grant execute on function public.is_app_access_approved(), public.resolve_app_access(), public.list_app_access_applications(),
  public.set_app_access_user_enabled(uuid,boolean,text,text) to authenticated;
-- Owner-only activation. Migration NEVER calls this function or sets cutoff.
-- Snapshot membership, not user-controlled created_at. Existing events unchanged.
create or replace function private.activate_app_access_model(p_expected_allowed integer)
returns jsonb language plpgsql security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
declare v_cutoff timestamptz; v_ids uuid[]; v_allowed integer; v_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('app_access_model_activation',0));
 -- Serialization: block concurrent decisions/first-login events and pause changes
 -- until this transaction commits. Writers waiting here insert their events after
 -- commit with their own server clock_timestamp(), so they are after the cutoff;
 -- anything committed before the lock is part of the frozen state. The cutoff is
 -- read AFTER the locks, so server-clock order and commit order agree.
 lock table private.app_access_application_events, private.app_access_settings in share row exclusive mode;
 v_cutoff := clock_timestamp();
 if exists(select 1 from private.app_access_settings where key='access_model_cutoff') then
  raise exception 'Access model already activated; do not recreate the snapshot';
 end if;
 -- One-time freeze of the people who are effectively allowed at this instant, so
 -- activation changes nobody's current access. Explicit access_disabled is not
 -- effectively allowed and is never captured. The identities are read inside the
 -- database only; the result is a count, with no list, no member or card rows.
 -- The set is read once; an Auth identity created after this read is neither
 -- counted nor frozen, so it starts pending/Off like any later newcomer.
 select coalesce(array_agg(u.id),'{}') into v_ids from auth.users u where private.app_access_effective_allowed(u.id);
 v_allowed := cardinality(v_ids);
 if p_expected_allowed is null or p_expected_allowed<0 or v_allowed<>p_expected_allowed then
  raise exception 'Activation blocked: currently allowed count changed; review aggregates';
 end if;
 insert into private.app_access_grandfathers(user_id) select unnest(v_ids) on conflict do nothing;
 get diagnostics v_count = row_count;
 insert into private.app_access_settings(key,value) values('access_model_cutoff',to_jsonb(v_cutoff));
 return jsonb_build_object('cutoff',v_cutoff,'grandfather_count',v_count,'currently_allowed_count',v_allowed);
end;
$function$;
revoke all on function private.activate_app_access_model(integer) from public, anon, authenticated, service_role;
commit;
