-- Investment Human-in-the-loop pending action contract v1.
-- External evidence sources (AI-assisted screenshot review, broker adapters later)
-- may stage a proposal, but only the authenticated portfolio owner can confirm
-- it into the canonical transaction lifecycle.

create table if not exists public.investment_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  action_type text not null check (action_type in ('record_transaction')),
  status text not null default 'pending' check (status in ('pending','confirmed','dismissed','failed')),
  source text not null,
  source_ref text,
  title text not null,
  summary text,
  transaction_payload jsonb not null,
  evidence jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  dismissed_at timestamptz,
  transaction_id uuid references public.transactions(id) on delete set null,
  last_error text,
  unique (user_id, portfolio_id, idempotency_key)
);

create index if not exists investment_pending_actions_owner_status_idx
  on public.investment_pending_actions (user_id, status, created_at desc);

alter table public.investment_pending_actions enable row level security;
revoke all on table public.investment_pending_actions from public, anon, authenticated;
grant select on table public.investment_pending_actions to authenticated;

drop policy if exists investment_pending_actions_select_owner_aal2 on public.investment_pending_actions;
create policy investment_pending_actions_select_owner_aal2
on public.investment_pending_actions
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create or replace function public.investment_pending_action_count()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_owner_id uuid;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_PENDING_AUTH_REQUIRED';
  end if;
  v_owner_id := private.investment_current_owner_id();
  if v_owner_id is null then return 0; end if;
  select count(*)::integer into v_count
  from public.investment_pending_actions action
  where action.user_id = v_owner_id and action.status = 'pending';
  return v_count;
end;
$function$;

revoke all on function public.investment_pending_action_count() from public, anon;
grant execute on function public.investment_pending_action_count() to authenticated;

create or replace function public.investment_confirm_pending_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_action public.investment_pending_actions%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_transaction_id uuid;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_PENDING_AUTH_REQUIRED';
  end if;
  if not ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed()) then
    raise exception using errcode = '42501', message = 'INVESTMENT_PENDING_AAL2_REQUIRED';
  end if;
  v_owner_id := private.investment_current_owner_id();
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_OWNER_MAPPING_REQUIRED';
  end if;

  select action.* into v_action
  from public.investment_pending_actions action
  where action.id = p_action_id and action.user_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'INVESTMENT_PENDING_ACTION_NOT_FOUND';
  end if;
  if v_action.status = 'confirmed' and v_action.transaction_id is not null then
    return jsonb_build_object('action_id', v_action.id, 'status', v_action.status, 'transaction_id', v_action.transaction_id, 'idempotent', true);
  end if;
  if v_action.status <> 'pending' then
    raise exception using errcode = '22023', message = 'INVESTMENT_PENDING_ACTION_NOT_PENDING';
  end if;
  if v_action.action_type <> 'record_transaction' then
    raise exception using errcode = '22023', message = 'INVESTMENT_PENDING_ACTION_TYPE_INVALID';
  end if;

  v_payload := v_action.transaction_payload;
  begin
    v_result := public.investment_record_transaction(
      v_action.portfolio_id,
      (v_payload ->> 'tradeDate')::date,
      v_payload ->> 'tradeType',
      v_payload ->> 'symbol',
      nullif(v_payload ->> 'name', ''),
      coalesce(nullif(v_payload ->> 'market', ''), 'TW'),
      (v_payload ->> 'quantity')::numeric,
      (v_payload ->> 'price')::numeric,
      coalesce((v_payload ->> 'fee')::numeric, 0),
      coalesce((v_payload ->> 'tax')::numeric, 0),
      coalesce(nullif(v_payload ->> 'currency', ''), 'TWD'),
      nullif(v_payload ->> 'account', ''),
      nullif(v_payload ->> 'note', ''),
      v_action.idempotency_key
    );
    v_transaction_id := (v_result ->> 'transaction_id')::uuid;
    update public.investment_pending_actions
    set status = 'confirmed', confirmed_at = now(), transaction_id = v_transaction_id, last_error = null
    where id = v_action.id;
  exception when others then
    update public.investment_pending_actions
    set last_error = left(sqlerrm, 500)
    where id = v_action.id;
    raise;
  end;

  return jsonb_build_object('action_id', v_action.id, 'status', 'confirmed', 'transaction_id', v_transaction_id, 'idempotent', false);
end;
$function$;

revoke all on function public.investment_confirm_pending_action(uuid) from public, anon;
grant execute on function public.investment_confirm_pending_action(uuid) to authenticated;

create or replace function public.investment_dismiss_pending_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_owner_id uuid;
  v_action public.investment_pending_actions%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_PENDING_AUTH_REQUIRED';
  end if;
  v_owner_id := private.investment_current_owner_id();
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_OWNER_MAPPING_REQUIRED';
  end if;
  select action.* into v_action
  from public.investment_pending_actions action
  where action.id = p_action_id and action.user_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'INVESTMENT_PENDING_ACTION_NOT_FOUND';
  end if;
  if v_action.status = 'pending' then
    update public.investment_pending_actions set status = 'dismissed', dismissed_at = now() where id = v_action.id;
  end if;
  return jsonb_build_object('action_id', v_action.id, 'status', case when v_action.status = 'pending' then 'dismissed' else v_action.status end);
end;
$function$;

revoke all on function public.investment_dismiss_pending_action(uuid) from public, anon;
grant execute on function public.investment_dismiss_pending_action(uuid) to authenticated;
