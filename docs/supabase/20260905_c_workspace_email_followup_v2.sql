-- Module C workspace notification v2: CC/BCC + card progress follow-up notification.
-- Additive only. Existing settings and board/task data are preserved.
begin;
alter table public.board_workspace_notification_settings
  add column if not exists cc_emails text[] not null default '{}'::text[],
  add column if not exists bcc_emails text[] not null default '{}'::text[],
  add column if not exists progress_notification_enabled boolean not null default false,
  add column if not exists progress_to_emails text[] not null default '{}'::text[],
  add column if not exists progress_cc_emails text[] not null default '{}'::text[],
  add column if not exists progress_bcc_emails text[] not null default '{}'::text[];

create unique index if not exists engineering_activity_log_card_progress_email_idempotency_idx
  on public.engineering_activity_log ((after_data->>'idempotency_key'))
  where action='card_progress_email_notification' and nullif(after_data->>'idempotency_key','') is not null;

create or replace function public.board_get_workspace_notification_settings(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_workspace public.board_workspaces; v_setting public.board_workspace_notification_settings;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 select * into v_workspace from public.board_workspaces where id=p_workspace_id and active=true;
 if not found then raise exception using errcode='P0002',message='Workspace not found'; end if;
 if coalesce(v_workspace.owner_uuid,v_user)<>v_user and not public.is_engineering_member(array['owner']) then raise exception using errcode='42501',message='Workspace owner access required'; end if;
 select * into v_setting from public.board_workspace_notification_settings where workspace_id=p_workspace_id;
 if not found then return jsonb_build_object('workspace_id',p_workspace_id,'enabled',false,'notify_assignee',false,'notify_reporter',false,'custom_emails','[]'::jsonb,'cc_emails','[]'::jsonb,'bcc_emails','[]'::jsonb,'progress_notification_enabled',false,'progress_to_emails','[]'::jsonb,'progress_cc_emails','[]'::jsonb,'progress_bcc_emails','[]'::jsonb,'subject_template','{{卡片編號}} 已進入{{工作區名稱}}','body_template','您的案件 {{卡片編號}}「{{卡片名稱}}」目前已進入「{{工作區名稱}}」。'); end if;
 return to_jsonb(v_setting)-'owner_uuid'-'created_by'-'updated_by';
end $$;

create or replace function public.board_save_workspace_notification_settings(
 p_workspace_id uuid,p_enabled boolean,p_notify_assignee boolean,p_notify_reporter boolean,p_custom_emails text[],p_cc_emails text[],p_bcc_emails text[],p_progress_notification_enabled boolean,p_progress_to_emails text[],p_progress_cc_emails text[],p_progress_bcc_emails text[],p_subject_template text,p_body_template text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_workspace public.board_workspaces; v_saved public.board_workspace_notification_settings; v_all text[]; v_email text;
begin
 if v_user is null then raise exception using errcode='42501',message='Authentication required'; end if;
 select * into v_workspace from public.board_workspaces where id=p_workspace_id and active=true for update;
 if not found then raise exception using errcode='P0002',message='Workspace not found'; end if;
 if coalesce(v_workspace.owner_uuid,v_user)<>v_user and not public.is_engineering_member(array['owner']) then raise exception using errcode='42501',message='Workspace owner access required'; end if;
 v_all:=coalesce(p_custom_emails,'{}')||coalesce(p_cc_emails,'{}')||coalesce(p_bcc_emails,'{}')||coalesce(p_progress_to_emails,'{}')||coalesce(p_progress_cc_emails,'{}')||coalesce(p_progress_bcc_emails,'{}');
 if cardinality(v_all)>120 then raise exception using errcode='22023',message='Too many email recipients'; end if;
 foreach v_email in array v_all loop if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then raise exception using errcode='22023',message='Invalid email address'; end if; end loop;
 insert into public.board_workspace_notification_settings(workspace_id,board_instance_id,owner_uuid,enabled,notify_assignee,notify_reporter,custom_emails,cc_emails,bcc_emails,progress_notification_enabled,progress_to_emails,progress_cc_emails,progress_bcc_emails,subject_template,body_template,created_by,updated_by)
 values(p_workspace_id,v_workspace.board_instance_id,coalesce(v_workspace.owner_uuid,v_user),coalesce(p_enabled,false),coalesce(p_notify_assignee,false),coalesce(p_notify_reporter,false),coalesce(p_custom_emails,'{}'),coalesce(p_cc_emails,'{}'),coalesce(p_bcc_emails,'{}'),coalesce(p_progress_notification_enabled,false),coalesce(p_progress_to_emails,'{}'),coalesce(p_progress_cc_emails,'{}'),coalesce(p_progress_bcc_emails,'{}'),left(coalesce(p_subject_template,''),240),left(coalesce(p_body_template,''),12000),v_user,v_user)
 on conflict(workspace_id) do update set enabled=excluded.enabled,notify_assignee=excluded.notify_assignee,notify_reporter=excluded.notify_reporter,custom_emails=excluded.custom_emails,cc_emails=excluded.cc_emails,bcc_emails=excluded.bcc_emails,progress_notification_enabled=excluded.progress_notification_enabled,progress_to_emails=excluded.progress_to_emails,progress_cc_emails=excluded.progress_cc_emails,progress_bcc_emails=excluded.progress_bcc_emails,subject_template=excluded.subject_template,body_template=excluded.body_template,updated_by=v_user,updated_at=now()
 returning * into v_saved;
 return to_jsonb(v_saved)-'owner_uuid'-'created_by'-'updated_by';
end $$;
revoke all on function public.board_save_workspace_notification_settings(uuid,boolean,boolean,boolean,text[],text[],text[],boolean,text[],text[],text[],text,text) from public,anon;
grant execute on function public.board_save_workspace_notification_settings(uuid,boolean,boolean,boolean,text[],text[],text[],boolean,text[],text[],text[],text,text) to authenticated;
commit;
