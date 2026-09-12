-- Module C canonical completion archive policy foundation (P1).
--
-- This migration creates the single Cloud-owned policy source used by the
-- future Module C completion/archive adoption work.  It intentionally does
-- not switch any existing Consumer writer, recalculate existing timestamps,
-- or mutate board_tasks/user_tasks data.

begin;

create schema if not exists private;

create table if not exists private.module_c_completion_archive_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null check (length(btrim(policy_key)) > 0),
  policy_version integer not null check (policy_version > 0),
  status text not null check (status in ('published', 'retired')),
  archive_delay_seconds bigint not null check (archive_delay_seconds > 0),
  policy_identity text not null check (length(btrim(policy_identity)) > 0),
  policy_source text not null check (length(btrim(policy_source)) > 0),
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (policy_key, policy_version)
);

create unique index if not exists module_c_completion_archive_policies_one_published_idx
  on private.module_c_completion_archive_policies (policy_key)
  where status = 'published';

alter table private.module_c_completion_archive_policies enable row level security;

-- The policy table is an internal C authority.  Consumers read it through
-- the authenticated, read-only RPCs below; it is never a browser data path.
revoke all on table private.module_c_completion_archive_policies from public, anon, authenticated;

-- Seed the current policy exactly once.  Existing completion/archive rows are
-- deliberately untouched; this row is only the new policy source.
insert into private.module_c_completion_archive_policies (
  policy_key,
  policy_version,
  status,
  archive_delay_seconds,
  policy_identity,
  policy_source,
  effective_at
)
values (
  'completion_archive',
  1,
  'published',
  172800,
  'module-c-completion-archive-policy',
  'module-c-mother',
  now()
)
on conflict (policy_key, policy_version) do nothing;

create or replace function public.board_c_get_completion_archive_policy(
  p_policy_key text default 'completion_archive'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, private, auth, public, pg_temp
as $function$
declare
  v_actor uuid;
  v_policy private.module_c_completion_archive_policies%rowtype;
  v_policy_key text := coalesce(nullif(btrim(p_policy_key), ''), 'completion_archive');
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception using
      errcode = '42501',
      message = 'Authenticated C session is required to read the completion archive policy.';
  end if;

  if v_policy_key <> 'completion_archive' then
    raise exception using
      errcode = '22023',
      message = 'Unknown Module C completion archive policy key.';
  end if;

  select *
    into v_policy
    from private.module_c_completion_archive_policies
   where policy_key = v_policy_key
     and status = 'published'
   order by policy_version desc
   limit 1;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Published Module C completion archive policy is unavailable.';
  end if;

  return jsonb_build_object(
    'contract_family', 'module-c-lifecycle-acceptance',
    'contract_version', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive',
    'policy_identity', v_policy.policy_identity,
    'policy_key', v_policy.policy_key,
    'policy_version', v_policy.policy_version,
    'archive_delay_seconds', v_policy.archive_delay_seconds,
    'archive_delay_hours', v_policy.archive_delay_seconds / 3600.0,
    'policy_source', v_policy.policy_source,
    'effective_at', v_policy.effective_at,
    'cloud_source_of_truth', true,
    'existing_due_at_retroactive', false
  );
end;
$function$;

revoke all on function public.board_c_get_completion_archive_policy(text) from public, anon;
grant execute on function public.board_c_get_completion_archive_policy(text) to authenticated;

create or replace function public.board_c_calculate_completion_archive_due_at(
  p_completion_at timestamptz,
  p_policy_key text default 'completion_archive'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, private, auth, public, pg_temp
as $function$
declare
  v_actor uuid;
  v_policy private.module_c_completion_archive_policies%rowtype;
  v_policy_key text := coalesce(nullif(btrim(p_policy_key), ''), 'completion_archive');
  v_archive_due_at timestamptz;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception using
      errcode = '42501',
      message = 'Authenticated C session is required to calculate archive timing.';
  end if;

  if p_completion_at is null then
    raise exception using
      errcode = '22004',
      message = 'completion_at is required to calculate archive timing.';
  end if;

  if v_policy_key <> 'completion_archive' then
    raise exception using
      errcode = '22023',
      message = 'Unknown Module C completion archive policy key.';
  end if;

  select *
    into v_policy
    from private.module_c_completion_archive_policies
   where policy_key = v_policy_key
     and status = 'published'
   order by policy_version desc
   limit 1;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Published Module C completion archive policy is unavailable.';
  end if;

  v_archive_due_at := p_completion_at
    + make_interval(secs => v_policy.archive_delay_seconds::double precision);

  return jsonb_build_object(
    'contract_family', 'module-c-lifecycle-acceptance',
    'contract_version', 'module-c-lifecycle-acceptance-v2',
    'capability', 'completion-archive',
    'policy_identity', v_policy.policy_identity,
    'policy_key', v_policy.policy_key,
    'policy_version', v_policy.policy_version,
    'archive_delay_seconds', v_policy.archive_delay_seconds,
    'archive_delay_hours', v_policy.archive_delay_seconds / 3600.0,
    'policy_source', v_policy.policy_source,
    'effective_at', v_policy.effective_at,
    'completion_at', p_completion_at,
    'archive_due_at', v_archive_due_at,
    'cloud_source_of_truth', true,
    'existing_due_at_retroactive', false
  );
end;
$function$;

revoke all on function public.board_c_calculate_completion_archive_due_at(timestamptz, text) from public, anon;
grant execute on function public.board_c_calculate_completion_archive_due_at(timestamptz, text) to authenticated;

comment on table private.module_c_completion_archive_policies is
  'Module C canonical completion archive policy versions; private Cloud SoT, not a Consumer-owned policy.';
comment on function public.board_c_get_completion_archive_policy(text) is
  'Authenticated read-only access to the published Module C completion archive policy.';
comment on function public.board_c_calculate_completion_archive_due_at(timestamptz, text) is
  'Authenticated canonical calculation of archive_due_at from completion_at and the published Module C policy.';

notify pgrst, 'reload schema';

commit;
