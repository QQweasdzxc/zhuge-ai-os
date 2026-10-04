-- P5.6 Work Memory Cloud Foundation
-- Single Source of Truth: public.user_work_models

begin;

alter table public.user_work_models
  add column if not exists description text not null default '',
  add column if not exists category text not null default '一般工作',
  add column if not exists aliases text[] not null default '{}'::text[],
  add column if not exists source_references jsonb not null default '[]'::jsonb,
  add column if not exists keywords text[] not null default '{}'::text[],
  add column if not exists familiarity smallint not null default 1,
  add column if not exists last_used_at timestamptz;

alter table public.user_work_models
  drop constraint if exists user_work_models_familiarity_check;

alter table public.user_work_models
  add constraint user_work_models_familiarity_check
  check (familiarity between 1 and 5);

alter table public.user_work_models
  drop constraint if exists user_work_models_source_check;

alter table public.user_work_models
  add constraint user_work_models_source_check
  check (source in ('manual', 'migrated', 'knowledge', 'worklog', 'ai_suggestion'));

create index if not exists user_work_models_user_active_updated_idx
  on public.user_work_models(user_uuid, is_active, updated_at desc);

grant select, insert, update, delete on public.user_work_models to authenticated;
alter table public.user_work_models enable row level security;

-- Recreate policies explicitly so UPDATE has both row visibility and ownership checks.
drop policy if exists "user_work_models_select_own" on public.user_work_models;
create policy "user_work_models_select_own"
on public.user_work_models for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "user_work_models_insert_own" on public.user_work_models;
create policy "user_work_models_insert_own"
on public.user_work_models for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_work_models_update_own" on public.user_work_models;
create policy "user_work_models_update_own"
on public.user_work_models for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "user_work_models_delete_own" on public.user_work_models;
create policy "user_work_models_delete_own"
on public.user_work_models for delete
to authenticated
using ((select auth.uid()) = user_uuid);

commit;
