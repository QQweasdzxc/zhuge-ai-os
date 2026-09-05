-- Work-code allocator collision guard
--
-- The allocator is the Cloud-authoritative source for automatically assigned
-- TASK/WLTK/registered-prefix work codes.  Existing rows, identifiers, the
-- unique index, auth, RLS, and application-scope contracts remain unchanged.
--
-- This migration is intentionally additive and non-destructive.  A stale
-- sequence or registry counter is repaired by skipping occupied candidates
-- while holding the same prefix lock used by every automatic board writer.
begin;

create or replace function public.allocate_board_task_work_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_candidate text;
  v_next bigint;
  v_attempts integer := 0;
begin
  if new.board_instance_id is not null then
    select upper(task_code_prefix)
      into v_prefix
    from public.board_instances
    where id = new.board_instance_id
      and active = true;
    if v_prefix is null then
      raise exception using errcode = '23503', message = 'Active board instance is required';
    end if;

    if new.work_code is null or btrim(new.work_code) = '' then
      -- Prefix locking gives the registry path and the legacy compatibility
      -- paths one ordering rule.  It prevents a stale counter from racing a
      -- concurrent writer for the same canonical namespace.
      perform pg_advisory_xact_lock(
        hashtext('public.board_tasks.work_code.prefix:' || v_prefix)
      );
      loop
        update public.board_instances
        set next_task_number = next_task_number + 1,
            updated_at = now()
        where id = new.board_instance_id
          and active = true
        returning next_task_number into v_next;
        if not found then
          raise exception using errcode = '23503', message = 'Active board instance is required';
        end if;

        v_candidate := v_prefix || '-' || lpad(v_next::text, 3, '0');
        exit when not exists (
          select 1
          from public.board_tasks existing
          where existing.work_code = v_candidate
        );

        v_attempts := v_attempts + 1;
        if v_attempts >= 1000000 then
          raise exception using errcode = 'P0001', message = 'No available board work code could be allocated';
        end if;
      end loop;
      new.work_code := v_candidate;
    elsif new.work_code !~ ('^' || v_prefix || '-[0-9]{3,}$') then
      raise exception using errcode = '22023',
        message = format('Board work_code must use canonical %s-NNN format', v_prefix);
    end if;
    return new;
  end if;

  if new.application_scope = 'worktodo' then
    if new.work_code is null or btrim(new.work_code) = '' then
      perform pg_advisory_xact_lock(
        hashtext('public.board_tasks.work_code.prefix:WLTK')
      );
      loop
        select nextval('public.worktodo_wltk_seq') into v_next;
        v_candidate := 'WLTK-' || lpad(v_next::text, 3, '0');
        exit when not exists (
          select 1
          from public.board_tasks existing
          where existing.work_code = v_candidate
        );

        v_attempts := v_attempts + 1;
        if v_attempts >= 1000000 then
          raise exception using errcode = 'P0001', message = 'No available WorkTodo work code could be allocated';
        end if;
      end loop;
      new.work_code := v_candidate;
    elsif new.work_code !~ '^WLTK-[0-9]{3,}$' then
      raise exception using errcode = '22023', message = 'WorkTodo work_code must use canonical WLTK-NNN format';
    end if;
  else
    if new.work_code is null or btrim(new.work_code) = '' then
      perform pg_advisory_xact_lock(
        hashtext('public.board_tasks.work_code.prefix:TASK')
      );
      select coalesce(max((substring(work_code from 'TASK-([0-9]+)'))::bigint), 0) + 1
        into v_next
      from public.board_tasks
      where application_scope = 'ai_board'
        and work_code ~ '^TASK-[0-9]+$';

      loop
        v_candidate := 'TASK-' || lpad(v_next::text, 3, '0');
        exit when not exists (
          select 1
          from public.board_tasks existing
          where existing.work_code = v_candidate
        );
        v_next := v_next + 1;
        v_attempts := v_attempts + 1;
        if v_attempts >= 1000000 then
          raise exception using errcode = 'P0001', message = 'No available AI Board work code could be allocated';
        end if;
      end loop;
      new.work_code := v_candidate;
    elsif new.work_code !~ '^TASK-[0-9]{3,}$' then
      raise exception using errcode = '22023', message = 'AI Board work_code must use canonical TASK-NNN format';
    end if;
  end if;
  return new;
end;
$$;

-- The legacy WorkTodo table uses the same sequence.  Keep its trigger
-- collision-safe as well so the older compatibility route cannot reintroduce
-- the same failure class.
create or replace function public.worktodo_assign_work_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_candidate text;
  v_next bigint;
  v_attempts integer := 0;
begin
  if new.work_code is null or btrim(new.work_code) = '' then
    perform pg_advisory_xact_lock(
      hashtext('public.board_tasks.work_code.prefix:WLTK')
    );
    loop
      select nextval('public.worktodo_wltk_seq') into v_next;
      v_candidate := 'WLTK-' || lpad(v_next::text, 3, '0');
      exit when not exists (
        select 1
        from public.user_tasks existing
        where existing.work_code = v_candidate
      );

      v_attempts := v_attempts + 1;
      if v_attempts >= 1000000 then
        raise exception using errcode = 'P0001', message = 'No available legacy WorkTodo work code could be allocated';
      end if;
    end loop;
    new.work_code := v_candidate;
  elsif new.work_code !~ '^WLTK-[0-9]{3,}$' then
    raise exception using errcode = '22023', message = 'WorkTodo identity must use WLTK namespace';
  end if;
  return new;
end;
$$;

-- All generic registered boards use the shared trigger above.  This RPC no
-- longer increments the registry counter or supplies work_code itself; doing
-- so would create a second allocator and could collide with WorkTodo or
-- another Consumer.  Removing the pre-read row lock also keeps lock ordering
-- consistent: prefix lock first, registry counter update second.
create or replace function public.board_instance_create_task(
  p_board_instance_id uuid,
  p_title text,
  p_summary text default null,
  p_status text default 'not_started',
  p_usage_scenario text default null,
  p_workspace_id uuid default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_instance public.board_instances;
  v_workspace public.board_workspaces;
  v_row public.board_tasks;
  v_owner uuid;
  v_status text := lower(btrim(coalesce(p_status, 'not_started')));
  v_default_key text;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  if length(v_title) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  select * into v_instance
  from public.board_instances
  where id = p_board_instance_id
    and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active board instance not found';
  end if;
  v_default_key := lower(v_instance.task_code_prefix) || '-todo';
  if p_workspace_id is null then
    select * into v_workspace
    from public.board_workspaces
    where board_instance_id = p_board_instance_id
      and workspace_key = v_default_key
      and active = true
    order by sort_order
    limit 1;
  else
    select * into v_workspace
    from public.board_workspaces
    where id = p_workspace_id
      and board_instance_id = p_board_instance_id
      and active = true;
  end if;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active board workspace is required';
  end if;
  v_owner := case when v_instance.authorization_mode = 'owner' then v_user else null end;
  insert into public.board_tasks (
    board_instance_id, workspace_id, title, summary, status, usage_scenario,
    application_scope, owner_uuid, created_by
  ) values (
    p_board_instance_id, v_workspace.id, v_title,
    nullif(btrim(coalesce(p_summary, '')), ''),
    coalesce(nullif(v_status, ''), 'not_started'),
    nullif(btrim(coalesce(p_usage_scenario, '')), ''),
    null, v_owner, v_user
  ) returning * into v_row;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_row.id::text, 'task_created', to_jsonb(v_row),
    'Board task created through the universal board contract',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$$;

commit;
