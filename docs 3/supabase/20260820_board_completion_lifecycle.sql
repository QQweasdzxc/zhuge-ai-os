-- Board Completion Lifecycle
--
-- A PM acceptance PASS is the only controlled entry into the canonical
-- "已完成" workspace. The task remains there for 48 hours based on the
-- Cloud completion timestamp, then the authenticated read path invokes the
-- server-side reconciliation RPC to mark it archived. No browser timer,
-- localStorage flag, second status model, or hard delete is introduced.

begin;

alter table public.board_tasks
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references auth.users(id) on delete restrict,
  add column if not exists completion_at timestamptz,
  add column if not exists completion_by uuid references auth.users(id) on delete restrict,
  add column if not exists archive_due_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete restrict;

create index if not exists board_tasks_completion_lifecycle_idx
  on public.board_tasks (status, archive_due_at)
  where completion_at is not null and archived_at is null;

create index if not exists board_tasks_archived_at_idx
  on public.board_tasks (archived_at)
  where archived_at is not null;

-- The existing user-created "測試" row is the canonical completion workspace
-- in the current Cloud state. Rename it in place and retain the row/history.
-- The historical "done / 已完工" row is not deleted and remains hidden by the
-- Board presentation for backward compatibility.
update public.board_workspaces
set workspace_key = 'completed',
    name = '已完成',
    updated_at = now()
where active = true
  and name = '測試'
  and coalesce(workspace_key, '') = ''
  and not exists (
    select 1 from public.board_workspaces existing
    where existing.active = true and existing.name = '已完成'
  );

do $$
begin
  if not exists (
    select 1 from public.board_workspaces
    where active = true and name = '已完成'
  ) then
    update public.board_workspaces
    set workspace_key = 'completed',
        name = '已完成',
        updated_at = now()
    where active = true
      and workspace_key = 'done';
  end if;
end
$$;

-- Backfill only from canonical PM acceptance evidence. In particular, this
-- intentionally does not infer a timestamp from runtime, chat, or packaging
-- history when the evidence is absent.
update public.board_tasks task
set accepted_at = coalesce(task.accepted_at, acceptance.checked_at),
    accepted_by = coalesce(task.accepted_by, acceptance.checked_by),
    completion_at = coalesce(task.completion_at, acceptance.checked_at),
    completion_by = coalesce(task.completion_by, acceptance.checked_by),
    archive_due_at = coalesce(task.archive_due_at, acceptance.checked_at + interval '48 hours'),
    updated_at = now()
from public.engineering_checklist_items acceptance
where acceptance.task_id = task.id
  and lower(coalesce(acceptance.stage, '')) = 'qjc'
  and lower(coalesce(acceptance.item_key, '')) = 'pm-acceptance'
  and acceptance.state = 'pass'
  and acceptance.checked_at is not null
  and (nullif(btrim(coalesce(acceptance.evidence_note, '')), '') is not null
       or nullif(btrim(coalesce(acceptance.evidence_ref, '')), '') is not null)
  and task.accepted_at is null
  and task.completion_at is null;

create or replace function public.board_reconcile_completion_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_task public.board_tasks%rowtype;
  archived_task public.board_tasks%rowtype;
  archived_count integer := 0;
  archived_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;

  for current_task in
    select *
    from public.board_tasks
    where status = 'done'
      and accepted_at is not null
      and completion_at is not null
      and archive_due_at is not null
      and archive_due_at <= now()
      and archived_at is null
    for update
  loop
    update public.board_tasks
    set archived_at = now(),
        archived_by = null,
        updated_at = now()
    where id = current_task.id
    returning * into archived_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', current_task.id::text, 'task_auto_archived',
      jsonb_build_object(
        'status', current_task.status,
        'workspace_id', current_task.workspace_id,
        'completion_at', current_task.completion_at,
        'archive_due_at', current_task.archive_due_at,
        'archived_at', current_task.archived_at
      ),
      jsonb_build_object(
        'status', archived_task.status,
        'workspace_id', archived_task.workspace_id,
        'completion_at', archived_task.completion_at,
        'archive_due_at', archived_task.archive_due_at,
        'archived_at', archived_task.archived_at,
        'lifecycle', 'completion_48h'
      ),
      'TASK automatically archived after the canonical 48-hour completion window',
      null, 'system', 'System', 'system_activity'
    );

    archived_count := archived_count + 1;
    archived_ids := array_append(archived_ids, current_task.id);
  end loop;

  return jsonb_build_object(
    'success', true,
    'archived_count', archived_count,
    'archived_task_ids', to_jsonb(archived_ids)
  );
end;
$function$;

revoke all on function public.board_reconcile_completion_lifecycle() from public;
revoke execute on function public.board_reconcile_completion_lifecycle() from anon;
grant execute on function public.board_reconcile_completion_lifecycle() to authenticated;

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
set search_path = public, pg_temp
as $function$
declare
  current_item public.engineering_checklist_items;
  updated_item public.engineering_checklist_items;
  current_task public.board_tasks%rowtype;
  completed_task public.board_tasks%rowtype;
  completion_workspace_id uuid;
  actor_type_value text := lower(trim(coalesce(p_actor_type, 'human')));
  actor_label_value text;
  actor_id_value uuid;
  state_value text := lower(trim(coalesce(p_state, '')));
  note_value text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  ref_value text := nullif(btrim(coalesce(p_evidence_ref, '')), '');
begin
  if state_value not in ('not_verified', 'pass', 'fail', 'na') then
    raise exception using errcode = '22023', message = 'Invalid checklist state';
  end if;

  select * into current_item
  from public.engineering_checklist_items
  where id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checklist item not found';
  end if;

  select * into current_task
  from public.board_tasks
  where id = current_item.task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  if actor_type_value = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    actor_id_value := auth.uid();
    actor_label_value := 'QJC';
  elsif actor_type_value = 'ai' and coalesce(auth.role(), '') = 'service_role' and p_actor_label in ('GPT', 'Co') then
    if lower(p_actor_label) <> lower(current_item.stage) then
      raise exception using errcode = '42501', message = 'AI actor may only update its own checklist stage';
    end if;
    actor_id_value := null;
    actor_label_value := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Checklist actor is not allowed';
  end if;

  if current_task.status = 'done'
     and current_item.stage = 'qjc'
     and current_item.item_key = 'pm-acceptance'
     and current_item.state = 'pass'
     and state_value <> 'pass' then
    raise exception using errcode = '55000', message = 'Completed TASK acceptance is immutable';
  end if;

  if current_item.stage = 'qjc'
     and current_item.item_key = 'pm-acceptance'
     and state_value = 'pass' then
    if actor_type_value <> 'human' then
      raise exception using errcode = '42501', message = 'PM Acceptance requires the authenticated QJC owner';
    end if;
    if note_value is null and ref_value is null then
      raise exception using errcode = '22023', message = 'PM Acceptance evidence is required';
    end if;
    if current_task.status <> 'qa' or current_task.assignee <> 'QJC' then
      raise exception using errcode = '42501', message = 'TASK must be in QJC PM QA before acceptance';
    end if;
    if exists (
      select 1
      from public.engineering_checklist_items item
      where item.task_id = current_task.id
        and item.required = true
        and lower(coalesce(item.stage, '')) in ('co', 'qjc')
        and item.id <> current_item.id
        and (item.state <> 'pass'
             or (nullif(btrim(coalesce(item.evidence_note, '')), '') is null
                 and nullif(btrim(coalesce(item.evidence_ref, '')), '') is null))
    ) then
      raise exception using errcode = '42501', message = 'Co/QJC engineering evidence is incomplete';
    end if;
    if not exists (
      select 1 from public.engineering_checklist_items item
      where item.task_id = current_task.id and item.required = true and lower(coalesce(item.stage, '')) = 'co'
    ) then
      raise exception using errcode = '42501', message = 'Co Developer QA evidence is required';
    end if;

    select id into completion_workspace_id
    from public.board_workspaces
    where active = true and name = '已完成'
    order by sort_order asc, created_at asc
    limit 1;
    if completion_workspace_id is null then
      raise exception using errcode = 'P0002', message = 'Canonical 已完成 workspace is missing';
    end if;
  end if;

  update public.engineering_checklist_items
  set state = state_value,
      checked_by = case when state_value = 'not_verified' then null else actor_id_value end,
      checked_at = case when state_value = 'not_verified' then null else now() end,
      evidence_note = note_value,
      evidence_ref = ref_value,
      updated_at = now()
  where id = p_item_id
  returning * into updated_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'engineering_checklist_item', p_item_id::text, 'checklist_item_updated',
    to_jsonb(current_item), to_jsonb(updated_item), coalesce(note_value, ref_value),
    actor_id_value, actor_type_value, actor_label_value, 'system_activity'
  );

  if current_item.stage = 'qjc'
     and current_item.item_key = 'pm-acceptance'
     and state_value = 'pass' then
    update public.board_tasks
    set status = 'done',
        assignee = 'QJC',
        workspace_id = completion_workspace_id,
        accepted_at = coalesce(accepted_at, now()),
        accepted_by = coalesce(accepted_by, actor_id_value),
        completion_at = coalesce(completion_at, now()),
        completion_by = coalesce(completion_by, actor_id_value),
        archive_due_at = coalesce(archive_due_at, now() + interval '48 hours'),
        archived_at = null,
        archived_by = null,
        updated_at = now()
    where id = current_task.id
    returning * into completed_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', current_task.id::text, 'task_completed_after_pm_acceptance',
      jsonb_build_object(
        'status', current_task.status,
        'workspace_id', current_task.workspace_id,
        'assignee', current_task.assignee,
        'accepted_at', current_task.accepted_at,
        'completion_at', current_task.completion_at
      ),
      jsonb_build_object(
        'status', completed_task.status,
        'workspace_id', completed_task.workspace_id,
        'assignee', completed_task.assignee,
        'accepted_at', completed_task.accepted_at,
        'completion_at', completed_task.completion_at,
        'archive_due_at', completed_task.archive_due_at,
        'lifecycle', 'pm_acceptance_pass'
      ),
      'TASK entered 已完成 after authenticated PM Acceptance PASS',
      actor_id_value, 'human', 'QJC', 'system_activity'
    );
  end if;

  return updated_item;
end;
$function$;

revoke all on function public.board_update_checklist_item(uuid, text, text, text, text, text) from public;
revoke execute on function public.board_update_checklist_item(uuid, text, text, text, text, text) from anon;
grant execute on function public.board_update_checklist_item(uuid, text, text, text, text, text) to authenticated;

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
set search_path = public, pg_temp
as $function$
declare
  current_row public.board_tasks%rowtype;
  actor_id_value uuid;
  actor_type_value text := lower(trim(coalesce(p_actor_type, 'human')));
  actor_label_value text;
  target_status_value text := lower(trim(coalesce(p_target_status, '')));
  target_assignee_value text := trim(coalesce(p_target_assignee, ''));
  allowed_transition boolean := false;
begin
  if target_status_value not in ('ready', 'inprogress', 'qa', 'done') then
    raise exception using errcode = '22023', message = 'Unsupported Board status';
  end if;
  if target_assignee_value not in ('QJC', 'GPT', 'Co') then
    raise exception using errcode = '22023', message = 'Unsupported workflow assignee';
  end if;
  if target_status_value = 'done' then
    raise exception using errcode = '42501', message = 'PM Acceptance controlled path is required before completion';
  end if;

  if actor_type_value = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    actor_id_value := auth.uid();
    actor_label_value := 'QJC';
  elsif actor_type_value = 'ai' then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception using errcode = '42501', message = 'AI workflow actors require the controlled service path';
    end if;
    if p_actor_label not in ('GPT', 'Co') then
      raise exception using errcode = '22023', message = 'Unsupported AI workflow actor';
    end if;
    actor_id_value := null;
    actor_label_value := p_actor_label;
  else
    raise exception using errcode = '22023', message = 'Unsupported actor type';
  end if;

  select * into current_row
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  allowed_transition :=
    actor_label_value = 'QJC'
    and (
      (current_row.status = 'ready' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
      or (current_row.status = 'inprogress' and target_status_value = 'qa' and target_assignee_value = 'GPT')
      or (current_row.status = 'qa' and target_status_value = 'qa' and target_assignee_value = 'QJC')
      or (current_row.status = 'qa' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
    )
    or (actor_label_value = 'Co' and (
      (current_row.status = 'ready' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
      or (current_row.status = 'inprogress' and target_status_value = 'qa' and target_assignee_value = 'GPT')
      or (current_row.status = 'qa' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
    ))
    or (actor_label_value = 'GPT' and (
      (current_row.status = 'qa' and target_status_value = 'qa' and target_assignee_value = 'QJC')
      or (current_row.status = 'qa' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
    ));

  if not allowed_transition then
    raise exception using errcode = '42501', message = 'Workflow transition is not permitted';
  end if;

  update public.board_tasks
  set status = target_status_value,
      assignee = target_assignee_value,
      updated_at = now()
  where id = p_task_id;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'workflow_transition',
    jsonb_build_object('status', current_row.status, 'assignee', current_row.assignee),
    jsonb_build_object('status', target_status_value, 'assignee', target_assignee_value),
    p_note, actor_id_value, actor_type_value, actor_label_value, 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'status', target_status_value,
    'assignee', target_assignee_value,
    'actor_type', actor_type_value,
    'actor_label', actor_label_value
  );
end;
$function$;

revoke all on function public.board_transition_task(uuid, text, text, text, text, text) from public;
revoke execute on function public.board_transition_task(uuid, text, text, text, text, text) from anon;
grant execute on function public.board_transition_task(uuid, text, text, text, text, text) to authenticated;

create or replace function public.board_move_task_workspace(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_note text default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_task public.board_tasks;
  target_workspace public.board_workspaces;
  current_workspace public.board_workspaces;
  moved_task public.board_tasks;
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_task_id is null or p_target_workspace_id is null then
    raise exception using errcode = '22023', message = 'Task id and target workspace are required';
  end if;

  select * into current_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  if current_task.status in ('merged', 'cancelled') then
    raise exception using errcode = '42501', message = 'Terminal governance task cannot move workspace';
  end if;

  select * into target_workspace
  from public.board_workspaces
  where id = p_target_workspace_id and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active target workspace not found';
  end if;

  if current_task.workspace_id = target_workspace.id then
    return current_task;
  end if;
  if target_workspace.workspace_key in ('done', 'completed') or target_workspace.name in ('已完工', '已完成') then
    raise exception using errcode = '42501', message = 'Only PM Acceptance PASS can enter 已完成';
  end if;
  if current_task.status = 'done' then
    raise exception using errcode = '42501', message = 'Completed TASK workspace is lifecycle-managed';
  end if;

  select * into current_workspace
  from public.board_workspaces
  where id = current_task.workspace_id;

  update public.board_tasks
  set workspace_id = target_workspace.id,
      updated_at = now()
  where id = p_task_id
  returning * into moved_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'workspace_moved',
    jsonb_build_object(
      'workspace_id', current_task.workspace_id,
      'workspace_name', current_workspace.name,
      'status', current_task.status,
      'assignee', current_task.assignee
    ),
    jsonb_build_object(
      'workspace_id', moved_task.workspace_id,
      'workspace_name', target_workspace.name,
      'status', moved_task.status,
      'assignee', moved_task.assignee
    ),
    coalesce(note_value, 'AI Board workspace moved'),
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return moved_task;
end;
$function$;

revoke all on function public.board_move_task_workspace(uuid, uuid, text) from public;
revoke execute on function public.board_move_task_workspace(uuid, uuid, text) from anon;
grant execute on function public.board_move_task_workspace(uuid, uuid, text) to authenticated;

commit;
