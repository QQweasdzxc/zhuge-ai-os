-- TASK-065: GAS Task Card <-> Vendor relation
--
-- The relation stores only the formal Vendor ID.  Google Sheet remains the
-- Vendor Profile source of truth; no vendor master data is copied to Cloud.
-- Writes are available only through the authenticated, GAS-scoped RPCs below.

begin;

create table if not exists public.board_task_vendor_links (
  id uuid primary key default gen_random_uuid(),
  board_instance_id uuid not null references public.board_instances(id) on delete cascade,
  task_id uuid not null references public.board_tasks(id) on delete cascade,
  vendor_id text not null check (vendor_id ~ '^GAS-V[0-9]{4}$'),
  source_system text not null default 'google_sheet' check (source_system = 'google_sheet'),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id)
);

create index if not exists board_task_vendor_links_instance_idx
  on public.board_task_vendor_links (board_instance_id);

alter table public.board_task_vendor_links enable row level security;

revoke all on public.board_task_vendor_links from public, anon, authenticated;
grant select on public.board_task_vendor_links to authenticated;

drop policy if exists board_task_vendor_links_select on public.board_task_vendor_links;
create policy board_task_vendor_links_select
on public.board_task_vendor_links
for select to authenticated
using (
  public.board_task_can_read(task_id)
  and exists (
    select 1
    from public.board_tasks task
    where task.id = board_task_vendor_links.task_id
      and task.board_instance_id = board_task_vendor_links.board_instance_id
  )
);

create or replace function public.board_instance_get_task_vendor_link(
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_board_instance_id uuid;
  v_prefix text;
  v_template_key text;
  v_active boolean;
  v_link public.board_task_vendor_links%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = '請先登入 Zhuge AI OS，才能查看廠商關聯。';
  end if;

  select task.board_instance_id, instance.task_code_prefix, instance.template_key, instance.active
    into v_board_instance_id, v_prefix, v_template_key, v_active
  from public.board_tasks task
  join public.board_instances instance on instance.id = task.board_instance_id
  where task.id = p_task_id;

  if not found or not coalesce(v_active, false) then
    raise exception using errcode = 'P0002', message = '找不到啟用中的 GAS 工作卡片。';
  end if;
  if not public.board_task_can_read(p_task_id) then
    raise exception using errcode = '42501', message = '目前登入身分沒有讀取此卡片廠商關聯的權限。';
  end if;
  if upper(coalesce(v_prefix, '')) <> 'GAS' or lower(coalesce(v_template_key, '')) <> 'c' then
    raise exception using errcode = '42501', message = '廠商關聯只適用於 GAS 的 C 看板。';
  end if;

  select * into v_link
  from public.board_task_vendor_links link
  where link.task_id = p_task_id
    and link.board_instance_id = v_board_instance_id;

  return jsonb_build_object(
    'task_id', p_task_id,
    'board_instance_id', v_board_instance_id,
    'linked', v_link.id is not null,
    'vendor_id', case when v_link.id is null then null else v_link.vendor_id end,
    'source_of_truth', 'google_sheet',
    'updated_at', case when v_link.id is null then null else v_link.updated_at end
  );
end;
$function$;

create or replace function public.board_instance_set_task_vendor_link(
  p_task_id uuid,
  p_vendor_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_task public.board_tasks%rowtype;
  v_instance public.board_instances%rowtype;
  v_existing public.board_task_vendor_links%rowtype;
  v_link public.board_task_vendor_links%rowtype;
  v_vendor_id text := nullif(btrim(coalesce(p_vendor_id, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_found boolean := false;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = '請先登入 Zhuge AI OS，才能保存廠商關聯。';
  end if;
  if not public.board_task_can_write(p_task_id) then
    raise exception using errcode = '42501', message = '目前登入身分沒有保存此卡片廠商關聯的權限。';
  end if;
  if v_vendor_id is not null and v_vendor_id !~ '^GAS-V[0-9]{4}$' then
    raise exception using errcode = '22023', message = '廠商關聯識別格式無效。';
  end if;

  select * into v_task
  from public.board_tasks task
  where task.id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '找不到要關聯的工作卡片。';
  end if;

  select * into v_instance
  from public.board_instances instance
  where instance.id = v_task.board_instance_id
    and instance.active = true;
  if not found or upper(coalesce(v_instance.task_code_prefix, '')) <> 'GAS' or lower(coalesce(v_instance.template_key, '')) <> 'c' then
    raise exception using errcode = '42501', message = '廠商關聯只適用於 GAS 的 C 看板。';
  end if;

  select * into v_existing
  from public.board_task_vendor_links link
  where link.task_id = v_task.id
    and link.board_instance_id = v_task.board_instance_id
  for update;
  v_found := found;

  if v_vendor_id is not null and v_found and v_existing.vendor_id = v_vendor_id then
    return jsonb_build_object(
      'task_id', v_task.id,
      'board_instance_id', v_task.board_instance_id,
      'linked', true,
      'vendor_id', v_existing.vendor_id,
      'source_of_truth', 'google_sheet',
      'updated_at', v_existing.updated_at,
      'idempotent', true
    );
  end if;
  if v_vendor_id is null and not v_found then
    return jsonb_build_object(
      'task_id', v_task.id,
      'board_instance_id', v_task.board_instance_id,
      'linked', false,
      'vendor_id', null,
      'source_of_truth', 'google_sheet',
      'idempotent', true
    );
  end if;

  v_before := jsonb_build_object(
    'linked', v_found,
    'vendor_id', case when v_found then v_existing.vendor_id else null end,
    'source_of_truth', 'google_sheet'
  );

  if v_vendor_id is null then
    delete from public.board_task_vendor_links link
    where link.id = v_existing.id;
    v_after := jsonb_build_object(
      'linked', false,
      'vendor_id', null,
      'source_of_truth', 'google_sheet'
    );
  else
    insert into public.board_task_vendor_links (
      board_instance_id, task_id, vendor_id, source_system, created_by, updated_by
    ) values (
      v_task.board_instance_id, v_task.id, v_vendor_id, 'google_sheet', v_user, v_user
    )
    on conflict (task_id) do update set
      board_instance_id = excluded.board_instance_id,
      vendor_id = excluded.vendor_id,
      source_system = excluded.source_system,
      updated_by = excluded.updated_by,
      updated_at = now()
    returning * into v_link;
    v_after := jsonb_build_object(
      'linked', true,
      'vendor_id', v_link.vendor_id,
      'source_of_truth', 'google_sheet'
    );
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'vendor_association_updated', v_before, v_after,
    'GAS 卡片廠商關聯透過受控 C instance contract 更新；Vendor Profile 仍由 Google Sheet 提供。',
    v_user, 'human', 'PM', 'system_activity'
  );

  return jsonb_build_object(
    'task_id', v_task.id,
    'board_instance_id', v_task.board_instance_id,
    'linked', v_vendor_id is not null,
    'vendor_id', v_vendor_id,
    'source_of_truth', 'google_sheet',
    'idempotent', false
  );
end;
$function$;

revoke execute on function public.board_instance_get_task_vendor_link(uuid) from public, anon;
revoke execute on function public.board_instance_set_task_vendor_link(uuid, text) from public, anon;
grant execute on function public.board_instance_get_task_vendor_link(uuid) to authenticated;
grant execute on function public.board_instance_set_task_vendor_link(uuid, text) to authenticated;

comment on table public.board_task_vendor_links is
  'GAS-only task relation storing formal Vendor IDs; Vendor Profile remains in Google Sheet.';

commit;
