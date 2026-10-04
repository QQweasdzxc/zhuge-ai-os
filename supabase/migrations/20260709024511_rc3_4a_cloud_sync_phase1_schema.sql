-- Zhuge AI OS / WorkLog
-- RC3.4A Cloud Sync MVP
-- Phase 1: Supabase Schema + Grants + RLS
--
-- Scope:
--   1. user_profiles
--   2. user_work_models
--   3. user_export_settings
--   4. user_ecp_tasks
--   5. work_entries
--   6. sync_migrations
--
-- Explicitly out of scope for RC3.4A:
--   - knowledge_sources
--   - ai_feedback
--   - role_work_models
--   - pending queue / offline sync
--   - conflict resolution
--   - export status workflow

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.user_profiles (
  user_uuid uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  role_code text not null default 'PROCUREMENT',
  work_start_time time not null default '09:00',
  work_end_time time not null default '18:00',
  lunch_start_time time not null default '12:00',
  lunch_end_time time not null default '13:00',
  timezone text not null default 'Asia/Taipei',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_work_time_check check (work_start_time < work_end_time),
  constraint user_profiles_lunch_time_check check (lunch_start_time < lunch_end_time)
);

create table if not exists public.user_work_models (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references auth.users(id) on delete cascade,
  role_code text not null default 'PROCUREMENT',
  name text not null,
  source text not null default 'manual',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_work_models_name_not_blank check (length(trim(name)) > 0),
  constraint user_work_models_source_check check (source in ('manual', 'migrated'))
);

create table if not exists public.user_export_settings (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references auth.users(id) on delete cascade,
  export_profile text not null default 'ecp',
  ecp_owner text,
  ecp_department text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_export_settings_profile_not_blank check (length(trim(export_profile)) > 0)
);

create table if not exists public.user_ecp_tasks (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_ecp_tasks_name_not_blank check (length(trim(name)) > 0)
);

create table if not exists public.work_entries (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  hours numeric(5,2) not null,
  title text not null,
  note text,
  event_type text not null default 'WORK',
  status text not null default 'completed',
  source text not null default 'manual',
  ecp_task_id uuid,
  ecp_task_name_snapshot text,
  work_model_id uuid,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint work_entries_title_not_blank check (length(trim(title)) > 0),
  constraint work_entries_hours_check check (hours > 0 and hours <= 24),
  constraint work_entries_time_check check (started_at < ended_at),
  constraint work_entries_event_type_check check (event_type in ('WORK', 'MEETING', 'TRAINING', 'LEAVE', 'BUSINESS_TRIP')),
  constraint work_entries_status_check check (status in ('draft', 'completed', 'exported', 'deleted')),
  constraint work_entries_source_check check (source in ('manual', 'ai-card', 'migrated'))
);

create table if not exists public.sync_migrations (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references auth.users(id) on delete cascade,
  migration_key text not null,
  source_hash text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sync_migrations_key_not_blank check (length(trim(migration_key)) > 0)
);

-- Compatibility guard:
-- If an earlier RC3.4A draft was applied with `role`, normalize it to `role_code`.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'role'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'role_code'
  ) then
    alter table public.user_profiles rename column role to role_code;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_work_models'
      and column_name = 'role'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_work_models'
      and column_name = 'role_code'
  ) then
    alter table public.user_work_models rename column role to role_code;
  end if;
end $$;

alter table public.user_profiles
  alter column role_code set default 'PROCUREMENT';

alter table public.user_work_models
  alter column role_code set default 'PROCUREMENT';

alter table public.work_entries
  alter column event_type set default 'WORK',
  alter column status set default 'completed',
  drop constraint if exists work_entries_event_type_check,
  drop constraint if exists work_entries_status_check,
  add constraint work_entries_event_type_check check (event_type in ('WORK', 'MEETING', 'TRAINING', 'LEAVE', 'BUSINESS_TRIP')),
  add constraint work_entries_status_check check (status in ('draft', 'completed', 'exported', 'deleted'));

-- Uniqueness and relationship safety.
-- The composite unique constraints allow work_entries to reference an ECP task
-- or work model owned by the same user_uuid, preventing cross-user references.
create unique index if not exists user_profiles_user_uuid_uidx
  on public.user_profiles(user_uuid);

create unique index if not exists user_work_models_user_id_uidx
  on public.user_work_models(user_uuid, id);

create unique index if not exists user_ecp_tasks_user_id_uidx
  on public.user_ecp_tasks(user_uuid, id);

create unique index if not exists user_work_models_user_name_uidx
  on public.user_work_models(user_uuid, name);

create unique index if not exists user_export_settings_user_profile_uidx
  on public.user_export_settings(user_uuid, export_profile);

create unique index if not exists user_ecp_tasks_user_name_uidx
  on public.user_ecp_tasks(user_uuid, name);

create unique index if not exists work_entries_user_legacy_uidx
  on public.work_entries(user_uuid, legacy_id)
  where legacy_id is not null;

create unique index if not exists sync_migrations_user_key_uidx
  on public.sync_migrations(user_uuid, migration_key);

alter table public.work_entries
  drop constraint if exists work_entries_ecp_task_same_user_fk;

alter table public.work_entries
  add constraint work_entries_ecp_task_same_user_fk
  foreign key (user_uuid, ecp_task_id)
  references public.user_ecp_tasks(user_uuid, id)
  on update cascade;

alter table public.work_entries
  drop constraint if exists work_entries_work_model_same_user_fk;

alter table public.work_entries
  add constraint work_entries_work_model_same_user_fk
  foreign key (user_uuid, work_model_id)
  references public.user_work_models(user_uuid, id)
  on update cascade;

create index if not exists user_work_models_user_active_idx
  on public.user_work_models(user_uuid, is_active);

create index if not exists user_work_models_user_role_code_idx
  on public.user_work_models(user_uuid, role_code);

create index if not exists user_ecp_tasks_user_active_idx
  on public.user_ecp_tasks(user_uuid, is_active);

create index if not exists work_entries_user_date_idx
  on public.work_entries(user_uuid, work_date);

create index if not exists work_entries_user_started_idx
  on public.work_entries(user_uuid, started_at);

create index if not exists work_entries_user_status_idx
  on public.work_entries(user_uuid, status);

create index if not exists work_entries_user_ecp_task_idx
  on public.work_entries(user_uuid, ecp_task_id);

create index if not exists work_entries_user_work_model_idx
  on public.work_entries(user_uuid, work_model_id);

create index if not exists sync_migrations_user_created_idx
  on public.sync_migrations(user_uuid, created_at desc);

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_user_work_models_updated_at on public.user_work_models;
create trigger set_user_work_models_updated_at
before update on public.user_work_models
for each row execute function public.set_updated_at();

drop trigger if exists set_user_export_settings_updated_at on public.user_export_settings;
create trigger set_user_export_settings_updated_at
before update on public.user_export_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_user_ecp_tasks_updated_at on public.user_ecp_tasks;
create trigger set_user_ecp_tasks_updated_at
before update on public.user_ecp_tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_work_entries_updated_at on public.work_entries;
create trigger set_work_entries_updated_at
before update on public.work_entries
for each row execute function public.set_updated_at();

-- Data API access.
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.user_profiles to authenticated;
grant select, insert, update, delete on public.user_work_models to authenticated;
grant select, insert, update, delete on public.user_export_settings to authenticated;
grant select, insert, update, delete on public.user_ecp_tasks to authenticated;
grant select, insert, update, delete on public.work_entries to authenticated;
grant select, insert, update, delete on public.sync_migrations to authenticated;

-- RLS.
alter table public.user_profiles enable row level security;
alter table public.user_work_models enable row level security;
alter table public.user_export_settings enable row level security;
alter table public.user_ecp_tasks enable row level security;
alter table public.work_entries enable row level security;
alter table public.sync_migrations enable row level security;

drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own"
on public.user_profiles
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own"
on public.user_profiles
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own"
on public.user_profiles
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_profiles_delete_own" on public.user_profiles;
create policy "user_profiles_delete_own"
on public.user_profiles
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "user_work_models_select_own" on public.user_work_models;
create policy "user_work_models_select_own"
on public.user_work_models
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "user_work_models_insert_own" on public.user_work_models;
create policy "user_work_models_insert_own"
on public.user_work_models
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_work_models_update_own" on public.user_work_models;
create policy "user_work_models_update_own"
on public.user_work_models
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_work_models_delete_own" on public.user_work_models;
create policy "user_work_models_delete_own"
on public.user_work_models
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "user_export_settings_select_own" on public.user_export_settings;
create policy "user_export_settings_select_own"
on public.user_export_settings
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "user_export_settings_insert_own" on public.user_export_settings;
create policy "user_export_settings_insert_own"
on public.user_export_settings
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_export_settings_update_own" on public.user_export_settings;
create policy "user_export_settings_update_own"
on public.user_export_settings
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_export_settings_delete_own" on public.user_export_settings;
create policy "user_export_settings_delete_own"
on public.user_export_settings
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "user_ecp_tasks_select_own" on public.user_ecp_tasks;
create policy "user_ecp_tasks_select_own"
on public.user_ecp_tasks
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "user_ecp_tasks_insert_own" on public.user_ecp_tasks;
create policy "user_ecp_tasks_insert_own"
on public.user_ecp_tasks
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_ecp_tasks_update_own" on public.user_ecp_tasks;
create policy "user_ecp_tasks_update_own"
on public.user_ecp_tasks
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_ecp_tasks_delete_own" on public.user_ecp_tasks;
create policy "user_ecp_tasks_delete_own"
on public.user_ecp_tasks
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "work_entries_select_own" on public.work_entries;
create policy "work_entries_select_own"
on public.work_entries
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "work_entries_insert_own" on public.work_entries;
create policy "work_entries_insert_own"
on public.work_entries
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "work_entries_update_own" on public.work_entries;
create policy "work_entries_update_own"
on public.work_entries
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "work_entries_delete_own" on public.work_entries;
create policy "work_entries_delete_own"
on public.work_entries
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "sync_migrations_select_own" on public.sync_migrations;
create policy "sync_migrations_select_own"
on public.sync_migrations
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "sync_migrations_insert_own" on public.sync_migrations;
create policy "sync_migrations_insert_own"
on public.sync_migrations
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "sync_migrations_update_own" on public.sync_migrations;
create policy "sync_migrations_update_own"
on public.sync_migrations
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "sync_migrations_delete_own" on public.sync_migrations;
create policy "sync_migrations_delete_own"
on public.sync_migrations
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

comment on table public.user_profiles is 'RC3.4A Cloud Sync: user profile and work time settings.';
comment on table public.user_work_models is 'RC3.4A Cloud Sync: personal work models.';
comment on table public.user_export_settings is 'RC3.4A Cloud Sync: ECP export settings.';
comment on table public.user_ecp_tasks is 'RC3.4A Cloud Sync: user-managed ECP task list.';
comment on table public.work_entries is 'RC3.4A Cloud Sync: WorkLog entries.';
comment on table public.sync_migrations is 'RC3.4A Cloud Sync: one-time migration completion records.';

commit;