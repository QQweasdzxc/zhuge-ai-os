-- Investment Phase 1-3: transaction ledger, canonical position calculation,
-- and zero-quantity historical position projection.
--
-- Scope: Investment domain only. Existing opening_positions and transactions
-- are not rewritten. Opening positions remain the baseline; only transactions
-- created after the activation boundary below participate in the calculation.

begin;

create table if not exists private.investment_transaction_lifecycle_contract (
  contract_key text primary key,
  activation_at timestamptz not null,
  calculation_method text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table private.investment_transaction_lifecycle_contract from public, anon, authenticated;

insert into private.investment_transaction_lifecycle_contract (
  contract_key,
  activation_at,
  calculation_method
) values (
  'investment-transaction-lifecycle-v1',
  now(),
  'opening_baseline_plus_post_activation_transactions_moving_weighted_average_v1'
)
on conflict (contract_key) do nothing;

alter table public.transactions
  add column if not exists idempotency_key text;

create unique index if not exists transactions_user_portfolio_idempotency_key_idx
  on public.transactions (user_id, portfolio_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.transactions.idempotency_key is
  'Investment transaction write idempotency key; populated only by the controlled Investment RPC.';

-- Browser clients may read their owner-scoped rows through RLS, but all new
-- transaction writes must use the controlled RPC below. Remove the legacy
-- broad grants first so anon cannot retain a table-level write surface.
revoke all on table public.transactions from public, anon, authenticated;
grant select on table public.transactions to authenticated, service_role;

-- Historical/closed position projections need an explicit, non-authoritative
-- link kind. These links remain C-card projections; they never store finance
-- values or become a second position source of truth.
alter table public.investment_ivtk_card_links
  drop constraint if exists investment_ivtk_card_links_source_kind_check;
alter table public.investment_ivtk_card_links
  add constraint investment_ivtk_card_links_source_kind_check
  check (source_kind = any (array['opening_position'::text, 'broker_snapshot_item'::text, 'transaction_position'::text, 'watchlist'::text]));

alter table public.investment_ivtk_card_links
  drop constraint if exists investment_ivtk_card_links_card_kind_check;
alter table public.investment_ivtk_card_links
  add constraint investment_ivtk_card_links_card_kind_check
  check (card_kind = any (array['position'::text, 'history'::text, 'watchlist'::text]));

-- Investment history has its own domain workspace data, while the C board
-- engine remains the renderer and projection authority.
insert into public.board_workspaces (
  workspace_key,
  name,
  sort_order,
  active,
  created_by,
  updated_by,
  application_scope,
  owner_uuid,
  board_instance_id
)
select
  'ivtk-history',
  '投資紀錄',
  40,
  true,
  instance.created_by,
  instance.created_by,
  null,
  instance.owner_uuid,
  instance.id
from public.board_instances instance
where instance.active = true
  and instance.template_key = 'c'
  and upper(instance.task_code_prefix) = 'IVTK'
  and instance.is_template_instance = false
on conflict (board_instance_id, workspace_key) do nothing;

create or replace function public.investment_calculated_positions()
returns table (
  source_kind text,
  source_id uuid,
  source_snapshot_id uuid,
  user_id uuid,
  portfolio_id uuid,
  effective_at timestamptz,
  symbol text,
  name text,
  market text,
  asset_type text,
  quantity numeric,
  avg_cost numeric,
  invested_cost numeric,
  last_price numeric,
  market_value numeric,
  unrealized_pnl numeric,
  unrealized_pct numeric,
  currency text,
  account text,
  source text,
  market_value_source text,
  raw_broker_values jsonb,
  note text,
  realized_pnl numeric,
  ever_held boolean,
  position_status text,
  baseline_at timestamptz,
  calculation_source text
)
language plpgsql
security invoker
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_activation_at timestamptz;
  v_key record;
  v_baseline record;
  v_event record;
  v_baseline_found boolean;
  v_portfolio_snapshot_at timestamptz;
  v_source_kind text;
  v_source_id uuid;
  v_source_snapshot_id uuid;
  v_user_id uuid;
  v_portfolio_id uuid;
  v_effective_at timestamptz;
  v_baseline_at timestamptz;
  v_symbol text;
  v_name text;
  v_market text;
  v_asset_type text;
  v_currency text;
  v_account text;
  v_source text;
  v_market_value_source text;
  v_raw_broker_values jsonb;
  v_note text;
  v_quantity numeric := 0;
  v_avg_cost numeric := 0;
  v_invested_cost numeric := 0;
  v_last_price numeric;
  v_market_value numeric;
  v_unrealized_pnl numeric;
  v_unrealized_pct numeric;
  v_realized_pnl numeric := 0;
  v_ever_held boolean := false;
  v_invalid boolean := false;
  v_event_count integer := 0;
  v_first_event_id uuid;
  v_event_at timestamptz;
  v_buy_cost numeric;
  v_sell_proceeds numeric;
  v_trade_type text;
  v_position_status text;
  v_calculation_source text;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_AUTH_REQUIRED';
  end if;

  v_owner_id := private.investment_current_owner_id();
  if v_owner_id is null then
    return;
  end if;

  select contract.activation_at
    into v_activation_at
  from private.investment_transaction_lifecycle_contract contract
  where contract.contract_key = 'investment-transaction-lifecycle-v1';
  if v_activation_at is null then
    raise exception using errcode = 'P0002', message = 'INVESTMENT_TRANSACTION_CONTRACT_REQUIRED';
  end if;

  -- A key is either a current baseline row or a post-activation transaction
  -- identity. The latest confirmed broker snapshot replaces opening_positions
  -- for its portfolio, matching the existing Investment source precedence.
  for v_key in
    with latest_snapshot as (
      select distinct on (snapshot.user_id, snapshot.portfolio_id)
        snapshot.id,
        snapshot.user_id,
        snapshot.portfolio_id,
        snapshot.snapshot_at
      from public.broker_position_snapshots snapshot
      where snapshot.user_id = v_owner_id
        and snapshot.verification = 'pm_confirmed'
      order by snapshot.user_id, snapshot.portfolio_id, snapshot.snapshot_at desc, snapshot.created_at desc, snapshot.id desc
    ), baseline as (
      select latest.user_id, latest.portfolio_id, item.market, item.symbol
      from latest_snapshot latest
      join public.broker_position_snapshot_items item on item.snapshot_id = latest.id
      union
      select position.user_id, position.portfolio_id, position.market, position.symbol
      from public.opening_positions position
      where position.user_id = v_owner_id
        and not exists (
          select 1
          from latest_snapshot latest
          where latest.user_id = position.user_id
            and latest.portfolio_id is not distinct from position.portfolio_id
        )
    )
    select baseline.user_id, baseline.portfolio_id, baseline.market, baseline.symbol
    from baseline
    union
    select transaction.user_id, transaction.portfolio_id, transaction.market, transaction.symbol
    from public.transactions transaction
    where transaction.user_id = v_owner_id
    order by 1, 2, 3, 4
  loop
    v_baseline := null;
    v_baseline_found := false;

    with latest_snapshot as (
      select distinct on (snapshot.user_id, snapshot.portfolio_id)
        snapshot.id,
        snapshot.user_id,
        snapshot.portfolio_id,
        snapshot.broker,
        snapshot.snapshot_at,
        snapshot.source,
        snapshot.created_at
      from public.broker_position_snapshots snapshot
      where snapshot.user_id = v_owner_id
        and snapshot.verification = 'pm_confirmed'
      order by snapshot.user_id, snapshot.portfolio_id, snapshot.snapshot_at desc, snapshot.created_at desc, snapshot.id desc
    ), baseline as (
      select
        'broker_snapshot_item'::text as source_kind,
        item.id as source_id,
        latest.id as source_snapshot_id,
        latest.user_id,
        latest.portfolio_id,
        latest.snapshot_at as baseline_at,
        item.symbol,
        item.name,
        item.market,
        'position'::text as asset_type,
        item.quantity,
        item.avg_cost,
        item.invested_cost,
        item.last_price,
        item.market_value,
        item.unrealized_pnl,
        item.unrealized_pct,
        item.currency,
        latest.broker as account,
        latest.source,
        item.market_value_source,
        item.raw_broker_values,
        null::text as note
      from latest_snapshot latest
      join public.broker_position_snapshot_items item on item.snapshot_id = latest.id
      union all
      select
        'opening_position'::text as source_kind,
        position.id as source_id,
        null::uuid as source_snapshot_id,
        position.user_id,
        position.portfolio_id,
        position.bootstrap_at as baseline_at,
        position.symbol,
        position.name,
        position.market,
        position.asset_type,
        position.quantity,
        position.avg_cost,
        position.invested_cost,
        position.last_price,
        position.market_value,
        position.unrealized_pnl,
        position.unrealized_pct,
        position.currency,
        position.account,
        position.source,
        'legacy_opening_position'::text as market_value_source,
        '{}'::jsonb as raw_broker_values,
        position.note
      from public.opening_positions position
      where position.user_id = v_owner_id
        and not exists (
          select 1
          from latest_snapshot latest
          where latest.user_id = position.user_id
            and latest.portfolio_id is not distinct from position.portfolio_id
        )
    )
    select baseline.*
      into v_baseline
    from baseline
    where baseline.user_id = v_key.user_id
      and baseline.portfolio_id is not distinct from v_key.portfolio_id
      and upper(trim(baseline.market)) = upper(trim(v_key.market))
      and baseline.symbol = v_key.symbol
    order by baseline.baseline_at desc, baseline.source_id desc
    limit 1;
    v_baseline_found := found;

    select latest.snapshot_at
      into v_portfolio_snapshot_at
    from (
      select distinct on (snapshot.user_id, snapshot.portfolio_id)
        snapshot.user_id,
        snapshot.portfolio_id,
        snapshot.snapshot_at
      from public.broker_position_snapshots snapshot
      where snapshot.user_id = v_owner_id
        and snapshot.verification = 'pm_confirmed'
      order by snapshot.user_id, snapshot.portfolio_id, snapshot.snapshot_at desc, snapshot.created_at desc, snapshot.id desc
    ) latest
    where latest.user_id = v_key.user_id
      and latest.portfolio_id is not distinct from v_key.portfolio_id;

    v_user_id := v_key.user_id;
    v_portfolio_id := v_key.portfolio_id;
    v_market := upper(trim(coalesce(v_key.market, '')));
    v_symbol := trim(coalesce(v_key.symbol, ''));
    v_event_count := 0;
    v_invalid := false;
    v_first_event_id := null;
    v_realized_pnl := 0;
    v_effective_at := null;

    if v_baseline_found then
      v_source_kind := v_baseline.source_kind;
      v_source_id := v_baseline.source_id;
      v_source_snapshot_id := v_baseline.source_snapshot_id;
      v_baseline_at := v_baseline.baseline_at;
      v_effective_at := v_baseline.baseline_at;
      v_name := v_baseline.name;
      v_asset_type := v_baseline.asset_type;
      v_currency := v_baseline.currency;
      v_account := v_baseline.account;
      v_source := v_baseline.source;
      v_market_value_source := v_baseline.market_value_source;
      v_raw_broker_values := v_baseline.raw_broker_values;
      v_note := v_baseline.note;
      v_quantity := coalesce(v_baseline.quantity, 0);
      v_avg_cost := coalesce(v_baseline.avg_cost, 0);
      v_invested_cost := coalesce(v_baseline.invested_cost, v_quantity * v_avg_cost);
      v_last_price := v_baseline.last_price;
      v_market_value := v_baseline.market_value;
      v_unrealized_pnl := v_baseline.unrealized_pnl;
      v_unrealized_pct := v_baseline.unrealized_pct;
      v_ever_held := v_quantity > 0;
    else
      -- A transaction-only position is allowed only for post-activation
      -- events. The existing historical three rows therefore cannot seed a
      -- new current position.
      v_source_kind := 'transaction_position';
      v_source_snapshot_id := null;
      v_baseline_at := v_portfolio_snapshot_at;
      v_effective_at := v_portfolio_snapshot_at;
      v_name := '';
      v_asset_type := 'stock';
      v_currency := case when v_market = 'US' then 'USD' else 'TWD' end;
      v_account := '';
      v_source := 'investment_transaction_runtime_v1';
      v_market_value_source := 'transaction_calculated';
      v_raw_broker_values := '{}'::jsonb;
      v_note := '';
      v_quantity := 0;
      v_avg_cost := 0;
      v_invested_cost := 0;
      v_last_price := null;
      v_market_value := null;
      v_unrealized_pnl := null;
      v_unrealized_pct := null;
      v_ever_held := false;
    end if;

    for v_event in
      select
        transaction.id,
        transaction.trade_date,
        transaction.trade_type,
        transaction.symbol,
        transaction.name,
        transaction.market,
        transaction.quantity,
        transaction.price,
        transaction.gross_amount,
        transaction.fee,
        transaction.tax,
        transaction.net_amount,
        transaction.currency,
        transaction.account,
        transaction.source,
        transaction.note,
        transaction.created_at
      from public.transactions transaction
      where transaction.user_id = v_owner_id
        and transaction.portfolio_id is not distinct from v_portfolio_id
        and upper(trim(transaction.market)) = v_market
        and trim(transaction.symbol) = v_symbol
        and transaction.created_at >= v_activation_at
        and (
          v_baseline_at is null
          or transaction.trade_date > (v_baseline_at at time zone 'Asia/Taipei')::date
        )
      order by transaction.trade_date asc, transaction.created_at asc, transaction.id asc
    loop
      v_event_count := v_event_count + 1;
      if v_first_event_id is null then
        v_first_event_id := v_event.id;
        if not v_baseline_found then
          v_source_id := v_event.id;
          v_name := coalesce(nullif(trim(v_event.name), ''), v_name);
          v_currency := coalesce(nullif(upper(trim(v_event.currency)), ''), v_currency);
        end if;
      end if;
      v_event_at := (v_event.trade_date::timestamp at time zone 'Asia/Taipei');
      if v_effective_at is null or v_event_at > v_effective_at then
        v_effective_at := v_event_at;
      end if;

      v_trade_type := case lower(trim(coalesce(v_event.trade_type, '')))
        when 'buy' then 'BUY'
        when '買入' then 'BUY'
        when '買進' then 'BUY'
        when 'dca' then 'BUY'
        when '定期定額' then 'BUY'
        when 'sell' then 'SELL'
        when '賣出' then 'SELL'
        else 'UNSUPPORTED'
      end;

      if v_trade_type = 'BUY' then
        v_buy_cost := coalesce(v_event.quantity, 0) * coalesce(v_event.price, 0)
          + coalesce(v_event.fee, 0) + coalesce(v_event.tax, 0);
        if coalesce(v_event.quantity, 0) <= 0 or v_buy_cost < 0 then
          v_invalid := true;
        else
          v_invested_cost := v_invested_cost + v_buy_cost;
          v_quantity := v_quantity + v_event.quantity;
          if v_quantity > 0 then
            v_avg_cost := v_invested_cost / v_quantity;
          end if;
          v_ever_held := true;
        end if;
      elsif v_trade_type = 'SELL' then
        v_sell_proceeds := coalesce(v_event.quantity, 0) * coalesce(v_event.price, 0)
          - coalesce(v_event.fee, 0) - coalesce(v_event.tax, 0);
        if coalesce(v_event.quantity, 0) <= 0 or v_event.quantity > v_quantity or v_quantity <= 0 then
          v_invalid := true;
        else
          v_realized_pnl := v_realized_pnl + v_sell_proceeds - (v_avg_cost * v_event.quantity);
          v_quantity := v_quantity - v_event.quantity;
          v_invested_cost := v_avg_cost * v_quantity;
          if v_quantity = 0 then
            v_avg_cost := 0;
            v_invested_cost := 0;
          end if;
        end if;
      else
        v_invalid := true;
      end if;
    end loop;

    if not v_baseline_found and v_event_count = 0 then
      continue;
    end if;
    if not v_ever_held and v_quantity <= 0 then
      continue;
    end if;

    if v_invalid then
      v_position_status := 'invalid';
    elsif v_quantity > 0 then
      v_position_status := 'current';
    else
      v_position_status := 'history';
    end if;

    if v_event_count = 0 and v_baseline_found then
      v_calculation_source := 'opening_or_broker_snapshot_baseline';
    else
      v_calculation_source := 'opening_or_broker_snapshot_plus_post_activation_transactions_v1';
      if v_position_status = 'history' then
        v_market_value := 0;
        v_unrealized_pnl := 0;
        v_unrealized_pct := 0;
      elsif v_last_price is null then
        v_market_value := null;
        v_unrealized_pnl := null;
        v_unrealized_pct := null;
      else
        v_market_value := v_quantity * v_last_price;
        v_unrealized_pnl := v_market_value - v_invested_cost;
        v_unrealized_pct := case when v_invested_cost <> 0 then v_unrealized_pnl / v_invested_cost * 100 else 0 end;
      end if;
    end if;

    if not v_baseline_found then
      v_source := 'investment_transaction_runtime_v1';
      v_market_value_source := 'transaction_calculated';
    end if;

    return query select
      v_source_kind,
      v_source_id,
      v_source_snapshot_id,
      v_user_id,
      v_portfolio_id,
      v_effective_at,
      v_symbol,
      v_name,
      v_market,
      v_asset_type,
      v_quantity,
      v_avg_cost,
      v_invested_cost,
      v_last_price,
      v_market_value,
      v_unrealized_pnl,
      v_unrealized_pct,
      v_currency,
      v_account,
      v_source,
      v_market_value_source,
      v_raw_broker_values,
      v_note,
      v_realized_pnl,
      v_ever_held,
      v_position_status,
      v_baseline_at,
      v_calculation_source;
  end loop;
end;
$function$;

-- PostgreSQL cannot add columns through CREATE OR REPLACE VIEW. The current
-- view has only the legacy 23-column shape, so replace that compatibility
-- surface in-place with the enriched result from the same canonical function.
drop view if exists public.investment_current_positions_view;

create view public.investment_current_positions_view (
  source_kind,
  source_id,
  source_snapshot_id,
  user_id,
  portfolio_id,
  effective_at,
  symbol,
  name,
  market,
  asset_type,
  quantity,
  avg_cost,
  invested_cost,
  last_price,
  market_value,
  unrealized_pnl,
  unrealized_pct,
  currency,
  account,
  source,
  market_value_source,
  raw_broker_values,
  note,
  realized_pnl,
  ever_held,
  position_status,
  baseline_at,
  calculation_source
)
as
select
  position.source_kind,
  position.source_id,
  position.source_snapshot_id,
  position.user_id,
  position.portfolio_id,
  position.effective_at,
  position.symbol,
  position.name,
  position.market,
  position.asset_type,
  position.quantity,
  position.avg_cost,
  position.invested_cost,
  position.last_price,
  position.market_value,
  position.unrealized_pnl,
  position.unrealized_pct,
  position.currency,
  position.account,
  position.source,
  position.market_value_source,
  position.raw_broker_values,
  position.note,
  position.realized_pnl,
  position.ever_held,
  position.position_status,
  position.baseline_at,
  position.calculation_source
from public.investment_calculated_positions() position;

comment on view public.investment_current_positions_view is
  'Canonical Investment position result: Opening Baseline plus post-activation buy/sell transactions using moving weighted average cost. Zero-quantity ever-held positions are history; no transaction is double-counted before the activation boundary.';

alter view public.investment_current_positions_view set (security_invoker = true);
grant select on public.investment_current_positions_view to authenticated, service_role;
revoke execute on function public.investment_calculated_positions() from public, anon;
grant execute on function public.investment_calculated_positions() to authenticated, service_role;

create or replace function public.investment_record_transaction(
  p_portfolio_id uuid,
  p_trade_date date,
  p_trade_type text,
  p_symbol text,
  p_name text default null,
  p_market text default 'TW',
  p_quantity numeric default null,
  p_price numeric default null,
  p_fee numeric default 0,
  p_tax numeric default 0,
  p_currency text default 'TWD',
  p_account text default null,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_activation_at timestamptz;
  v_trade_type text;
  v_symbol text := trim(coalesce(p_symbol, ''));
  v_market text := upper(trim(coalesce(p_market, '')));
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_portfolio public.portfolios%rowtype;
  v_existing public.transactions%rowtype;
  v_baseline_at timestamptz;
  v_current_quantity numeric := 0;
  v_gross_amount numeric;
  v_fee numeric := coalesce(p_fee, 0);
  v_tax numeric := coalesce(p_tax, 0);
  v_net_amount numeric;
  v_inserted public.transactions%rowtype;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_TRANSACTION_AUTH_REQUIRED';
  end if;
  if not ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed()) then
    raise exception using errcode = '42501', message = 'INVESTMENT_TRANSACTION_AAL2_REQUIRED';
  end if;
  if p_trade_date is null then
    raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_DATE_REQUIRED';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 or length(trim(p_idempotency_key)) > 200 then
    raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if v_symbol = '' or length(v_symbol) > 64 then
    raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_SYMBOL_REQUIRED';
  end if;
  if v_market not in ('TW', 'US') or v_currency not in ('TWD', 'USD') then
    raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_MARKET_CURRENCY_INVALID';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_price is null or p_price < 0 or v_fee < 0 or v_tax < 0 then
    raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_NUMERIC_VALUES_INVALID';
  end if;

  v_trade_type := case lower(trim(coalesce(p_trade_type, '')))
    when 'buy' then '買進'
    when '買入' then '買進'
    when '買進' then '買進'
    when 'sell' then '賣出'
    when '賣出' then '賣出'
    else null
  end;
  if v_trade_type is null then
    raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_TRADE_TYPE_INVALID';
  end if;

  v_owner_id := private.investment_current_owner_id();
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_OWNER_MAPPING_REQUIRED';
  end if;

  select contract.activation_at
    into v_activation_at
  from private.investment_transaction_lifecycle_contract contract
  where contract.contract_key = 'investment-transaction-lifecycle-v1';
  if v_activation_at is null then
    raise exception using errcode = 'P0002', message = 'INVESTMENT_TRANSACTION_CONTRACT_REQUIRED';
  end if;

  select portfolio.*
    into v_portfolio
  from public.portfolios portfolio
  where portfolio.id = p_portfolio_id
    and portfolio.user_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'INVESTMENT_PORTFOLIO_SCOPE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext(concat('investment:transaction:', v_owner_id::text, ':', p_portfolio_id::text, ':', v_market, ':', v_symbol)));

  select transaction.*
    into v_existing
  from public.transactions transaction
  where transaction.user_id = v_owner_id
    and transaction.portfolio_id = p_portfolio_id
    and transaction.idempotency_key = trim(p_idempotency_key)
  for update;
  if found then
    return jsonb_build_object(
      'transaction_id', v_existing.id,
      'portfolio_id', v_existing.portfolio_id,
      'trade_type', v_existing.trade_type,
      'symbol', v_existing.symbol,
      'idempotent', true,
      'calculation_source', 'investment_current_positions_view'
    );
  end if;

  select max(snapshot.snapshot_at)
    into v_baseline_at
  from public.broker_position_snapshots snapshot
  where snapshot.user_id = v_owner_id
    and snapshot.portfolio_id = p_portfolio_id
    and snapshot.verification = 'pm_confirmed';
  if v_baseline_at is null then
    select max(position.bootstrap_at)
      into v_baseline_at
    from public.opening_positions position
    where position.user_id = v_owner_id
      and position.portfolio_id = p_portfolio_id
      and upper(trim(position.market)) = v_market
      and trim(position.symbol) = v_symbol;
  end if;
  if v_baseline_at is not null and p_trade_date <= (v_baseline_at at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_BEFORE_OPENING_BASELINE';
  end if;

  if v_trade_type = '賣出' then
    select coalesce(position.quantity, 0)
      into v_current_quantity
    from public.investment_current_positions_view position
    where position.user_id = v_owner_id
      and position.portfolio_id = p_portfolio_id
      and upper(trim(position.market)) = v_market
      and trim(position.symbol) = v_symbol
      and position.position_status = 'current'
    order by position.effective_at desc, position.source_id desc
    limit 1;
    if p_quantity > coalesce(v_current_quantity, 0) then
      raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_SELL_EXCEEDS_POSITION';
    end if;
  end if;

  v_gross_amount := p_quantity * p_price;
  v_net_amount := case when v_trade_type = '買進'
    then -(v_gross_amount + v_fee + v_tax)
    else v_gross_amount - v_fee - v_tax
  end;

  insert into public.transactions (
    user_id,
    portfolio_id,
    trade_date,
    trade_type,
    symbol,
    name,
    market,
    quantity,
    price,
    gross_amount,
    fee,
    tax,
    net_amount,
    currency,
    account,
    source,
    note,
    idempotency_key
  ) values (
    v_owner_id,
    p_portfolio_id,
    p_trade_date,
    v_trade_type,
    v_symbol,
    nullif(trim(coalesce(p_name, '')), ''),
    v_market,
    p_quantity,
    p_price,
    v_gross_amount,
    v_fee,
    v_tax,
    v_net_amount,
    v_currency,
    nullif(trim(coalesce(p_account, '')), ''),
    'investment_transaction_runtime_v1',
    nullif(trim(coalesce(p_note, '')), ''),
    trim(p_idempotency_key)
  )
  returning * into v_inserted;

  return jsonb_build_object(
    'transaction_id', v_inserted.id,
    'portfolio_id', v_inserted.portfolio_id,
    'trade_date', v_inserted.trade_date,
    'trade_type', v_inserted.trade_type,
    'symbol', v_inserted.symbol,
    'quantity', v_inserted.quantity,
    'price', v_inserted.price,
    'gross_amount', v_inserted.gross_amount,
    'fee', v_inserted.fee,
    'tax', v_inserted.tax,
    'net_amount', v_inserted.net_amount,
    'idempotent', false,
    'calculation_source', 'investment_current_positions_view',
    'activation_boundary', v_activation_at
  );
end;
$function$;

revoke all on function public.investment_record_transaction(uuid, date, text, text, text, text, numeric, numeric, numeric, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.investment_record_transaction(uuid, date, text, text, text, text, numeric, numeric, numeric, numeric, text, text, text, text) to authenticated;

create or replace function public.sync_investment_ivtk_projection()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, private, pg_temp
as $function$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_owner_id uuid;
  v_instance public.board_instances%rowtype;
  v_stocks_workspace public.board_workspaces%rowtype;
  v_us_workspace public.board_workspaces%rowtype;
  v_watchlist_workspace public.board_workspaces%rowtype;
  v_history_workspace public.board_workspaces%rowtype;
  v_position_workspace public.board_workspaces%rowtype;
  v_position record;
  v_watchlist record;
  v_link public.investment_ivtk_card_links%rowtype;
  v_task public.board_tasks%rowtype;
  v_relinked boolean;
  v_link_found boolean;
  v_move_rows integer;
  v_position_card_kind text;
  v_position_count integer := 0;
  v_current_count integer := 0;
  v_history_count integer := 0;
  v_watchlist_count integer := 0;
  v_created_count integer := 0;
  v_relinked_count integer := 0;
  v_moved_count integer := 0;
  v_deactivated_count integer := 0;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_IVTK_AUTH_REQUIRED';
  end if;

  if not (
    (select auth.jwt() ->> 'aal') = 'aal2'
    or private.investment_mfa_bypassed()
  ) then
    raise exception using errcode = '42501', message = 'INVESTMENT_IVTK_AAL2_REQUIRED';
  end if;

  v_owner_id := private.investment_current_owner_id();
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_OWNER_MAPPING_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('investment:ivtk:projection:' || v_owner_id::text));

  select * into v_instance
  from public.board_instances
  where active = true
    and template_key = 'c'
    and upper(task_code_prefix) = 'IVTK'
  order by created_at
  limit 1
  for update;

  if not found or not public.board_instance_can_write(v_instance.id) then
    raise exception using errcode = '42501', message = 'INVESTMENT_IVTK_BOARD_SCOPE_REQUIRED';
  end if;

  select * into v_stocks_workspace
  from public.board_workspaces
  where board_instance_id = v_instance.id
    and workspace_key = 'ivtk-stocks'
    and active = true
  order by sort_order
  limit 1;

  select * into v_us_workspace
  from public.board_workspaces
  where board_instance_id = v_instance.id
    and lower(trim(name)) = lower(trim('投資-美股'))
    and active = true
  order by sort_order, created_at, id
  limit 1;

  select * into v_watchlist_workspace
  from public.board_workspaces
  where board_instance_id = v_instance.id
    and workspace_key = 'ivtk-watchlist'
    and active = true
  order by sort_order
  limit 1;

  select * into v_history_workspace
  from public.board_workspaces
  where board_instance_id = v_instance.id
    and workspace_key = 'ivtk-history'
    and active = true
  order by sort_order
  limit 1;

  if v_stocks_workspace.id is null
     or v_us_workspace.id is null
     or v_watchlist_workspace.id is null
     or v_history_workspace.id is null then
    raise exception using errcode = 'P0002', message = 'INVESTMENT_IVTK_WORKSPACES_REQUIRED';
  end if;

  update public.investment_ivtk_card_links link
  set active = false,
      updated_at = now()
  where link.board_instance_id = v_instance.id
    and link.user_id = v_owner_id
    and link.active = true
    and (
      (
        link.card_kind = 'position'
        and not exists (
          select 1
          from public.investment_current_positions_view current_position
          where current_position.user_id = v_owner_id
            and current_position.source_kind = link.source_kind
            and current_position.source_id = link.source_id
            and current_position.position_status = 'current'
        )
      )
      or (
        link.card_kind = 'history'
        and not exists (
          select 1
          from public.investment_current_positions_view historical_position
          where historical_position.user_id = v_owner_id
            and historical_position.source_kind = link.source_kind
            and historical_position.source_id = link.source_id
            and historical_position.position_status = 'history'
        )
      )
      or (
        link.card_kind = 'watchlist'
        and not exists (
          select 1
          from public.watchlists current_watchlist
          where current_watchlist.id = link.source_id
            and current_watchlist.user_id = v_owner_id
            and coalesce(lower(current_watchlist.status), '') not in ('archived', 'removed', 'deleted')
        )
      )
    );
  get diagnostics v_deactivated_count = row_count;

  for v_position in
    select current_position.*
    from public.investment_current_positions_view current_position
    where current_position.user_id = v_owner_id
      and current_position.position_status in ('current', 'history')
    order by current_position.market asc, current_position.symbol asc, current_position.source_id asc
  loop
    v_position_count := v_position_count + 1;
    v_relinked := false;
    v_link := null;

    if v_position.position_status = 'history' then
      v_history_count := v_history_count + 1;
      v_position_workspace := v_history_workspace;
      v_position_card_kind := 'history';
    else
      v_current_count := v_current_count + 1;
      if upper(trim(coalesce(v_position.market, ''))) = 'US' then
        v_position_workspace := v_us_workspace;
      elsif upper(trim(coalesce(v_position.market, ''))) = 'TW' then
        v_position_workspace := v_stocks_workspace;
      else
        raise exception using errcode = 'P0002', message = 'INVESTMENT_IVTK_MARKET_WORKSPACE_REQUIRED';
      end if;
      v_position_card_kind := 'position';
    end if;

    select * into v_link
    from public.investment_ivtk_card_links link
    where link.board_instance_id = v_instance.id
      and link.source_kind = v_position.source_kind
      and link.source_id = v_position.source_id
    for update;
    v_link_found := found;

    if not v_link_found and v_position.source_kind = 'broker_snapshot_item' then
      v_link := null;
      select link.* into v_link
      from public.investment_ivtk_card_links link
      join public.broker_position_reconciliation_items reconciliation_item
        on reconciliation_item.previous_opening_position_id = link.source_id
       and reconciliation_item.current_item_id = v_position.source_id
      join public.broker_position_reconciliations reconciliation
        on reconciliation.id = reconciliation_item.reconciliation_id
       and reconciliation.user_id = v_owner_id
       and reconciliation.portfolio_id is not distinct from v_position.portfolio_id
      where link.board_instance_id = v_instance.id
        and link.user_id = v_owner_id
        and link.source_kind = 'opening_position'
        and link.card_kind = 'position'
      order by reconciliation.created_at desc, reconciliation_item.created_at desc
      limit 1;

      v_link_found := found;
      if v_link_found then
        update public.investment_ivtk_card_links link
        set source_kind = 'broker_snapshot_item',
            source_id = v_position.source_id,
            portfolio_id = v_position.portfolio_id,
            card_kind = v_position_card_kind,
            active = true,
            updated_at = now()
        where link.id = v_link.id;
        v_relinked := true;
        v_relinked_count := v_relinked_count + 1;
      end if;
    end if;

    if not v_link_found then
      v_task := public.board_instance_create_task(
        v_instance.id,
        case when v_position_card_kind = 'history' then 'Investment Historical Position Projection' else 'Investment Position Projection' end,
        'Card projection owned by Investment Cloud; financial values are read from the Investment source.',
        'not_started',
        null,
        v_position_workspace.id
      );
      insert into public.investment_ivtk_card_links (
        board_instance_id,
        board_task_id,
        user_id,
        portfolio_id,
        source_kind,
        source_id,
        card_kind,
        active,
        created_by_auth_user_id
      ) values (
        v_instance.id,
        v_task.id,
        v_owner_id,
        v_position.portfolio_id,
        v_position.source_kind,
        v_position.source_id,
        v_position_card_kind,
        true,
        v_auth_user_id
      );
      v_created_count := v_created_count + 1;
    else
      if not v_relinked and (
        not v_link.active
        or v_link.portfolio_id is distinct from v_position.portfolio_id
        or v_link.card_kind is distinct from v_position_card_kind
      ) then
        update public.investment_ivtk_card_links link
        set portfolio_id = v_position.portfolio_id,
            card_kind = v_position_card_kind,
            active = true,
            updated_at = now()
        where link.id = v_link.id;
      end if;

      update public.board_tasks task
      set workspace_id = v_position_workspace.id,
          updated_at = now()
      where task.id = v_link.board_task_id
        and task.board_instance_id = v_instance.id
        and task.workspace_id is distinct from v_position_workspace.id;
      get diagnostics v_move_rows = row_count;
      v_moved_count := v_moved_count + coalesce(v_move_rows, 0);
    end if;
  end loop;

  for v_watchlist in
    select current_watchlist.*
    from public.watchlists current_watchlist
    where current_watchlist.user_id = v_owner_id
      and coalesce(lower(current_watchlist.status), '') not in ('archived', 'removed', 'deleted')
    order by current_watchlist.importance asc, current_watchlist.updated_at desc, current_watchlist.id asc
  loop
    v_watchlist_count := v_watchlist_count + 1;
    v_link := null;

    select * into v_link
    from public.investment_ivtk_card_links link
    where link.board_instance_id = v_instance.id
      and link.source_kind = 'watchlist'
      and link.source_id = v_watchlist.id
    for update;

    if not found then
      v_task := public.board_instance_create_task(
        v_instance.id,
        'Investment Watchlist Projection',
        'Card projection owned by Investment Cloud; watchlist values are read from the Investment source.',
        'not_started',
        null,
        v_watchlist_workspace.id
      );
      insert into public.investment_ivtk_card_links (
        board_instance_id,
        board_task_id,
        user_id,
        portfolio_id,
        source_kind,
        source_id,
        card_kind,
        active,
        created_by_auth_user_id
      ) values (
        v_instance.id,
        v_task.id,
        v_owner_id,
        v_watchlist.portfolio_id,
        'watchlist',
        v_watchlist.id,
        'watchlist',
        true,
        v_auth_user_id
      );
      v_created_count := v_created_count + 1;
    elsif not v_link.active or v_link.portfolio_id is distinct from v_watchlist.portfolio_id then
      update public.investment_ivtk_card_links link
      set portfolio_id = v_watchlist.portfolio_id,
          active = true,
          updated_at = now()
      where link.id = v_link.id;
    end if;
  end loop;

  return jsonb_build_object(
    'board_instance_id', v_instance.id,
    'position_count', v_position_count,
    'current_count', v_current_count,
    'history_count', v_history_count,
    'watchlist_count', v_watchlist_count,
    'created_count', v_created_count,
    'relinked_count', v_relinked_count,
    'moved_count', v_moved_count,
    'deactivated_count', v_deactivated_count,
    'idempotent', v_created_count = 0
      and v_relinked_count = 0
      and v_moved_count = 0
      and v_deactivated_count = 0
  );
end;
$function$;

revoke all on function public.sync_investment_ivtk_projection() from public, anon;
grant execute on function public.sync_investment_ivtk_projection() to authenticated;

commit;
