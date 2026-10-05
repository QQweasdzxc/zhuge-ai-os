-- Sprint 7.1: shared Task workflow state.
-- Repeatable migration. Supabase remains the source of truth.

begin;

alter table if exists public.user_tasks
  add column if not exists progress integer not null default 0;

alter table if exists public.user_tasks
  drop constraint if exists user_tasks_status_check,
  drop constraint if exists user_tasks_status_check_v2,
  drop constraint if exists user_tasks_workflow_status_check,
  drop constraint if exists user_tasks_progress_check;

update public.user_tasks
set status = case lower(coalesce(status, 'not_started'))
  when 'open' then 'not_started'
  when 'todo' then 'not_started'
  when 'in progress' then 'in_progress'
  when 'waiting' then 'waiting_reply'
  when 'done' then 'completed'
  when 'complete' then 'completed'
  when 'completed' then 'completed'
  when 'waiting_reply' then 'waiting_reply'
  when 'waiting_acceptance' then 'waiting_acceptance'
  when 'blocked' then 'blocked'
  when 'in_progress' then 'in_progress'
  when 'not_started' then 'not_started'
  else 'not_started'
end,
progress = greatest(0, least(100, coalesce(progress, case when lower(coalesce(status, '')) in ('completed','done','complete') then 100 else 0 end)));

alter table if exists public.user_tasks
  add constraint user_tasks_workflow_status_check
  check (status in ('not_started','in_progress','waiting_reply','waiting_acceptance','blocked','completed'));

alter table if exists public.user_tasks
  add constraint user_tasks_progress_check
  check (progress between 0 and 100);

create index if not exists user_tasks_workflow_idx
  on public.user_tasks(user_uuid, status, progress, updated_at desc)
  where deleted_at is null;

grant select, insert, update, delete on public.user_tasks to authenticated;
alter table if exists public.user_tasks enable row level security;

commit;
