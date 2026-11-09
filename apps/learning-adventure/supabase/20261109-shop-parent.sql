-- TQ95 generic shop catalog foundation. No seeded family prizes or redemptions.
begin;
create table if not exists public.learning_adventure_rewards (
 id uuid primary key default gen_random_uuid(), adventure_family_id uuid not null references public.learning_adventure_families(id),
 title text not null check(length(title) between 1 and 80), price integer not null check(price>0), available boolean not null default true,
 proposed boolean not null default true, created_at timestamptz not null default now()
);
alter table public.learning_adventure_rewards enable row level security;
revoke all on public.learning_adventure_rewards from public,anon,authenticated;
grant all on public.learning_adventure_rewards to service_role;
commit;

-- Generic opt-in parent setup. No grants are issued by this migration.
-- A trusted operator must verify household ownership before issuing a grant.
-- Shared family links can neither issue a setup grant nor reset an existing PIN.
begin;
create table if not exists public.learning_adventure_parent_credentials (
 adventure_family_id uuid primary key references public.learning_adventure_families(id), pin_hash text not null,
 failures integer not null default 0 check(failures>=0), blocked_until timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.learning_adventure_parent_sessions (
 token_hash text primary key, adventure_family_id uuid not null references public.learning_adventure_parent_credentials(adventure_family_id),
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
create or replace function public.learning_adventure_parent_login(p_family uuid,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare c public.learning_adventure_parent_credentials; v_token text; v_until timestamptz; v_failures integer;
begin
 select * into c from public.learning_adventure_parent_credentials where adventure_family_id=p_family for update;
 if not found then return jsonb_build_object('ok',false,'error','家長驗證尚未設定'); end if;
 if c.blocked_until>clock_timestamp() then return jsonb_build_object('ok',false,'error','請稍後再試家長驗證'); end if;
 if p_pin is null or length(p_pin)>12 or not (p_pin~'^[0-9]{6,12}$') or extensions.crypt(p_pin,c.pin_hash)<>c.pin_hash then
  v_failures:=case when c.blocked_until is not null and c.blocked_until<=clock_timestamp() then 1 else c.failures+1 end;
  update public.learning_adventure_parent_credentials set failures=v_failures,blocked_until=case when v_failures>=5 then clock_timestamp()+interval '15 minutes' else null end where adventure_family_id=p_family;
  return jsonb_build_object('ok',false,'error','家長 PIN 不正確');
 end if;
 update public.learning_adventure_parent_credentials set failures=0,blocked_until=null where adventure_family_id=p_family;
 v_token:=encode(extensions.gen_random_bytes(32),'hex'); v_until:=clock_timestamp()+interval '15 minutes';
 insert into public.learning_adventure_parent_sessions(token_hash,adventure_family_id,expires_at) values(encode(extensions.digest(v_token,'sha256'),'hex'),p_family,v_until);
 return jsonb_build_object('ok',true,'parentSession',v_token,'expiresAt',v_until);
end $fn$;

create or replace function public.learning_adventure_parent_valid(p_family uuid,p_token text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $fn$
 select exists(select 1 from public.learning_adventure_parent_sessions s join public.learning_adventure_parent_credentials c using(adventure_family_id)
 where s.adventure_family_id=p_family and s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.expires_at>statement_timestamp() and s.created_at>=c.updated_at);
$fn$;


create table if not exists public.learning_adventure_parent_setup_grants (
 token_hash text primary key, adventure_family_id uuid not null references public.learning_adventure_families(id),
 owner_reference text not null check(length(owner_reference)>0), authority_reference text not null check(length(authority_reference)>0),
 expires_at timestamptz not null, consumed_at timestamptz, created_at timestamptz not null default now()
);
create or replace function public.learning_adventure_issue_parent_setup(p_family uuid,p_owner_reference text,p_authority_reference text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_token text;
begin
 if nullif(trim(p_owner_reference),'') is null or nullif(trim(p_authority_reference),'') is null then raise exception 'verified owner evidence required' using errcode='42501';end if;
 perform 1 from public.learning_adventure_families where id=p_family for update;
 if not found then raise exception 'unknown family';end if;
 if exists(select 1 from public.learning_adventure_parent_credentials where adventure_family_id=p_family) then return jsonb_build_object('ok',false,'error','家長驗證已設定，不能透過初始連結重設');end if;
 update public.learning_adventure_parent_setup_grants set expires_at=clock_timestamp() where adventure_family_id=p_family and consumed_at is null;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.learning_adventure_parent_setup_grants(token_hash,adventure_family_id,owner_reference,authority_reference,expires_at) values(encode(extensions.digest(v_token,'sha256'),'hex'),p_family,p_owner_reference,p_authority_reference,clock_timestamp()+interval '30 minutes');
 return jsonb_build_object('ok',true,'setupToken',v_token);
end $fn$;
create or replace function public.learning_adventure_complete_parent_setup(p_setup_token text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare g public.learning_adventure_parent_setup_grants;
begin
 if p_setup_token is null or p_setup_token!~'^[0-9a-f]{64}$' or p_pin is null or p_pin!~'^[0-9]{6,12}$' then return jsonb_build_object('ok',false,'error','設定連結或 PIN 格式不正確');end if;
 select * into g from public.learning_adventure_parent_setup_grants where token_hash=encode(extensions.digest(p_setup_token,'sha256'),'hex') for update;
 if not found or g.consumed_at is not null or g.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'error','設定連結已失效或使用過');end if;
 perform 1 from public.learning_adventure_families where id=g.adventure_family_id for update;
 if exists(select 1 from public.learning_adventure_parent_credentials where adventure_family_id=g.adventure_family_id) then return jsonb_build_object('ok',false,'error','家長驗證已設定，不能重設');end if;
 insert into public.learning_adventure_parent_credentials(adventure_family_id,pin_hash) values(g.adventure_family_id,extensions.crypt(p_pin,extensions.gen_salt('bf',10)));
 update public.learning_adventure_parent_setup_grants set consumed_at=clock_timestamp() where token_hash=g.token_hash;
 return jsonb_build_object('ok',true);
end $fn$;
create or replace function public.learning_adventure_parent_set_reward(p_family uuid,p_parent_session text,p_reward uuid,p_title text,p_price integer,p_available boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare v_id uuid;
begin
 if not public.learning_adventure_parent_valid(p_family,p_parent_session) then raise exception 'parent verification required' using errcode='42501';end if;
 if p_title is null or length(trim(p_title)) not between 1 and 80 or p_price is null or p_price not between 1 and 100000 or p_available is null then return jsonb_build_object('ok',false,'error','請確認獎品名稱與金幣價格');end if;
 if p_reward is null then
 insert into public.learning_adventure_rewards(adventure_family_id,title,price,available,proposed) values(p_family,trim(p_title),p_price,p_available,false) returning id into v_id;
 else
 update public.learning_adventure_rewards set title=trim(p_title),price=p_price,available=p_available,proposed=false where id=p_reward and adventure_family_id=p_family returning id into v_id;
 if v_id is null then raise exception 'reward scope mismatch' using errcode='42501';end if;
 end if;
 return jsonb_build_object('ok',true,'rewardId',v_id);
end $fn$;
alter table public.learning_adventure_parent_credentials enable row level security;
alter table public.learning_adventure_parent_sessions enable row level security;
alter table public.learning_adventure_parent_setup_grants enable row level security;
revoke all on public.learning_adventure_parent_credentials,public.learning_adventure_parent_sessions,public.learning_adventure_parent_setup_grants from public,anon,authenticated;
grant all on public.learning_adventure_parent_credentials,public.learning_adventure_parent_sessions,public.learning_adventure_parent_setup_grants to service_role;
revoke all on function public.learning_adventure_parent_login(uuid,text),public.learning_adventure_parent_valid(uuid,text),public.learning_adventure_issue_parent_setup(uuid,text,text),public.learning_adventure_complete_parent_setup(text,text),public.learning_adventure_parent_set_reward(uuid,text,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.learning_adventure_parent_login(uuid,text),public.learning_adventure_parent_valid(uuid,text),public.learning_adventure_issue_parent_setup(uuid,text,text),public.learning_adventure_complete_parent_setup(text,text),public.learning_adventure_parent_set_reward(uuid,text,uuid,text,integer,boolean) to service_role;
commit;
