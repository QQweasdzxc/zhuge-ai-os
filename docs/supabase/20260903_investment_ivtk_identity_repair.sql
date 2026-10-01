-- One-time repair for the first IVTK projection.
--
-- The shared board allocator increments board_instances.next_task_number
-- before assigning a work_code. The initial IVTK transform set that counter
-- to 1, so the first authenticated projection received IVTK-002 instead of
-- IVTK-001. This repair is narrowly guarded to the eight newly-created,
-- opening-position projection links on the existing Investment board.
-- It does not touch Investment financial data, QAT-001, or transactions.

create or replace function public.repair_investment_ivtk_identity()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_instance_id uuid;
  v_projection_count integer;
  v_canonical_count integer;
  v_legacy_projection_count integer;
  v_ivtk_one_count integer;
  v_task record;
  v_old_code text;
  v_final_code text;
  v_number integer;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_IVTK_AUTH_REQUIRED';
  end if;

  if not (
    (select auth.jwt() ->> 'aal') = 'aal2'
    or private.investment_mfa_bypassed()
  ) then
    raise exception using errcode = '42501', message = 'INVESTMENT_IVTK_AAL2_REQUIRED';
  end if;

  v_owner_id := private.investment_current_owner_id();
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_OWNER_MAPPING_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('investment:ivtk:identity-repair'));

  select id
    into v_instance_id
  from public.board_instances
  where name = '投資戰情板'
    and upper(task_code_prefix) = 'IVTK'
    and template_key = 'c'
    and is_template_instance = false
    and active = true
  order by created_at
  limit 1
  for update;

  if v_instance_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Active Investment IVTK board instance is required';
  end if;

  if not public.board_instance_can_write(v_instance_id) then
    raise exception using
      errcode = '42501',
      message = 'Investment IVTK board owner authorization is required';
  end if;

  select count(*)
    into v_projection_count
  from public.investment_ivtk_card_links link
  join public.board_tasks task on task.id = link.board_task_id
  where link.board_instance_id = v_instance_id
    and link.active = true
    and link.user_id = v_owner_id
    and link.card_kind = 'position'
    and link.source_kind = 'opening_position'
    and task.board_instance_id = v_instance_id
    and task.archived_at is null
  ;

  select count(*)
    into v_canonical_count
  from public.investment_ivtk_card_links link
  join public.board_tasks task on task.id = link.board_task_id
  where link.board_instance_id = v_instance_id
    and link.active = true
    and link.user_id = v_owner_id
    and link.card_kind = 'position'
    and link.source_kind = 'opening_position'
    and task.board_instance_id = v_instance_id
    and task.archived_at is null
    and task.work_code ~ '^IVTK-00[1-8]$';

  select count(*)
    into v_legacy_projection_count
  from public.investment_ivtk_card_links link
  join public.board_tasks task on task.id = link.board_task_id
  where link.board_instance_id = v_instance_id
    and link.active = true
    and link.user_id = v_owner_id
    and link.card_kind = 'position'
    and link.source_kind = 'opening_position'
    and task.board_instance_id = v_instance_id
    and task.archived_at is null
    and task.work_code ~ '^IVTK-00[2-9]$';

  if v_projection_count = 8 and v_canonical_count = 8 then
    return jsonb_build_object(
      'status', 'already_canonical',
      'repaired_count', 0,
      'board_instance_id', v_instance_id
    );
  end if;

  if v_projection_count = 0 then
    return jsonb_build_object(
      'status', 'already_canonical',
      'repaired_count', 0,
      'board_instance_id', v_instance_id
    );
  end if;

  if v_projection_count <> 8 or v_legacy_projection_count <> 8 then
    raise exception using
      errcode = '23514',
      message = 'IVTK identity repair requires exactly eight IVTK-002..009 projection tasks';
  end if;

  select count(*)
    into v_ivtk_one_count
  from public.board_tasks
  where work_code = 'IVTK-001';

  if v_ivtk_one_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'IVTK-001 is already occupied; identity repair is not safe';
  end if;

  -- Stage the eight canonical codes in a non-overlapping canonical namespace
  -- so the unique work_code index is never violated during the correction.
  for v_task in
    select task.id, task.work_code
    from public.investment_ivtk_card_links link
    join public.board_tasks task on task.id = link.board_task_id
    where link.board_instance_id = v_instance_id
      and link.active = true
      and link.user_id = v_owner_id
      and link.card_kind = 'position'
      and link.source_kind = 'opening_position'
    order by task.work_code
  loop
    v_old_code := v_task.work_code;
    v_final_code := 'IVTK-900' || substring(v_old_code from 'IVTK-([0-9]+)$');

    if exists (select 1 from public.board_tasks where work_code = v_final_code) then
      raise exception using
        errcode = '23514',
        message = format('Temporary IVTK identity is already occupied: %s', v_final_code);
    end if;

    update public.board_tasks
    set work_code = v_final_code,
        updated_at = now()
    where id = v_task.id;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_task.id::text, 'investment_ivtk_identity_repaired',
      jsonb_build_object('work_code', v_old_code),
      jsonb_build_object('work_code', v_final_code),
      'Temporary namespace stage for the approved IVTK-001 identity correction',
      v_auth_user_id, 'system', 'System', 'system_activity'
    );
  end loop;

  -- Shift the staged values down by one: 9002..9009 -> 001..008.
  for v_task in
    select task.id, task.work_code
    from public.investment_ivtk_card_links link
    join public.board_tasks task on task.id = link.board_task_id
    where link.board_instance_id = v_instance_id
      and link.active = true
      and link.user_id = v_owner_id
      and link.card_kind = 'position'
      and link.source_kind = 'opening_position'
    order by task.work_code
  loop
    v_number := substring(v_task.work_code from 'IVTK-([0-9]+)$')::integer - 900000 - 1;
    v_old_code := v_task.work_code;
    v_final_code := 'IVTK-' || lpad(v_number::text, 3, '0');

    update public.board_tasks
    set work_code = v_final_code,
        updated_at = now()
    where id = v_task.id;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_task.id::text, 'investment_ivtk_identity_repaired',
      jsonb_build_object('work_code', v_old_code),
      jsonb_build_object('work_code', v_final_code),
      'Final canonical IVTK identity; QAT-001 remains unchanged',
      v_auth_user_id, 'system', 'System', 'system_activity'
    );
  end loop;

  -- The allocator increments first, so 8 is the last assigned number and the
  -- next new projection will receive IVTK-009.
  update public.board_instances
  set next_task_number = 8,
      updated_at = now()
  where id = v_instance_id
    and active = true
    and upper(task_code_prefix) = 'IVTK';

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Active IVTK board instance was not found during identity repair';
  end if;

  return jsonb_build_object(
    'status', 'repaired',
    'repaired_count', 8,
    'board_instance_id', v_instance_id,
    'next_task_number', 8
  );
end;
$function$;

revoke all on function public.repair_investment_ivtk_identity() from public, anon;
grant execute on function public.repair_investment_ivtk_identity() to authenticated;
