-- Permanent Engineering Memory Retrieval
--
-- Canonical Principle content remains in public.engineering_knowledge.
-- knowledge_sources and knowledge_units are intentionally not populated by
-- this migration: they are document index/unit tables, not Principle Truth.
--
-- This migration is idempotent and does not modify approved Principle rows.

begin;

-- ---------------------------------------------------------------------------
-- Project-level Engineering Checkpoint
-- ---------------------------------------------------------------------------
create table if not exists public.engineering_project_checkpoints (
  checkpoint_key text primary key default 'current',
  current_task text,
  current_stage text,
  completed jsonb not null default '[]'::jsonb,
  pending jsonb not null default '[]'::jsonb,
  files_changed jsonb not null default '[]'::jsonb,
  cloud_changes jsonb not null default '[]'::jsonb,
  qa_status text,
  blocking jsonb not null default '[]'::jsonb,
  next_action text,
  branch text,
  git_commit text,
  working_tree_state text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------------------
-- Current PM Accepted Baseline (empty until QJC / PM explicitly accepts one)
-- ---------------------------------------------------------------------------
create table if not exists public.engineering_pm_accepted_baselines (
  baseline_key text primary key default 'current',
  product_version text,
  runtime_build text,
  git_commit text,
  artifact_reference text,
  pm_accepted_at timestamptz,
  pm_acceptance_status text,
  notes text,
  accepted_by uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Canonical project/system configuration
-- ---------------------------------------------------------------------------
create table if not exists public.engineering_project_configuration (
  configuration_key text primary key,
  configuration_value jsonb not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.engineering_project_configuration (
  configuration_key,
  configuration_value
)
values (
  'artifact_rule',
  jsonb_build_object(
    'artifact_root', '/Users/qq/Library/CloudStorage/GoogleDrive-qq.1025@gmail.com/我的雲端硬碟/TOOLS-自製/ZhuGe AI OS/版控',
    'immutable', true,
    'append_only', true,
    'overwrite_allowed', false,
    'allowed_artifact_types', jsonb_build_array('candidate', 'qa', 'release'),
    'identity_fields', jsonb_build_array('version', 'build', 'timestamp', 'git_commit', 'sha256', 'artifact_type', 'qa_status', 'pm_acceptance_status', 'storage_location'),
    'unavailable_behavior', 'Artifact Root Unavailable'
  )
)
on conflict (configuration_key) do nothing;

-- ---------------------------------------------------------------------------
-- Immutable artifact identity index. No artifact is created by this migration.
-- ---------------------------------------------------------------------------
create table if not exists public.engineering_artifacts (
  artifact_id text primary key,
  filename text not null default '',
  product_version text not null,
  runtime_build text not null,
  artifact_timestamp timestamptz not null,
  git_commit text not null,
  sha256 text not null,
  artifact_type text not null,
  qa_status text not null,
  pm_acceptance_status text not null,
  storage_location text not null,
  related_task text not null default '',
  lineage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.engineering_artifacts
  add column if not exists filename text not null default '',
  add column if not exists related_task text not null default '',
  add column if not exists lineage jsonb not null default '{}'::jsonb;

-- These records are read through the authenticated Resolver only. Browser
-- table DML is not a write path for checkpoint, baseline, or artifact data.
alter table public.engineering_project_checkpoints enable row level security;
alter table public.engineering_pm_accepted_baselines enable row level security;
alter table public.engineering_project_configuration enable row level security;
alter table public.engineering_artifacts enable row level security;

drop policy if exists engineering_project_checkpoints_select on public.engineering_project_checkpoints;
create policy engineering_project_checkpoints_select
  on public.engineering_project_checkpoints
  for select to authenticated
  using (public.is_engineering_member());

drop policy if exists engineering_pm_accepted_baselines_select on public.engineering_pm_accepted_baselines;
create policy engineering_pm_accepted_baselines_select
  on public.engineering_pm_accepted_baselines
  for select to authenticated
  using (public.is_engineering_member());

drop policy if exists engineering_project_configuration_select on public.engineering_project_configuration;
create policy engineering_project_configuration_select
  on public.engineering_project_configuration
  for select to authenticated
  using (public.is_engineering_member());

drop policy if exists engineering_artifacts_select on public.engineering_artifacts;
create policy engineering_artifacts_select
  on public.engineering_artifacts
  for select to authenticated
  using (public.is_engineering_member());

revoke all on public.engineering_project_checkpoints from anon, authenticated;
revoke all on public.engineering_pm_accepted_baselines from anon, authenticated;
revoke all on public.engineering_project_configuration from anon, authenticated;
revoke all on public.engineering_artifacts from anon, authenticated;
revoke insert, update, delete on public.engineering_artifacts from service_role;
grant select on public.engineering_project_checkpoints to authenticated;
grant select on public.engineering_pm_accepted_baselines to authenticated;
grant select on public.engineering_project_configuration to authenticated;
grant select on public.engineering_artifacts to authenticated;

-- ---------------------------------------------------------------------------
-- Canonical Current Resolver
-- ---------------------------------------------------------------------------
create or replace function public.resolve_current_engineering_memory(
  p_knowledge_codes text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.is_engineering_member() then
    raise exception using errcode = '42501', message = 'Authenticated Engineering Member is required';
  end if;

  with requested_codes as (
    select distinct upper(trim(code)) as code
    from unnest(coalesce(p_knowledge_codes, array[]::text[])) as input(code)
    where length(trim(code)) > 0
    union
    select distinct upper(trim(knowledge_code)) as code
    from public.engineering_knowledge
    where p_knowledge_codes is null
      and lower(trim(coalesce(status, ''))) = 'approved'
      and length(trim(coalesce(knowledge_code, ''))) > 0
  ),
  grouped as (
    select
      requested.code,
      count(knowledge.knowledge_code)::integer as candidate_count,
      (array_agg(knowledge.knowledge_type))[1] as knowledge_type,
      (array_agg(knowledge.title))[1] as title,
      (array_agg(knowledge.summary))[1] as summary,
      (array_agg(knowledge.content))[1] as content,
      (array_agg(knowledge.version))[1] as version,
      (array_agg(knowledge.updated_at))[1] as updated_at
    from requested_codes requested
    left join public.engineering_knowledge knowledge
      on upper(trim(knowledge.knowledge_code)) = requested.code
     and lower(trim(coalesce(knowledge.status, ''))) = 'approved'
    group by requested.code
  )
  select jsonb_build_object(
    'source', 'public.engineering_knowledge',
    'current_rule', 'status = approved; one approved current record per knowledge_code',
    'records', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'knowledge_code', code,
          'knowledge_type', knowledge_type,
          'title', title,
          'summary', summary,
          'content', content,
          'version', version,
          'updated_at', updated_at
        ) order by code
      )
      from grouped
      where candidate_count = 1
    ), '[]'::jsonb),
    'failures', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'knowledge_code', code,
          'reason', case when candidate_count > 1
            then 'Canonical Conflict / Need PM Decision'
            else 'Canonical Retrieval Failed'
          end,
          'candidate_count', candidate_count
        ) order by code
      )
      from grouped
      where candidate_count <> 1
    ), '[]'::jsonb),
    'status', case when exists (select 1 from grouped where candidate_count <> 1)
      then 'failed' else 'ready' end
  ) into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Startup Gate Projection
-- ---------------------------------------------------------------------------
create or replace function public.resolve_engineering_startup_gate(
  p_knowledge_codes text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  principles jsonb;
  checkpoint jsonb;
  baseline jsonb;
  artifact_rule jsonb;
  artifact_records jsonb;
begin
  if auth.uid() is null or not public.is_engineering_member() then
    raise exception using errcode = '42501', message = 'Authenticated Engineering Member is required';
  end if;

  principles := public.resolve_current_engineering_memory(p_knowledge_codes);

  select to_jsonb(row_data) - 'updated_by'
    into checkpoint
  from (
    select *
    from public.engineering_project_checkpoints
    where checkpoint_key = 'current'
    limit 1
  ) as row_data;

  select to_jsonb(row_data) - 'accepted_by' - 'updated_by'
    into baseline
  from (
    select *
    from public.engineering_pm_accepted_baselines
    where baseline_key = 'current'
      and lower(trim(coalesce(pm_acceptance_status, ''))) = 'accepted'
    limit 1
  ) as row_data;

  select configuration_value
    into artifact_rule
  from public.engineering_project_configuration
  where configuration_key = 'artifact_rule'
    and is_active = true
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by artifact_timestamp desc), '[]'::jsonb)
    into artifact_records
  from (
    select *
    from public.engineering_artifacts
    order by artifact_timestamp desc
    limit 1
  ) as row_data;

  return jsonb_build_object(
    'principles', coalesce(principles, jsonb_build_object(
      'source', 'public.engineering_knowledge',
      'status', 'failed',
      'records', '[]'::jsonb,
      'failures', jsonb_build_array(jsonb_build_object('reason', 'Canonical Retrieval Failed'))
    )),
    'checkpoint', coalesce(checkpoint, 'null'::jsonb),
    'pm_accepted_baseline', coalesce(baseline, 'null'::jsonb),
    'artifact_rule', coalesce(artifact_rule, 'null'::jsonb),
    'artifact_records', artifact_records
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Controlled project-state write paths
-- ---------------------------------------------------------------------------
create or replace function public.write_engineering_checkpoint(p_checkpoint jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  checkpoint jsonb := coalesce(p_checkpoint, '{}'::jsonb);
  saved_checkpoint public.engineering_project_checkpoints;
  saved jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
    raise exception using errcode = '42501', message = 'QJC or controlled service path is required';
  end if;
  if coalesce(checkpoint->>'checkpoint_key', 'current') <> 'current' then
    raise exception using errcode = '22023', message = 'Only the current project checkpoint is writable';
  end if;

  insert into public.engineering_project_checkpoints (
    checkpoint_key, current_task, current_stage, completed, pending,
    files_changed, cloud_changes, qa_status, blocking, next_action,
    branch, git_commit, working_tree_state, updated_at, updated_by
  ) values (
    'current', nullif(trim(checkpoint->>'current_task'), ''), nullif(trim(checkpoint->>'current_stage'), ''),
    coalesce(checkpoint->'completed', '[]'::jsonb), coalesce(checkpoint->'pending', '[]'::jsonb),
    coalesce(checkpoint->'files_changed', '[]'::jsonb), coalesce(checkpoint->'cloud_changes', '[]'::jsonb),
    nullif(trim(checkpoint->>'qa_status'), ''), coalesce(checkpoint->'blocking', '[]'::jsonb),
    nullif(trim(checkpoint->>'next_action'), ''), nullif(trim(checkpoint->>'branch'), ''),
    nullif(trim(checkpoint->>'git_commit'), ''), nullif(trim(checkpoint->>'working_tree_state'), ''),
    now(), auth.uid()
  )
  on conflict (checkpoint_key) do update set
    current_task = excluded.current_task,
    current_stage = excluded.current_stage,
    completed = excluded.completed,
    pending = excluded.pending,
    files_changed = excluded.files_changed,
    cloud_changes = excluded.cloud_changes,
    qa_status = excluded.qa_status,
    blocking = excluded.blocking,
    next_action = excluded.next_action,
    branch = excluded.branch,
    git_commit = excluded.git_commit,
    working_tree_state = excluded.working_tree_state,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into saved_checkpoint;

  saved := to_jsonb(saved_checkpoint) - 'updated_by';

  return saved;
end;
$$;

create or replace function public.set_engineering_pm_accepted_baseline(p_baseline jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  baseline jsonb := coalesce(p_baseline, '{}'::jsonb);
  saved_baseline public.engineering_pm_accepted_baselines;
  saved jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
    raise exception using errcode = '42501', message = 'QJC PM acceptance is required';
  end if;
  if lower(trim(coalesce(baseline->>'pm_acceptance_status', ''))) <> 'accepted' then
    raise exception using errcode = '22023', message = 'Only explicit PM accepted status can create the current baseline';
  end if;

  insert into public.engineering_pm_accepted_baselines (
    baseline_key, product_version, runtime_build, git_commit, artifact_reference,
    pm_accepted_at, pm_acceptance_status, notes, accepted_by, updated_at
  ) values (
    'current', nullif(trim(baseline->>'product_version'), ''), nullif(trim(baseline->>'runtime_build'), ''),
    nullif(trim(baseline->>'git_commit'), ''), nullif(trim(baseline->>'artifact_reference'), ''),
    coalesce(nullif(trim(baseline->>'pm_accepted_at'), '')::timestamptz, now()), 'accepted',
    nullif(trim(baseline->>'notes'), ''), auth.uid(), now()
  )
  on conflict (baseline_key) do update set
    product_version = excluded.product_version,
    runtime_build = excluded.runtime_build,
    git_commit = excluded.git_commit,
    artifact_reference = excluded.artifact_reference,
    pm_accepted_at = excluded.pm_accepted_at,
    pm_acceptance_status = 'accepted',
    notes = excluded.notes,
    accepted_by = auth.uid(),
    updated_at = now()
  returning * into saved_baseline;

  saved := to_jsonb(saved_baseline) - 'accepted_by' - 'updated_by';

  return saved;
end;
$$;

create or replace function public.register_engineering_artifact(p_artifact jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  artifact jsonb := coalesce(p_artifact, '{}'::jsonb);
  root text;
  saved_artifact public.engineering_artifacts;
  saved jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and (auth.uid() is null or not public.is_engineering_member(array['owner'])) then
    raise exception using errcode = '42501', message = 'QJC or controlled service path is required';
  end if;

  select configuration_value->>'artifact_root'
    into root
  from public.engineering_project_configuration
  where configuration_key = 'artifact_rule' and is_active = true
  limit 1;

  if nullif(trim(coalesce(root, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'Artifact Root Unavailable';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(artifact) as keys(name)
    where name not in (
      'artifact_id', 'filename', 'product_version', 'runtime_build',
      'artifact_timestamp', 'git_commit', 'sha256', 'artifact_type',
      'qa_status', 'pm_acceptance_status', 'storage_location',
      'related_task', 'lineage'
    )
  ) then
    raise exception using errcode = '22023', message = 'Artifact metadata field is not allowlisted';
  end if;
  if nullif(trim(coalesce(artifact->>'artifact_id', '')), '') is null
     or nullif(trim(coalesce(artifact->>'filename', '')), '') is null
     or nullif(trim(coalesce(artifact->>'product_version', '')), '') is null
     or nullif(trim(coalesce(artifact->>'runtime_build', '')), '') is null
     or nullif(trim(coalesce(artifact->>'artifact_timestamp', '')), '') is null
     or nullif(trim(coalesce(artifact->>'git_commit', '')), '') is null
     or nullif(trim(coalesce(artifact->>'sha256', '')), '') is null
     or nullif(trim(coalesce(artifact->>'artifact_type', '')), '') is null
     or nullif(trim(coalesce(artifact->>'qa_status', '')), '') is null
     or nullif(trim(coalesce(artifact->>'pm_acceptance_status', '')), '') is null
     or nullif(trim(coalesce(artifact->>'storage_location', '')), '') is null
     or nullif(trim(coalesce(artifact->>'related_task', '')), '') is null
     or jsonb_typeof(artifact->'lineage') <> 'object'
     or not (artifact->>'sha256' ~* '^[0-9a-f]{64}$')
     or not (
       artifact->>'storage_location' = root
       or position(root || '/' in artifact->>'storage_location') = 1
     ) then
    raise exception using errcode = '22023', message = 'Artifact identity or canonical storage location is invalid';
  end if;
  if exists (select 1 from public.engineering_artifacts where artifact_id = artifact->>'artifact_id') then
    raise exception using errcode = '23505', message = 'Artifact identity is immutable and already exists';
  end if;

  insert into public.engineering_artifacts (
    artifact_id, filename, product_version, runtime_build, artifact_timestamp,
    git_commit, sha256, artifact_type, qa_status, pm_acceptance_status,
    storage_location, related_task, lineage, created_at, created_by
  ) values (
    trim(artifact->>'artifact_id'), trim(artifact->>'filename'), trim(artifact->>'product_version'), trim(artifact->>'runtime_build'),
    (artifact->>'artifact_timestamp')::timestamptz, trim(artifact->>'git_commit'),
    lower(trim(artifact->>'sha256')), trim(artifact->>'artifact_type'), trim(artifact->>'qa_status'),
    trim(artifact->>'pm_acceptance_status'), trim(artifact->>'storage_location'),
    trim(artifact->>'related_task'), artifact->'lineage', now(), auth.uid()
  )
  returning * into saved_artifact;

  saved := to_jsonb(saved_artifact) - 'created_by';

  return saved;
end;
$$;

revoke execute on function public.resolve_current_engineering_memory(text[]) from public, anon;
revoke execute on function public.resolve_engineering_startup_gate(text[]) from public, anon;
revoke execute on function public.write_engineering_checkpoint(jsonb) from public, anon;
revoke execute on function public.set_engineering_pm_accepted_baseline(jsonb) from public, anon;
revoke execute on function public.register_engineering_artifact(jsonb) from public, anon;
grant execute on function public.resolve_current_engineering_memory(text[]) to authenticated;
grant execute on function public.resolve_engineering_startup_gate(text[]) to authenticated;
grant execute on function public.write_engineering_checkpoint(jsonb) to authenticated;
grant execute on function public.set_engineering_pm_accepted_baseline(jsonb) to authenticated;
grant execute on function public.register_engineering_artifact(jsonb) to authenticated;

commit;
