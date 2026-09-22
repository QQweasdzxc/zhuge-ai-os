-- TASK-063: fix the shared C board-task DELETE trigger.
--
-- The original universal board trigger read NEW before branching on tg_op.
-- PostgreSQL exposes only OLD for DELETE, so every authorized C card delete
-- failed with the misleading `board_instance_id is required` error.  This
-- migration changes only the trigger function; it does not touch board rows,
-- identities, workspaces, or card data.

begin;

create or replace function public.enforce_board_task_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_instance public.board_instances;
begin
  -- DELETE has no NEW record.  Resolve the immutable board identity from OLD
  -- and apply the same authorization checks before allowing the delete.
  if tg_op = 'DELETE' then
    if old.board_instance_id is null then
      raise exception using errcode = '23502', message = 'board_instance_id is required';
    end if;

    select * into v_instance
    from public.board_instances
    where id = old.board_instance_id
      and active = true;
    if not found then
      raise exception using errcode = '23503', message = 'Active board instance is required';
    end if;

    if old.application_scope = 'worktodo' then
      if auth.uid() is null or old.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
      end if;
    elsif old.application_scope is null and v_instance.authorization_mode = 'owner' then
      if auth.uid() is null or old.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'Board owner authorization is required';
      end if;
    elsif old.application_scope is null
      and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
      raise exception using errcode = '42501', message = 'Engineering board authorization is required';
    end if;
    return old;
  end if;

  if new.board_instance_id is null then
    raise exception using errcode = '23502', message = 'board_instance_id is required';
  end if;

  select * into v_instance
  from public.board_instances
  where id = new.board_instance_id
    and active = true;
  if not found then
    raise exception using errcode = '23503', message = 'Active board instance is required';
  end if;

  if tg_op = 'INSERT' then
    if new.application_scope = 'worktodo' then
      if auth.uid() is null or new.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
      end if;
    elsif new.application_scope = 'ai_board' then
      if new.owner_uuid is not null then
        raise exception using errcode = '42501', message = 'AI Board task owner must be null';
      end if;
    elsif v_instance.authorization_mode = 'owner' then
      if auth.uid() is null or new.owner_uuid is distinct from auth.uid() then
        raise exception using errcode = '42501', message = 'Board owner authorization is required';
      end if;
    elsif auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'Engineering board authorization is required';
    end if;
    return new;
  end if;

  if old.board_instance_id is distinct from new.board_instance_id then
    raise exception using errcode = '22023', message = 'board_instance_id is immutable';
  end if;
  if old.application_scope is distinct from new.application_scope
     or old.owner_uuid is distinct from new.owner_uuid then
    raise exception using errcode = '22023', message = 'Task board identity is immutable';
  end if;

  if new.application_scope = 'worktodo'
     and (auth.uid() is null or new.owner_uuid is distinct from auth.uid()) then
    raise exception using errcode = '42501', message = 'WorkTodo task owner authorization is required';
  elsif new.application_scope is null and v_instance.authorization_mode = 'owner'
     and (auth.uid() is null or new.owner_uuid is distinct from auth.uid()) then
    raise exception using errcode = '42501', message = 'Board owner authorization is required';
  elsif new.application_scope is null and v_instance.authorization_mode = 'engineering'
     and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
    raise exception using errcode = '42501', message = 'Engineering board authorization is required';
  end if;
  return new;
end;
$$;

commit;
