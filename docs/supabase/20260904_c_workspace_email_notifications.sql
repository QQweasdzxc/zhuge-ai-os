-- Module C / Workspace Email Notification v1
--
-- Settings are Cloud-only. The browser can reach them only through the two
-- authenticated RPCs below; direct table access remains revoked. Delivery
-- attempts are recorded in the existing engineering audit stream and keyed
-- to an authoritative workspace-entry activity so retries cannot send the
-- same transition twice.

begin;

create table if not exists public.board_workspace_notification_settings (
  workspace_id uuid primary key references public.board_workspaces(id) on delete restrict,
  board_instance_id uuid not null references public.board_instances(id) on delete restrict,
  enabled boolean not null default false,
  notify_assignee boolean not null default false,
  notify_reporter boolean not null default false,
  custom_emails text[] not null default '{}'::text[],
  subject_template text not null default '{{卡片編號}} 已進入{{工作區名稱}}',
  body_template text not null default '您的案件 {{卡片編號}}「{{卡片名稱}}」目前已進入「{{工作區名稱}}」。',
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_workspace_notification_subject_len check (length(subject_template) <= 240),
  constraint board_workspace_notification_body_len check (length(body_template) <= 12000),
  constraint board_workspace_notification_custom_count check (cardinality(custom_emails) <= 30)
);

create index if not exists board_workspace_notification_board_idx
  on public.board_workspace_notification_settings(board_instance_id, workspace_id);

alter table public.board_workspace_notification_settings enable row level security;
revoke all on public.board_workspace_notification_settings from public, anon, authenticated;

-- Existing board_instance_can_read/write functions are the canonical
-- ownership/authorization boundary for every C consumer. Do not copy
-- workspace ownership rules into this feature table.
create or replace function public.board_get_workspace_notification_settings(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
  v_setting public.board_workspace_notification_settings;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select * into v_workspace
  from public.board_workspaces
  where id = p_workspace_id and active = true;
  if not found or v_workspace.board_instance_id is null then
    raise exception using errcode = 'P0002', message = 'Workspace not found';
  end if;
  if not public.board_instance_can_read(v_workspace.board_instance_id) then
    raise exception using errcode = '42501', message = 'Board access required';
  end if;

  select * into v_setting
  from public.board_workspace_notification_settings
  where workspace_id = p_workspace_id
    and board_instance_id = v_workspace.board_instance_id;
  if not found then
    return jsonb_build_object(
      'workspace_id', p_workspace_id,
      'board_instance_id', v_workspace.board_instance_id,
      'enabled', false,
      'notify_assignee', false,
      'notify_reporter', false,
      'custom_emails', '[]'::jsonb,
      'subject_template', '{{卡片編號}} 已進入{{工作區名稱}}',
      'body_template', '您的案件 {{卡片編號}}「{{卡片名稱}}」目前已進入「{{工作區名稱}}」。'
    );
  end if;
  return to_jsonb(v_setting) - 'created_by' - 'updated_by';
end;
$function$;

create or replace function public.board_save_workspace_notification_settings(
  p_workspace_id uuid,
  p_enabled boolean,
  p_notify_assignee boolean,
  p_notify_reporter boolean,
  p_custom_emails text[],
  p_subject_template text,
  p_body_template text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_workspace public.board_workspaces;
  v_emails text[];
  v_email text;
  v_subject text := coalesce(nullif(btrim(p_subject_template), ''), '{{卡片編號}} 已進入{{工作區名稱}}');
  v_body text := coalesce(nullif(btrim(p_body_template), ''), '您的案件 {{卡片編號}}「{{卡片名稱}}」目前已進入「{{工作區名稱}}」。');
  v_saved public.board_workspace_notification_settings;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select * into v_workspace
  from public.board_workspaces
  where id = p_workspace_id and active = true
  for update;
  if not found or v_workspace.board_instance_id is null then
    raise exception using errcode = 'P0002', message = 'Workspace not found';
  end if;
  if not public.board_instance_can_write(v_workspace.board_instance_id) then
    raise exception using errcode = '42501', message = 'Board write access required';
  end if;

  select coalesce(array_agg(lower(btrim(item.email))), '{}'::text[])
    into v_emails
  from unnest(coalesce(p_custom_emails, '{}'::text[])) as item(email)
  where btrim(item.email) <> '';
  if cardinality(v_emails) > 30 then
    raise exception using errcode = '22023', message = 'Too many custom email recipients';
  end if;
  foreach v_email in array v_emails loop
    if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'Invalid email address';
    end if;
  end loop;
  if length(v_subject) > 240 or length(v_body) > 12000 then
    raise exception using errcode = '22023', message = 'Notification template is too long';
  end if;

  insert into public.board_workspace_notification_settings(
    workspace_id, board_instance_id, enabled, notify_assignee, notify_reporter,
    custom_emails, subject_template, body_template, created_by, updated_by
  ) values (
    p_workspace_id, v_workspace.board_instance_id, coalesce(p_enabled, false),
    coalesce(p_notify_assignee, false), coalesce(p_notify_reporter, false),
    v_emails, v_subject, v_body, auth.uid(), auth.uid()
  )
  on conflict (workspace_id) do update set
    board_instance_id = excluded.board_instance_id,
    enabled = excluded.enabled,
    notify_assignee = excluded.notify_assignee,
    notify_reporter = excluded.notify_reporter,
    custom_emails = excluded.custom_emails,
    subject_template = excluded.subject_template,
    body_template = excluded.body_template,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into v_saved;

  return to_jsonb(v_saved) - 'created_by' - 'updated_by';
end;
$function$;

-- One movement activity may be retried by the browser or by a provider
-- retry. The existing audit stream becomes the durable idempotency ledger.
create unique index if not exists engineering_workspace_email_notification_idempotency_idx
  on public.engineering_activity_log (
    entity_id,
    ((after_data ->> 'idempotency_key'))
  )
  where entity_type = 'board_workspace'
    and action = 'workspace_email_notification'
    and after_data ? 'idempotency_key';

revoke all on function public.board_get_workspace_notification_settings(uuid) from public, anon;
revoke all on function public.board_save_workspace_notification_settings(uuid,boolean,boolean,boolean,text[],text,text) from public, anon;
grant execute on function public.board_get_workspace_notification_settings(uuid) to authenticated;
grant execute on function public.board_save_workspace_notification_settings(uuid,boolean,boolean,boolean,text[],text,text) to authenticated;

commit;
