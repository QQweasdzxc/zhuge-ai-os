-- Module C Workflow v2: bind only newly-created cards to an explicitly
-- configured published step.  This is intentionally additive: it does not
-- update existing rows and it never infers a workflow from status, assignee,
-- TASK id, consumer name, or a missing workspace mapping.

begin;

create or replace function private.board_workflow_bind_new_task()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_workflow_version_id uuid;
  v_step_id uuid;
begin
  if new.board_instance_id is null
     or new.workspace_id is null
     or new.workflow_version_id is not null
     or new.current_workflow_step_id is not null then
    return new;
  end if;

  -- A card is bound only when its explicitly selected workspace is an
  -- explicit step in this Board Instance's currently published workflow.
  -- If there is no exact match, leave both columns NULL for explicit PM
  -- classification; runtime must not guess.
  select d.id, s.id
    into v_workflow_version_id, v_step_id
  from public.board_instance_workflow_state state
  join public.board_workflow_definitions d
    on d.id = state.published_workflow_version_id
   and d.board_instance_id = new.board_instance_id
   and d.status = 'published'
  join public.board_workflow_steps s
    on s.workflow_version_id = d.id
   and s.workspace_id = new.workspace_id
  where state.board_instance_id = new.board_instance_id;

  if v_workflow_version_id is not null and v_step_id is not null then
    new.workflow_version_id := v_workflow_version_id;
    new.current_workflow_step_id := v_step_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists board_tasks_workflow_binding_before_insert on public.board_tasks;
create trigger board_tasks_workflow_binding_before_insert
  before insert on public.board_tasks
  for each row
  execute function private.board_workflow_bind_new_task();

comment on function private.board_workflow_bind_new_task() is
  'Module C canonical new-card binding; exact published workflow step only, no historical backfill or runtime inference.';

commit;
