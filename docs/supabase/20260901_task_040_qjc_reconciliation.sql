-- TASK-040 Minimal Lifecycle Contract: QJC -> canonical Co reconciliation
--
-- This is a generic recovery path for a PM/Governance-approved stale
-- handoff. It is not TASK-specific and does not replace the normal lifecycle:
--   qa / QJC / canonical Co workspace -> ready / Co / canonical Co workspace
--
-- The operation is service-only, actor-bound, row-locked, idempotent by key,
-- and auditable. It does not create a table, rewrite checklist evidence, or
-- bypass the subsequent Specific Task Claim.

begin;

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
  v_updated_task public.board_tasks%rowtype;
  v_previous_audit public.engineering_activity_log%rowtype;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'GPT' then
    raise exception using errcode = '42501',
      message = 'QJC reconciliation requires the controlled GPT service path';
  end if;
  if p_task_id is null or v_key is null or length(v_key) < 8 or length(v_key) > 200 then
    raise exception using errcode = '22023',
      message = 'TASK and a bounded reconciliation idempotency key are required';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Board TASK not found';
  end if;
  if coalesce(v_task.application_scope, '') <> 'ai_board'
     or v_task.board_instance_id is null then
    raise exception using errcode = '42501',
      message = 'QJC reconciliation is limited to AI Board TASKs';
  end if;

  select *
    into v_instance
  from public.board_instances
  where id = v_task.board_instance_id
    and active = true
  for share;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Active Board instance not found';
  end if;
  if coalesce(v_instance.task_code_prefix, '') <> 'TASK'
     or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501',
      message = 'QJC reconciliation is limited to the canonical AI Board';
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
    raise exception using errcode = 'P0002',
      message = 'Canonical Co workspace is missing';
  end if;

  -- A retry after a committed reconciliation is a truthful no-op. The task
  -- row is already locked, so this check cannot race a first execution.
  select *
    into v_previous_audit
  from public.engineering_activity_log
  where entity_type = 'board_task'
    and entity_id = v_task.id::text
    and action = 'task_reconciled_to_co_ready'
    and after_data ->> 'idempotency_key' = v_key
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'reconciled', true,
      'task', to_jsonb(v_task),
      'audit_id', v_previous_audit.id
    );
  end if;

  if v_task.status <> 'qa'
     or v_task.assignee <> 'QJC'
     or v_task.workspace_id is distinct from v_co_workspace.id then
    raise exception using errcode = '55000',
      message = 'TASK must be qa/QJC in the canonical Co workspace for this reconciliation';
  end if;

  update public.board_tasks
  set status = 'ready',
      assignee = 'Co',
      workspace_id = v_co_workspace.id,
      updated_at = v_now
  where id = v_task.id
  returning * into v_updated_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_reconciled_to_co_ready',
    jsonb_build_object(
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id
    ),
    jsonb_build_object(
      'status', v_updated_task.status,
      'assignee', v_updated_task.assignee,
      'workspace_id', v_updated_task.workspace_id,
      'idempotency_key', v_key,
      'lifecycle', 'qjc_reconciliation_to_co_ready'
    ),
    'Approved generic reconciliation returned a stale QJC handoff to the canonical Co ready queue; Specific Claim remains required',
    null, 'ai', 'GPT', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'reconciled', true,
    'task', to_jsonb(v_updated_task)
  );
end;
$function$;

revoke all on function public.board_reconcile_qjc_task_to_co_ready(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.board_reconcile_qjc_task_to_co_ready(uuid, text, text) to service_role;

comment on function public.board_reconcile_qjc_task_to_co_ready(uuid, text, text) is
  'TASK-040 generic, audited reconciliation from qa/QJC in canonical Co workspace to ready/Co; Specific Co Claim remains required.';

commit;
