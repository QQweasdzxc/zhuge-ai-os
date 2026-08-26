-- Custom Workspace Delete Contract.
--
-- Scope: delete only custom AI Board / WorkTodo workspaces.  This migration
-- does not add Archive / Restore, a recycle bin, or another workspace
-- lifecycle.  The browser first removes the Storage objects returned by the
-- request RPC, then the finalize RPC explicitly removes attachment rows,
-- checklist rows, tasks, and finally the workspace in one controlled path.
-- Database ON DELETE CASCADE is intentionally not relied on for this flow.

begin;

-- Workspace deletion is a first-class audit event.  Existing task and
-- checklist audit vocabulary remains unchanged.
alter table public.engineering_activity_log
  drop constraint if exists engineering_activity_log_entity_type_check;

alter table public.engineering_activity_log
  add constraint engineering_activity_log_entity_type_check
  check (entity_type = any (array[
    'knowledge', 'feature', 'work_item', 'qa', 'member', 'board_task',
    'engineering_checklist_item', 'engineering_governance_authorization',
    'engineering_artifact', 'board_workspace'
  ]));

create or replace function public.zhuge_workspace_delete_manifest(
  p_workspace_id uuid,
  p_application_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
  v_task_ids uuid[] := '{}'::uuid[];
  v_task_count integer := 0;
  v_attachments jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_id is null or p_application_scope not in ('ai_board', 'worktodo') then
    raise exception using errcode = '22023', message = 'Workspace id and application scope are required';
  end if;

  select * into v_workspace
  from public.board_workspaces
  where id = p_workspace_id
    and application_scope = p_application_scope
    and active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active workspace not found';
  end if;

  if p_application_scope = 'ai_board' and v_workspace.workspace_key is not null then
    raise exception using errcode = '42501', message = 'System/Canonical AI Board workspaces are not deletable';
  end if;
  if p_application_scope = 'worktodo'
     and (v_workspace.workspace_key is null or v_workspace.workspace_key not like 'worktodo-custom-%') then
    raise exception using errcode = '42501', message = 'System/Canonical WorkTodo workspaces are not deletable';
  end if;

  select coalesce(array_agg(task.id order by task.created_at), '{}'::uuid[]), count(*)::integer
  into v_task_ids, v_task_count
  from public.board_tasks task
  where task.workspace_id = v_workspace.id
    and task.application_scope = p_application_scope;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', attachment.id,
      'storage_bucket', attachment.storage_bucket,
      'storage_path', attachment.storage_path
    ) order by attachment.created_at), '[]'::jsonb)
  into v_attachments
  from public.board_task_attachments attachment
  where attachment.task_id = any(v_task_ids)
    and coalesce(attachment.deletion_status, 'active') <> 'deleted';

  return jsonb_build_object(
    'workspace_id', v_workspace.id,
    'application_scope', p_application_scope,
    'workspace', to_jsonb(v_workspace),
    'task_count', v_task_count,
    'task_ids', to_jsonb(v_task_ids),
    'attachments', v_attachments
  );
end;
$function$;

create or replace function public.zhuge_finalize_workspace_delete(
  p_workspace_id uuid,
  p_application_scope text,
  p_task_ids uuid[],
  p_attachment_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
  v_task_ids uuid[] := coalesce(p_task_ids, '{}'::uuid[]);
  v_attachment_ids uuid[] := coalesce(p_attachment_ids, '{}'::uuid[]);
  v_task_count integer := 0;
  v_attachment_count integer := 0;
  v_supplied_task_count integer := 0;
  v_supplied_attachment_count integer := 0;
  v_deleted_task_count integer := 0;
  v_deleted_workspace public.board_workspaces;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_id is null or p_application_scope not in ('ai_board', 'worktodo') then
    raise exception using errcode = '22023', message = 'Workspace id and application scope are required';
  end if;

  select * into v_workspace
  from public.board_workspaces
  where id = p_workspace_id
    and application_scope = p_application_scope
    and active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active workspace not found';
  end if;

  if p_application_scope = 'ai_board' and v_workspace.workspace_key is not null then
    raise exception using errcode = '42501', message = 'System/Canonical AI Board workspaces are not deletable';
  end if;
  if p_application_scope = 'worktodo'
     and (v_workspace.workspace_key is null or v_workspace.workspace_key not like 'worktodo-custom-%') then
    raise exception using errcode = '42501', message = 'System/Canonical WorkTodo workspaces are not deletable';
  end if;

  select count(*)::integer into v_task_count
  from public.board_tasks task
  where task.workspace_id = v_workspace.id
    and task.application_scope = p_application_scope;

  select count(distinct supplied.id)::integer into v_supplied_task_count
  from unnest(v_task_ids) as supplied(id);
  if coalesce(array_length(v_task_ids, 1), 0) <> v_task_count
     or v_supplied_task_count <> v_task_count
     or exists (
       select 1
       from public.board_tasks task
       where task.workspace_id = v_workspace.id
         and task.application_scope = p_application_scope
         and not (task.id = any(v_task_ids))
     )
     or exists (
       select 1
       from unnest(v_task_ids) as supplied(id)
       left join public.board_tasks task
         on task.id = supplied.id
        and task.workspace_id = v_workspace.id
        and task.application_scope = p_application_scope
       where task.id is null
     ) then
    raise exception using errcode = '40001', message = 'Workspace changed; reload before deleting it';
  end if;

  select count(*)::integer into v_attachment_count
  from public.board_task_attachments attachment
  where attachment.task_id = any(v_task_ids)
    and coalesce(attachment.deletion_status, 'active') <> 'deleted';

  select count(distinct supplied.id)::integer into v_supplied_attachment_count
  from unnest(v_attachment_ids) as supplied(id);
  if v_supplied_attachment_count <> v_attachment_count
     or coalesce(array_length(v_attachment_ids, 1), 0) <> v_attachment_count
     or exists (
       select 1
       from public.board_task_attachments attachment
       where attachment.task_id = any(v_task_ids)
         and coalesce(attachment.deletion_status, 'active') <> 'deleted'
         and not (attachment.id = any(v_attachment_ids))
     )
     or exists (
       select 1
       from unnest(v_attachment_ids) as supplied(id)
       left join public.board_task_attachments attachment
         on attachment.id = supplied.id
        and attachment.task_id = any(v_task_ids)
        and coalesce(attachment.deletion_status, 'active') <> 'deleted'
       where attachment.id is null
     ) then
    raise exception using errcode = '40001', message = 'Workspace attachments changed; reload before deleting it';
  end if;

  if exists (
    select 1
    from public.board_task_attachments attachment
    join storage.objects object_row
      on object_row.bucket_id = attachment.storage_bucket
     and object_row.name = attachment.storage_path
    where attachment.task_id = any(v_task_ids)
      and coalesce(attachment.deletion_status, 'active') <> 'deleted'
  ) then
    raise exception using errcode = 'P0001', message = 'Workspace attachment Storage objects must be removed before finalizing deletion';
  end if;

  if exists (
    select 1
    from public.board_tasks retained
    where retained.id <> all(v_task_ids)
      and retained.application_scope = p_application_scope
      and (retained.merged_into = any(v_task_ids) or retained.linked_to = any(v_task_ids))
  ) then
    raise exception using errcode = '23514', message = 'Workspace tasks are referenced by retained governance links';
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_workspace', v_workspace.id::text, 'workspace_deleted',
    jsonb_build_object(
      'workspace', to_jsonb(v_workspace),
      'task_ids', to_jsonb(v_task_ids),
      'task_count', v_task_count,
      'attachment_ids', to_jsonb(v_attachment_ids),
      'attachment_count', v_attachment_count
    ),
    jsonb_build_object(
      'deleted', true,
      'application_scope', p_application_scope,
      'task_count', v_task_count,
      'attachment_count', v_attachment_count
    ),
    'Custom workspace and its task data deleted through the controlled Workspace Delete Contract',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  -- Explicit child cleanup.  These statements are intentionally present even
  -- though the historical FKs currently use ON DELETE CASCADE.
  delete from public.board_task_attachments
  where task_id = any(v_task_ids);
  delete from public.engineering_checklist_items
  where task_id = any(v_task_ids);
  delete from public.board_tasks
  where id = any(v_task_ids)
    and workspace_id = v_workspace.id
    and application_scope = p_application_scope;
  get diagnostics v_deleted_task_count = row_count;
  if v_deleted_task_count <> v_task_count then
    raise exception using errcode = '40001', message = 'Workspace tasks changed; workspace was not deleted';
  end if;

  if p_application_scope = 'worktodo' then
    perform set_config('zhuge.worktodo_workspace_write', '1', true);
  end if;
  delete from public.board_workspaces
  where id = v_workspace.id
    and application_scope = p_application_scope
    and active = true
  returning * into v_deleted_workspace;
  if not found then
    raise exception using errcode = '40001', message = 'Workspace changed; workspace was not deleted';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'workspace_id', v_deleted_workspace.id,
    'application_scope', p_application_scope,
    'task_count', v_deleted_task_count,
    'attachment_count', v_attachment_count
  );
end;
$function$;

create or replace function public.enforce_worktodo_workspace_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and old.application_scope = 'worktodo' then
    if coalesce(current_setting('zhuge.worktodo_workspace_write', true), '') <> '1'
       or old.workspace_key is null
       or old.workspace_key not like 'worktodo-custom-%' then
      raise exception using errcode = '42501', message = 'WorkTodo system workspaces are not deletable';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.application_scope = 'worktodo' then
    if coalesce(current_setting('zhuge.worktodo_workspace_write', true), '') <> '1' then
      raise exception using errcode = '42501', message = 'WorkTodo system workspaces require the controlled WorkTodo workspace path';
    end if;
    if new.application_scope is distinct from old.application_scope
       or new.workspace_key is distinct from old.workspace_key
       or new.owner_uuid is distinct from old.owner_uuid
       or new.active is distinct from old.active
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception using errcode = '42501', message = 'WorkTodo workspace identity is immutable';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$function$;

create or replace function public.board_request_delete_workspace(p_workspace_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.zhuge_workspace_delete_manifest(p_workspace_id, 'ai_board');
$function$;

create or replace function public.worktodo_request_delete_workspace(p_workspace_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.zhuge_workspace_delete_manifest(p_workspace_id, 'worktodo');
$function$;

create or replace function public.board_finalize_delete_workspace(
  p_workspace_id uuid,
  p_task_ids uuid[],
  p_attachment_ids uuid[]
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.zhuge_finalize_workspace_delete(p_workspace_id, 'ai_board', p_task_ids, p_attachment_ids);
$function$;

create or replace function public.worktodo_finalize_delete_workspace(
  p_workspace_id uuid,
  p_task_ids uuid[],
  p_attachment_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform set_config('zhuge.worktodo_workspace_write', '1', true);
  return public.zhuge_finalize_workspace_delete(p_workspace_id, 'worktodo', p_task_ids, p_attachment_ids);
end;
$function$;

revoke all on function public.zhuge_workspace_delete_manifest(uuid, text) from public, anon, authenticated;
revoke all on function public.zhuge_finalize_workspace_delete(uuid, text, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.board_request_delete_workspace(uuid) from public, anon;
revoke all on function public.worktodo_request_delete_workspace(uuid) from public, anon;
revoke all on function public.board_finalize_delete_workspace(uuid, uuid[], uuid[]) from public, anon;
revoke all on function public.worktodo_finalize_delete_workspace(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.board_request_delete_workspace(uuid) to authenticated;
grant execute on function public.worktodo_request_delete_workspace(uuid) to authenticated;
grant execute on function public.board_finalize_delete_workspace(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.worktodo_finalize_delete_workspace(uuid, uuid[], uuid[]) to authenticated;

comment on function public.board_request_delete_workspace(uuid) is
  'Returns the custom AI Board workspace deletion manifest; no data is deleted until Storage removal and finalize.';
comment on function public.worktodo_request_delete_workspace(uuid) is
  'Returns the custom WorkTodo workspace deletion manifest; no data is deleted until Storage removal and finalize.';
comment on function public.board_finalize_delete_workspace(uuid, uuid[], uuid[]) is
  'Controlled AI Board custom Workspace Delete Contract with explicit child cleanup and Storage verification.';
comment on function public.worktodo_finalize_delete_workspace(uuid, uuid[], uuid[]) is
  'Controlled WorkTodo custom Workspace Delete Contract with explicit child cleanup and Storage verification.';

notify pgrst, 'reload schema';

commit;
