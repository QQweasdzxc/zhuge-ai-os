-- TASK-094: protected LINE runtime bridge.
--
-- LINE is an external transport.  These private tables and service-role-only
-- RPCs resolve a verified LINE subject to one approved Zhuge identity and one
-- personal Board scope, then delegate task creation/movement through the
-- existing canonical Board contract.  No browser/client role can call this
-- bridge and no provider credential is stored in the database.

begin;

create schema if not exists private;

create table if not exists private.line_subject_bindings (
  line_subject text primary key,
  subject_type text not null check (subject_type in ('user', 'group', 'room')),
  user_id uuid not null references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint line_subject_bindings_subject_check check (length(btrim(line_subject)) between 1 and 200)
);

create index if not exists line_subject_bindings_user_idx
  on private.line_subject_bindings (user_id, active);

create table if not exists private.line_webhook_idempotency (
  idempotency_key text primary key,
  event_id text not null,
  command text not null,
  request_fingerprint text not null,
  status text not null check (status in ('pending', 'completed', 'failed')),
  response jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 days'),
  constraint line_webhook_idempotency_key_check check (length(btrim(idempotency_key)) between 8 and 240),
  constraint line_webhook_idempotency_event_check check (length(btrim(event_id)) between 1 and 200),
  constraint line_webhook_idempotency_command_check check (command in (
    'create_task', 'accept_task', 'set_progress', 'mark_blocked', 'mark_delayed', 'complete_task'
  ))
);

create index if not exists line_webhook_idempotency_expiry_idx
  on private.line_webhook_idempotency (expires_at, status);

revoke all on schema private from public, anon, authenticated, service_role;
revoke all on table private.line_subject_bindings from public, anon, authenticated, service_role;
revoke all on table private.line_webhook_idempotency from public, anon, authenticated, service_role;

create or replace function public.line_resolve_subject(
  p_line_subject text,
  p_subject_type text,
  p_task_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
declare
  v_subject text := btrim(coalesce(p_line_subject, ''));
  v_type text := lower(btrim(coalesce(p_subject_type, '')));
  v_binding private.line_subject_bindings%rowtype;
  v_latest private.app_access_application_events%rowtype;
  v_instance public.board_instances%rowtype;
  v_task public.board_tasks%rowtype;
  v_instance_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'LINE runtime service authority is required';
  end if;
  if length(v_subject) < 1 or length(v_subject) > 200 or v_type not in ('user', 'group', 'room') then
    raise exception using errcode = '22023', message = 'LINE subject is invalid';
  end if;

  select * into v_binding
    from private.line_subject_bindings binding
   where binding.line_subject = v_subject
     and binding.subject_type = v_type
     and binding.active = true;
  if not found then
    raise exception using errcode = '42501', message = 'LINE subject is not linked to an active Zhuge identity';
  end if;

  select * into v_latest
    from private.app_access_application_events event
   where event.applicant_user_id = v_binding.user_id
   order by event.event_no desc
   limit 1;
  if not found or v_latest.event_type not in ('approved_bootstrap', 'application_approved') then
    raise exception using errcode = '42501', message = 'LINE subject owner is not an approved Zhuge user';
  end if;

  select count(*)::integer into v_instance_count
    from public.board_instances instance
   where instance.active = true
     and instance.authorization_mode = 'owner'
     and instance.owner_uuid = v_binding.user_id
     and instance.legacy_application_scope = 'worktodo';
  if v_instance_count = 0 then
    raise exception using errcode = 'P0002', message = 'Personal WorkTodo Board scope is unavailable';
  end if;
  if v_instance_count <> 1 then
    raise exception using errcode = 'P0001', message = 'Personal WorkTodo Board scope is ambiguous';
  end if;
  select * into v_instance
    from public.board_instances instance
   where instance.active = true
     and instance.authorization_mode = 'owner'
     and instance.owner_uuid = v_binding.user_id
     and instance.legacy_application_scope = 'worktodo';

  if p_task_id is not null then
    select * into v_task
      from public.board_tasks task
     where task.id = p_task_id
       and task.board_instance_id = v_instance.id;
    if not found then
      raise exception using errcode = '42501', message = 'LINE task is outside the resolved Board scope';
    end if;
  end if;

  return jsonb_build_object(
    'verified', true,
    'authority', 'canonical-board-scope',
    'userId', v_binding.user_id,
    'boardInstanceId', v_instance.id,
    'taskId', case when v_task.id is null then null else v_task.id end,
    'subject', v_subject,
    'subjectType', v_type,
    'workflowBound', case when v_task.id is null then false else (v_task.workflow_version_id is not null or v_task.current_workflow_step_id is not null) end
  );
end;
$function$;

revoke all on function public.line_resolve_subject(text, text, uuid) from public, anon, authenticated;
grant execute on function public.line_resolve_subject(text, text, uuid) to service_role;

create or replace function public.board_line_task_command_v1(
  p_line_subject text,
  p_subject_type text,
  p_event_id text,
  p_idempotency_key text,
  p_command text,
  p_title text default null,
  p_content text default null,
  p_task_id uuid default null,
  p_progress integer default null,
  p_reason text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, auth, private, public, pg_temp
as $function$
declare
  v_command text := lower(btrim(coalesce(p_command, '')));
  v_event text := btrim(coalesce(p_event_id, ''));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_fingerprint text;
  v_resolution jsonb;
  v_user uuid;
  v_board uuid;
  v_task public.board_tasks%rowtype;
  v_existing private.line_webhook_idempotency%rowtype;
  v_before jsonb;
  v_response jsonb;
  v_status text;
  v_progress integer := p_progress;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'LINE runtime service authority is required';
  end if;
  if v_command not in ('create_task', 'accept_task', 'set_progress', 'mark_blocked', 'mark_delayed', 'complete_task') then
    raise exception using errcode = '22023', message = 'LINE command is not allowlisted';
  end if;
  if length(v_event) < 1 or length(v_event) > 200 or length(v_key) < 8 or length(v_key) > 240 then
    raise exception using errcode = '22023', message = 'LINE idempotency evidence is invalid';
  end if;
  if v_command = 'create_task' and length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception using errcode = '22023', message = 'LINE task title is required';
  end if;
  if v_command = 'set_progress' and (v_progress is null or v_progress not in (0, 25, 50, 75, 100)) then
    raise exception using errcode = '22023', message = 'LINE progress must be 0, 25, 50, 75, or 100';
  end if;
  if v_command = 'complete_task' and v_progress <> 100 then
    raise exception using errcode = '22023', message = 'LINE completion requires 100 percent';
  end if;
  if v_command = 'mark_blocked' and length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception using errcode = '22023', message = 'LINE blocked state requires a reason';
  end if;
  if v_command = 'mark_delayed' and (length(btrim(coalesce(p_reason, ''))) = 0 or p_due_at is null) then
    raise exception using errcode = '22023', message = 'LINE delayed state requires reason and due date';
  end if;
  if v_command <> 'create_task' and p_task_id is null then
    raise exception using errcode = '22023', message = 'LINE command requires a server-resolved task';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  v_fingerprint := md5(jsonb_build_object(
    'subject', p_line_subject, 'subject_type', p_subject_type, 'event_id', v_event,
    'command', v_command, 'title', p_title, 'content', p_content, 'task_id', p_task_id,
    'progress', p_progress, 'reason', p_reason, 'due_at', p_due_at
  )::text);

  select * into v_existing
    from private.line_webhook_idempotency record
   where record.idempotency_key = v_key
   for update;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '40001', message = 'LINE idempotency key was reused for a different request';
    end if;
    if v_existing.status = 'completed' then
      return coalesce(v_existing.response, jsonb_build_object('status', 'already_processed', 'idempotency_key', v_key));
    end if;
    if v_existing.status = 'pending' and v_existing.updated_at > clock_timestamp() - interval '30 seconds' then
      return jsonb_build_object('contract', 'zhuge-line-board-rpc-v1', 'status', 'in_flight', 'idempotency_key', v_key, 'mutation', 'none');
    end if;
    update private.line_webhook_idempotency
       set status = 'pending', updated_at = clock_timestamp(), expires_at = clock_timestamp() + interval '30 days'
     where idempotency_key = v_key;
  else
    insert into private.line_webhook_idempotency (idempotency_key, event_id, command, request_fingerprint, status)
    values (v_key, v_event, v_command, v_fingerprint, 'pending');
  end if;

  v_resolution := public.line_resolve_subject(p_line_subject, p_subject_type, p_task_id);
  v_user := (v_resolution->>'userId')::uuid;
  v_board := (v_resolution->>'boardInstanceId')::uuid;

  -- Downstream canonical Board RPCs use auth.uid().  The only value installed
  -- here is the user selected by the verified private LINE binding above; the
  -- browser and webhook body cannot set this claim.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  if v_command = 'create_task' then
    select * into v_task from public.board_instance_create_task(
      v_board,
      btrim(p_title),
      nullif(btrim(coalesce(p_content, '')), ''),
      'not_started',
      null,
      null,
      'published'
    );
    v_status := 'unassigned';
  else
    select * into v_task from public.board_tasks task
     where task.id = p_task_id and task.board_instance_id = v_board for update;
    if not found or not public.board_task_can_write(v_task.id) then
      raise exception using errcode = '42501', message = 'LINE task is outside the canonical Board write scope';
    end if;
    if v_task.workflow_version_id is not null or v_task.current_workflow_step_id is not null then
      raise exception using errcode = '42501', message = 'Workflow-bound Task must use the canonical Workflow transition path';
    end if;
    v_before := to_jsonb(v_task);
    v_status := case v_command
      when 'accept_task' then 'assigned'
      when 'set_progress' then 'in_progress'
      when 'mark_blocked' then 'blocked'
      when 'mark_delayed' then 'delayed'
      when 'complete_task' then 'done'
    end;
    update public.board_tasks
       set status = v_status,
           due_date = case when v_command = 'mark_delayed' then (p_due_at at time zone 'Asia/Taipei')::date else due_date end,
           updated_at = clock_timestamp()
     where id = v_task.id
     returning * into v_task;
    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_task.id::text, 'line_task_command', v_before,
      jsonb_build_object('task', to_jsonb(v_task), 'command', v_command, 'progress', v_progress, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'due_at', p_due_at),
      'LINE task command', v_user, 'human', 'LINE', 'system_activity'
    );
  end if;

  v_response := jsonb_build_object(
    'contract', 'zhuge-line-board-rpc-v1',
    'status', 'completed',
    'operation', v_command,
    'task_id', v_task.id,
    'board_instance_id', v_board,
    'canonical_status', v_task.status,
    'transport_state', case when v_command = 'create_task' then 'unassigned' when v_command = 'accept_task' then 'assigned' when v_command = 'set_progress' then 'in_progress' when v_command = 'mark_blocked' then 'blocked' when v_command = 'mark_delayed' then 'delayed' else 'completed' end,
    'progress', v_progress,
    'idempotency_key', v_key,
    'mutation', 'canonical-board-rpc'
  );
  update private.line_webhook_idempotency
     set status = 'completed', response = v_response, updated_at = clock_timestamp()
   where idempotency_key = v_key;
  return v_response;
exception when others then
  update private.line_webhook_idempotency
     set status = 'failed', response = jsonb_build_object('status', 'failed', 'error_code', sqlstate, 'idempotency_key', v_key, 'mutation', 'none'), updated_at = clock_timestamp()
   where idempotency_key = v_key and status = 'pending';
  raise;
end;
$function$;

revoke all on function public.board_line_task_command_v1(text, text, text, text, text, text, text, uuid, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.board_line_task_command_v1(text, text, text, text, text, text, text, uuid, integer, text, timestamptz) to service_role;

comment on table private.line_subject_bindings is
  'Server-managed LINE subject to approved Zhuge identity binding; never exposed to browser roles.';
comment on table private.line_webhook_idempotency is
  'Durable LINE webhook command idempotency and stale-reclaim ledger; never exposed to browser roles.';
comment on function public.line_resolve_subject(text, text, uuid) is
  'Service-role-only verified LINE subject and personal Board scope resolver.';
comment on function public.board_line_task_command_v1(text, text, text, text, text, text, text, uuid, integer, text, timestamptz) is
  'Service-role-only LINE adapter boundary; workflow-bound Tasks fail closed and must use canonical Workflow transitions.';

commit;
