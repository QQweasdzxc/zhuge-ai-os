-- Building Integrity / Item 2: C canonical parent-task deletion lineage.
--
-- Evidence is written in the same transaction as the existing hard delete:
-- task_deleted activity -> immutable manifest -> parent delete/cascade.
-- The private manifest is evidence storage only; it is not a delete authority.
-- Existing WorkLog data and historical activity are intentionally untouched.

begin;

create schema if not exists private;

create table if not exists private.module_c_task_deletion_manifests (
  manifest_id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null unique,
  board_instance_id uuid not null,
  consumer_id text not null,
  consumer_identity jsonb not null,
  template_key text not null,
  module_id text not null,
  workspace_id uuid not null,
  workspace_key text,
  workspace_name text,
  work_code text not null,
  task_snapshot jsonb not null,
  child_snapshot jsonb not null,
  deleted_at timestamptz not null,
  deleted_by uuid references auth.users(id) on delete set null,
  actor_type text not null default 'system',
  actor_label text not null default 'System',
  contract_version text not null,
  deletion_event_id bigint not null references public.engineering_activity_log(id) on delete restrict,
  idempotency_key text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  constraint module_c_task_deletion_manifest_consumer_identity_object
    check (jsonb_typeof(consumer_identity) = 'object'),
  constraint module_c_task_deletion_manifest_task_snapshot_object
    check (jsonb_typeof(task_snapshot) = 'object'),
  constraint module_c_task_deletion_manifest_child_snapshot_object
    check (jsonb_typeof(child_snapshot) = 'object'),
  constraint module_c_task_deletion_manifest_system_actor
    check (actor_type = 'system' and actor_label = 'System'),
  constraint module_c_task_deletion_manifest_contract
    check (contract_version = 'module-c-task-deletion-lineage-v1'),
  constraint module_c_task_deletion_manifest_module
    check (module_id = 'c')
);

comment on table private.module_c_task_deletion_manifests is
  'Immutable Module C task deletion evidence. It is not a delete authority and is never used to restore a task.';

comment on column private.module_c_task_deletion_manifests.task_snapshot is
  'Full pre-delete board_tasks row captured for audit lineage; not a restore payload.';

comment on column private.module_c_task_deletion_manifests.child_snapshot is
  'Child relation IDs and counts captured before existing cascade deletion.';

alter table private.module_c_task_deletion_manifests enable row level security;

revoke all on table private.module_c_task_deletion_manifests from public, anon, authenticated, service_role;

create or replace function private.prevent_module_c_task_deletion_manifest_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'Module C task deletion manifests are immutable';
end;
$function$;

revoke all on function private.prevent_module_c_task_deletion_manifest_mutation() from public, anon, authenticated, service_role;

drop trigger if exists module_c_task_deletion_manifest_immutable
  on private.module_c_task_deletion_manifests;

create trigger module_c_task_deletion_manifest_immutable
before update or delete on private.module_c_task_deletion_manifests
for each row execute function private.prevent_module_c_task_deletion_manifest_mutation();

create or replace function private.prevent_module_c_task_deleted_activity_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.action = 'task_deleted'
       and nullif(new.after_data ->> 'deletion_manifest_id', '') is null then
      raise exception using
        errcode = '55000',
        message = 'task_deleted activity requires a deletion manifest reference';
    end if;
    return new;
  end if;

  if (tg_op = 'DELETE' and old.action = 'task_deleted')
     or (tg_op = 'UPDATE' and (old.action = 'task_deleted' or new.action = 'task_deleted')) then
    raise exception using
      errcode = '55000',
      message = 'task_deleted activity is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.prevent_module_c_task_deleted_activity_mutation() from public, anon, authenticated, service_role;

drop trigger if exists module_c_task_deleted_activity_immutable
  on public.engineering_activity_log;

create trigger module_c_task_deleted_activity_immutable
before insert or update or delete on public.engineering_activity_log
for each row execute function private.prevent_module_c_task_deleted_activity_mutation();

create or replace function public.board_instance_delete_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_instance public.board_instances%rowtype;
  v_workspace public.board_workspaces%rowtype;
  v_manifest private.module_c_task_deletion_manifests%rowtype;
  v_manifest_id uuid := extensions.gen_random_uuid();
  v_activity_id bigint;
  v_deleted_at timestamptz := clock_timestamp();
  v_actor_id uuid := auth.uid();
  v_consumer_id text;
  v_consumer_identity jsonb;
  v_task_snapshot jsonb;
  v_child_snapshot jsonb;
  v_idempotency_key text;
begin
  if v_actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authenticated board access is required';
  end if;

  select *
    into v_task
    from public.board_tasks
   where id = p_task_id
   for update;

  if not found then
    -- A retry after a successful delete returns the original evidence when
    -- the caller still has write access to the same Board Instance.
    select *
      into v_manifest
      from private.module_c_task_deletion_manifests manifest
     where manifest.task_id = p_task_id;

    if found and public.board_instance_can_write(v_manifest.board_instance_id) then
      return jsonb_build_object(
        'contract', 'module-c-task-deletion-lineage-v1',
        'task_id', p_task_id,
        'deleted', true,
        'idempotent', true,
        'manifest_id', v_manifest.manifest_id,
        'deletion_event_id', v_manifest.deletion_event_id,
        'board_instance_id', v_manifest.board_instance_id,
        'consumer_id', v_manifest.consumer_id,
        'work_code', v_manifest.work_code,
        'evidence_persisted', true
      );
    end if;

    raise exception using
      errcode = '42501',
      message = 'Board task write authorization is required';
  end if;

  if not public.board_task_can_write(p_task_id) then
    raise exception using
      errcode = '42501',
      message = 'Board task write authorization is required';
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = v_task.board_instance_id
   for share;

  if not found or v_instance.active is not true or lower(btrim(v_instance.template_key)) <> 'c' then
    raise exception using
      errcode = '55000',
      message = 'Module C Board Instance context is required for task deletion';
  end if;

  select *
    into v_workspace
    from public.board_workspaces
   where id = v_task.workspace_id
     and board_instance_id = v_task.board_instance_id
   for share;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Module C workspace context is required for task deletion';
  end if;

  v_consumer_id := coalesce(
    nullif(lower(btrim(v_instance.legacy_application_scope)), ''),
    nullif(lower(btrim(v_task.application_scope)), ''),
    'board-instance:' || v_instance.id::text
  );

  v_consumer_identity := jsonb_build_object(
    'board_instance_id', v_instance.id,
    'board_name', v_instance.name,
    'task_code_prefix', v_instance.task_code_prefix,
    'legacy_application_scope', v_instance.legacy_application_scope,
    'consumer_id_source', case
      when nullif(lower(btrim(v_instance.legacy_application_scope)), '') is not null then 'board_instance.legacy_application_scope'
      when nullif(lower(btrim(v_task.application_scope)), '') is not null then 'board_tasks.application_scope'
      else 'board_instance.id'
    end
  );

  v_task_snapshot := to_jsonb(v_task);

  v_child_snapshot := jsonb_build_object(
    'board_task_checklist_items', jsonb_build_object(
      'count', (select count(*) from public.board_task_checklist_items child where child.task_id = v_task.id),
      'ids', coalesce((select jsonb_agg(child.id order by child.id) from public.board_task_checklist_items child where child.task_id = v_task.id), '[]'::jsonb)
    ),
    'board_task_attachments', jsonb_build_object(
      'count', (select count(*) from public.board_task_attachments child where child.task_id = v_task.id),
      'ids', coalesce((select jsonb_agg(child.id order by child.id) from public.board_task_attachments child where child.task_id = v_task.id), '[]'::jsonb),
      'activity_ids', coalesce((select jsonb_agg(child.activity_id order by child.activity_id) from public.board_task_attachments child where child.task_id = v_task.id and child.activity_id is not null), '[]'::jsonb)
    ),
    'board_task_vendor_links', jsonb_build_object(
      'count', (select count(*) from public.board_task_vendor_links child where child.task_id = v_task.id),
      'ids', coalesce((select jsonb_agg(child.id order by child.id) from public.board_task_vendor_links child where child.task_id = v_task.id), '[]'::jsonb)
    ),
    'engineering_checklist_items', jsonb_build_object(
      'count', (select count(*) from public.engineering_checklist_items child where child.task_id = v_task.id),
      'ids', coalesce((select jsonb_agg(child.id order by child.id) from public.engineering_checklist_items child where child.task_id = v_task.id), '[]'::jsonb)
    ),
    'investment_ivtk_card_links', jsonb_build_object(
      'count', (select count(*) from public.investment_ivtk_card_links child where child.board_task_id = v_task.id),
      'ids', coalesce((select jsonb_agg(child.id order by child.id) from public.investment_ivtk_card_links child where child.board_task_id = v_task.id), '[]'::jsonb)
    )
  );

  v_idempotency_key := 'module-c-task-delete:' || v_task.id::text;

  insert into public.engineering_activity_log (
    entity_type,
    entity_id,
    action,
    before_data,
    after_data,
    note,
    actor_id,
    actor_type,
    actor_label,
    activity_type,
    created_at
  ) values (
    'board_task',
    v_task.id::text,
    'task_deleted',
    v_task_snapshot,
    jsonb_build_object(
      'deletion_manifest_id', v_manifest_id,
      'task_id', v_task.id,
      'board_instance_id', v_instance.id,
      'consumer_id', v_consumer_id,
      'consumer_identity', v_consumer_identity,
      'template_key', v_instance.template_key,
      'module_id', 'c',
      'workspace_id', v_workspace.id,
      'workspace_key', v_workspace.workspace_key,
      'workspace_name', v_workspace.name,
      'work_code', v_task.work_code,
      'deleted_at', v_deleted_at,
      'deleted_by', v_actor_id,
      'contract_version', 'module-c-task-deletion-lineage-v1',
      'idempotency_key', v_idempotency_key,
      'child_snapshot', v_child_snapshot
    ),
    'Module C canonical task deletion; immutable manifest and task_deleted snapshot precede parent delete',
    v_actor_id,
    'system',
    'System',
    'system_activity',
    v_deleted_at
  ) returning id into v_activity_id;

  insert into private.module_c_task_deletion_manifests (
    manifest_id,
    task_id,
    board_instance_id,
    consumer_id,
    consumer_identity,
    template_key,
    module_id,
    workspace_id,
    workspace_key,
    workspace_name,
    work_code,
    task_snapshot,
    child_snapshot,
    deleted_at,
    deleted_by,
    actor_type,
    actor_label,
    contract_version,
    deletion_event_id,
    idempotency_key
  ) values (
    v_manifest_id,
    v_task.id,
    v_instance.id,
    v_consumer_id,
    v_consumer_identity,
    lower(btrim(v_instance.template_key)),
    'c',
    v_workspace.id,
    v_workspace.workspace_key,
    v_workspace.name,
    v_task.work_code,
    v_task_snapshot,
    v_child_snapshot,
    v_deleted_at,
    v_actor_id,
    'system',
    'System',
    'module-c-task-deletion-lineage-v1',
    v_activity_id,
    v_idempotency_key
  );

  delete from public.board_tasks
   where id = v_task.id;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'Board task delete lost its locked row; deletion evidence was rolled back';
  end if;

  return jsonb_build_object(
    'contract', 'module-c-task-deletion-lineage-v1',
    'task_id', v_task.id,
    'deleted', true,
    'idempotent', false,
    'manifest_id', v_manifest_id,
    'deletion_event_id', v_activity_id,
    'board_instance_id', v_instance.id,
    'consumer_id', v_consumer_id,
    'workspace_id', v_workspace.id,
    'work_code', v_task.work_code,
    'child_snapshot', v_child_snapshot,
    'evidence_persisted', true,
    'atomic', true
  );
end;
$function$;

comment on function public.board_instance_delete_task(uuid) is
  'Module C canonical parent-task delete: immutable deletion evidence and task_deleted activity are committed before existing hard-delete cascades.';

create or replace function public.board_instance_read_task_deletion_manifest(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_manifest private.module_c_task_deletion_manifests%rowtype;
  v_activity public.engineering_activity_log%rowtype;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authenticated board access is required';
  end if;

  select *
    into v_manifest
    from private.module_c_task_deletion_manifests manifest
   where manifest.task_id = p_task_id;

  if not found then
    return jsonb_build_object(
      'contract', 'module-c-task-deletion-lineage-v1',
      'found', false,
      'task_id', p_task_id
    );
  end if;

  if not public.board_instance_can_read(v_manifest.board_instance_id) then
    raise exception using
      errcode = '42501',
      message = 'Board task deletion evidence read authorization is required';
  end if;

  select *
    into v_activity
    from public.engineering_activity_log activity
   where activity.id = v_manifest.deletion_event_id;

  return jsonb_build_object(
    'contract', 'module-c-task-deletion-lineage-v1',
    'found', true,
    'manifest', to_jsonb(v_manifest),
    'activity', to_jsonb(v_activity),
    'lineage_verified', v_activity.id is not null and v_activity.id = v_manifest.deletion_event_id
  );
end;
$function$;

comment on function public.board_instance_read_task_deletion_manifest(uuid) is
  'Authenticated Board Instance-scoped read-back for immutable Module C task deletion evidence.';

revoke all on function public.board_instance_delete_task(uuid) from public, anon;
grant execute on function public.board_instance_delete_task(uuid) to authenticated, service_role;

revoke all on function public.board_instance_read_task_deletion_manifest(uuid) from public, anon;
grant execute on function public.board_instance_read_task_deletion_manifest(uuid) to authenticated;

commit;
