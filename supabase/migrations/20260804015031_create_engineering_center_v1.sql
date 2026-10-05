begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.engineering_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','editor','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_engineering_member(required_roles text[] default array['owner','editor','viewer'])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.engineering_members m
    where m.user_id = auth.uid()
      and m.is_active = true
      and m.role = any(required_roles)
  );
$$;

revoke all on function public.is_engineering_member(text[]) from public;
grant execute on function public.is_engineering_member(text[]) to authenticated;

create table if not exists public.engineering_knowledge (
  id uuid primary key default gen_random_uuid(),
  knowledge_code text unique,
  knowledge_type text not null check (knowledge_type in ('principle','development_rule','coding_rule','architecture','decision','adr','assistant_definition','best_practice','lesson_learned','document_rule')),
  title text not null,
  summary text,
  content text not null,
  module text,
  status text not null default 'draft' check (status in ('draft','discussion','proposed','approved','deprecated','superseded')),
  version text not null default '1.0',
  source_path text,
  source_reference text,
  conflict_status text not null default 'none' check (conflict_status in ('none','suspected','confirmed','resolved')),
  conflict_notes text,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.engineering_features (
  id uuid primary key default gen_random_uuid(),
  feature_code text unique not null,
  name text not null,
  module text not null,
  objective text,
  current_state text,
  health_status text not null default 'unknown' check (health_status in ('unknown','healthy','attention','blocked','completed','frozen')),
  priority text not null default 'p2' check (priority in ('p0','p1','p2','p3')),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  release_target text,
  owner_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.engineering_work_items (
  id uuid primary key default gen_random_uuid(),
  work_code text unique not null,
  feature_id uuid not null references public.engineering_features(id) on delete cascade,
  category text not null check (category in ('feature','stability','bug','ux','architecture','security','data','documentation','release','qa')),
  title text not null,
  problem text,
  objective text,
  proposed_solution text,
  scope text,
  out_of_scope text,
  impact_analysis text,
  acceptance_criteria text,
  developer_notes text,
  pm_notes text,
  status text not null default 'draft' check (status in ('draft','ready','in_development','developer_qa','ready_for_pm_qa','pm_qa_revision','pm_qa_passed','released','completed','blocked','cancelled')),
  priority text not null default 'p2' check (priority in ('p0','p1','p2','p3')),
  assignee_label text,
  target_version text,
  blocker text,
  started_at timestamptz,
  developer_completed_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engineering_work_items_completed_gate check (
    status <> 'completed' or completed_at is not null
  )
);

create table if not exists public.engineering_qa (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null unique references public.engineering_work_items(id) on delete cascade,
  developer_qa_status text not null default 'not_started' check (developer_qa_status in ('not_started','in_progress','passed','failed','not_applicable')),
  developer_qa_notes text,
  regression_status text not null default 'not_started' check (regression_status in ('not_started','in_progress','passed','failed','not_applicable')),
  regression_scope text,
  regression_notes text,
  ux_review_status text not null default 'not_started' check (ux_review_status in ('not_started','in_progress','passed','failed','not_applicable')),
  ux_review_notes text,
  pm_qa_status text not null default 'not_started' check (pm_qa_status in ('not_started','waiting','in_progress','passed','failed','revision_required','not_applicable')),
  pm_feedback text,
  artifact_links jsonb not null default '[]'::jsonb,
  test_evidence jsonb not null default '[]'::jsonb,
  release_ready boolean not null default false,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engineering_qa_release_gate check (
    release_ready = false or (
      developer_qa_status in ('passed','not_applicable') and
      regression_status in ('passed','not_applicable') and
      ux_review_status in ('passed','not_applicable') and
      pm_qa_status in ('passed','not_applicable')
    )
  )
);

create table if not exists public.engineering_activity_log (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('knowledge','feature','work_item','qa','member')),
  entity_id text not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  note text,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_engineering_knowledge_type_status on public.engineering_knowledge(knowledge_type, status);
create index if not exists idx_engineering_features_module_health on public.engineering_features(module, health_status);
create index if not exists idx_engineering_work_items_feature_status on public.engineering_work_items(feature_id, status);
create index if not exists idx_engineering_work_items_priority on public.engineering_work_items(priority, status);
create index if not exists idx_engineering_activity_entity on public.engineering_activity_log(entity_type, entity_id, created_at desc);

create trigger trg_engineering_members_updated_at before update on public.engineering_members for each row execute function public.set_updated_at();
create trigger trg_engineering_knowledge_updated_at before update on public.engineering_knowledge for each row execute function public.set_updated_at();
create trigger trg_engineering_features_updated_at before update on public.engineering_features for each row execute function public.set_updated_at();
create trigger trg_engineering_work_items_updated_at before update on public.engineering_work_items for each row execute function public.set_updated_at();
create trigger trg_engineering_qa_updated_at before update on public.engineering_qa for each row execute function public.set_updated_at();

alter table public.engineering_members enable row level security;
alter table public.engineering_knowledge enable row level security;
alter table public.engineering_features enable row level security;
alter table public.engineering_work_items enable row level security;
alter table public.engineering_qa enable row level security;
alter table public.engineering_activity_log enable row level security;

create policy engineering_members_select on public.engineering_members for select to authenticated using (public.is_engineering_member());
create policy engineering_members_owner_write on public.engineering_members for all to authenticated using (public.is_engineering_member(array['owner'])) with check (public.is_engineering_member(array['owner']));

create policy engineering_knowledge_read on public.engineering_knowledge for select to authenticated using (public.is_engineering_member());
create policy engineering_knowledge_write on public.engineering_knowledge for all to authenticated using (public.is_engineering_member(array['owner','editor'])) with check (public.is_engineering_member(array['owner','editor']));

create policy engineering_features_read on public.engineering_features for select to authenticated using (public.is_engineering_member());
create policy engineering_features_write on public.engineering_features for all to authenticated using (public.is_engineering_member(array['owner','editor'])) with check (public.is_engineering_member(array['owner','editor']));

create policy engineering_work_items_read on public.engineering_work_items for select to authenticated using (public.is_engineering_member());
create policy engineering_work_items_write on public.engineering_work_items for all to authenticated using (public.is_engineering_member(array['owner','editor'])) with check (public.is_engineering_member(array['owner','editor']));

create policy engineering_qa_read on public.engineering_qa for select to authenticated using (public.is_engineering_member());
create policy engineering_qa_write on public.engineering_qa for all to authenticated using (public.is_engineering_member(array['owner','editor'])) with check (public.is_engineering_member(array['owner','editor']));

create policy engineering_activity_read on public.engineering_activity_log for select to authenticated using (public.is_engineering_member());
create policy engineering_activity_insert on public.engineering_activity_log for insert to authenticated with check (public.is_engineering_member(array['owner','editor']));

commit;