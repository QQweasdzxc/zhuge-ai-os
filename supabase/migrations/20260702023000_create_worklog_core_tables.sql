-- WorkLog core tables
-- Principle: shared Supabase Auth, isolated WorkLog tables, RLS by auth.uid().

create extension if not exists pgcrypto;

create table if not exists public.worklog_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  display_name text,
  department text,
  role_title text,
  ecp_owner_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.worklog_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.worklog_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.worklog_tasks(id) on delete set null,
  work_datetime timestamptz not null,
  title text not null,
  note text,
  source text not null default 'chrome_extension',
  status text not null default 'logged' check (status in ('logged', 'suggested', 'confirmed', 'exported', 'archived')),
  estimated_hours numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.worklog_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  google_drive_folder_id text,
  template_file_id text,
  default_task_id uuid references public.worklog_tasks(id) on delete set null,
  workday_hours numeric(4,2) not null default 8.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_worklog_tasks_user_id on public.worklog_tasks(user_id);
create index if not exists idx_worklog_entries_user_id on public.worklog_entries(user_id);
create index if not exists idx_worklog_entries_work_datetime on public.worklog_entries(work_datetime);
create index if not exists idx_worklog_entries_task_id on public.worklog_entries(task_id);

alter table public.worklog_users enable row level security;
alter table public.worklog_tasks enable row level security;
alter table public.worklog_entries enable row level security;
alter table public.worklog_settings enable row level security;

-- worklog_users policies
create policy "worklog_users_select_own"
on public.worklog_users
for select
using (auth_user_id = auth.uid());

create policy "worklog_users_insert_own"
on public.worklog_users
for insert
with check (auth_user_id = auth.uid());

create policy "worklog_users_update_own"
on public.worklog_users
for update
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

-- worklog_tasks policies
create policy "worklog_tasks_select_own"
on public.worklog_tasks
for select
using (user_id = auth.uid());

create policy "worklog_tasks_insert_own"
on public.worklog_tasks
for insert
with check (user_id = auth.uid());

create policy "worklog_tasks_update_own"
on public.worklog_tasks
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "worklog_tasks_delete_own"
on public.worklog_tasks
for delete
using (user_id = auth.uid());

-- worklog_entries policies
create policy "worklog_entries_select_own"
on public.worklog_entries
for select
using (user_id = auth.uid());

create policy "worklog_entries_insert_own"
on public.worklog_entries
for insert
with check (user_id = auth.uid());

create policy "worklog_entries_update_own"
on public.worklog_entries
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "worklog_entries_delete_own"
on public.worklog_entries
for delete
using (user_id = auth.uid());

-- worklog_settings policies
create policy "worklog_settings_select_own"
on public.worklog_settings
for select
using (user_id = auth.uid());

create policy "worklog_settings_insert_own"
on public.worklog_settings
for insert
with check (user_id = auth.uid());

create policy "worklog_settings_update_own"
on public.worklog_settings
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "worklog_settings_delete_own"
on public.worklog_settings
for delete
using (user_id = auth.uid());
