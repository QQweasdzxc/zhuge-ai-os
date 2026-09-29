-- Module C background completion/archive scheduler.
--
-- The scheduler calls the same private C reconciler used by the authenticated
-- read safety-net.  It does not contain a second due-time or archive rule.

begin;

create table if not exists private.module_c_completion_archive_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  instances_scanned integer not null default 0,
  cards_archived integer not null default 0,
  error_count integer not null default 0,
  details jsonb not null default '[]'::jsonb
);

alter table private.module_c_completion_archive_scheduler_runs enable row level security;
revoke all on table private.module_c_completion_archive_scheduler_runs from public, anon, authenticated;

create or replace function private.board_c_completion_archive_scheduler_run()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_run_id uuid := gen_random_uuid();
  v_instance record;
  v_result jsonb;
  v_details jsonb := '[]'::jsonb;
  v_instances_scanned integer := 0;
  v_cards_archived integer := 0;
  v_error_count integer := 0;
begin
  -- A second invocation while the first one is still running is a no-op.  The
  -- row lock is transaction-scoped and does not change any card data.
  if not pg_try_advisory_xact_lock(hashtextextended('module-c-completion-archive-scheduler', 0)) then
    return jsonb_build_object(
      'contract', 'module-c-lifecycle-acceptance-v2',
      'capability', 'completion-archive-lifecycle',
      'action', 'background-reconcile',
      'state', 'already_running',
      'idempotent', true,
      'atomic', true
    );
  end if;

  insert into private.module_c_completion_archive_scheduler_runs (id, status)
  values (v_run_id, 'running');

  for v_instance in
    select instance.id as board_instance_id,
           state.published_workflow_version_id as workflow_version_id
      from public.board_instances instance
      join public.board_instance_workflow_state state
        on state.board_instance_id = instance.id
      join public.board_workflow_definitions definition
        on definition.id = state.published_workflow_version_id
       and definition.board_instance_id = instance.id
       and definition.status = 'published'
       and definition.published_at is not null
     where instance.active = true
       and instance.template_key = 'c'
       and state.published_workflow_version_id is not null
     order by instance.id
  loop
    begin
      v_result := private.board_c_reconcile_completion_archive_lifecycle_core(
        v_instance.board_instance_id,
        v_instance.workflow_version_id,
        null,
        null,
        'Module C Background Scheduler'
      );
      v_instances_scanned := v_instances_scanned + 1;
      v_cards_archived := v_cards_archived + coalesce((v_result->>'archived_count')::integer, 0);
      v_details := v_details || jsonb_build_array(v_result);
    exception when others then
      v_instances_scanned := v_instances_scanned + 1;
      v_error_count := v_error_count + 1;
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'board_instance_id', v_instance.board_instance_id,
        'workflow_version_id', v_instance.workflow_version_id,
        'state', 'error',
        'error_message', sqlerrm
      ));
      insert into public.engineering_activity_log (
        entity_type, entity_id, action, after_data, note,
        actor_id, actor_type, actor_label, activity_type
      ) values (
        'completion_archive_scheduler', v_instance.board_instance_id::text,
        'completion_archive_scheduler_error',
        jsonb_build_object(
          'contract', 'module-c-lifecycle-acceptance-v2',
          'board_instance_id', v_instance.board_instance_id,
          'workflow_version_id', v_instance.workflow_version_id,
          'error_message', sqlerrm
        ),
        'Module C Background Scheduler error evidence',
        null, 'system', 'Module C Background Scheduler', 'system_activity'
      );
    end;
  end loop;

  update private.module_c_completion_archive_scheduler_runs
     set completed_at = clock_timestamp(),
         status = case when v_error_count = 0 then 'completed' else 'completed_with_errors' end,
         instances_scanned = v_instances_scanned,
         cards_archived = v_cards_archived,
         error_count = v_error_count,
         details = v_details
   where id = v_run_id;

  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive-lifecycle',
    'action', 'background-reconcile',
    'state', case when v_error_count = 0 then 'completed' else 'completed_with_errors' end,
    'scheduler_run_id', v_run_id,
    'instances_scanned', v_instances_scanned,
    'cards_archived', v_cards_archived,
    'error_count', v_error_count,
    'details', v_details,
    'idempotent', true,
    'atomic_per_instance', true,
    'archive_authority', 'module-c-canonical-completion-archive-lifecycle'
  );
exception when others then
  update private.module_c_completion_archive_scheduler_runs
     set completed_at = clock_timestamp(),
         status = 'failed',
         instances_scanned = v_instances_scanned,
         cards_archived = v_cards_archived,
         error_count = v_error_count + 1,
         details = v_details || jsonb_build_array(jsonb_build_object('state', 'error', 'error_message', sqlerrm))
   where id = v_run_id;
  raise;
end;
$function$;

revoke all on function private.board_c_completion_archive_scheduler_run() from public, anon, authenticated;

-- pg_cron is optional in a Supabase project.  Installation is deliberately
-- part of this additive migration: if the project does not permit the
-- extension, this migration rolls back and the caller must stop at the
-- Background Scheduler Gate rather than pretending that Read-triggered work
-- is automatic.
create extension if not exists pg_cron;

do $schedule$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    raise exception using errcode = '0A000', message = 'pg_cron extension did not expose the cron schema; scheduler not activated';
  end if;
  select jobid into v_job_id
    from cron.job
   where jobname = 'module-c-completion-archive-v2';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'module-c-completion-archive-v2',
    '*/5 * * * *',
    $job$select private.board_c_completion_archive_scheduler_run();$job$
  );
end;
$schedule$;

comment on table private.module_c_completion_archive_scheduler_runs is
  'Internal execution evidence for the single Module C completion archive scheduler.';
comment on function private.board_c_completion_archive_scheduler_run() is
  'Background Module C scheduler; invokes the canonical instance/workflow reconciler and never implements a second archive policy.';

commit;
