-- Canonical C Template: create a card in the workspace selected by the user.
--
-- The shared Golden Master renders the same add action for every active
-- non-completion workspace.  This controlled RPC keeps the existing AI Board
-- creation contract and adds an optional workspace position; NULL preserves
-- the historical default of the AI Board 待辦 workspace.

begin;

drop function if exists public.board_create_task(text, text, text, text, text, text);

create or replace function public.board_create_task(
  p_title text,
  p_summary text default null,
  p_usage_scenario text default null,
  p_priority text default null,
  p_actor_type text default 'human',
  p_actor_label text default null,
  p_workspace_id uuid default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_type_value text := lower(trim(coalesce(p_actor_type, 'human')));
  actor_label_value text;
  actor_id_value uuid;
  target_workspace_id uuid;
  created_task public.board_tasks;
begin
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;

  if actor_type_value = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    actor_id_value := auth.uid();
    actor_label_value := 'QJC';
  elsif actor_type_value = 'ai' and coalesce(auth.role(), '') = 'service_role' and p_actor_label in ('GPT', 'Co') then
    actor_id_value := null;
    actor_label_value := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Task actor is not allowed';
  end if;

  if p_workspace_id is null then
    select id into target_workspace_id
    from public.board_workspaces
    where workspace_key = 'todo'
      and application_scope = 'ai_board'
      and active = true;
  else
    select id into target_workspace_id
    from public.board_workspaces
    where id = p_workspace_id
      and application_scope = 'ai_board'
      and active = true;
  end if;

  if target_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Active AI Board workspace is unavailable';
  end if;

  insert into public.board_tasks (
    title, summary, usage_scenario, priority, status, assignee,
    workspace_id, created_by, created_at, updated_at
  ) values (
    trim(p_title),
    nullif(trim(coalesce(p_summary, '')), ''),
    nullif(trim(coalesce(p_usage_scenario, '')), ''),
    nullif(trim(coalesce(p_priority, '')), ''),
    'ready', 'Co', target_workspace_id, actor_id_value, now(), now()
  ) returning * into created_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label
  ) values (
    'board_task', created_task.id::text, 'task_created', to_jsonb(created_task),
    'Board task created', actor_id_value, actor_type_value, actor_label_value
  );

  insert into public.engineering_checklist_items (
    task_id, checklist_type, stage, item_key, label, required, sort_order, version
  ) values
    (created_task.id, 'task_acceptance', 'co', 'developer-qa',
      format('Co Developer QA：完成「%s」並附 Evidence', created_task.title), true, 10, 1),
    (created_task.id, 'task_acceptance', 'gpt', 'gpt-review',
      format('GPT Review：確認「%s」的 Scope、Architecture 與 Regression Evidence', created_task.title), true, 20, 1),
    (created_task.id, 'task_acceptance', 'qjc', 'pm-acceptance',
      format('QJC PM QA：依「%s」Acceptance Criteria 驗收並確認 Artifact／Build', created_task.title), true, 30, 1);

  return created_task;
end;
$$;

revoke all on function public.board_create_task(text, text, text, text, text, text, uuid) from public;
revoke execute on function public.board_create_task(text, text, text, text, text, text, uuid) from anon;
grant execute on function public.board_create_task(text, text, text, text, text, text, uuid) to authenticated;

comment on function public.board_create_task(text, text, text, text, text, text, uuid)
  is 'Creator-controlled AI Board task creation for the canonical C Template; optional workspace position';

notify pgrst, 'reload schema';

commit;
