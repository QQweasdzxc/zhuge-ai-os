begin;

-- Repair all existing Board TASK rows that do not yet have a canonical TASK code.
with base as (
  select coalesce(max((substring(work_code from 'TASK-([0-9]+)'))::int), 0) as max_no
  from public.board_tasks
  where work_code ~ '^TASK-[0-9]+$'
), missing as (
  select id, row_number() over (order by created_at asc nulls last, id) as rn
  from public.board_tasks
  where work_code is null or btrim(work_code) = ''
)
update public.board_tasks t
set work_code = 'TASK-' || lpad((base.max_no + missing.rn)::text, 3, '0'),
    updated_at = now()
from base, missing
where t.id = missing.id;

-- Enforce canonical format and uniqueness.
alter table public.board_tasks
  add constraint board_tasks_work_code_format_chk
  check (work_code ~ '^TASK-[0-9]{3,}$') not valid;

alter table public.board_tasks validate constraint board_tasks_work_code_format_chk;

create unique index if not exists board_tasks_work_code_uidx
  on public.board_tasks(work_code);

-- Server-side allocator. No caller needs to remember or calculate the next TASK number.
create or replace function public.allocate_board_task_work_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  next_no integer;
begin
  if new.work_code is null or btrim(new.work_code) = '' then
    perform pg_advisory_xact_lock(hashtext('public.board_tasks.work_code'));

    select coalesce(max((substring(work_code from 'TASK-([0-9]+)'))::int), 0) + 1
      into next_no
    from public.board_tasks
    where work_code ~ '^TASK-[0-9]+$';

    new.work_code := 'TASK-' || lpad(next_no::text, 3, '0');
  elsif new.work_code !~ '^TASK-[0-9]{3,}$' then
    raise exception using errcode = '22023', message = 'work_code must use canonical TASK-NNN format';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_allocate_board_task_work_code on public.board_tasks;
create trigger trg_allocate_board_task_work_code
before insert on public.board_tasks
for each row
execute function public.allocate_board_task_work_code();

alter table public.board_tasks
  alter column work_code set not null;

commit;