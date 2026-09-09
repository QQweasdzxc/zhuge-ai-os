-- Module C Workflow Capability v2
--
-- Additive foundation for per-Board-Instance workflow definitions.
-- Module C owns the capability; each Board Instance owns its immutable
-- published versions and its card bindings.  This migration intentionally
-- does not backfill or mutate existing Board/Card rows.

begin;

create table if not exists public.board_workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  board_instance_id uuid not null references public.board_instances(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  name text not null check (length(btrim(name)) > 0),
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  based_on_workflow_version_id uuid references public.board_workflow_definitions(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  retired_at timestamptz,
  unique (board_instance_id, version_no)
);

create unique index if not exists board_workflow_one_draft_per_instance_idx
  on public.board_workflow_definitions (board_instance_id)
  where status = 'draft';

create unique index if not exists board_workflow_one_published_per_instance_idx
  on public.board_workflow_definitions (board_instance_id)
  where status = 'published';

create table if not exists public.board_instance_workflow_state (
  board_instance_id uuid primary key references public.board_instances(id) on delete restrict,
  draft_workflow_version_id uuid references public.board_workflow_definitions(id) on delete restrict,
  published_workflow_version_id uuid references public.board_workflow_definitions(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.board_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.board_workflow_definitions(id) on delete cascade,
  step_key text not null check (step_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text not null check (length(btrim(name)) > 0),
  sort_order integer not null check (sort_order >= 0),
  role_key text not null check (role_key in ('co', 'gpt', 'qjc', 'pm')),
  workspace_id uuid not null references public.board_workspaces(id) on delete restrict,
  status_key text not null default 'inprogress' check (status_key in ('ready', 'inprogress', 'qa', 'done')),
  is_initial boolean not null default false,
  is_completion boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_version_id, step_key),
  unique (workflow_version_id, sort_order),
  unique (workflow_version_id, workspace_id)
);

create unique index if not exists board_workflow_one_initial_step_idx
  on public.board_workflow_steps (workflow_version_id)
  where is_initial;

create unique index if not exists board_workflow_one_completion_step_idx
  on public.board_workflow_steps (workflow_version_id)
  where is_completion;

create table if not exists public.board_workflow_transitions (
  id uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.board_workflow_definitions(id) on delete cascade,
  transition_key text not null check (transition_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  from_step_id uuid not null references public.board_workflow_steps(id) on delete cascade,
  to_step_id uuid not null references public.board_workflow_steps(id) on delete cascade,
  allowed_roles text[] not null default array['pm']::text[],
  requires_gate boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_version_id, transition_key),
  check (cardinality(allowed_roles) > 0),
  check (allowed_roles <@ array['co', 'gpt', 'qjc', 'pm']::text[])
);

create table if not exists public.board_workflow_gates (
  id uuid primary key default gen_random_uuid(),
  workflow_version_id uuid not null references public.board_workflow_definitions(id) on delete cascade,
  step_id uuid not null references public.board_workflow_steps(id) on delete cascade,
  gate_key text not null check (gate_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text not null check (length(btrim(name)) > 0),
  required boolean not null default true,
  human_action_required boolean not null default false,
  completion_role text not null default 'pm' check (completion_role in ('co', 'gpt', 'qjc', 'pm')),
  failure_policy text not null default 'stay' check (failure_policy in ('stay', 'reopen')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_version_id, gate_key)
);

create table if not exists public.board_workflow_evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  gate_id uuid not null references public.board_workflow_gates(id) on delete cascade,
  evidence_key text not null check (evidence_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  label text not null check (length(btrim(label)) > 0),
  required boolean not null default true,
  source_kind text not null check (source_kind in ('pm_action_context', 'checklist', 'cloud_readback', 'artifact', 'runtime_action')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gate_id, evidence_key)
);

create table if not exists public.board_workflow_adoptions (
  id uuid primary key default gen_random_uuid(),
  board_instance_id uuid not null references public.board_instances(id) on delete restrict,
  from_workflow_version_id uuid references public.board_workflow_definitions(id) on delete restrict,
  to_workflow_version_id uuid not null references public.board_workflow_definitions(id) on delete restrict,
  status text not null default 'requested' check (status in ('requested', 'approved', 'applied', 'rejected', 'needs_pm_classification')),
  note text,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  applied_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_workflow_step_mappings (
  id uuid primary key default gen_random_uuid(),
  adoption_id uuid not null references public.board_workflow_adoptions(id) on delete cascade,
  from_step_id uuid not null references public.board_workflow_steps(id) on delete restrict,
  to_step_id uuid not null references public.board_workflow_steps(id) on delete restrict,
  mapping_status text not null default 'mapped' check (mapping_status in ('mapped', 'needs_pm_classification', 'rejected')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adoption_id, from_step_id),
  unique (adoption_id, to_step_id)
);

alter table public.board_tasks
  add column if not exists workflow_version_id uuid references public.board_workflow_definitions(id) on delete restrict,
  add column if not exists current_workflow_step_id uuid references public.board_workflow_steps(id) on delete restrict;

create index if not exists board_tasks_workflow_version_idx
  on public.board_tasks (workflow_version_id, current_workflow_step_id);

create table if not exists private.board_workflow_action_idempotency (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  action_type text not null,
  board_instance_id uuid not null,
  task_id uuid,
  request_hash text not null,
  response jsonb not null,
  status text not null check (status in ('completed', 'rejected')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

alter table public.board_workflow_definitions enable row level security;
alter table public.board_instance_workflow_state enable row level security;
alter table public.board_workflow_steps enable row level security;
alter table public.board_workflow_transitions enable row level security;
alter table public.board_workflow_gates enable row level security;
alter table public.board_workflow_evidence_requirements enable row level security;
alter table public.board_workflow_adoptions enable row level security;
alter table public.board_workflow_step_mappings enable row level security;
alter table private.board_workflow_action_idempotency enable row level security;

revoke all on public.board_workflow_definitions from public, anon;
revoke all on public.board_instance_workflow_state from public, anon;
revoke all on public.board_workflow_steps from public, anon;
revoke all on public.board_workflow_transitions from public, anon;
revoke all on public.board_workflow_gates from public, anon;
revoke all on public.board_workflow_evidence_requirements from public, anon;
revoke all on public.board_workflow_adoptions from public, anon;
revoke all on public.board_workflow_step_mappings from public, anon;
revoke all on private.board_workflow_action_idempotency from public, anon, authenticated;

grant select on public.board_workflow_definitions to authenticated;
grant select on public.board_instance_workflow_state to authenticated;
grant select on public.board_workflow_steps to authenticated;
grant select on public.board_workflow_transitions to authenticated;
grant select on public.board_workflow_gates to authenticated;
grant select on public.board_workflow_evidence_requirements to authenticated;
grant select on public.board_workflow_adoptions to authenticated;
grant select on public.board_workflow_step_mappings to authenticated;

drop policy if exists board_workflow_definitions_read on public.board_workflow_definitions;
create policy board_workflow_definitions_read
  on public.board_workflow_definitions for select to authenticated
  using (public.board_instance_can_read(board_instance_id));

drop policy if exists board_instance_workflow_state_read on public.board_instance_workflow_state;
create policy board_instance_workflow_state_read
  on public.board_instance_workflow_state for select to authenticated
  using (public.board_instance_can_read(board_instance_id));

drop policy if exists board_workflow_steps_read on public.board_workflow_steps;
create policy board_workflow_steps_read
  on public.board_workflow_steps for select to authenticated
  using (exists (select 1 from public.board_workflow_definitions d where d.id = workflow_version_id and public.board_instance_can_read(d.board_instance_id)));

drop policy if exists board_workflow_transitions_read on public.board_workflow_transitions;
create policy board_workflow_transitions_read
  on public.board_workflow_transitions for select to authenticated
  using (exists (select 1 from public.board_workflow_definitions d where d.id = workflow_version_id and public.board_instance_can_read(d.board_instance_id)));

drop policy if exists board_workflow_gates_read on public.board_workflow_gates;
create policy board_workflow_gates_read
  on public.board_workflow_gates for select to authenticated
  using (exists (select 1 from public.board_workflow_definitions d where d.id = workflow_version_id and public.board_instance_can_read(d.board_instance_id)));

drop policy if exists board_workflow_evidence_requirements_read on public.board_workflow_evidence_requirements;
create policy board_workflow_evidence_requirements_read
  on public.board_workflow_evidence_requirements for select to authenticated
  using (exists (
    select 1
    from public.board_workflow_gates g
    join public.board_workflow_definitions d on d.id = g.workflow_version_id
    where g.id = gate_id and public.board_instance_can_read(d.board_instance_id)
  ));

drop policy if exists board_workflow_adoptions_read on public.board_workflow_adoptions;
create policy board_workflow_adoptions_read
  on public.board_workflow_adoptions for select to authenticated
  using (public.board_instance_can_read(board_instance_id));

drop policy if exists board_workflow_step_mappings_read on public.board_workflow_step_mappings;
create policy board_workflow_step_mappings_read
  on public.board_workflow_step_mappings for select to authenticated
  using (exists (
    select 1 from public.board_workflow_adoptions a
    where a.id = adoption_id and public.board_instance_can_read(a.board_instance_id)
  ));

create or replace function private.board_workflow_role_label(p_role_key text)
returns text
language sql
immutable
set search_path = public, private, pg_temp
as $function$
  select case lower(coalesce(p_role_key, ''))
    when 'co' then 'Co'
    when 'gpt' then 'GPT'
    when 'qjc' then 'QJC'
    when 'pm' then 'PM'
    else ''
  end;
$function$;

create or replace function private.board_workflow_snapshot(p_workflow_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_definition public.board_workflow_definitions%rowtype;
begin
  if p_workflow_version_id is null then
    return null;
  end if;
  select * into v_definition
  from public.board_workflow_definitions
  where id = p_workflow_version_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_definition.id,
    'board_instance_id', v_definition.board_instance_id,
    'version_no', v_definition.version_no,
    'name', v_definition.name,
    'description', v_definition.description,
    'status', v_definition.status,
    'based_on_workflow_version_id', v_definition.based_on_workflow_version_id,
    'created_by', v_definition.created_by,
    'published_by', v_definition.published_by,
    'created_at', v_definition.created_at,
    'updated_at', v_definition.updated_at,
    'published_at', v_definition.published_at,
    'retired_at', v_definition.retired_at,
    'steps', coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order) from public.board_workflow_steps s where s.workflow_version_id = v_definition.id), '[]'::jsonb),
    'transitions', coalesce((select jsonb_agg(to_jsonb(t) order by t.transition_key) from public.board_workflow_transitions t where t.workflow_version_id = v_definition.id), '[]'::jsonb),
    'gates', coalesce((select jsonb_agg(to_jsonb(g) order by g.sort_order, g.gate_key) from public.board_workflow_gates g where g.workflow_version_id = v_definition.id), '[]'::jsonb),
    'evidence_requirements', coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order, e.evidence_key) from public.board_workflow_evidence_requirements e join public.board_workflow_gates g on g.id = e.gate_id where g.workflow_version_id = v_definition.id), '[]'::jsonb)
  );
end;
$function$;

create or replace function private.board_workflow_validate(p_workflow_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_definition public.board_workflow_definitions%rowtype;
  v_errors text[] := array[]::text[];
begin
  select * into v_definition from public.board_workflow_definitions where id = p_workflow_version_id;
  if not found then
    return jsonb_build_object('valid', false, 'errors', jsonb_build_array('找不到流程版本。'), 'warnings', '[]'::jsonb);
  end if;
  if not exists (select 1 from public.board_workflow_steps where workflow_version_id = p_workflow_version_id) then
    v_errors := array_append(v_errors, '流程至少需要一個工作階段。');
  end if;
  if (select count(*) from public.board_workflow_steps where workflow_version_id = p_workflow_version_id and is_initial) <> 1 then
    v_errors := array_append(v_errors, '流程必須有且只有一個起始階段。');
  end if;
  if (select count(*) from public.board_workflow_steps where workflow_version_id = p_workflow_version_id and is_completion) <> 1 then
    v_errors := array_append(v_errors, '流程必須有且只有一個完成階段。');
  end if;
  if exists (
    select 1
    from public.board_workflow_steps s
    left join public.board_workspaces w on w.id = s.workspace_id
    where s.workflow_version_id = p_workflow_version_id
      and (w.id is null or w.board_instance_id <> v_definition.board_instance_id or w.active is not true or w.archived_at is not null)
  ) then
    v_errors := array_append(v_errors, '每個階段必須對應同一子板內的啟用工作區。');
  end if;
  if exists (
    select 1 from public.board_workflow_transitions t
    left join public.board_workflow_steps f on f.id = t.from_step_id
    left join public.board_workflow_steps n on n.id = t.to_step_id
    where t.workflow_version_id = p_workflow_version_id
      and (f.workflow_version_id <> p_workflow_version_id or n.workflow_version_id <> p_workflow_version_id)
  ) then
    v_errors := array_append(v_errors, '流程轉換只能連接同一版本內的階段。');
  end if;
  if exists (
    select 1 from public.board_workflow_gates g
    left join public.board_workflow_steps s on s.id = g.step_id
    where g.workflow_version_id = p_workflow_version_id and s.workflow_version_id <> p_workflow_version_id
  ) then
    v_errors := array_append(v_errors, 'Gate 必須連接同一版本內的階段。');
  end if;
  if exists (
    select 1 from public.board_workflow_evidence_requirements e
    left join public.board_workflow_gates g on g.id = e.gate_id
    where g.id is null or g.workflow_version_id <> p_workflow_version_id
  ) then
    v_errors := array_append(v_errors, 'Evidence 必須連接同一版本內的 Gate。');
  end if;
  return jsonb_build_object(
    'valid', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors),
    'warnings', case when v_definition.status = 'draft' and not exists (select 1 from public.board_workflow_transitions where workflow_version_id = p_workflow_version_id) then jsonb_build_array('尚未設定流程轉換；發布前必須補齊。') else '[]'::jsonb end
  );
end;
$function$;

create or replace function public.board_c_workflow_get(
  p_board_instance_id uuid,
  p_include_draft boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_state public.board_instance_workflow_state%rowtype;
  v_instance public.board_instances%rowtype;
  v_draft jsonb;
  v_published jsonb;
  v_has_state boolean := false;
begin
  if auth.uid() is null or not public.board_instance_can_read(p_board_instance_id) then
    raise exception using errcode = '42501', message = '沒有讀取此子板流程設定的權限。';
  end if;
  select * into v_instance from public.board_instances where id = p_board_instance_id and active;
  if not found then raise exception using errcode = 'P0002', message = '找不到啟用中的子板。'; end if;
  select * into v_state from public.board_instance_workflow_state where board_instance_id = p_board_instance_id;
  v_has_state := found;
  if v_state.draft_workflow_version_id is not null and (p_include_draft and public.board_instance_can_write(p_board_instance_id)) then
    v_draft := private.board_workflow_snapshot(v_state.draft_workflow_version_id);
  end if;
  if v_state.published_workflow_version_id is not null then
    v_published := private.board_workflow_snapshot(v_state.published_workflow_version_id);
  end if;
  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'board_instance_id', p_board_instance_id,
    'board_name', v_instance.name,
    'draft', v_draft,
    'published', v_published,
    'state', case when v_has_state then jsonb_build_object('draft_workflow_version_id', v_state.draft_workflow_version_id, 'published_workflow_version_id', v_state.published_workflow_version_id, 'updated_at', v_state.updated_at) else null end
  );
end;
$function$;

create or replace function public.board_c_workflow_save_draft(
  p_board_instance_id uuid,
  p_name text,
  p_description text default null,
  p_steps jsonb default '[]'::jsonb,
  p_transitions jsonb default '[]'::jsonb,
  p_gates jsonb default '[]'::jsonb,
  p_evidence_requirements jsonb default '[]'::jsonb,
  p_expected_draft_version_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_draft public.board_workflow_definitions%rowtype;
  v_state public.board_instance_workflow_state%rowtype;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_hash text := md5(concat_ws('|', p_board_instance_id::text, coalesce(p_name, ''), coalesce(p_description, ''), p_steps::text, p_transitions::text, p_gates::text, p_evidence_requirements::text, coalesce(p_expected_draft_version_id::text, '')));
  v_step jsonb;
  v_transition jsonb;
  v_gate jsonb;
  v_evidence jsonb;
  v_workspace_id uuid;
  v_step_id uuid;
  v_gate_id uuid;
  v_version_no integer;
  v_validation jsonb;
  v_response jsonb;
begin
  if auth.uid() is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = '只有子板 Owner／授權管理者可以修改流程設定。';
  end if;
  if p_idempotency_key is not null then
    select * into v_existing from private.board_workflow_action_idempotency where idempotency_key = p_idempotency_key and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then raise exception using errcode = '40001', message = '流程設定請求的 Idempotency Key 已用於不同內容。'; end if;
      return v_existing.response;
    end if;
  end if;
  select * into v_instance from public.board_instances where id = p_board_instance_id and active for update;
  if not found then raise exception using errcode = 'P0002', message = '找不到啟用中的子板。'; end if;
  select * into v_state from public.board_instance_workflow_state where board_instance_id = p_board_instance_id for update;
  if v_state.draft_workflow_version_id is not null then
    select * into v_draft from public.board_workflow_definitions where id = v_state.draft_workflow_version_id for update;
    if p_expected_draft_version_id is not null and v_draft.id <> p_expected_draft_version_id then raise exception using errcode = '40001', message = '流程設定已被其他工作階段更新，請重新載入後再儲存。'; end if;
  else
    if p_expected_draft_version_id is not null then raise exception using errcode = '40001', message = '目前沒有符合預期的流程草稿版本。'; end if;
    select coalesce(max(version_no), 0) + 1 into v_version_no from public.board_workflow_definitions where board_instance_id = p_board_instance_id;
    insert into public.board_workflow_definitions (board_instance_id, version_no, name, description, status, created_by)
    values (p_board_instance_id, v_version_no, nullif(btrim(p_name), ''), nullif(btrim(p_description), ''), 'draft', auth.uid())
    returning * into v_draft;
  end if;
  if v_draft.status <> 'draft' then raise exception using errcode = '55000', message = '只有草稿流程可以修改。'; end if;
  update public.board_workflow_definitions set name = nullif(btrim(p_name), ''), description = nullif(btrim(p_description), ''), updated_at = now() where id = v_draft.id returning * into v_draft;
  delete from public.board_workflow_steps where workflow_version_id = v_draft.id;
  if jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) <> 'array' then raise exception using errcode = '22023', message = '流程階段格式不正確。'; end if;
  for v_step in select value from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    v_workspace_id := (v_step->>'workspace_id')::uuid;
    if not exists (select 1 from public.board_workspaces where id = v_workspace_id and board_instance_id = p_board_instance_id and active and archived_at is null) then raise exception using errcode = '22023', message = '流程階段只能使用此子板內的啟用工作區。'; end if;
    insert into public.board_workflow_steps (workflow_version_id, step_key, name, sort_order, role_key, workspace_id, status_key, is_initial, is_completion)
    values (v_draft.id, lower(btrim(v_step->>'step_key')), btrim(v_step->>'name'), (v_step->>'sort_order')::integer, lower(btrim(v_step->>'role_key')), v_workspace_id, lower(coalesce(nullif(btrim(v_step->>'status_key'), ''), 'inprogress')), coalesce((v_step->>'is_initial')::boolean, false), coalesce((v_step->>'is_completion')::boolean, false));
  end loop;
  if jsonb_typeof(coalesce(p_transitions, '[]'::jsonb)) <> 'array' then raise exception using errcode = '22023', message = '流程轉換格式不正確。'; end if;
  for v_transition in select value from jsonb_array_elements(coalesce(p_transitions, '[]'::jsonb)) loop
    select id into v_step_id from public.board_workflow_steps where workflow_version_id = v_draft.id and step_key = lower(btrim(v_transition->>'from_step_key'));
    if v_step_id is null then raise exception using errcode = '22023', message = '流程轉換找不到來源階段。'; end if;
    insert into public.board_workflow_transitions (workflow_version_id, transition_key, from_step_id, to_step_id, allowed_roles, requires_gate)
    select v_draft.id, lower(btrim(v_transition->>'transition_key')), v_step_id, id, coalesce((select array_agg(lower(value::text)) from jsonb_array_elements_text(coalesce(v_transition->'allowed_roles', '["pm"]'::jsonb)) value), array['pm']::text[]), coalesce((v_transition->>'requires_gate')::boolean, false)
    from public.board_workflow_steps where workflow_version_id = v_draft.id and step_key = lower(btrim(v_transition->>'to_step_key'));
    if not found then raise exception using errcode = '22023', message = '流程轉換找不到目標階段。'; end if;
  end loop;
  if jsonb_typeof(coalesce(p_gates, '[]'::jsonb)) <> 'array' then raise exception using errcode = '22023', message = 'Gate 格式不正確。'; end if;
  for v_gate in select value from jsonb_array_elements(coalesce(p_gates, '[]'::jsonb)) loop
    select id into v_step_id from public.board_workflow_steps where workflow_version_id = v_draft.id and step_key = lower(btrim(v_gate->>'step_key'));
    if v_step_id is null then raise exception using errcode = '22023', message = 'Gate 找不到對應階段。'; end if;
    insert into public.board_workflow_gates (workflow_version_id, step_id, gate_key, name, required, human_action_required, completion_role, failure_policy, sort_order)
    values (v_draft.id, v_step_id, lower(btrim(v_gate->>'gate_key')), btrim(v_gate->>'name'), coalesce((v_gate->>'required')::boolean, true), coalesce((v_gate->>'human_action_required')::boolean, false), lower(coalesce(nullif(btrim(v_gate->>'completion_role'), ''), 'pm')), lower(coalesce(nullif(btrim(v_gate->>'failure_policy'), ''), 'stay')), coalesce((v_gate->>'sort_order')::integer, 0));
  end loop;
  if jsonb_typeof(coalesce(p_evidence_requirements, '[]'::jsonb)) <> 'array' then raise exception using errcode = '22023', message = 'Evidence 格式不正確。'; end if;
  for v_evidence in select value from jsonb_array_elements(coalesce(p_evidence_requirements, '[]'::jsonb)) loop
    select id into v_gate_id from public.board_workflow_gates where workflow_version_id = v_draft.id and gate_key = lower(btrim(v_evidence->>'gate_key'));
    if v_gate_id is null then raise exception using errcode = '22023', message = 'Evidence 找不到對應 Gate。'; end if;
    insert into public.board_workflow_evidence_requirements (gate_id, evidence_key, label, required, source_kind, sort_order)
    values (v_gate_id, lower(btrim(v_evidence->>'evidence_key')), btrim(v_evidence->>'label'), coalesce((v_evidence->>'required')::boolean, true), lower(btrim(v_evidence->>'source_kind')), coalesce((v_evidence->>'sort_order')::integer, 0));
  end loop;
  insert into public.board_instance_workflow_state (board_instance_id, draft_workflow_version_id, updated_by)
  values (p_board_instance_id, v_draft.id, auth.uid())
  on conflict (board_instance_id) do update set draft_workflow_version_id = excluded.draft_workflow_version_id, updated_by = excluded.updated_by, updated_at = now();
  v_validation := private.board_workflow_validate(v_draft.id);
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'save-draft', 'board_instance_id', p_board_instance_id, 'workflow', private.board_workflow_snapshot(v_draft.id), 'validation', v_validation);
  insert into public.engineering_activity_log (entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label, activity_type)
  values ('board_workflow_definition', v_draft.id::text, 'workflow_draft_saved', v_response, 'C Mother workflow draft saved', auth.uid(), 'human', 'PM', 'system_activity');
  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (idempotency_key, action_type, board_instance_id, request_hash, response, status)
    values (p_idempotency_key, 'save_draft', p_board_instance_id, v_hash, v_response, 'completed');
  end if;
  return v_response;
end;
$function$;

create or replace function public.board_c_workflow_validate_draft(p_workflow_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_board_instance_id uuid;
begin
  select board_instance_id into v_board_instance_id from public.board_workflow_definitions where id = p_workflow_version_id;
  if v_board_instance_id is null or not public.board_instance_can_read(v_board_instance_id) then raise exception using errcode = '42501', message = '沒有驗證此流程草稿的權限。'; end if;
  return jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'workflow_version_id', p_workflow_version_id, 'validation', private.board_workflow_validate(p_workflow_version_id));
end;
$function$;

create or replace function public.board_c_workflow_publish(
  p_workflow_version_id uuid,
  p_expected_published_version_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_definition public.board_workflow_definitions%rowtype;
  v_state public.board_instance_workflow_state%rowtype;
  v_previous uuid;
  v_validation jsonb;
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_workflow_version_id::text, coalesce(p_expected_published_version_id::text, '')));
  v_existing private.board_workflow_action_idempotency%rowtype;
begin
  select * into v_definition from public.board_workflow_definitions where id = p_workflow_version_id for update;
  if not found or not public.board_instance_can_write(v_definition.board_instance_id) then raise exception using errcode = '42501', message = '只有子板 Owner／授權管理者可以發布流程。'; end if;
  if v_definition.status <> 'draft' then raise exception using errcode = '55000', message = '只有流程草稿可以發布；已發布版本不可覆寫。'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from private.board_workflow_action_idempotency where idempotency_key = p_idempotency_key and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then raise exception using errcode = '40001', message = '發布請求的 Idempotency Key 已用於不同內容。'; end if;
      return v_existing.response;
    end if;
  end if;
  select * into v_state from public.board_instance_workflow_state where board_instance_id = v_definition.board_instance_id for update;
  v_previous := v_state.published_workflow_version_id;
  if p_expected_published_version_id is not null and v_previous is distinct from p_expected_published_version_id then raise exception using errcode = '40001', message = '已發布版本已變更，請重新載入後再發布。'; end if;
  v_validation := private.board_workflow_validate(p_workflow_version_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then raise exception using errcode = '22023', message = '流程草稿尚未通過驗證。', detail = v_validation::text; end if;
  if v_previous is not null then update public.board_workflow_definitions set status = 'retired', retired_at = now(), updated_at = now() where id = v_previous and status = 'published'; end if;
  update public.board_workflow_definitions set status = 'published', published_by = auth.uid(), published_at = now(), updated_at = now() where id = p_workflow_version_id returning * into v_definition;
  insert into public.board_instance_workflow_state (board_instance_id, published_workflow_version_id, updated_by)
  values (v_definition.board_instance_id, p_workflow_version_id, auth.uid())
  on conflict (board_instance_id) do update set published_workflow_version_id = excluded.published_workflow_version_id, updated_by = excluded.updated_by, updated_at = now();
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'publish', 'board_instance_id', v_definition.board_instance_id, 'workflow', private.board_workflow_snapshot(p_workflow_version_id), 'previous_published_workflow_version_id', v_previous);
  insert into public.engineering_activity_log (entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label, activity_type)
  values ('board_workflow_definition', v_definition.id::text, 'workflow_published', v_response, 'C Mother workflow published', auth.uid(), 'human', 'PM', 'system_activity');
  if p_idempotency_key is not null then insert into private.board_workflow_action_idempotency (idempotency_key, action_type, board_instance_id, request_hash, response, status) values (p_idempotency_key, 'publish', v_definition.board_instance_id, v_hash, v_response, 'completed'); end if;
  return v_response;
end;
$function$;

create or replace function public.board_c_workflow_request_adoption(
  p_board_instance_id uuid,
  p_to_workflow_version_id uuid,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_from uuid;
  v_to public.board_workflow_definitions%rowtype;
  v_adoption public.board_workflow_adoptions%rowtype;
  v_response jsonb;
begin
  if auth.uid() is null or not public.board_instance_can_write(p_board_instance_id) then raise exception using errcode = '42501', message = '沒有申請流程採用的權限。'; end if;
  select published_workflow_version_id into v_from from public.board_instance_workflow_state where board_instance_id = p_board_instance_id;
  select * into v_to from public.board_workflow_definitions where id = p_to_workflow_version_id and board_instance_id = p_board_instance_id and status = 'published';
  if not found then raise exception using errcode = '22023', message = '目標流程不是此子板的已發布版本。'; end if;
  insert into public.board_workflow_adoptions (board_instance_id, from_workflow_version_id, to_workflow_version_id, note, requested_by)
  values (p_board_instance_id, v_from, p_to_workflow_version_id, nullif(btrim(p_note), ''), auth.uid())
  returning * into v_adoption;
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'request-adoption', 'adoption', to_jsonb(v_adoption));
  insert into public.engineering_activity_log (entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label, activity_type) values ('board_workflow_adoption', v_adoption.id::text, 'workflow_adoption_requested', v_response, 'C Mother workflow adoption requested', auth.uid(), 'human', 'PM', 'system_activity');
  return v_response;
end;
$function$;

create or replace function public.board_c_workflow_approve_adoption(
  p_adoption_id uuid,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_adoption public.board_workflow_adoptions%rowtype;
  v_response jsonb;
begin
  select * into v_adoption from public.board_workflow_adoptions where id = p_adoption_id for update;
  if not found or not public.board_instance_can_write(v_adoption.board_instance_id) then raise exception using errcode = '42501', message = '沒有核准流程採用的權限。'; end if;
  if v_adoption.status <> 'requested' then raise exception using errcode = '55000', message = '只有待核准的流程採用申請可以核准。'; end if;
  update public.board_workflow_adoptions set status = 'approved', note = coalesce(nullif(btrim(p_note), ''), note), approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_adoption_id returning * into v_adoption;
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'approve-adoption', 'adoption', to_jsonb(v_adoption));
  insert into public.engineering_activity_log (entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label, activity_type) values ('board_workflow_adoption', v_adoption.id::text, 'workflow_adoption_approved', v_response, 'C Mother workflow adoption approved', auth.uid(), 'human', 'PM', 'system_activity');
  return v_response;
end;
$function$;

create or replace function public.board_c_workflow_set_step_mapping(
  p_adoption_id uuid,
  p_from_step_id uuid,
  p_to_step_id uuid,
  p_mapping_status text default 'mapped',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_adoption public.board_workflow_adoptions%rowtype;
  v_mapping public.board_workflow_step_mappings%rowtype;
begin
  select * into v_adoption from public.board_workflow_adoptions where id = p_adoption_id;
  if not found or not public.board_instance_can_write(v_adoption.board_instance_id) then raise exception using errcode = '42501', message = '沒有設定流程對應的權限。'; end if;
  if v_adoption.status not in ('requested', 'approved') then raise exception using errcode = '55000', message = '目前流程採用狀態不可設定階段對應。'; end if;
  if p_mapping_status not in ('mapped', 'needs_pm_classification', 'rejected') then raise exception using errcode = '22023', message = '流程對應狀態不正確。'; end if;
  if not exists (select 1 from public.board_workflow_steps where id = p_from_step_id and workflow_version_id = v_adoption.from_workflow_version_id) then raise exception using errcode = '22023', message = '來源階段不屬於原流程版本。'; end if;
  if not exists (select 1 from public.board_workflow_steps where id = p_to_step_id and workflow_version_id = v_adoption.to_workflow_version_id) then raise exception using errcode = '22023', message = '目標階段不屬於新流程版本。'; end if;
  insert into public.board_workflow_step_mappings (adoption_id, from_step_id, to_step_id, mapping_status, note, created_by)
  values (p_adoption_id, p_from_step_id, p_to_step_id, p_mapping_status, nullif(btrim(p_note), ''), auth.uid())
  on conflict (adoption_id, from_step_id) do update set to_step_id = excluded.to_step_id, mapping_status = excluded.mapping_status, note = excluded.note, updated_at = now()
  returning * into v_mapping;
  return jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'set-step-mapping', 'mapping', to_jsonb(v_mapping));
end;
$function$;

create or replace function public.board_c_workflow_apply_card_mapping(
  p_adoption_id uuid,
  p_task_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_adoption public.board_workflow_adoptions%rowtype;
  v_task public.board_tasks%rowtype;
  v_mapping public.board_workflow_step_mappings%rowtype;
  v_before jsonb;
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_adoption_id::text, p_task_id::text));
  v_existing private.board_workflow_action_idempotency%rowtype;
begin
  select * into v_adoption from public.board_workflow_adoptions where id = p_adoption_id;
  if not found or not public.board_instance_can_write(v_adoption.board_instance_id) then raise exception using errcode = '42501', message = '沒有套用流程對應的權限。'; end if;
  if v_adoption.status not in ('approved', 'applied') then raise exception using errcode = '55000', message = '流程對應尚未核准。'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from private.board_workflow_action_idempotency where idempotency_key = p_idempotency_key and expires_at > now();
    if found then if v_existing.request_hash <> v_hash then raise exception using errcode = '40001', message = '流程採用請求的 Idempotency Key 已用於不同內容。'; end if; return v_existing.response; end if;
  end if;
  select * into v_task from public.board_tasks where id = p_task_id and board_instance_id = v_adoption.board_instance_id for update;
  if not found then raise exception using errcode = 'P0002', message = '找不到此子板內的卡片。'; end if;
  if v_task.workflow_version_id is null or v_task.current_workflow_step_id is null then raise exception using errcode = '55000', message = '此卡片缺少目前流程版本／階段，需由 PM 判定後才能套用，未變更卡片。'; end if;
  select * into v_mapping from public.board_workflow_step_mappings where adoption_id = p_adoption_id and from_step_id = v_task.current_workflow_step_id and mapping_status = 'mapped';
  if not found then raise exception using errcode = '55000', message = '此卡片找不到安全的流程階段對應，已標記為待 PM 判定，未變更卡片。'; end if;
  v_before := to_jsonb(v_task);
  update public.board_tasks set workflow_version_id = v_adoption.to_workflow_version_id, current_workflow_step_id = v_mapping.to_step_id, updated_at = now() where id = v_task.id returning * into v_task;
  update public.board_workflow_adoptions set status = 'applied', applied_by = auth.uid(), applied_at = coalesce(applied_at, now()), updated_at = now() where id = p_adoption_id;
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'apply-card-mapping', 'task_id', v_task.id, 'adoption_id', p_adoption_id, 'before', v_before, 'after', to_jsonb(v_task));
  insert into public.engineering_activity_log (entity_type, entity_id, action, before_data, after_data, note, actor_id, actor_type, actor_label, activity_type) values ('board_task', v_task.id::text, 'workflow_card_mapping_applied', v_before, to_jsonb(v_task), 'C workflow adoption applied to one explicitly selected card', auth.uid(), 'human', 'PM', 'system_activity');
  if p_idempotency_key is not null then insert into private.board_workflow_action_idempotency (idempotency_key, action_type, board_instance_id, task_id, request_hash, response, status) values (p_idempotency_key, 'apply_card_mapping', v_adoption.board_instance_id, v_task.id, v_hash, v_response, 'completed'); end if;
  return v_response;
end;
$function$;

create or replace function public.board_c_workflow_resolve_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_step public.board_workflow_steps%rowtype;
begin
  select * into v_task from public.board_tasks where id = p_task_id;
  if not found or not public.board_task_can_read(p_task_id) then raise exception using errcode = '42501', message = '沒有讀取此卡片流程的權限。'; end if;
  if v_task.workflow_version_id is null or v_task.current_workflow_step_id is null then
    return jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'task_id', p_task_id, 'state', 'workflow_not_configured', 'message', '此卡片尚未指定正式流程版本與目前階段，不能由 Runtime 猜測。');
  end if;
  select * into v_definition from public.board_workflow_definitions where id = v_task.workflow_version_id;
  select * into v_step from public.board_workflow_steps where id = v_task.current_workflow_step_id and workflow_version_id = v_task.workflow_version_id;
  if not found or v_definition.id is null then return jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'task_id', p_task_id, 'state', 'workflow_binding_invalid', 'message', '卡片的流程版本／階段對應無效，需人工檢查。'); end if;
  return jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'task_id', p_task_id,
    'state', 'resolved',
    'workflow', private.board_workflow_snapshot(v_definition.id),
    'current_step', to_jsonb(v_step),
    'legal_transitions', coalesce((select jsonb_agg(to_jsonb(t) order by t.transition_key) from public.board_workflow_transitions t where t.workflow_version_id = v_definition.id and t.from_step_id = v_step.id), '[]'::jsonb),
    'gates', coalesce((select jsonb_agg(to_jsonb(g) order by g.sort_order, g.gate_key) from public.board_workflow_gates g where g.workflow_version_id = v_definition.id and g.step_id = v_step.id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.board_c_reconcile_workspace_decision_v2(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_decision_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_before jsonb;
  v_instance public.board_instances%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_current_step public.board_workflow_steps%rowtype;
  v_target_step public.board_workflow_steps%rowtype;
  v_transition public.board_workflow_transitions%rowtype;
  v_gate public.board_workflow_gates%rowtype;
  v_evidence public.board_workflow_evidence_requirements%rowtype;
  v_missing text[] := array[]::text[];
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_task_id::text, p_target_workspace_id::text, coalesce(p_decision_note, '')));
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_is_reopen boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = '工作區決定需要登入身分；卡片未變更。'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from private.board_workflow_action_idempotency where idempotency_key = p_idempotency_key and expires_at > now();
    if found then if v_existing.request_hash <> v_hash then raise exception using errcode = '40001', message = '工作區決定的 Idempotency Key 已用於不同內容。'; end if; return v_existing.response; end if;
  end if;
  select * into v_task from public.board_tasks where id = p_task_id for update;
  if not found or not public.board_task_can_write(p_task_id) then raise exception using errcode = '42501', message = '目前登入身分沒有此卡片的管理權限；卡片未變更。'; end if;
  if v_task.archived_at is not null then raise exception using errcode = '42501', message = '封存卡片不可移動；卡片未變更。'; end if;
  select * into v_instance from public.board_instances where id = v_task.board_instance_id and active for share;
  select * into v_definition from public.board_workflow_definitions where id = v_task.workflow_version_id and board_instance_id = v_task.board_instance_id and status in ('published', 'retired');
  if not found or v_task.current_workflow_step_id is null then raise exception using errcode = '55000', message = '此卡片尚未綁定可用的流程版本／目前階段；Runtime 不會猜測流程，卡片未變更。'; end if;
  select * into v_current_step from public.board_workflow_steps where id = v_task.current_workflow_step_id and workflow_version_id = v_definition.id;
  select * into v_target_step from public.board_workflow_steps where workflow_version_id = v_definition.id and workspace_id = p_target_workspace_id;
  if not found then raise exception using errcode = '22023', message = '目標工作區不是此流程定義的合法階段；卡片未變更。'; end if;
  if v_current_step.id = v_target_step.id then return jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'workspace-decision', 'task_id', p_task_id, 'state', 'no_change', 'workspace_id', p_target_workspace_id); end if;
  select * into v_transition from public.board_workflow_transitions where workflow_version_id = v_definition.id and from_step_id = v_current_step.id and to_step_id = v_target_step.id;
  if not found or not ('pm' = any(v_transition.allowed_roles)) then raise exception using errcode = '42501', message = '這張子板的流程未允許目前 PM 工作區決定；卡片未變更。'; end if;
  if v_current_step.is_completion and not v_target_step.is_completion then v_is_reopen := true; end if;
  if v_transition.requires_gate or v_target_step.is_completion then
    for v_gate in select * from public.board_workflow_gates where workflow_version_id = v_definition.id and step_id = v_target_step.id and required order by sort_order, gate_key loop
      for v_evidence in select * from public.board_workflow_evidence_requirements where gate_id = v_gate.id and required order by sort_order, evidence_key loop
        if v_evidence.source_kind = 'pm_action_context' then
          continue;
        elsif v_evidence.source_kind = 'checklist' then
          if not exists (select 1 from public.engineering_checklist_items i where i.task_id = v_task.id and i.item_key = v_evidence.evidence_key and lower(coalesce(i.state, '')) = 'pass' and (nullif(btrim(coalesce(i.evidence_note, '')), '') is not null or nullif(btrim(coalesce(i.evidence_ref, '')), '') is not null)) then
            v_missing := array_append(v_missing, v_evidence.label);
          end if;
        else
          if not exists (select 1 from public.engineering_activity_log a where a.entity_type = 'board_task' and a.entity_id = v_task.id::text and a.after_data->>'evidence_key' = v_evidence.evidence_key) then
            v_missing := array_append(v_missing, v_evidence.label);
          end if;
        end if;
      end loop;
    end loop;
  end if;
  if cardinality(v_missing) > 0 then
    raise exception using errcode = '42501', message = format('此流程完成前還缺少：%s；卡片未移動，正式狀態不變。', array_to_string(v_missing, '、')), detail = jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'workspace-decision', 'gate', 'workflow_evidence', 'missing', to_jsonb(v_missing))::text;
  end if;
  v_before := to_jsonb(v_task);
  update public.board_tasks
  set workspace_id = p_target_workspace_id,
      current_workflow_step_id = v_target_step.id,
      status = v_target_step.status_key,
      assignee = private.board_workflow_role_label(v_target_step.role_key),
      accepted_at = case when v_target_step.is_completion then coalesce(accepted_at, v_now) else accepted_at end,
      accepted_by = case when v_target_step.is_completion then coalesce(accepted_by, auth.uid()) else accepted_by end,
      completion_at = case when v_target_step.is_completion then coalesce(completion_at, v_now) else completion_at end,
      completion_by = case when v_target_step.is_completion then coalesce(completion_by, auth.uid()) else completion_by end,
      archive_due_at = case when v_target_step.is_completion then v_now + interval '48 hours' when v_is_reopen then null else archive_due_at end,
      updated_at = v_now
  where id = v_task.id
  returning * into v_task;
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'workspace-decision', 'task_id', v_task.id, 'workflow_version_id', v_task.workflow_version_id, 'source_step_id', v_current_step.id, 'target_step_id', v_target_step.id, 'source_workspace_id', v_before->>'workspace_id', 'target_workspace_id', v_task.workspace_id, 'status', v_task.status, 'assignee', v_task.assignee, 'completion', v_target_step.is_completion, 'reopen', v_is_reopen, 'acceptance_action_context', jsonb_build_object('actor_id', auth.uid(), 'occurred_at', v_now, 'workflow_version_id', v_definition.id, 'source_step_id', v_current_step.id, 'target_step_id', v_target_step.id, 'action', case when v_target_step.is_completion then 'pm-completion-decision' else case when v_is_reopen then 'pm-reopen-decision' else 'pm-workspace-decision' end end, 'decision_note', p_decision_note));
  insert into public.engineering_activity_log (entity_type, entity_id, action, before_data, after_data, note, actor_id, actor_type, actor_label, activity_type) values ('board_task', v_task.id::text, case when v_target_step.is_completion then 'workflow_completion_decision' when v_is_reopen then 'workflow_reopen_decision' else 'workflow_workspace_decision' end, v_before, v_response, nullif(btrim(p_decision_note), ''), auth.uid(), 'human', 'PM', 'system_activity');
  if p_idempotency_key is not null then insert into private.board_workflow_action_idempotency (idempotency_key, action_type, board_instance_id, task_id, request_hash, response, status) values (p_idempotency_key, case when v_target_step.is_completion then 'completion' when v_is_reopen then 'reopen' else 'workspace_decision' end, v_task.board_instance_id, v_task.id, v_hash, v_response, 'completed'); end if;
  return v_response;
end;
$function$;

revoke all on function public.board_c_workflow_get(uuid, boolean) from public, anon;
revoke all on function public.board_c_workflow_save_draft(uuid, text, text, jsonb, jsonb, jsonb, jsonb, uuid, text) from public, anon;
revoke all on function public.board_c_workflow_validate_draft(uuid) from public, anon;
revoke all on function public.board_c_workflow_publish(uuid, uuid, text) from public, anon;
revoke all on function public.board_c_workflow_request_adoption(uuid, uuid, text, text) from public, anon;
revoke all on function public.board_c_workflow_approve_adoption(uuid, text, text) from public, anon;
revoke all on function public.board_c_workflow_set_step_mapping(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.board_c_workflow_apply_card_mapping(uuid, uuid, text) from public, anon;
revoke all on function public.board_c_workflow_resolve_task(uuid) from public, anon;
revoke all on function public.board_c_reconcile_workspace_decision_v2(uuid, uuid, text, text) from public, anon;
grant execute on function public.board_c_workflow_get(uuid, boolean) to authenticated;
grant execute on function public.board_c_workflow_save_draft(uuid, text, text, jsonb, jsonb, jsonb, jsonb, uuid, text) to authenticated;
grant execute on function public.board_c_workflow_validate_draft(uuid) to authenticated;
grant execute on function public.board_c_workflow_publish(uuid, uuid, text) to authenticated;
grant execute on function public.board_c_workflow_request_adoption(uuid, uuid, text, text) to authenticated;
grant execute on function public.board_c_workflow_approve_adoption(uuid, text, text) to authenticated;
grant execute on function public.board_c_workflow_set_step_mapping(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.board_c_workflow_apply_card_mapping(uuid, uuid, text) to authenticated;
grant execute on function public.board_c_workflow_resolve_task(uuid) to authenticated;
grant execute on function public.board_c_reconcile_workspace_decision_v2(uuid, uuid, text, text) to authenticated;

comment on table public.board_workflow_definitions is 'Module C canonical workflow definitions owned by Board Instance; published versions are immutable.';
comment on table public.board_instance_workflow_state is 'Published/draft workflow pointers for one Board Instance.';
comment on table public.board_workflow_steps is 'One operable workflow step maps to one workspace within the same Board Instance.';
comment on table public.board_workflow_adoptions is 'Explicit, auditable workflow version adoption; never batch-migrates cards.';
comment on column public.board_tasks.workflow_version_id is 'Additive C Workflow binding; NULL means needs explicit reconciliation, never runtime guessing.';
comment on column public.board_tasks.current_workflow_step_id is 'Additive C Workflow current step; NULL means needs explicit reconciliation.';

commit;
