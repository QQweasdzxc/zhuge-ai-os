-- TASK-074 Runtime QA action
--
-- Runtime QA is a human QJC-authorized action.  It is deliberately not
-- exposed through the GPT-only engineering actor token: GPT may plan/review,
-- while QJC remains the authority for a runtime gate.
--
-- This action is fail-closed until the published workflow supplies exactly
-- one required runtime_qa gate and one matching QJC transition.  It is the
-- canonical writer for this bounded action, updates the task and workflow
-- binding atomically, and records the existing workflow idempotency/audit
-- evidence.  It never calls a second task system and never completes a task;
-- PM Acceptance remains the completion authority.

begin;

create or replace function public.board_task074_runtime_qa(
  p_task_id uuid,
  p_qa_state text,
  p_evidence_note text,
  p_evidence_ref text,
  p_idempotency_key text,
  p_transition_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_state text := lower(btrim(coalesce(p_qa_state, '')));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_transition_key text := nullif(btrim(coalesce(p_transition_key, '')), '');
  v_request_hash text;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_task public.board_tasks%rowtype;
  v_after_task public.board_tasks%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_current_step public.board_workflow_steps%rowtype;
  v_target_step public.board_workflow_steps%rowtype;
  v_transition public.board_workflow_transitions%rowtype;
  v_gate public.board_workflow_gates%rowtype;
  v_evidence public.board_workflow_evidence_requirements%rowtype;
  v_before jsonb;
  v_response jsonb;
  v_missing text[] := array[]::text[];
  v_gate_count integer := 0;
  v_transition_count integer := 0;
  v_qjc_workspace_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authenticated QJC identity required';
  end if;

  if not public.is_engineering_member(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'QJC runtime QA authority required';
  end if;

  if p_task_id is null then
    raise exception using errcode = '22023', message = 'task id is required';
  end if;

  if v_state not in ('pass', 'rework') then
    raise exception using errcode = '22023', message = 'qa state must be pass or rework';
  end if;

  if nullif(btrim(coalesce(p_evidence_note, '')), '') is null
     and nullif(btrim(coalesce(p_evidence_ref, '')), '') is null then
    raise exception using errcode = '22023', message = 'runtime QA evidence note or reference is required';
  end if;

  if length(coalesce(p_evidence_note, '')) > 12000
     or length(coalesce(p_evidence_ref, '')) > 1000 then
    raise exception using errcode = '22023', message = 'runtime QA evidence exceeds the bounded contract';
  end if;

  if length(v_key) < 8 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'idempotency key must be 8..200 characters';
  end if;

  v_request_hash := md5(concat_ws(
    '|',
    p_task_id::text,
    v_state,
    coalesce(p_evidence_note, ''),
    coalesce(p_evidence_ref, ''),
    v_key,
    coalesce(v_transition_key, '')
  ));

  select *
    into v_existing
    from private.board_workflow_action_idempotency
   where idempotency_key = v_key
   for update;

  if found then
    if coalesce(v_existing.request_hash, '') <> v_request_hash then
      raise exception using errcode = '40001', message = 'idempotency key was already used with a different runtime QA request';
    end if;
    return coalesce(v_existing.response, jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'contract', 'task074-runtime-qa-v1',
      'action', 'task074_runtime_qa'
    ));
  end if;

  select *
    into v_task
    from public.board_tasks
   where id = p_task_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if coalesce(v_task.application_scope, '') <> 'ai_board'
     or v_task.board_instance_id is null then
    raise exception using errcode = '42501', message = 'task is outside the AI Board runtime QA boundary';
  end if;

  if coalesce(v_task.status, '') <> 'qa'
     or upper(coalesce(v_task.assignee, '')) <> 'QJC' then
    raise exception using errcode = '42501', message = 'task is not assigned to QJC runtime QA';
  end if;

  select id
    into v_qjc_workspace_id
    from public.board_workspaces
   where board_instance_id = v_task.board_instance_id
     and active = true
     and workspace_key = 'qjc'
   order by sort_order, created_at, id
   limit 1;

  if v_qjc_workspace_id is null
     or v_task.workspace_id is distinct from v_qjc_workspace_id then
    raise exception using errcode = '42501', message = 'task is not in the canonical QJC verification workspace';
  end if;

  if v_task.workflow_version_id is null or v_task.current_workflow_step_id is null then
    raise exception using errcode = '42501', message = 'task has no canonical workflow binding';
  end if;

  select *
    into v_definition
    from public.board_workflow_definitions
   where id = v_task.workflow_version_id
     and board_instance_id = v_task.board_instance_id
     and status = 'published'
   for share;

  if not found then
    raise exception using errcode = '42501', message = 'published workflow binding is required';
  end if;

  select *
    into v_current_step
    from public.board_workflow_steps
   where id = v_task.current_workflow_step_id
     and workflow_version_id = v_definition.id
   for share;

  if not found
     or lower(coalesce(v_current_step.role_key, '')) <> 'qjc'
     or lower(coalesce(v_current_step.status_key, '')) <> 'qa'
     or v_current_step.workspace_id is distinct from v_qjc_workspace_id then
    raise exception using errcode = '42501', message = 'current workflow step is not the canonical QJC runtime QA step';
  end if;

  select count(*)
    into v_gate_count
    from public.board_workflow_gates
   where workflow_version_id = v_definition.id
     and step_id = v_current_step.id
     and required = true
     and lower(coalesce(gate_key, '')) = 'runtime_qa';

  if v_gate_count <> 1 then
    raise exception using errcode = '42501', message = 'published workflow must define exactly one required runtime_qa gate';
  end if;

  select *
    into v_gate
    from public.board_workflow_gates
   where workflow_version_id = v_definition.id
     and step_id = v_current_step.id
     and required = true
     and lower(coalesce(gate_key, '')) = 'runtime_qa';

  if lower(coalesce(v_gate.completion_role, '')) <> 'qjc'
     or v_gate.human_action_required <> true then
    raise exception using
      errcode = '42501',
      message = 'runtime_qa gate must remain a human QJC gate';
  end if;

  for v_evidence in
    select *
      from public.board_workflow_evidence_requirements
     where gate_id = v_gate.id
       and required = true
     order by sort_order, evidence_key
  loop
    if v_evidence.source_kind = 'runtime_action' then
      if nullif(btrim(coalesce(p_evidence_note, '')), '') is null
         and nullif(btrim(coalesce(p_evidence_ref, '')), '') is null then
        v_missing := array_append(v_missing, v_evidence.label);
      end if;
    elsif v_evidence.source_kind = 'checklist' then
      if not exists (
        select 1
          from public.engineering_checklist_items i
         where i.task_id = v_task.id
           and i.item_key = v_evidence.evidence_key
           and lower(coalesce(i.state, '')) = 'pass'
           and (
             nullif(btrim(coalesce(i.evidence_note, '')), '') is not null
             or nullif(btrim(coalesce(i.evidence_ref, '')), '') is not null
           )
      ) then
        v_missing := array_append(v_missing, v_evidence.label);
      end if;
    else
      if not exists (
        select 1
          from public.engineering_activity_log a
         where a.entity_type = 'board_task'
           and a.entity_id = v_task.id::text
           and a.after_data ->> 'evidence_key' = v_evidence.evidence_key
      ) then
        v_missing := array_append(v_missing, v_evidence.label);
      end if;
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception using
      errcode = '42501',
      message = format('runtime QA evidence is incomplete: %s', array_to_string(v_missing, ', '));
  end if;

  if v_transition_key is not null then
    select count(*)
      into v_transition_count
      from public.board_workflow_transitions t
     where t.workflow_version_id = v_definition.id
       and t.from_step_id = v_current_step.id
       and t.transition_key = v_transition_key
       and t.allowed_roles @> array['qjc']::text[]
       and t.requires_gate = (v_state = 'pass')
       and not exists (
         select 1
           from public.board_workflow_steps target_step
          where target_step.id = t.to_step_id
            and target_step.is_completion = true
       );
  else
    select count(*)
      into v_transition_count
      from public.board_workflow_transitions t
     where t.workflow_version_id = v_definition.id
       and t.from_step_id = v_current_step.id
       and t.allowed_roles @> array['qjc']::text[]
       and t.requires_gate = (v_state = 'pass')
       and not exists (
         select 1
           from public.board_workflow_steps target_step
          where target_step.id = t.to_step_id
            and target_step.is_completion = true
       );
  end if;

  if v_transition_count <> 1 then
    raise exception using
      errcode = '42501',
      message = 'runtime QA transition is missing or ambiguous for the published workflow';
  end if;

  if v_transition_key is not null then
    select *
      into v_transition
      from public.board_workflow_transitions t
     where t.workflow_version_id = v_definition.id
       and t.from_step_id = v_current_step.id
       and t.transition_key = v_transition_key
       and t.allowed_roles @> array['qjc']::text[]
       and t.requires_gate = (v_state = 'pass');
  else
    select *
      into v_transition
      from public.board_workflow_transitions t
     where t.workflow_version_id = v_definition.id
       and t.from_step_id = v_current_step.id
       and t.allowed_roles @> array['qjc']::text[]
       and t.requires_gate = (v_state = 'pass')
       and not exists (
         select 1
           from public.board_workflow_steps target_step
          where target_step.id = t.to_step_id
            and target_step.is_completion = true
       )
     order by t.id
     limit 1;
  end if;

  select *
    into v_target_step
    from public.board_workflow_steps
   where id = v_transition.to_step_id
     and workflow_version_id = v_definition.id
   for share;

  if not found or v_target_step.is_completion then
    raise exception using
      errcode = '42501',
      message = 'runtime QA cannot perform PM-controlled completion';
  end if;

  if (v_state = 'rework' and (
        lower(coalesce(v_target_step.role_key, '')) <> 'co'
        or lower(coalesce(v_target_step.status_key, '')) not in ('ready', 'inprogress')
      ))
     or (v_state = 'pass' and lower(coalesce(v_target_step.role_key, '')) not in ('qjc', 'pm')) then
    raise exception using
      errcode = '42501',
      message = 'runtime QA target is outside the bounded pass/rework contract';
  end if;

  v_before := jsonb_build_object(
    'task_id', v_task.id,
    'status', v_task.status,
    'assignee', v_task.assignee,
    'workspace_id', v_task.workspace_id,
    'workflow_version_id', v_task.workflow_version_id,
    'current_workflow_step_id', v_task.current_workflow_step_id
  );

  update public.board_tasks
     set status = v_target_step.status_key,
         assignee = private.board_workflow_role_label(v_target_step.role_key),
         workspace_id = v_target_step.workspace_id,
         current_workflow_step_id = v_target_step.id,
         workflow_version_id = v_definition.id,
         updated_at = v_now
   where id = v_task.id
   returning * into v_after_task;

  insert into public.engineering_activity_log (
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    note,
    actor_id,
    actor_type,
    actor_label,
    activity_type
  ) values (
    'board_task',
    p_task_id::text,
    'task074_runtime_qa',
    v_before,
    jsonb_build_object(
      'contract', 'task074-runtime-qa-v1',
      'evidence_key', 'runtime_qa',
      'qa_state', v_state,
      'evidence_ref', nullif(btrim(coalesce(p_evidence_ref, '')), ''),
      'idempotency_key', v_key,
      'transition_key', v_transition.transition_key,
      'workflow_version_id', v_definition.id,
      'status', v_after_task.status,
      'assignee', v_after_task.assignee,
      'workspace_id', v_after_task.workspace_id,
      'current_workflow_step_id', v_after_task.current_workflow_step_id
    ),
    nullif(btrim(coalesce(p_evidence_note, '')), ''),
    v_actor,
    'human',
    'QJC',
    'system_activity'
  );

  v_response := jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'contract', 'task074-runtime-qa-v1',
    'action', 'task074_runtime_qa',
    'task_id', p_task_id,
    'qa_state', v_state,
    'evidence_ref', nullif(btrim(coalesce(p_evidence_ref, '')), ''),
    'transition_key', v_transition.transition_key,
    'workflow_version_id', v_definition.id,
    'before', v_before,
    'after', jsonb_build_object(
      'status', v_after_task.status,
      'assignee', v_after_task.assignee,
      'workspace_id', v_after_task.workspace_id,
      'current_workflow_step_id', v_after_task.current_workflow_step_id
    )
  );

  insert into private.board_workflow_action_idempotency (
    idempotency_key,
    action_type,
    board_instance_id,
    task_id,
    request_hash,
    response,
    status
  ) values (
    v_key,
    'task074_runtime_qa',
    v_task.board_instance_id,
    p_task_id,
    v_request_hash,
    v_response,
    'completed'
  );

  return v_response;
end;
$$;

revoke all on function public.board_task074_runtime_qa(uuid, text, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.board_task074_runtime_qa(uuid, text, text, text, text, text)
  to authenticated;

comment on function public.board_task074_runtime_qa(uuid, text, text, text, text, text)
  is 'TASK-074 authenticated QJC Runtime QA action; fail-closed until a published runtime_qa gate and QJC transition exist; PM-controlled completion remains separate.';

commit;
