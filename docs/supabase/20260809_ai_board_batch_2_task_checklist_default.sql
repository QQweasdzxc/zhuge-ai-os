-- AI Board Batch #2 follow-up: new TASKs receive a contract checklist.
begin;

create or replace function public.board_create_task(
  p_title text,
  p_summary text default null,
  p_priority text default null,
  p_actor_type text default 'human',
  p_actor_label text default null
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

  insert into public.board_tasks (title, summary, priority, status, assignee, created_by, created_at, updated_at)
  values (trim(p_title), nullif(trim(coalesce(p_summary, '')), ''), nullif(trim(coalesce(p_priority, '')), ''), 'ready', 'Co', actor_id_value, now(), now())
  returning * into created_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label
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

revoke all on function public.board_create_task(text, text, text, text, text) from public;
revoke execute on function public.board_create_task(text, text, text, text, text) from anon;
grant execute on function public.board_create_task(text, text, text, text, text) to authenticated;

commit;
