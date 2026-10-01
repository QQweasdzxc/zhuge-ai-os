-- TASK lifecycle consistency: the visible lifecycle workspace and the formal
-- Cloud state must be one atomic fact.
--
-- This is an additive, AI Board-only correction.  It does not rewrite any
-- existing TASK, checklist, claim, Board, or Consumer data.  Non-lifecycle
-- workspaces remain movable through the existing generic operation.

begin;

create or replace function public.enforce_ai_board_lifecycle_workspace_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_scope text;
  v_workspace public.board_workspaces%rowtype;
  v_expected_status text;
  v_expected_assignee text;
begin
  select coalesce(
    nullif(btrim(coalesce(new.application_scope, '')), ''),
    nullif(btrim(coalesce(instance.legacy_application_scope, '')), '')
  )
    into v_scope
  from public.board_instances instance
  where instance.id = new.board_instance_id;

  if coalesce(v_scope, '') <> 'ai_board' then
    return new;
  end if;

  select *
    into v_workspace
  from public.board_workspaces workspace
  where workspace.id = new.workspace_id
    and workspace.board_instance_id = new.board_instance_id
    and workspace.active = true;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'AI Board lifecycle 與工作區不一致：目標工作區不存在、未啟用或不屬於此 Board；卡片未移動。';
  end if;

  case lower(coalesce(v_workspace.workspace_key, ''))
    when 'todo' then
      v_expected_status := 'ready';
      v_expected_assignee := 'Co';
    when 'co' then
      v_expected_status := 'inprogress';
      v_expected_assignee := 'Co';
    when 'qjc' then
      v_expected_status := 'qa';
      v_expected_assignee := 'QJC';
    when 'gpt' then
      v_expected_status := 'qa';
      v_expected_assignee := 'GPT';
    when 'completed' then
      v_expected_status := 'done';
      v_expected_assignee := 'QJC';
    else
      -- Ordinary custom workspaces are not lifecycle states.  Keep the
      -- existing generic move capability available for them.
      return new;
  end case;

  if new.status is distinct from v_expected_status
     or new.assignee is distinct from v_expected_assignee then
    raise exception using
      errcode = '42501',
      message = format(
        'AI Board lifecycle 與工作區不一致：工作區「%s」必須是 %s / %s；請使用正式 lifecycle transition，卡片未移動。',
        v_workspace.name,
        v_expected_status,
        v_expected_assignee
      );
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_ai_board_lifecycle_workspace_consistency on public.board_tasks;
create trigger trg_ai_board_lifecycle_workspace_consistency
before insert or update of status, assignee, workspace_id on public.board_tasks
for each row
execute function public.enforce_ai_board_lifecycle_workspace_consistency();

comment on function public.enforce_ai_board_lifecycle_workspace_consistency() is
  'AI Board-only invariant: canonical lifecycle workspace, status, and assignee are one Cloud fact; custom workspaces remain generic.';

-- The existing transition RPC remains the single generic lifecycle entry
-- point, but it now updates the canonical workspace in the same transaction.
-- PM Acceptance still owns the only path to done.
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
  v_updated public.board_tasks%rowtype;
  v_instance public.board_instances%rowtype;
  v_target_workspace public.board_workspaces%rowtype;
  v_actor_id uuid;
  v_scope text;
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
    raise exception using errcode = '42501',
      message = 'PM Acceptance controlled path is required before completion';
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

  select *
    into v_instance
  from public.board_instances
  where id = v_current.board_instance_id
    and active = true
  for share;
  v_scope := coalesce(
    nullif(btrim(coalesce(v_current.application_scope, '')), ''),
    nullif(btrim(coalesce(v_instance.legacy_application_scope, '')), '')
  );

  if v_actor_label = 'Co'
     and v_current.status = 'ready'
     and v_target_status = 'inprogress'
     and v_target_assignee = 'Co' then
    raise exception using errcode = '42501',
      message = 'Co ready -> inprogress requires board_claim_next_task';
  end if;

  if v_actor_label = 'QJC'
     and v_current.status = 'qa'
     and v_current.assignee = 'QJC'
     and v_target_status = 'inprogress'
     and v_target_assignee = 'Co' then
    raise exception using errcode = '42501',
      message = 'QJC PM QA FAIL must use the formal PM Acceptance退回 path';
  end if;

  if not (
    (v_actor_label = 'QJC' and (
      (v_current.status = 'ready' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
      or (v_current.status = 'inprogress' and v_target_status = 'ready' and v_target_assignee = 'Co')
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

  if v_scope = 'ai_board' then
    select *
      into v_target_workspace
    from public.board_workspaces
    where board_instance_id = v_current.board_instance_id
      and active = true
      and workspace_key = case
        when v_target_status = 'ready' and v_target_assignee = 'Co' then 'todo'
        when v_target_status = 'inprogress' and v_target_assignee = 'Co' then 'co'
        when v_target_status = 'qa' and v_target_assignee = 'GPT' then 'gpt'
        when v_target_status = 'qa' and v_target_assignee = 'QJC' then 'qjc'
        else null
      end
    order by sort_order asc, created_at asc
    limit 1;
    if not found then
      raise exception using errcode = 'P0002',
        message = format(
          'Canonical AI Board workspace is missing for %s / %s; transition was not applied.',
          v_target_status,
          v_target_assignee
        );
    end if;

    if v_target_status = 'qa' and v_target_assignee = 'GPT' then
      if not exists (
        select 1
        from public.engineering_checklist_items item
        where item.task_id = v_current.id
          and item.required = true
          and lower(coalesce(item.stage, '')) = 'co'
          and item.state = 'pass'
          and (
            nullif(btrim(coalesce(item.evidence_note, '')), '') is not null
            or nullif(btrim(coalesce(item.evidence_ref, '')), '') is not null
          )
      ) then
        raise exception using errcode = '42501',
          message = '正式工程交接被阻擋：Co Developer QA Evidence 尚未完成。';
      end if;
    end if;

    if v_target_status = 'qa' and v_target_assignee = 'QJC' then
      if exists (
        select 1
        from public.engineering_checklist_items item
        where item.task_id = v_current.id
          and item.required = true
          and lower(coalesce(item.stage, '')) = 'co'
          and (
            item.state <> 'pass'
            or (
              nullif(btrim(coalesce(item.evidence_note, '')), '') is null
              and nullif(btrim(coalesce(item.evidence_ref, '')), '') is null
            )
          )
      ) or not exists (
        select 1
        from public.engineering_checklist_items item
        where item.task_id = v_current.id
          and item.required = true
          and lower(coalesce(item.stage, '')) = 'co'
      ) then
        raise exception using errcode = '42501',
          message = '正式工程交接被阻擋：Co Developer QA Evidence 尚未完成。';
      end if;

      if exists (
        select 1
        from public.engineering_checklist_items item
        where item.task_id = v_current.id
          and item.required = true
          and lower(coalesce(item.stage, '')) = 'gpt'
          and lower(coalesce(item.item_key, '')) in ('gpt-review', 'engineering-review')
          and (
            item.state <> 'pass'
            or (
              nullif(btrim(coalesce(item.evidence_note, '')), '') is null
              and nullif(btrim(coalesce(item.evidence_ref, '')), '') is null
            )
          )
      ) or not exists (
        select 1
        from public.engineering_checklist_items item
        where item.task_id = v_current.id
          and item.required = true
          and lower(coalesce(item.stage, '')) = 'gpt'
          and lower(coalesce(item.item_key, '')) in ('gpt-review', 'engineering-review')
      ) then
        raise exception using errcode = '42501',
          message = '正式工程交接被阻擋：GPT Review Evidence 尚未完成。';
      end if;

      if exists (
        select 1
        from public.engineering_checklist_items item
        where item.task_id = v_current.id
          and item.required = true
          and lower(coalesce(item.stage, '')) = 'gpt'
          and (
            lower(coalesce(item.checklist_type, '')) = 'batch_regression'
            or lower(coalesce(item.item_key, '')) in ('regression-evidence', 'batch-regression')
          )
          and (
            item.state <> 'pass'
            or (
              nullif(btrim(coalesce(item.evidence_note, '')), '') is null
              and nullif(btrim(coalesce(item.evidence_ref, '')), '') is null
            )
          )
      ) or not exists (
        select 1
        from public.engineering_checklist_items item
        where item.task_id = v_current.id
          and item.required = true
          and lower(coalesce(item.stage, '')) = 'gpt'
          and (
            lower(coalesce(item.checklist_type, '')) = 'batch_regression'
            or lower(coalesce(item.item_key, '')) in ('regression-evidence', 'batch-regression')
          )
      ) then
        raise exception using errcode = '42501',
          message = '正式工程交接被阻擋：Regression Evidence 尚未完成。';
      end if;
    end if;
  end if;

  update public.board_tasks
  set status = v_target_status,
      assignee = v_target_assignee,
      workspace_id = case when v_scope = 'ai_board' then v_target_workspace.id else workspace_id end,
      updated_at = now()
  where id = v_current.id
  returning * into v_updated;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_current.id::text, 'workflow_transition',
    jsonb_build_object(
      'status', v_current.status,
      'assignee', v_current.assignee,
      'workspace_id', v_current.workspace_id
    ),
    jsonb_build_object(
      'status', v_updated.status,
      'assignee', v_updated.assignee,
      'workspace_id', v_updated.workspace_id,
      'lifecycle', case
        when v_target_status = 'qa' and v_target_assignee = 'QJC' then 'engineering_handoff_to_qjc'
        when v_target_status = 'qa' and v_target_assignee = 'GPT' then 'engineering_handoff_to_gpt'
        when v_target_status = 'inprogress' and v_target_assignee = 'Co' then 'returned_to_co_inprogress'
        when v_target_status = 'ready' and v_target_assignee = 'Co' then 'returned_to_todo_ready'
        else 'workflow_transition'
      end
    ),
    p_note, v_actor_id, v_actor_type, v_actor_label, 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'task_id', v_updated.id,
    'status', v_updated.status,
    'assignee', v_updated.assignee,
    'workspace_id', v_updated.workspace_id,
    'actor_type', v_actor_type,
    'actor_label', v_actor_label
  );
end;
$function$;

-- PM QA FAIL is a separate formal operation so a generic checklist update
-- cannot accidentally produce ready/Co in the Co workspace.  Checklist
-- evidence and task state are written under one row lock/transaction.
create or replace function public.board_pm_qa_fail_requeue(
  p_item_id uuid,
  p_evidence_note text default null,
  p_evidence_ref text default null
)
returns public.engineering_checklist_items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item public.engineering_checklist_items%rowtype;
  v_updated_item public.engineering_checklist_items%rowtype;
  v_task public.board_tasks%rowtype;
  v_co_workspace public.board_workspaces%rowtype;
  v_actor_id uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  v_ref text := nullif(btrim(coalesce(p_evidence_ref, '')), '');
begin
  if v_actor_id is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'PM QA FAIL requires the authenticated QJC owner';
  end if;
  if v_note is null and v_ref is null then
    raise exception using errcode = '22023', message = 'PM QA FAIL evidence is required';
  end if;

  select *
    into v_item
  from public.engineering_checklist_items
  where id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checklist item not found';
  end if;
  if lower(coalesce(v_item.stage, '')) <> 'qjc'
     or lower(coalesce(v_item.item_key, '')) <> 'pm-acceptance' then
    raise exception using errcode = '42501', message = 'Only the formal QJC PM Acceptance item can requeue a TASK';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = v_item.task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  if coalesce(v_task.application_scope, '') <> 'ai_board'
     or v_task.status <> 'qa'
     or v_task.assignee <> 'QJC' then
    raise exception using errcode = '42501',
      message = 'TASK must be qa/QJC before a formal PM QA FAIL';
  end if;

  select *
    into v_co_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and workspace_key = 'co'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'Canonical Co workspace is missing';
  end if;

  update public.engineering_checklist_items
  set state = 'fail',
      checked_by = v_actor_id,
      checked_at = now(),
      evidence_note = v_note,
      evidence_ref = v_ref,
      updated_at = now()
  where id = v_item.id
  returning * into v_updated_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'engineering_checklist_item', v_item.id::text, 'checklist_item_updated',
    to_jsonb(v_item), to_jsonb(v_updated_item), coalesce(v_note, v_ref),
    v_actor_id, 'human', 'QJC', 'system_activity'
  );

  update public.board_tasks
  set status = 'inprogress',
      assignee = 'Co',
      workspace_id = v_co_workspace.id,
      updated_at = now()
  where id = v_task.id;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_pm_qa_failed_requeued',
    jsonb_build_object(
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id
    ),
    jsonb_build_object(
      'status', 'inprogress',
      'assignee', 'Co',
      'workspace_id', v_co_workspace.id,
      'lifecycle', 'pm_qa_fail_to_co_inprogress'
    ),
    'PM QA FAIL recorded; TASK returned to the executable Co work stage',
    v_actor_id, 'human', 'QJC', 'system_activity'
  );

  return v_updated_item;
end;
$function$;

-- Honest recovery for a stale task that already has real PM Acceptance
-- evidence.  It never infers acceptance from a workspace, timestamp, or UI.
create or replace function public.board_reconcile_pm_acceptance_lifecycle(
  p_task_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_updated public.board_tasks%rowtype;
  v_acceptance public.engineering_checklist_items%rowtype;
  v_completion public.board_workspaces%rowtype;
  v_actor_id uuid := auth.uid();
  v_scope text;
begin
  if v_actor_id is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Lifecycle recovery requires the authenticated QJC owner';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  select coalesce(
    nullif(btrim(coalesce(v_task.application_scope, '')), ''),
    nullif(btrim(coalesce(instance.legacy_application_scope, '')), '')
  )
    into v_scope
  from public.board_instances instance
  where instance.id = v_task.board_instance_id;
  if v_scope <> 'ai_board' then
    raise exception using errcode = '42501', message = 'Lifecycle recovery is limited to AI Board TASKs';
  end if;

  if v_task.status = 'done' and v_task.assignee = 'QJC' then
    select *
      into v_completion
    from public.board_workspaces
    where id = v_task.workspace_id
      and active = true
      and workspace_key = 'completed';
    if found then
      return jsonb_build_object('success', true, 'reconciled', false, 'idempotent', true, 'task', to_jsonb(v_task));
    end if;
  end if;

  select *
    into v_acceptance
  from public.engineering_checklist_items item
  where item.task_id = v_task.id
    and lower(coalesce(item.stage, '')) = 'qjc'
    and lower(coalesce(item.item_key, '')) = 'pm-acceptance'
    and item.state = 'pass'
    and item.checked_at is not null
    and (
      nullif(btrim(coalesce(item.evidence_note, '')), '') is not null
      or nullif(btrim(coalesce(item.evidence_ref, '')), '') is not null
    )
  order by item.checked_at desc, item.updated_at desc
  limit 1;
  if not found then
    raise exception using errcode = '42501',
      message = '正式 PM Acceptance Evidence 不存在；不會從工作區或時間戳推定完成。';
  end if;
  if v_task.status <> 'qa' or v_task.assignee <> 'QJC' then
    raise exception using errcode = '42501',
      message = '已有 PM Acceptance Evidence，但 TASK 不在 qa/QJC；未自動修復以避免繞過正式 Gate。';
  end if;

  if exists (
    select 1
    from public.engineering_checklist_items item
    where item.task_id = v_task.id
      and item.required = true
      and lower(coalesce(item.stage, '')) in ('co', 'qjc')
      and item.id <> v_acceptance.id
      and (
        item.state <> 'pass'
        or (
          nullif(btrim(coalesce(item.evidence_note, '')), '') is null
          and nullif(btrim(coalesce(item.evidence_ref, '')), '') is null
        )
      )
  ) then
    raise exception using errcode = '42501', message = '正式 Lifecycle Recovery 被阻擋：Co/QJC 必要 Evidence 不完整。';
  end if;

  select *
    into v_completion
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and workspace_key = 'completed'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'Canonical 完成 workspace is missing';
  end if;

  update public.board_tasks
  set status = 'done',
      assignee = 'QJC',
      workspace_id = v_completion.id,
      accepted_at = coalesce(accepted_at, v_acceptance.checked_at),
      accepted_by = coalesce(accepted_by, v_acceptance.checked_by, v_actor_id),
      completion_at = coalesce(completion_at, v_acceptance.checked_at),
      completion_by = coalesce(completion_by, v_acceptance.checked_by, v_actor_id),
      archive_due_at = coalesce(archive_due_at, v_acceptance.checked_at + interval '48 hours'),
      archived_at = null,
      archived_by = null,
      updated_at = now()
  where id = v_task.id
  returning * into v_updated;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_lifecycle_reconciled_after_pm_acceptance',
    jsonb_build_object(
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id
    ),
    jsonb_build_object(
      'status', v_updated.status,
      'assignee', v_updated.assignee,
      'workspace_id', v_updated.workspace_id,
      'lifecycle', 'pm_acceptance_reconciled',
      'pm_acceptance_checked_at', v_acceptance.checked_at
    ),
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Existing PM Acceptance evidence reconciled through the formal lifecycle path'),
    v_actor_id, 'human', 'QJC', 'system_activity'
  );

  return jsonb_build_object('success', true, 'reconciled', true, 'idempotent', false, 'task', to_jsonb(v_updated));
end;
$function$;

-- Preserve the legacy RPC name for controlled GPT reconciliation, but make
-- its actual result truthful: QJC -> Co is inprogress/Co, never ready/Co.
create or replace function public.board_reconcile_qjc_task_to_co_ready(
  p_task_id uuid,
  p_idempotency_key text,
  p_actor_label text default 'GPT'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_instance public.board_instances%rowtype;
  v_co_workspace public.board_workspaces%rowtype;
  v_updated public.board_tasks%rowtype;
  v_previous public.engineering_activity_log%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'GPT' then
    raise exception using errcode = '42501', message = 'QJC reconciliation requires the controlled GPT service path';
  end if;
  if p_task_id is null or v_key is null or length(v_key) < 8 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'TASK and a bounded reconciliation idempotency key are required';
  end if;

  select * into v_task from public.board_tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board TASK not found';
  end if;
  if coalesce(v_task.application_scope, '') <> 'ai_board' or v_task.board_instance_id is null then
    raise exception using errcode = '42501', message = 'QJC reconciliation is limited to AI Board TASKs';
  end if;

  select * into v_instance
  from public.board_instances
  where id = v_task.board_instance_id and active = true
  for share;
  if not found or coalesce(v_instance.task_code_prefix, '') <> 'TASK'
     or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501', message = 'QJC reconciliation is limited to the canonical AI Board';
  end if;

  select * into v_co_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true and workspace_key = 'co'
  order by sort_order asc, created_at asc limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'Canonical Co workspace is missing';
  end if;

  select * into v_previous
  from public.engineering_activity_log
  where entity_type = 'board_task'
    and entity_id = v_task.id::text
    and action = 'task_reconciled_to_co_inprogress'
    and after_data ->> 'idempotency_key' = v_key
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object('success', true, 'idempotent', true, 'reconciled', true, 'task', to_jsonb(v_task), 'audit_id', v_previous.id);
  end if;

  if v_task.status <> 'qa' or v_task.assignee <> 'QJC' or v_task.workspace_id is distinct from v_co_workspace.id then
    raise exception using errcode = '55000', message = 'TASK must be qa/QJC in the canonical Co workspace for this reconciliation';
  end if;

  update public.board_tasks
  set status = 'inprogress', assignee = 'Co', workspace_id = v_co_workspace.id, updated_at = v_now
  where id = v_task.id
  returning * into v_updated;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_reconciled_to_co_inprogress',
    jsonb_build_object('status', v_task.status, 'assignee', v_task.assignee, 'workspace_id', v_task.workspace_id),
    jsonb_build_object('status', v_updated.status, 'assignee', v_updated.assignee, 'workspace_id', v_updated.workspace_id, 'idempotency_key', v_key, 'lifecycle', 'qjc_reconciliation_to_co_inprogress'),
    'Approved generic reconciliation returned a stale QJC handoff to the executable Co work stage',
    null, 'ai', 'GPT', 'system_activity'
  );

  return jsonb_build_object('success', true, 'idempotent', false, 'reconciled', true, 'task', to_jsonb(v_updated));
end;
$function$;

-- Claim/release paths must use the same canonical mapping as the invariant:
-- ready/Co belongs to 待辦, while inprogress/Co belongs to Co.  These are
-- compatibility replacements for the existing RPCs; their claim ledger and
-- audit contracts remain unchanged.
create or replace function public.board_claim_next_task(
  p_board_instance_id uuid,
  p_idempotency_key text,
  p_actor_label text default 'Co',
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_todo_workspace public.board_workspaces%rowtype;
  v_co_workspace public.board_workspaces%rowtype;
  v_candidate public.board_tasks%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_existing_claim private.board_task_claims%rowtype;
  v_existing_task public.board_tasks%rowtype;
  v_expired_claim private.board_task_claims%rowtype;
  v_expired_task public.board_tasks%rowtype;
  v_requeued_task public.board_tasks%rowtype;
  v_claimed_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'Co' then
    raise exception using errcode = '42501', message = 'Co Claim requires the controlled service path';
  end if;
  if p_board_instance_id is null or v_key is null or length(v_key) < 8 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'Board instance and a bounded idempotency key are required';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023', message = 'Claim lease must be between 60 and 86400 seconds';
  end if;

  select * into v_instance
  from public.board_instances
  where id = p_board_instance_id and active = true
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active Board instance not found';
  end if;
  if v_instance.task_code_prefix <> 'TASK'
     or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501', message = 'Co Claim is limited to the canonical AI Board';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  select * into v_existing_claim
  from private.board_task_claims
  where actor_label = 'Co' and idempotency_key = v_key;
  if found then
    if v_existing_claim.board_instance_id <> p_board_instance_id then
      raise exception using errcode = '23505', message = 'Idempotency key is already bound to another Board instance';
    end if;
    select * into v_existing_task from public.board_tasks where id = v_existing_claim.task_id;
    return jsonb_build_object(
      'success', true,
      'claimed', v_existing_claim.state in ('active', 'completed'),
      'idempotent', true,
      'claim', jsonb_build_object(
        'id', v_existing_claim.id, 'task_id', v_existing_claim.task_id,
        'board_instance_id', v_existing_claim.board_instance_id,
        'actor_label', v_existing_claim.actor_label, 'claim_token', v_existing_claim.claim_token,
        'state', v_existing_claim.state, 'claimed_at', v_existing_claim.claimed_at,
        'lease_expires_at', v_existing_claim.lease_expires_at,
        'released_at', v_existing_claim.released_at, 'release_reason', v_existing_claim.release_reason
      ),
      'task', to_jsonb(v_existing_task)
    );
  end if;

  select * into v_todo_workspace
  from public.board_workspaces
  where board_instance_id = p_board_instance_id and active = true and workspace_key = 'todo'
  order by sort_order asc, created_at asc limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'Canonical 待辦 workspace is missing';
  end if;
  select * into v_co_workspace
  from public.board_workspaces
  where board_instance_id = p_board_instance_id and active = true and workspace_key = 'co'
  order by sort_order asc, created_at asc limit 1;
  if not found then
    raise exception using errcode = 'P0002', message = 'Canonical Co workspace is missing';
  end if;

  for v_expired_claim in
    select claim.*
    from private.board_task_claims claim
    where claim.board_instance_id = p_board_instance_id
      and claim.state = 'active' and claim.lease_expires_at <= v_now
    order by claim.lease_expires_at asc, claim.created_at asc
  loop
    select * into v_expired_task from public.board_tasks where id = v_expired_claim.task_id for update;
    select * into v_expired_claim from private.board_task_claims where id = v_expired_claim.id for update;
    if v_expired_claim.state <> 'active' or v_expired_claim.lease_expires_at > v_now then continue; end if;

    if v_expired_task.status = 'inprogress' and v_expired_task.assignee = 'Co' then
      update public.board_tasks
      set status = 'ready', assignee = 'Co', workspace_id = v_todo_workspace.id, updated_at = v_now
      where id = v_expired_task.id returning * into v_requeued_task;
      insert into public.engineering_activity_log (
        entity_type, entity_id, action, before_data, after_data, note,
        actor_id, actor_type, actor_label, activity_type
      ) values (
        'board_task', v_expired_task.id::text, 'task_claim_expired_requeued',
        jsonb_build_object('status', v_expired_task.status, 'assignee', v_expired_task.assignee, 'workspace_id', v_expired_task.workspace_id, 'claim_id', v_expired_claim.id),
        jsonb_build_object('status', v_requeued_task.status, 'assignee', v_requeued_task.assignee, 'workspace_id', v_requeued_task.workspace_id, 'claim_id', v_expired_claim.id, 'lifecycle', 'claim_expired'),
        'Co Claim lease expired; TASK safely returned to the 待辦 queue',
        null, 'system', 'System', 'system_activity'
      );
    end if;

    update private.board_task_claims
    set state = 'expired', released_at = coalesce(released_at, v_now), release_reason = coalesce(release_reason, 'lease_expired'), updated_at = v_now
    where id = v_expired_claim.id;
    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_expired_task.id::text, 'task_claim_expired',
      jsonb_build_object('claim_id', v_expired_claim.id, 'claim_state', 'active', 'lease_expires_at', v_expired_claim.lease_expires_at),
      jsonb_build_object('claim_id', v_expired_claim.id, 'claim_state', 'expired', 'released_at', v_now, 'release_reason', 'lease_expired'),
      'Co Claim lease closed by the authoritative Cloud claim path',
      null, 'system', 'System', 'system_activity'
    );
  end loop;

  select task.* into v_candidate
  from public.board_tasks task
  join public.board_workspaces workspace
    on workspace.id = task.workspace_id
   and workspace.board_instance_id = task.board_instance_id
   and workspace.active = true and workspace.workspace_key = 'todo'
  where task.board_instance_id = p_board_instance_id
    and task.application_scope = 'ai_board' and task.status = 'ready' and task.assignee = 'Co'
    and task.archived_at is null
    and not exists (select 1 from private.board_task_claims active_claim where active_claim.task_id = task.id and active_claim.state = 'active')
  order by task.updated_at asc nulls first, task.work_code asc
  limit 1
  for update of task skip locked;
  if not found then
    return jsonb_build_object('success', true, 'claimed', false, 'idempotent', false, 'reason', 'no_executable_task', 'board_instance_id', p_board_instance_id);
  end if;

  update public.board_tasks
  set status = 'inprogress', assignee = 'Co', workspace_id = v_co_workspace.id, updated_at = v_now
  where id = v_candidate.id returning * into v_claimed_task;
  insert into private.board_task_claims (
    task_id, board_instance_id, actor_label, idempotency_key, state, claimed_at, lease_expires_at, created_at, updated_at
  ) values (
    v_claimed_task.id, p_board_instance_id, 'Co', v_key, 'active', v_now,
    v_now + make_interval(secs => p_lease_seconds), v_now, v_now
  ) returning * into v_claim;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_claimed_task.id::text, 'task_claimed',
    jsonb_build_object('status', v_candidate.status, 'assignee', v_candidate.assignee, 'workspace_id', v_candidate.workspace_id),
    jsonb_build_object('status', v_claimed_task.status, 'assignee', v_claimed_task.assignee, 'workspace_id', v_claimed_task.workspace_id, 'claim_id', v_claim.id, 'lease_expires_at', v_claim.lease_expires_at, 'lifecycle', 'co_claim'),
    'Co claimed the next executable TASK through the authoritative Cloud claim path',
    null, 'ai', 'Co', 'system_activity'
  );
  return jsonb_build_object(
    'success', true, 'claimed', true, 'idempotent', false,
    'claim', jsonb_build_object('id', v_claim.id, 'task_id', v_claim.task_id, 'board_instance_id', v_claim.board_instance_id, 'actor_label', v_claim.actor_label, 'claim_token', v_claim.claim_token, 'state', v_claim.state, 'claimed_at', v_claim.claimed_at, 'lease_expires_at', v_claim.lease_expires_at),
    'task', to_jsonb(v_claimed_task)
  );
end;
$function$;

create or replace function public.board_release_task_claim(
  p_claim_token uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim private.board_task_claims%rowtype;
  v_task public.board_tasks%rowtype;
  v_todo_workspace public.board_workspaces%rowtype;
  v_requeued_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Claim release requires the controlled service path';
  end if;
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'Claim token is required';
  end if;
  select * into v_claim from private.board_task_claims where claim_token = p_claim_token and actor_label = 'Co';
  if not found then raise exception using errcode = 'P0002', message = 'Claim not found'; end if;
  select * into v_task from public.board_tasks where id = v_claim.task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Claimed TASK not found'; end if;
  select * into v_claim from private.board_task_claims where id = v_claim.id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Claim not found'; end if;
  if v_claim.state <> 'active' then
    return jsonb_build_object('success', true, 'released', false, 'idempotent', true, 'claim', jsonb_build_object('id', v_claim.id, 'task_id', v_claim.task_id, 'claim_token', v_claim.claim_token, 'state', v_claim.state, 'release_reason', v_claim.release_reason), 'task', to_jsonb(v_task));
  end if;
  select * into v_todo_workspace
  from public.board_workspaces
  where board_instance_id = v_claim.board_instance_id and active = true and workspace_key = 'todo'
  order by sort_order asc, created_at asc limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'Canonical 待辦 workspace is missing'; end if;

  if v_task.status = 'inprogress' and v_task.assignee = 'Co' then
    update public.board_tasks
    set status = 'ready', assignee = 'Co', workspace_id = v_todo_workspace.id, updated_at = v_now
    where id = v_task.id returning * into v_requeued_task;
  else v_requeued_task := v_task;
  end if;
  update private.board_task_claims
  set state = 'released', released_at = v_now, release_reason = coalesce(v_reason, 'released_by_co'), updated_at = v_now
  where id = v_claim.id returning * into v_claim;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_claim_released',
    jsonb_build_object('claim_id', v_claim.id, 'claim_state', 'active', 'status', v_task.status, 'assignee', v_task.assignee, 'workspace_id', v_task.workspace_id),
    jsonb_build_object('claim_id', v_claim.id, 'claim_state', v_claim.state, 'status', v_requeued_task.status, 'assignee', v_requeued_task.assignee, 'workspace_id', v_requeued_task.workspace_id, 'release_reason', v_claim.release_reason, 'lifecycle', 'claim_released'),
    'Co released the active claim; TASK returned to the executable 待辦 queue',
    null, 'ai', 'Co', 'system_activity'
  );
  return jsonb_build_object('success', true, 'released', true, 'idempotent', false, 'claim', jsonb_build_object('id', v_claim.id, 'task_id', v_claim.task_id, 'claim_token', v_claim.claim_token, 'state', v_claim.state, 'released_at', v_claim.released_at, 'release_reason', v_claim.release_reason), 'task', to_jsonb(v_requeued_task));
end;
$function$;

create or replace function public.board_claim_specific_task(
  p_task_id uuid,
  p_idempotency_key text,
  p_actor_label text default 'Co',
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_instance public.board_instances%rowtype;
  v_todo_workspace public.board_workspaces%rowtype;
  v_co_workspace public.board_workspaces%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_existing_claim private.board_task_claims%rowtype;
  v_active_claim private.board_task_claims%rowtype;
  v_claimed_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'Co' then
    raise exception using errcode = '42501', message = 'Specific Co Claim requires the controlled service path';
  end if;
  if p_task_id is null or v_key is null or length(v_key) < 8 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'TASK and a bounded idempotency key are required';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023', message = 'Claim lease must be between 60 and 86400 seconds';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
  select * into v_task from public.board_tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Board TASK not found'; end if;
  if coalesce(v_task.application_scope, '') <> 'ai_board' or v_task.board_instance_id is null then
    raise exception using errcode = '42501', message = 'Specific Co Claim is limited to AI Board TASKs';
  end if;
  select * into v_instance from public.board_instances where id = v_task.board_instance_id and active = true for share;
  if not found or coalesce(v_instance.task_code_prefix, '') <> 'TASK' or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501', message = 'Specific Co Claim is limited to the canonical AI Board';
  end if;
  select * into v_todo_workspace from public.board_workspaces where board_instance_id = v_task.board_instance_id and active = true and workspace_key = 'todo' order by sort_order asc, created_at asc limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'Canonical 待辦 workspace is missing'; end if;
  select * into v_co_workspace from public.board_workspaces where board_instance_id = v_task.board_instance_id and active = true and workspace_key = 'co' order by sort_order asc, created_at asc limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'Canonical Co workspace is missing'; end if;

  select * into v_existing_claim from private.board_task_claims where actor_label = 'Co' and idempotency_key = v_key for update;
  if found then
    if v_existing_claim.task_id <> v_task.id or v_existing_claim.board_instance_id <> v_task.board_instance_id then
      raise exception using errcode = '23505', message = 'Specific Claim idempotency key is already bound to another TASK or Board instance';
    end if;
    return jsonb_build_object('success', true, 'claimed', v_existing_claim.state in ('active', 'completed'), 'idempotent', true, 'claim', jsonb_build_object('id', v_existing_claim.id, 'task_id', v_existing_claim.task_id, 'board_instance_id', v_existing_claim.board_instance_id, 'actor_label', v_existing_claim.actor_label, 'claim_token', v_existing_claim.claim_token, 'state', v_existing_claim.state, 'claimed_at', v_existing_claim.claimed_at, 'lease_expires_at', v_existing_claim.lease_expires_at, 'released_at', v_existing_claim.released_at, 'release_reason', v_existing_claim.release_reason), 'task', to_jsonb(v_task));
  end if;
  if v_task.status <> 'ready' or v_task.assignee <> 'Co' or v_task.archived_at is not null or v_task.workspace_id is distinct from v_todo_workspace.id then
    raise exception using errcode = '55000', message = 'TASK is not eligible for a Specific Co Claim; it must be ready, assigned to Co, unarchived, and in the canonical 待辦 workspace';
  end if;
  select * into v_active_claim from private.board_task_claims where task_id = v_task.id and state = 'active' for update;
  if found then raise exception using errcode = '40901', message = 'TASK already has an active Cloud Claim'; end if;

  update public.board_tasks set status = 'inprogress', assignee = 'Co', workspace_id = v_co_workspace.id, updated_at = v_now where id = v_task.id returning * into v_claimed_task;
  insert into private.board_task_claims (task_id, board_instance_id, actor_label, idempotency_key, state, claimed_at, lease_expires_at, created_at, updated_at)
  values (v_claimed_task.id, v_claimed_task.board_instance_id, 'Co', v_key, 'active', v_now, v_now + make_interval(secs => p_lease_seconds), v_now, v_now) returning * into v_claim;
  insert into public.engineering_activity_log (entity_type, entity_id, action, before_data, after_data, note, actor_id, actor_type, actor_label, activity_type)
  values ('board_task', v_claimed_task.id::text, 'task_claimed_specific', jsonb_build_object('status', v_task.status, 'assignee', v_task.assignee, 'workspace_id', v_task.workspace_id), jsonb_build_object('status', v_claimed_task.status, 'assignee', v_claimed_task.assignee, 'workspace_id', v_claimed_task.workspace_id, 'claim_id', v_claim.id, 'lease_expires_at', v_claim.lease_expires_at, 'lifecycle', 'co_specific_claim'), 'Co claimed the PM-selected executable TASK through the authoritative Cloud Specific Claim path', null, 'ai', 'Co', 'system_activity');
  return jsonb_build_object('success', true, 'claimed', true, 'idempotent', false, 'claim', jsonb_build_object('id', v_claim.id, 'task_id', v_claim.task_id, 'board_instance_id', v_claim.board_instance_id, 'actor_label', v_claim.actor_label, 'claim_token', v_claim.claim_token, 'state', v_claim.state, 'claimed_at', v_claim.claimed_at, 'lease_expires_at', v_claim.lease_expires_at), 'task', to_jsonb(v_claimed_task));
end;
$function$;

revoke all on function public.enforce_ai_board_lifecycle_workspace_consistency() from public, anon, authenticated;
revoke all on function public.board_pm_qa_fail_requeue(uuid, text, text) from public, anon;
grant execute on function public.board_pm_qa_fail_requeue(uuid, text, text) to authenticated;
revoke all on function public.board_reconcile_pm_acceptance_lifecycle(uuid, text) from public, anon;
grant execute on function public.board_reconcile_pm_acceptance_lifecycle(uuid, text) to authenticated;
revoke all on function public.board_transition_task(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.board_transition_task(uuid, text, text, text, text, text) to authenticated;
revoke all on function public.board_reconcile_qjc_task_to_co_ready(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.board_reconcile_qjc_task_to_co_ready(uuid, text, text) to service_role;

comment on function public.board_pm_qa_fail_requeue(uuid, text, text) is
  'Authenticated PM QA FAIL gate: checklist evidence and inprogress/Co/canonical workspace are one atomic lifecycle result.';
comment on function public.board_reconcile_pm_acceptance_lifecycle(uuid, text) is
  'Honest recovery for existing PM Acceptance evidence; never infers completion from UI location or timestamps.';

commit;
