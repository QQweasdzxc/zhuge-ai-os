-- TASK-040 Engineering Review staging and authoritative gate
--
-- Scope approved by PM: reuse the existing GPT區 workspace between Co
-- Developer QA and QJC PM QA. No schema, RLS, Auth, Security, task-number,
-- or Release Governance change is introduced. Existing task/audit history is
-- append-only and the TASK-040 grandfather state remains in QJC.
--
-- Contract:
--   Co Developer QA PASS -> GPT區
--   GPT Review + Regression Evidence (parallel) -> both PASS
--   Cloud atomic handoff -> QJC驗證 -> PM Acceptance
--
-- Rollback design (not executed): disable the Edge operation, restore the
-- preceding function bodies, deactivate only the reactivated GPT workspace
-- after active work is drained, and drop only the new gate RPC. Never delete
-- tasks, checklist history, or Audit evidence.

begin;

with reactivated as (
  update public.board_workspaces
  set active = true,
      archived_at = null,
      updated_at = now()
  where workspace_key = 'gpt'
    and application_scope = 'ai_board'
    and active = false
  returning id, board_instance_id, workspace_key, name
)
insert into public.engineering_activity_log (
  entity_type, entity_id, action, before_data, after_data, note,
  actor_id, actor_type, actor_label, activity_type
)
select
  'board_workspace',
  id::text,
  'workspace_reactivated',
  jsonb_build_object(
    'workspace_id', id,
    'workspace_key', workspace_key,
    'name', name,
    'active', false
  ),
  jsonb_build_object(
    'workspace_id', id,
    'workspace_key', workspace_key,
    'name', name,
    'active', true,
    'lifecycle', 'task_040_engineering_review_staging'
  ),
  'Existing GPT區 reactivated as the approved TASK-040 Engineering Review staging workspace',
  null, 'system', 'System', 'system_activity'
from reactivated;

insert into public.engineering_checklist_items (
  task_id, checklist_type, stage, item_key, label, required, state, sort_order, version
)
select
  task.id,
  'batch_regression',
  'gpt',
  'regression-evidence',
  'Regression Evidence：完成回歸測試並提供可追溯結果',
  true,
  'not_verified',
  25,
  1
from public.board_tasks task
where task.work_code = 'TASK-040'
  and task.application_scope = 'ai_board'
on conflict (task_id, checklist_type, stage, item_key, version) do nothing;

create or replace function public.board_orchestrate_developer_qa(
  p_task_id uuid,
  p_item_id uuid,
  p_evidence_note text,
  p_evidence_ref text default null,
  p_actor_label text default 'Co',
  p_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_item public.engineering_checklist_items%rowtype;
  v_updated_item public.engineering_checklist_items%rowtype;
  v_gpt_workspace public.board_workspaces%rowtype;
  v_qjc_workspace public.board_workspaces%rowtype;
  v_gpt_item public.engineering_checklist_items%rowtype;
  v_regression_item public.engineering_checklist_items%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_closed_claim private.board_task_claims%rowtype;
  v_updated_task public.board_tasks%rowtype;
  v_note text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  v_ref text := nullif(btrim(coalesce(p_evidence_ref, '')), '');
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'Co' then
    raise exception using errcode = '42501',
      message = 'Developer QA orchestration requires the controlled Co service path';
  end if;
  if p_task_id is null or p_item_id is null or v_note is null and v_ref is null then
    raise exception using errcode = '22023',
      message = 'TASK, Developer QA item, and evidence are required';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Board task not found';
  end if;
  if v_task.application_scope <> 'ai_board'
     or v_task.board_instance_id is null then
    raise exception using errcode = '42501',
      message = 'Developer QA orchestration is limited to AI Board TASKs';
  end if;

  select *
    into v_item
  from public.engineering_checklist_items
  where id = p_item_id
    and task_id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Developer QA checklist item does not belong to TASK';
  end if;
  if lower(v_item.stage) <> 'co'
     or lower(v_item.item_key) <> 'developer-qa'
     or v_item.required <> true then
    raise exception using errcode = '42501',
      message = 'Only the required Co Developer QA item can trigger orchestration';
  end if;

  select *
    into v_gpt_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and workspace_key = 'gpt'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical GPT workspace is missing';
  end if;

  select *
    into v_qjc_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and workspace_key = 'qjc'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical QJC workspace is missing';
  end if;

  -- Prepare the two formal engineering review records without fabricating
  -- either result. Existing rows and evidence are preserved by the unique key.
  insert into public.engineering_checklist_items (
    task_id, checklist_type, stage, item_key, label, required, state, sort_order, version
  ) values (
    p_task_id, 'task_acceptance', 'gpt', 'gpt-review',
    'GPT Review：完成 Engineering Review Evidence',
    true, 'not_verified', 20, 1
  )
  on conflict (task_id, checklist_type, stage, item_key, version) do nothing;

  insert into public.engineering_checklist_items (
    task_id, checklist_type, stage, item_key, label, required, state, sort_order, version
  ) values (
    p_task_id, 'batch_regression', 'gpt', 'regression-evidence',
    'Regression Evidence：完成回歸測試並提供可追溯結果',
    true, 'not_verified', 25, 1
  )
  on conflict (task_id, checklist_type, stage, item_key, version) do nothing;

  select *
    into v_gpt_item
  from public.engineering_checklist_items
  where task_id = p_task_id
    and checklist_type = 'task_acceptance'
    and stage = 'gpt'
    and item_key = 'gpt-review'
    and required = true
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Required GPT Review checklist item is missing';
  end if;

  select *
    into v_regression_item
  from public.engineering_checklist_items
  where task_id = p_task_id
    and checklist_type = 'batch_regression'
    and stage = 'gpt'
    and item_key = 'regression-evidence'
    and required = true
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Required Regression checklist item is missing';
  end if;

  -- A retry after either controlled handoff is a truthful no-op.
  if v_task.work_code = 'TASK-040'
     and v_task.status = 'qa'
     and v_task.assignee = 'QJC'
     and v_task.workspace_id = v_qjc_workspace.id
     and v_item.state = 'pass'
     and (nullif(btrim(coalesce(v_item.evidence_note, '')), '') is not null
          or nullif(btrim(coalesce(v_item.evidence_ref, '')), '') is not null) then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'task', to_jsonb(v_task),
      'checklist', to_jsonb(v_item),
      'handoff', 'qjc',
      'engineering_gate', 'grandfathered_pending'
    );
  end if;

  if v_task.status = 'qa'
     and v_task.assignee = 'GPT'
     and v_task.workspace_id = v_gpt_workspace.id
     and v_item.state = 'pass'
     and (nullif(btrim(coalesce(v_item.evidence_note, '')), '') is not null
          or nullif(btrim(coalesce(v_item.evidence_ref, '')), '') is not null) then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'task', to_jsonb(v_task),
      'checklist', to_jsonb(v_item),
      'handoff', 'gpt',
      'engineering_gate', 'pending'
    );
  end if;

  if v_task.status <> 'inprogress' or v_task.assignee <> 'Co' then
    raise exception using errcode = '55000',
      message = 'TASK must be actively claimed by Co before Developer QA handoff';
  end if;

  if p_claim_token is null then
    select *
      into v_claim
    from private.board_task_claims
    where task_id = p_task_id
      and actor_label = 'Co'
      and state = 'active'
    order by claimed_at desc
    limit 1
    for update;
  else
    select *
      into v_claim
    from private.board_task_claims
    where task_id = p_task_id
      and actor_label = 'Co'
      and claim_token = p_claim_token
      and state = 'active'
    for update;
  end if;
  if not found then
    raise exception using errcode = '55000',
      message = 'An active Cloud Co Claim is required before Developer QA handoff';
  end if;
  if v_claim.lease_expires_at <= v_now then
    raise exception using errcode = '40901',
      message = 'Co Claim is expired; acquire a new TASK before Developer QA handoff';
  end if;

  update public.engineering_checklist_items
  set state = 'pass',
      checked_by = null,
      checked_at = v_now,
      evidence_note = v_note,
      evidence_ref = v_ref,
      updated_at = v_now
  where id = v_item.id
  returning * into v_updated_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'engineering_checklist_item', v_item.id::text, 'checklist_item_updated',
    to_jsonb(v_item), to_jsonb(v_updated_item),
    coalesce(v_note, v_ref),
    null, 'ai', 'Co', 'system_activity'
  );

  update public.board_tasks
  set status = 'qa',
      assignee = 'GPT',
      workspace_id = v_gpt_workspace.id,
      updated_at = v_now
  where id = v_task.id
  returning * into v_updated_task;

  update private.board_task_claims
  set state = 'completed',
      released_at = v_now,
      release_reason = 'developer_qa_to_gpt_review',
      updated_at = v_now
  where id = v_claim.id
  returning * into v_closed_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_developer_qa_handoff',
    jsonb_build_object(
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id,
      'claim_id', v_claim.id
    ),
    jsonb_build_object(
      'status', v_updated_task.status,
      'assignee', v_updated_task.assignee,
      'workspace_id', v_updated_task.workspace_id,
      'claim_id', v_closed_claim.id,
      'claim_state', v_closed_claim.state,
      'lifecycle', 'developer_qa_to_gpt_review'
    ),
    'Co Developer QA passed; TASK atomically entered the GPT engineering review staging queue',
    null, 'ai', 'Co', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'handoff', 'gpt',
    'engineering_review', jsonb_build_object(
      'gpt_review_item_id', v_gpt_item.id,
      'regression_item_id', v_regression_item.id,
      'status', 'pending'
    ),
    'task', to_jsonb(v_updated_task),
    'checklist', to_jsonb(v_updated_item),
    'claim', jsonb_build_object(
      'id', v_closed_claim.id,
      'task_id', v_closed_claim.task_id,
      'state', v_closed_claim.state,
      'released_at', v_closed_claim.released_at,
      'release_reason', v_closed_claim.release_reason
    )
  );
end;
$function$;


create or replace function public.board_orchestrate_engineering_review(
  p_task_id uuid,
  p_actor_label text default 'GPT'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_gpt_workspace public.board_workspaces%rowtype;
  v_qjc_workspace public.board_workspaces%rowtype;
  v_gpt_item public.engineering_checklist_items%rowtype;
  v_regression_item public.engineering_checklist_items%rowtype;
  v_updated_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_idempotent boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'GPT' then
    raise exception using errcode = '42501',
      message = 'Engineering Review orchestration requires the controlled GPT service path';
  end if;
  if p_task_id is null then
    raise exception using errcode = '22023',
      message = 'TASK is required';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Board task not found';
  end if;
  if v_task.application_scope <> 'ai_board'
     or v_task.board_instance_id is null then
    raise exception using errcode = '42501',
      message = 'Engineering Review orchestration is limited to AI Board TASKs';
  end if;

  select *
    into v_gpt_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and workspace_key = 'gpt'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical GPT workspace is missing';
  end if;

  select *
    into v_qjc_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and workspace_key = 'qjc'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical QJC workspace is missing';
  end if;

  select *
    into v_gpt_item
  from public.engineering_checklist_items
  where task_id = p_task_id
    and checklist_type = 'task_acceptance'
    and stage = 'gpt'
    and item_key = 'gpt-review'
    and required = true
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Required GPT Review checklist item is missing';
  end if;

  select *
    into v_regression_item
  from public.engineering_checklist_items
  where task_id = p_task_id
    and checklist_type = 'batch_regression'
    and stage = 'gpt'
    and item_key = 'regression-evidence'
    and required = true
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Required Regression checklist item is missing';
  end if;

  if v_gpt_item.state = 'fail' or v_regression_item.state = 'fail' then
    return jsonb_build_object(
      'success', false,
      'ready', false,
      'reason', 'engineering_review_failed',
      'task', to_jsonb(v_task),
      'gpt_review', to_jsonb(v_gpt_item),
      'regression', to_jsonb(v_regression_item)
    );
  end if;

  if v_gpt_item.state <> 'pass'
     or v_regression_item.state <> 'pass'
     or (nullif(btrim(coalesce(v_gpt_item.evidence_note, '')), '') is null
         and nullif(btrim(coalesce(v_gpt_item.evidence_ref, '')), '') is null)
     or (nullif(btrim(coalesce(v_regression_item.evidence_note, '')), '') is null
         and nullif(btrim(coalesce(v_regression_item.evidence_ref, '')), '') is null) then
    return jsonb_build_object(
      'success', true,
      'ready', false,
      'reason', 'engineering_review_incomplete',
      'task', to_jsonb(v_task),
      'gpt_review', to_jsonb(v_gpt_item),
      'regression', to_jsonb(v_regression_item)
    );
  end if;

  -- TASK-040 is already in QJC under the approved grandfather rule. Do not
  -- rewrite its current state; append only the new gate evidence once.
  if v_task.work_code = 'TASK-040'
     and v_task.status = 'qa'
     and v_task.assignee = 'QJC'
     and v_task.workspace_id = v_qjc_workspace.id then
    if not exists (
      select 1
      from public.engineering_activity_log
      where entity_type = 'board_task'
        and entity_id = v_task.id::text
        and action = 'task_engineering_gate_passed'
    ) then
      insert into public.engineering_activity_log (
        entity_type, entity_id, action, before_data, after_data, note,
        actor_id, actor_type, actor_label, activity_type
      ) values (
        'board_task', v_task.id::text, 'task_engineering_gate_passed',
        jsonb_build_object(
          'status', v_task.status,
          'assignee', v_task.assignee,
          'workspace_id', v_task.workspace_id
        ),
        jsonb_build_object(
          'status', v_task.status,
          'assignee', v_task.assignee,
          'workspace_id', v_task.workspace_id,
          'gpt_review_item_id', v_gpt_item.id,
          'regression_item_id', v_regression_item.id,
          'lifecycle', 'grandfathered_engineering_review_gate'
        ),
        'GPT Review and Regression Evidence passed; TASK-040 grandfathered in QJC without rewriting prior PM QA history',
        null, 'ai', 'GPT', 'system_activity'
      );
    else
      v_idempotent := true;
    end if;
    return jsonb_build_object(
      'success', true,
      'ready', true,
      'idempotent', v_idempotent,
      'handoff', 'qjc',
      'task', to_jsonb(v_task),
      'gpt_review', to_jsonb(v_gpt_item),
      'regression', to_jsonb(v_regression_item)
    );
  end if;

  if v_task.status <> 'qa'
     or v_task.assignee <> 'GPT'
     or v_task.workspace_id <> v_gpt_workspace.id then
    raise exception using errcode = '55000',
      message = 'TASK must be in GPT區 before Engineering Review handoff';
  end if;

  update public.board_tasks
  set status = 'qa',
      assignee = 'QJC',
      workspace_id = v_qjc_workspace.id,
      updated_at = v_now
  where id = v_task.id
  returning * into v_updated_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_engineering_gate_passed',
    jsonb_build_object(
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id
    ),
    jsonb_build_object(
      'status', v_updated_task.status,
      'assignee', v_updated_task.assignee,
      'workspace_id', v_updated_task.workspace_id,
      'gpt_review_item_id', v_gpt_item.id,
      'regression_item_id', v_regression_item.id,
      'lifecycle', 'engineering_review_to_qjc'
    ),
    'GPT Review and Regression Evidence passed; TASK atomically entered the QJC PM QA queue',
    null, 'ai', 'GPT', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'ready', true,
    'idempotent', false,
    'handoff', 'qjc',
    'task', to_jsonb(v_updated_task),
    'gpt_review', to_jsonb(v_gpt_item),
    'regression', to_jsonb(v_regression_item)
  );
end;
$function$;

create or replace function public.board_update_checklist_item(
  p_item_id uuid,
  p_state text,
  p_evidence_note text default null,
  p_evidence_ref text default null,
  p_actor_type text default 'human',
  p_actor_label text default null
)
returns public.engineering_checklist_items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current_item public.engineering_checklist_items;
  v_updated_item public.engineering_checklist_items;
  v_current_task public.board_tasks%rowtype;
  v_completed_task public.board_tasks%rowtype;
  v_requeued_task public.board_tasks%rowtype;
  v_co_workspace public.board_workspaces%rowtype;
  v_completion_workspace_id uuid;
  v_actor_type text := lower(trim(coalesce(p_actor_type, 'human')));
  v_actor_label text;
  v_actor_id uuid;
  v_state text := lower(trim(coalesce(p_state, '')));
  v_note text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  v_ref text := nullif(btrim(coalesce(p_evidence_ref, '')), '');
begin
  if v_state not in ('not_verified', 'pass', 'fail', 'na') then
    raise exception using errcode = '22023', message = 'Invalid checklist state';
  end if;

  select *
    into v_current_item
  from public.engineering_checklist_items
  where id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checklist item not found';
  end if;

  select *
    into v_current_task
  from public.board_tasks
  where id = v_current_item.task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  if v_actor_type = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    v_actor_id := auth.uid();
    v_actor_label := 'QJC';
  elsif v_actor_type = 'ai'
        and coalesce(auth.role(), '') = 'service_role'
        and p_actor_label in ('GPT', 'Co') then
    if lower(p_actor_label) <> lower(v_current_item.stage) then
      raise exception using errcode = '42501', message = 'AI actor may only update its own checklist stage';
    end if;
    v_actor_id := null;
    v_actor_label := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Checklist actor is not allowed';
  end if;

  if v_current_task.status = 'done'
     and lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_current_item.state = 'pass'
     and v_state <> 'pass' then
    raise exception using errcode = '55000', message = 'Completed TASK acceptance is immutable';
  end if;

  if lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_state = 'pass' then
    if v_actor_type <> 'human' then
      raise exception using errcode = '42501', message = 'PM Acceptance requires the authenticated QJC owner';
    end if;
    if v_note is null and v_ref is null then
      raise exception using errcode = '22023', message = 'PM Acceptance evidence is required';
    end if;
    if v_current_task.status <> 'qa' or v_current_task.assignee <> 'QJC' then
      raise exception using errcode = '42501', message = 'TASK must be in QJC PM QA before acceptance';
    end if;
    if exists (
      select 1
      from public.engineering_checklist_items item
      where item.task_id = v_current_task.id
        and item.required = true
        and lower(coalesce(item.stage, '')) in ('co', 'qjc')
        and item.id <> v_current_item.id
        and (item.state <> 'pass'
             or (nullif(btrim(coalesce(item.evidence_note, '')), '') is null
                 and nullif(btrim(coalesce(item.evidence_ref, '')), '') is null))
    ) then
      raise exception using errcode = '42501', message = 'Co/QJC engineering evidence is incomplete';
    end if;
    if not exists (
      select 1
      from public.engineering_checklist_items item
      where item.task_id = v_current_task.id
        and item.required = true
        and lower(coalesce(item.stage, '')) = 'co'
    ) then
      raise exception using errcode = '42501', message = 'Co Developer QA evidence is required';
    end if;

    if not exists (
      select 1
      from public.engineering_checklist_items item
      where item.task_id = v_current_task.id
        and item.required = true
        and lower(coalesce(item.stage, '')) = 'gpt'
        and lower(coalesce(item.item_key, '')) = 'gpt-review'
        and item.state = 'pass'
        and (nullif(btrim(coalesce(item.evidence_note, '')), '') is not null
             or nullif(btrim(coalesce(item.evidence_ref, '')), '') is not null)
    ) then
      raise exception using errcode = '42501', message = 'GPT Review evidence is incomplete';
    end if;
    if not exists (
      select 1
      from public.engineering_checklist_items item
      where item.task_id = v_current_task.id
        and item.required = true
        and lower(coalesce(item.stage, '')) = 'gpt'
        and item.checklist_type = 'batch_regression'
    ) then
      raise exception using errcode = '42501', message = 'Regression evidence is required';
    end if;
    if exists (
      select 1
      from public.engineering_checklist_items item
      where item.task_id = v_current_task.id
        and item.required = true
        and lower(coalesce(item.stage, '')) = 'gpt'
        and (
          lower(coalesce(item.item_key, '')) = 'gpt-review'
          or item.checklist_type = 'batch_regression'
        )
        and (
          item.state <> 'pass'
          or (nullif(btrim(coalesce(item.evidence_note, '')), '') is null
              and nullif(btrim(coalesce(item.evidence_ref, '')), '') is null)
        )
    ) then
      raise exception using errcode = '42501', message = 'GPT Review and Regression evidence are incomplete';
    end if;

    select id
      into v_completion_workspace_id
    from public.board_workspaces
    where board_instance_id = v_current_task.board_instance_id
      and active = true
      and workspace_key = 'completed'
    order by sort_order asc, created_at asc
    limit 1;
    if v_completion_workspace_id is null then
      select id
        into v_completion_workspace_id
      from public.board_workspaces
      where board_instance_id = v_current_task.board_instance_id
        and active = true
        and name = '已完成'
      order by sort_order asc, created_at asc
      limit 1;
    end if;
    if v_completion_workspace_id is null then
      raise exception using errcode = 'P0002', message = 'Canonical 已完成 workspace is missing';
    end if;
  end if;

  if lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_state = 'fail' then
    if v_actor_type <> 'human' then
      raise exception using errcode = '42501', message = 'PM QA FAIL requires the authenticated QJC owner';
    end if;
    if v_current_task.status <> 'qa' or v_current_task.assignee <> 'QJC' then
      raise exception using errcode = '42501', message = 'TASK must be in QJC PM QA before a PM QA FAIL';
    end if;
    select *
      into v_co_workspace
    from public.board_workspaces
    where board_instance_id = v_current_task.board_instance_id
      and active = true
      and workspace_key = 'co'
    order by sort_order asc, created_at asc
    limit 1;
    if not found then
      raise exception using errcode = 'P0002', message = 'Canonical Co workspace is missing';
    end if;
  end if;

  update public.engineering_checklist_items
  set state = v_state,
      checked_by = case when v_state = 'not_verified' then null else v_actor_id end,
      checked_at = case when v_state = 'not_verified' then null else now() end,
      evidence_note = v_note,
      evidence_ref = v_ref,
      updated_at = now()
  where id = p_item_id
  returning * into v_updated_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'engineering_checklist_item', p_item_id::text, 'checklist_item_updated',
    to_jsonb(v_current_item), to_jsonb(v_updated_item),
    coalesce(v_note, v_ref), v_actor_id, v_actor_type, v_actor_label, 'system_activity'
  );

  if lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_state = 'fail' then
    update public.board_tasks
    set status = 'ready',
        assignee = 'Co',
        workspace_id = v_co_workspace.id,
        updated_at = now()
    where id = v_current_task.id
    returning * into v_requeued_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_current_task.id::text, 'task_pm_qa_failed_requeued',
      jsonb_build_object(
        'status', v_current_task.status,
        'assignee', v_current_task.assignee,
        'workspace_id', v_current_task.workspace_id
      ),
      jsonb_build_object(
        'status', v_requeued_task.status,
        'assignee', v_requeued_task.assignee,
        'workspace_id', v_requeued_task.workspace_id,
        'lifecycle', 'pm_qa_fail_to_co_queue'
      ),
    'PM QA FAIL recorded; TASK returned to the executable Co queue for correction',
      v_actor_id, 'human', 'QJC', 'system_activity'
    );
  end if;

  if lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_state = 'pass' then
    update public.board_tasks
    set status = 'done',
        assignee = 'QJC',
        workspace_id = v_completion_workspace_id,
        accepted_at = coalesce(accepted_at, now()),
        accepted_by = coalesce(accepted_by, v_actor_id),
        completion_at = coalesce(completion_at, now()),
        completion_by = coalesce(completion_by, v_actor_id),
        archive_due_at = coalesce(archive_due_at, now() + interval '48 hours'),
        archived_at = null,
        archived_by = null,
        updated_at = now()
    where id = v_current_task.id
    returning * into v_completed_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_current_task.id::text, 'task_completed_after_pm_acceptance',
      jsonb_build_object(
        'status', v_current_task.status,
        'workspace_id', v_current_task.workspace_id,
        'assignee', v_current_task.assignee,
        'accepted_at', v_current_task.accepted_at,
        'completion_at', v_current_task.completion_at
      ),
      jsonb_build_object(
        'status', v_completed_task.status,
        'workspace_id', v_completed_task.workspace_id,
        'assignee', v_completed_task.assignee,
        'accepted_at', v_completed_task.accepted_at,
        'completion_at', v_completed_task.completion_at,
        'archive_due_at', v_completed_task.archive_due_at,
        'lifecycle', 'pm_acceptance_pass'
      ),
      'TASK entered 已完成 after authenticated PM Acceptance PASS',
      v_actor_id, 'human', 'QJC', 'system_activity'
    );
  end if;

  return v_updated_item;
end;
$function$;


create or replace function public.board_transition_task(
  p_task_id uuid,
  p_target_status text,
  p_target_assignee text,
  p_actor_type text default 'human',
  p_actor_label text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current public.board_tasks%rowtype;
  v_actor_id uuid;
  v_actor_type text := lower(trim(coalesce(p_actor_type, 'human')));
  v_actor_label text;
  v_target_status text := lower(trim(coalesce(p_target_status, '')));
  v_target_assignee text := trim(coalesce(p_target_assignee, ''));
begin
  if v_target_status not in ('ready', 'inprogress', 'qa', 'done') then
    raise exception using errcode = '22023', message = 'Unsupported Board status';
  end if;
  if v_target_assignee not in ('QJC', 'GPT', 'Co') then
    raise exception using errcode = '22023', message = 'Unsupported workflow assignee';
  end if;
  if v_target_status = 'done' then
    raise exception using errcode = '42501', message = 'PM Acceptance controlled path is required before completion';
  end if;

  if v_actor_type = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    v_actor_id := auth.uid();
    v_actor_label := 'QJC';
  elsif v_actor_type = 'ai' then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception using errcode = '42501', message = 'AI workflow actors require the controlled service path';
    end if;
    if p_actor_label not in ('GPT', 'Co') then
      raise exception using errcode = '22023', message = 'Unsupported AI workflow actor';
    end if;
    v_actor_id := null;
    v_actor_label := p_actor_label;
  else
    raise exception using errcode = '22023', message = 'Unsupported actor type';
  end if;

  select *
    into v_current
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  if v_actor_label = 'Co'
     and v_current.status = 'ready'
     and v_target_status = 'inprogress'
     and v_target_assignee = 'Co' then
    raise exception using errcode = '42501',
      message = 'Co ready -> inprogress requires board_claim_next_task';
  end if;

  if v_current.status = 'qa'
     and v_target_status = 'qa'
     and v_target_assignee = 'QJC' then
    raise exception using errcode = '42501',
      message = 'GPT Review and Regression gates require board_orchestrate_engineering_review';
  end if;

  if not (
    (v_actor_label = 'QJC' and (
      (v_current.status = 'ready' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
      or (v_current.status = 'inprogress' and v_target_status = 'qa' and v_target_assignee = 'GPT')
      or (v_current.status = 'qa' and v_target_status = 'qa' and v_target_assignee = 'QJC')
      or (v_current.status = 'qa' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
    ))
    or (v_actor_label = 'Co' and (
      (v_current.status = 'inprogress' and v_target_status = 'qa' and v_target_assignee = 'GPT')
      or (v_current.status = 'qa' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
    ))
    or (v_actor_label = 'GPT' and (
      (v_current.status = 'qa' and v_target_status = 'qa' and v_target_assignee = 'QJC')
      or (v_current.status = 'qa' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
    ))
  ) then
    raise exception using errcode = '42501', message = 'Workflow transition is not permitted';
  end if;

  update public.board_tasks
  set status = v_target_status,
      assignee = v_target_assignee,
      updated_at = now()
  where id = p_task_id;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'workflow_transition',
    jsonb_build_object('status', v_current.status, 'assignee', v_current.assignee),
    jsonb_build_object('status', v_target_status, 'assignee', v_target_assignee),
    p_note, v_actor_id, v_actor_type, v_actor_label, 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'status', v_target_status,
    'assignee', v_target_assignee,
    'actor_type', v_actor_type,
    'actor_label', v_actor_label
  );
end;
$function$;


revoke all on function public.board_orchestrate_engineering_review(uuid, text) from public, anon, authenticated;
grant execute on function public.board_orchestrate_engineering_review(uuid, text) to service_role;

revoke all on function public.board_orchestrate_developer_qa(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.board_orchestrate_developer_qa(uuid, uuid, text, text, text, uuid) to service_role;

revoke all on function public.board_update_checklist_item(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.board_update_checklist_item(uuid, text, text, text, text, text) to authenticated;

revoke all on function public.board_transition_task(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.board_transition_task(uuid, text, text, text, text, text) to authenticated;

comment on function public.board_orchestrate_engineering_review(uuid, text) is
  'TASK-040 Cloud authoritative GPT Review + Regression gate; both pass before QJC handoff.';

comment on table private.board_task_claims is
  'TASK-040 private Cloud claim ledger; access only through the controlled service RPCs.';

commit;

