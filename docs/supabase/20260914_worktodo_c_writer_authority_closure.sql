-- TASK-064 / Step 3: close retired WorkTodo-specific application writer routes.
--
-- Formal WorkTodo runtime writes through Module C board_instance_* contracts.
-- These historical function definitions remain available for owner-controlled
-- inspection/rollback, but no application role may execute them.

begin;

revoke all on function public.worktodo_update_task(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_delete_task(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_create_workspace(text)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_rename_workspace(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_reorder_workspaces(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_add_task_progress_note(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_edit_task_progress_note(bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_delete_task_progress_note(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_set_agreement_schedule(uuid, text, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_request_delete_workspace(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.worktodo_finalize_delete_workspace(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;

comment on function public.worktodo_update_task(uuid, jsonb) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_delete_task(uuid) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_create_workspace(text) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_rename_workspace(uuid, text) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_reorder_workspaces(uuid[]) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_add_task_progress_note(uuid, text) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_edit_task_progress_note(bigint, text) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_delete_task_progress_note(bigint) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_set_agreement_schedule(uuid, text, date, date) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_request_delete_workspace(uuid) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';
comment on function public.worktodo_finalize_delete_workspace(uuid, uuid, uuid[]) is
  'TASK-064 Step 3: retired WorkTodo-specific writer; formal runtime uses Module C board_instance_* contracts. Definition retained for historical inspection only; application Execute revoked.';

commit;
