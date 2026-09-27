-- Module C Checker Final Alignment #2.
--
-- This is a Checker-only control-plane migration.  It does not modify product
-- tables, C Runtime writers, workflow state, lifecycle state, or any data.
-- The function body is obtained from the current Cloud definition and patched
-- idempotently so this remains a replayable follow-up to the prior alignment.

begin;

do $migration$
declare
  v_definition text;
  v_shared_entry text := $shared_entry$    'board_update_checklist_item',
$shared_entry$;
  v_shared_entry_with_task text := $shared_entry_with_task$    'board_update_checklist_item',
    'board_update_task_checklist_item',
$shared_entry_with_task$;
  v_count_block text := $count_block$  select count(*)
    into v_attachment_orphan_count
    from public.board_task_attachments attachment
    join public.board_tasks task on task.id = attachment.task_id
   where task.board_instance_id = p_board_instance_id;

  select count(*)
    into v_checklist_orphan_count
    from public.board_task_checklist_items checklist
    join public.board_tasks task on task.id = checklist.task_id
   where task.board_instance_id = p_board_instance_id;
$count_block$;
  v_count_replacement text := $count_replacement$  -- Child rows inherit Board Instance scope from their parent task.  A linked
  -- child is not an orphan; only the global unscoped checks below represent a
  -- missing parent and therefore remain explicit unknown evidence.
  v_attachment_orphan_count := 0;
  v_checklist_orphan_count := 0;
$count_replacement$;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid = to_regprocedure(
       'public.board_c_authority_conformance_check(uuid)'
     )::oid;

  if v_definition is null then
    raise exception 'Checker function public.board_c_authority_conformance_check(uuid) is missing';
  end if;

  if position(v_shared_entry_with_task in v_definition) = 0 then
    if position(v_shared_entry in v_definition) = 0 then
      raise exception 'Checker shared checklist allow-list entry is missing';
    end if;
    v_definition := replace(v_definition, v_shared_entry, v_shared_entry_with_task);
  end if;

  if position(v_count_block in v_definition) > 0 then
    v_definition := replace(v_definition, v_count_block, v_count_replacement);
  elsif position(v_count_replacement in v_definition) = 0 then
    raise exception 'Checker child-row orphan counting block is not in an expected state';
  end if;

  execute v_definition;
end;
$migration$;

commit;
