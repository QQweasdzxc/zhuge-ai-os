-- ERP coordination metadata only. Business ledger remains in Google Sheets.
begin;
create table public.erp_edit_custody (
 resource_key text primary key check(length(resource_key) between 1 and 1000),
 owner_uuid uuid not null references auth.users(id),
 reservation_token uuid not null,
 phase text not null check(phase in ('EDITING','WRITING','UNCERTAIN')),
 expires_at timestamptz not null,
 operation_id uuid,
 updated_at timestamptz not null default now()
);
create table public.erp_write_operations (
 operation_id uuid primary key,
 owner_uuid uuid not null references auth.users(id),
 reservation_token uuid not null,
 resource_keys text[] not null,
 phase text not null check(phase in ('WRITING','UNCERTAIN','COMPLETE')),
 dispatch_closed boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.erp_write_attempts (
 attempt_id uuid primary key,
 operation_id uuid not null references public.erp_write_operations(operation_id),
 outcome text not null check(outcome in ('STARTED','DONE','UNKNOWN','NOT_SENT')),
 http_status integer,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table public.erp_edit_custody enable row level security;
alter table public.erp_write_operations enable row level security;
alter table public.erp_write_attempts enable row level security;
revoke all on public.erp_edit_custody,public.erp_write_operations,public.erp_write_attempts from public,anon,authenticated;
-- No browser table access. Existing approved bridge owns scoped calls.
create function public.erp_reserve(p_keys text[],p_owner uuid,p_token uuid) returns void
language plpgsql security definer set search_path=public as $$
declare k text; r public.erp_edit_custody;
begin
 if cardinality(p_keys)<1 or cardinality(p_keys)>1000 then raise exception 'invalid keys'; end if;
 for k in select distinct unnest(p_keys) order by 1 loop
  insert into public.erp_edit_custody(resource_key,owner_uuid,reservation_token,phase,expires_at)
   values(k,p_owner,p_token,'EDITING',now()+interval '5 minutes') on conflict do nothing;
  select * into strict r from public.erp_edit_custody where resource_key=k for update;
  if r.phase<>'EDITING' or (r.expires_at>now() and (r.owner_uuid<>p_owner or r.reservation_token<>p_token)) then raise exception 'RECORD_BUSY'; end if;
  update public.erp_edit_custody set owner_uuid=p_owner,reservation_token=p_token,expires_at=now()+interval '5 minutes',updated_at=now() where resource_key=k;
 end loop;
end $$;
create function public.erp_begin_write(p_keys text[],p_owner uuid,p_token uuid,p_operation uuid) returns void
language plpgsql security definer set search_path=public as $$
declare k text; r public.erp_edit_custody;
begin
 if cardinality(p_keys)<1 then raise exception 'invalid keys'; end if;
 -- Time-bound UUIDv7 operation IDs make completed tombstone cleanup replay-safe.
 if substring(p_operation::text,15,1)<>'7' or
    (('x'||replace(left(p_operation::text,13),'-',''))::bit(48)::bigint) < extract(epoch from clock_timestamp())*1000-900000 or
    (('x'||replace(left(p_operation::text,13),'-',''))::bit(48)::bigint) > extract(epoch from clock_timestamp())*1000+60000 then raise exception 'OPERATION_EXPIRED'; end if;
 -- Opportunistic bounded cleanup only COMPLETE; unknown/writing custody is untouched.
 with old as (select operation_id from public.erp_write_operations where phase='COMPLETE' and created_at<now()-interval '1 day' order by created_at limit 50 for update skip locked)
 delete from public.erp_write_attempts where operation_id in(select operation_id from old);
 delete from public.erp_write_operations where operation_id in(select operation_id from public.erp_write_operations where phase='COMPLETE' and created_at<now()-interval '1 day' and not exists(select 1 from public.erp_write_attempts a where a.operation_id=erp_write_operations.operation_id) order by created_at limit 50);
 -- Reusing an operation ID never dispatches a second write.
 insert into public.erp_write_operations(operation_id,owner_uuid,reservation_token,resource_keys,phase) values(p_operation,p_owner,p_token,p_keys,'WRITING');
 for k in select distinct unnest(p_keys) order by 1 loop
  select * into strict r from public.erp_edit_custody where resource_key=k for update;
  if r.owner_uuid<>p_owner or r.reservation_token<>p_token or r.phase<>'EDITING' or r.expires_at<=now() then raise exception 'EDIT_PERMISSION_EXPIRED'; end if;
  update public.erp_edit_custody set phase='WRITING',operation_id=p_operation,updated_at=now() where resource_key=k;
 end loop;
end $$;
revoke all on function public.erp_reserve(text[],uuid,uuid),public.erp_begin_write(text[],uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.erp_reserve(text[],uuid,uuid),public.erp_begin_write(text[],uuid,uuid,uuid) to service_role;

create function public.erp_attempt_begin(p_operation uuid,p_attempt uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.erp_write_operations where operation_id=p_operation and phase='WRITING' and not dispatch_closed for update;
 if not found then raise exception 'OPERATION_NOT_WRITING'; end if;
 insert into public.erp_write_attempts(attempt_id,operation_id,outcome) values(p_attempt,p_operation,'STARTED');
end $$;
create function public.erp_attempt_result(p_operation uuid,p_attempt uuid,p_status integer) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_status is not null and (p_status<100 or p_status>599) then raise exception 'INVALID_STATUS'; end if;
 update public.erp_write_attempts set outcome=case when p_status is null then 'UNKNOWN' else 'DONE' end,http_status=p_status,completed_at=case when p_status is null then null else now() end
 where operation_id=p_operation and attempt_id=p_attempt and outcome='STARTED';
 if not found then raise exception 'ATTEMPT_NOT_STARTED'; end if;
 if p_status is null then
  update public.erp_write_operations set phase='UNCERTAIN' where operation_id=p_operation;
  update public.erp_edit_custody set phase='UNCERTAIN',updated_at=now() where operation_id=p_operation;
 end if;
end $$;
create function public.erp_quarantine(p_operation uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.erp_write_operations where operation_id=p_operation for update;
 if exists(select 1 from public.erp_write_attempts where operation_id=p_operation) then
 update public.erp_write_operations set phase='UNCERTAIN' where operation_id=p_operation;
 update public.erp_edit_custody set phase='UNCERTAIN',updated_at=now() where operation_id=p_operation;
 end if;
end $$;
revoke all on function public.erp_quarantine(uuid) from public,anon,authenticated;
grant execute on function public.erp_quarantine(uuid) to service_role;
create function public.erp_finish_write(p_operation uuid,p_retain_keys text[] default '{}'::text[]) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.erp_write_operations where operation_id=p_operation and phase in ('WRITING','UNCERTAIN') for update;
 if not found then raise exception 'OPERATION_NOT_OPEN'; end if;
 update public.erp_write_operations set dispatch_closed=true where operation_id=p_operation;
 if exists(select 1 from public.erp_write_operations where operation_id=p_operation and phase='UNCERTAIN') or exists(select 1 from public.erp_write_attempts where operation_id=p_operation and outcome not in ('DONE','NOT_SENT')) then
  update public.erp_write_operations set phase='UNCERTAIN' where operation_id=p_operation;
  update public.erp_edit_custody set phase='UNCERTAIN',updated_at=now() where operation_id=p_operation;
  return;
 end if;
 -- Keep tombstones for one day, beyond the enforced 15-minute operation window.
 -- zero attempts means bridge failed validation BEFORE any dispatch. No implicit retry.
 update public.erp_edit_custody set phase='EDITING',operation_id=null,expires_at=now()+interval '5 minutes',updated_at=now() where operation_id=p_operation and resource_key=any(p_retain_keys);
 delete from public.erp_edit_custody where operation_id=p_operation;
 update public.erp_write_operations set phase='COMPLETE' where operation_id=p_operation;
end $$;
create function public.erp_renew(p_keys text[],p_owner uuid,p_token uuid) returns void
language plpgsql security definer set search_path=public as $$
declare k text; r public.erp_edit_custody;
begin
 for k in select distinct unnest(p_keys) order by 1 loop
  select * into strict r from public.erp_edit_custody where resource_key=k for update;
  if r.owner_uuid<>p_owner or r.reservation_token<>p_token or r.phase<>'EDITING' or r.expires_at<=now() then raise exception 'EDIT_PERMISSION_EXPIRED'; end if;
  update public.erp_edit_custody set expires_at=now()+interval '5 minutes',updated_at=now() where resource_key=k;
 end loop;
end $$;
create function public.erp_release(p_keys text[],p_owner uuid,p_token uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 -- No API or elapsed time can release writing/uncertain custody.
 delete from public.erp_edit_custody where resource_key=any(p_keys) and owner_uuid=p_owner and reservation_token=p_token and phase='EDITING';
end $$;
revoke all on function public.erp_attempt_begin(uuid,uuid),public.erp_attempt_result(uuid,uuid,integer),public.erp_finish_write(uuid,text[]),public.erp_renew(text[],uuid,uuid),public.erp_release(text[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.erp_attempt_begin(uuid,uuid),public.erp_attempt_result(uuid,uuid,integer),public.erp_finish_write(uuid,text[]),public.erp_renew(text[],uuid,uuid),public.erp_release(text[],uuid,uuid) to service_role;
commit;
