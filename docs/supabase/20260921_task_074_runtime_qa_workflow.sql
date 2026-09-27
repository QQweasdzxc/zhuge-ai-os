-- TASK-074 Runtime QA workflow extension
--
-- Additive, idempotent governance migration for the already-published AI Board
-- workflow.  It does not create a second workflow, rebind tasks, or mutate
-- product data.  The QJC runtime action remains fail-closed until this
-- published gate and its two bounded QJC transitions are present.

begin;

do $$
declare
  v_workflow_id uuid;
  v_qjc_step_id uuid;
  v_co_step_id uuid;
  v_gate_id uuid;
  v_workflow_count integer;
  v_gate_count integer;
  v_evidence_count integer;
  v_pass_count integer;
  v_rework_count integer;
  v_gate public.board_workflow_gates%rowtype;
  v_evidence public.board_workflow_evidence_requirements%rowtype;
  v_pass public.board_workflow_transitions%rowtype;
  v_rework public.board_workflow_transitions%rowtype;
begin
  -- Resolve the one currently published TASK-074 Module C workflow by its
  -- canonical role/step contract; do not hard-code generated UUIDs.
  select count(*)
    into v_workflow_count
    from public.board_workflow_definitions d
   where d.status = 'published'
     and exists (
       select 1
         from public.board_workflow_steps s
        where s.workflow_version_id = d.id
          and s.step_key = 'step-5'
          and s.role_key = 'qjc'
          and s.status_key = 'qa'
     )
     and exists (
       select 1
         from public.board_workflow_steps s
        where s.workflow_version_id = d.id
          and s.step_key = 'step-3'
          and s.role_key = 'co'
          and s.status_key = 'inprogress'
     );

  if v_workflow_count <> 1 then
    raise exception using
      errcode = '55000',
      message = format('TASK-074 runtime QA requires exactly one matching published workflow; found %s', v_workflow_count);
  end if;

  select d.id
    into v_workflow_id
    from public.board_workflow_definitions d
   where d.status = 'published'
     and exists (
       select 1
         from public.board_workflow_steps s
        where s.workflow_version_id = d.id
          and s.step_key = 'step-5'
          and s.role_key = 'qjc'
          and s.status_key = 'qa'
     )
     and exists (
       select 1
         from public.board_workflow_steps s
        where s.workflow_version_id = d.id
          and s.step_key = 'step-3'
          and s.role_key = 'co'
          and s.status_key = 'inprogress'
     );

  select id
    into v_qjc_step_id
    from public.board_workflow_steps
   where workflow_version_id = v_workflow_id
     and step_key = 'step-5'
     and role_key = 'qjc'
     and status_key = 'qa';

  select id
    into v_co_step_id
    from public.board_workflow_steps
   where workflow_version_id = v_workflow_id
     and step_key = 'step-3'
     and role_key = 'co'
     and status_key = 'inprogress';

  select count(*)
    into v_gate_count
    from public.board_workflow_gates
   where workflow_version_id = v_workflow_id
     and gate_key = 'runtime_qa';

  if v_gate_count = 0 then
    insert into public.board_workflow_gates (
      workflow_version_id,
      step_id,
      gate_key,
      name,
      required,
      human_action_required,
      completion_role,
      failure_policy,
      sort_order
    ) values (
      v_workflow_id,
      v_qjc_step_id,
      'runtime_qa',
      'Runtime QA',
      true,
      true,
      'qjc',
      'stay',
      0
    )
    returning id into v_gate_id;
  elsif v_gate_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'TASK-074 runtime_qa gate is ambiguous; migration stopped fail-closed';
  end if;

  if v_gate_count = 1 then
    select id
      into v_gate_id
      from public.board_workflow_gates
     where workflow_version_id = v_workflow_id
       and gate_key = 'runtime_qa';
  end if;

  select *
    into v_gate
    from public.board_workflow_gates
   where id = v_gate_id;

  if v_gate.workflow_version_id is distinct from v_workflow_id
     or v_gate.step_id is distinct from v_qjc_step_id
     or v_gate.gate_key <> 'runtime_qa'
     or v_gate.required is distinct from true
     or v_gate.human_action_required is distinct from true
     or v_gate.completion_role <> 'qjc'
     or v_gate.failure_policy <> 'stay' then
    raise exception using
      errcode = '55000',
      message = 'Existing runtime_qa gate does not match the canonical QJC contract';
  end if;

  select count(*)
    into v_evidence_count
    from public.board_workflow_evidence_requirements
   where gate_id = v_gate_id
     and evidence_key = 'runtime_qa';

  if v_evidence_count = 0 then
    insert into public.board_workflow_evidence_requirements (
      gate_id,
      evidence_key,
      label,
      required,
      source_kind,
      sort_order
    ) values (
      v_gate_id,
      'runtime_qa',
      'Runtime QA evidence',
      true,
      'runtime_action',
      0
    );
  elsif v_evidence_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'Runtime QA evidence requirement is ambiguous; migration stopped fail-closed';
  end if;

  select *
    into v_evidence
    from public.board_workflow_evidence_requirements
   where gate_id = v_gate_id
     and evidence_key = 'runtime_qa';

  if v_evidence.required is distinct from true
     or v_evidence.source_kind <> 'runtime_action' then
    raise exception using
      errcode = '55000',
      message = 'Existing runtime_qa evidence requirement is not a runtime-action evidence contract';
  end if;

  -- PASS is an evidence-recording self-transition: PM-controlled completion
  -- remains separate. REWORK returns the task to the canonical Co step.
  insert into public.board_workflow_transitions (
    workflow_version_id,
    transition_key,
    from_step_id,
    to_step_id,
    allowed_roles,
    requires_gate
  ) values (
    v_workflow_id,
    'step-5_runtime_qa_pass',
    v_qjc_step_id,
    v_qjc_step_id,
    array['qjc']::text[],
    true
  ) on conflict (workflow_version_id, transition_key) do nothing;

  insert into public.board_workflow_transitions (
    workflow_version_id,
    transition_key,
    from_step_id,
    to_step_id,
    allowed_roles,
    requires_gate
  ) values (
    v_workflow_id,
    'step-5_runtime_qa_rework',
    v_qjc_step_id,
    v_co_step_id,
    array['qjc']::text[],
    false
  ) on conflict (workflow_version_id, transition_key) do nothing;

  select count(*)
    into v_pass_count
    from public.board_workflow_transitions
   where workflow_version_id = v_workflow_id
     and transition_key = 'step-5_runtime_qa_pass'
     and from_step_id = v_qjc_step_id
     and to_step_id = v_qjc_step_id
     and allowed_roles = array['qjc']::text[]
     and requires_gate = true;

  select count(*)
    into v_rework_count
    from public.board_workflow_transitions
   where workflow_version_id = v_workflow_id
     and transition_key = 'step-5_runtime_qa_rework'
     and from_step_id = v_qjc_step_id
     and to_step_id = v_co_step_id
     and allowed_roles = array['qjc']::text[]
     and requires_gate = false;

  if v_pass_count <> 1 or v_rework_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'TASK-074 runtime QA transitions do not match the canonical QJC pass/rework contract';
  end if;

  -- Keep the rows available to the subsequent read-back and fail-closed action
  -- without silently accepting a wrong pre-existing transition.
  select * into v_pass
    from public.board_workflow_transitions
   where workflow_version_id = v_workflow_id
     and transition_key = 'step-5_runtime_qa_pass';
  select * into v_rework
    from public.board_workflow_transitions
   where workflow_version_id = v_workflow_id
     and transition_key = 'step-5_runtime_qa_rework';
  if v_pass.id is null or v_rework.id is null then
    raise exception using errcode = '55000', message = 'TASK-074 runtime QA transition read-back failed';
  end if;
end;
$$;

commit;
