begin;
-- Align the legacy Investment write RPCs (controlled transaction record,
-- pending-action confirm, broker position snapshot) with the saved
-- sensitive-write switch, matching the reviewed receivable split in
-- 20261118085000_investment_receivables_mfa_policy.sql:
-- aal2 always passes; aal1 passes only when the server-saved boolean
-- preference investment_sensitive_write_mfa_required is false.
-- Saved server preferences only; no caller-provided bypass, owner or
-- assurance. Unknown aal or a missing/malformed preference stays
-- fail-closed (aal2 required). The entry switch
-- (private.investment_mfa_bypassed) no longer implies a write bypass.
-- Function bodies are byte-identical to the live definitions except the
-- gate line; validation, idempotency, owner binding and state machines
-- are unchanged.
create or replace function private.investment_write_mfa_bypassed()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $policy$
  select exists (
    select 1
    from public.app_users owner
    where owner.auth_user_id = (select auth.uid())
      and lower(trim(coalesce(owner.role, ''))) in ('creator', 'owner')
      and coalesce(
        (select setting_value from public.user_settings where user_id = owner.id and setting_key = 'investment_sensitive_write_mfa_required' and jsonb_typeof(setting_value) = 'boolean' limit 1),
        'true'::jsonb
      ) = 'false'::jsonb
  );
$policy$;

revoke all on function private.investment_write_mfa_bypassed() from public, anon;
grant execute on function private.investment_write_mfa_bypassed() to authenticated;

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
  if not (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' or (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal1' and private.investment_write_mfa_bypassed())) then
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

create or replace function public.investment_confirm_pending_action(p_action_id uuid) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, auth, extensions, private, pg_temp as $function$ declare v_auth_user_id uuid := (select auth.uid()); v_owner_id uuid; v_action public.investment_pending_actions%rowtype; v_payload jsonb; v_result jsonb; v_transaction_id uuid; begin if v_auth_user_id is null then raise exception using errcode = '42501', message = 'INVESTMENT_PENDING_AUTH_REQUIRED'; end if; if not (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' or (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal1' and private.investment_write_mfa_bypassed())) then raise exception using errcode = '42501', message = 'INVESTMENT_PENDING_AAL2_REQUIRED'; end if; v_owner_id := private.investment_current_owner_id(); if v_owner_id is null then raise exception using errcode = '42501', message = 'INVESTMENT_OWNER_MAPPING_REQUIRED'; end if; select action.* into v_action from public.investment_pending_actions action where action.id = p_action_id and action.user_id = v_owner_id for update; if not found then raise exception using errcode = 'P0002', message = 'INVESTMENT_PENDING_ACTION_NOT_FOUND'; end if; if v_action.status = 'confirmed' and v_action.transaction_id is not null then return jsonb_build_object('action_id', v_action.id, 'status', v_action.status, 'transaction_id', v_action.transaction_id, 'idempotent', true); end if; if v_action.status <> 'pending' then raise exception using errcode = '22023', message = 'INVESTMENT_PENDING_ACTION_NOT_PENDING'; end if; if v_action.action_type <> 'record_transaction' then raise exception using errcode = '22023', message = 'INVESTMENT_PENDING_ACTION_TYPE_INVALID'; end if; v_payload := v_action.transaction_payload; begin v_result := public.investment_record_transaction(v_action.portfolio_id,(v_payload ->> 'tradeDate')::date,v_payload ->> 'tradeType',v_payload ->> 'symbol',nullif(v_payload ->> 'name', ''),coalesce(nullif(v_payload ->> 'market', ''), 'TW'),(v_payload ->> 'quantity')::numeric,(v_payload ->> 'price')::numeric,coalesce((v_payload ->> 'fee')::numeric, 0),coalesce((v_payload ->> 'tax')::numeric, 0),coalesce(nullif(v_payload ->> 'currency', ''), 'TWD'),nullif(v_payload ->> 'account', ''),nullif(v_payload ->> 'note', ''),v_action.idempotency_key); v_transaction_id := (v_result ->> 'transaction_id')::uuid; update public.investment_pending_actions set status = 'confirmed', confirmed_at = now(), transaction_id = v_transaction_id, last_error = null where id = v_action.id; exception when others then update public.investment_pending_actions set last_error = left(sqlerrm, 500) where id = v_action.id; raise; end; return jsonb_build_object('action_id', v_action.id, 'status', 'confirmed', 'transaction_id', v_transaction_id, 'idempotent', false); end; $function$;

create or replace function public.create_broker_position_snapshot(
  p_portfolio_id uuid,
  p_broker text,
  p_snapshot_at timestamptz,
  p_verification text,
  p_source text,
  p_idempotency_key text,
  p_positions jsonb
)
returns table (
  snapshot_id uuid,
  reconciliation_id uuid,
  previous_snapshot_id uuid,
  broker text,
  snapshot_at timestamptz,
  verification text,
  source text,
  content_hash text,
  idempotency_key text,
  position_count integer,
  created_at timestamptz,
  was_existing boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_user_id uuid;
  v_snapshot_id uuid;
  v_reconciliation_id uuid;
  v_previous_snapshot_id uuid;
  v_previous_snapshot_at timestamptz;
  v_created_at timestamptz;
  v_broker text := btrim(coalesce(p_broker, ''));
  v_source text := btrim(coalesce(p_source, ''));
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_verification text := btrim(coalesce(p_verification, ''));
  v_previous_source text := 'none';
  v_normalized jsonb := '[]'::jsonb;
  v_element jsonb;
  v_raw jsonb;
  v_symbol text;
  v_name text;
  v_market text;
  v_currency text;
  v_quantity_text text;
  v_avg_cost_text text;
  v_invested_cost_text text;
  v_last_price_text text;
  v_market_value_text text;
  v_unrealized_pnl_text text;
  v_unrealized_pct_text text;
  v_quantity numeric;
  v_avg_cost numeric;
  v_invested_cost numeric;
  v_last_price numeric;
  v_market_value numeric;
  v_unrealized_pnl numeric;
  v_unrealized_pct numeric;
  v_position_count integer;
  v_distinct_count integer;
  v_index integer;
  v_content_hash text;
  v_was_existing boolean := false;
  v_existing public.broker_position_snapshots%rowtype;
  v_compare record;
  v_status text;
  v_reason text;
  v_differences jsonb;
  v_item_count integer := 0;
  v_unchanged_count integer := 0;
  v_changed_count integer := 0;
  v_new_count integer := 0;
  v_missing_count integer := 0;
  v_unknown_count integer := 0;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'BROKER_SNAPSHOT_AUTH_REQUIRED';
  end if;

  if not (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' or (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal1' and private.investment_write_mfa_bypassed())) then
    raise exception using errcode = '42501', message = 'BROKER_SNAPSHOT_AAL2_REQUIRED';
  end if;

  select owner.id
    into v_user_id
  from public.app_users owner
  where owner.auth_user_id = v_auth_user_id
  limit 1;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'BROKER_SNAPSHOT_OWNER_MAPPING_REQUIRED';
  end if;

  if p_portfolio_id is null or not exists (
    select 1
    from public.portfolios portfolio
    where portfolio.id = p_portfolio_id
      and portfolio.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'BROKER_SNAPSHOT_PORTFOLIO_SCOPE_REQUIRED';
  end if;

  if length(v_broker) = 0 or length(v_source) = 0 or length(v_idempotency_key) < 8 then
    raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_METADATA_REQUIRED';
  end if;

  if p_snapshot_at is null then
    raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_TIME_REQUIRED';
  end if;

  if v_verification <> 'pm_confirmed' then
    raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_PM_CONFIRMATION_REQUIRED';
  end if;

  if coalesce(jsonb_typeof(p_positions), '') <> 'array' then
    raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_POSITIONS_ARRAY_REQUIRED';
  end if;

  v_position_count := jsonb_array_length(p_positions);
  if v_position_count < 1 or v_position_count > 100 then
    raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_POSITION_COUNT_INVALID';
  end if;

  for v_index in 0..v_position_count - 1 loop
    v_element := p_positions -> v_index;
    if coalesce(jsonb_typeof(v_element), '') <> 'object' then
      raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_POSITION_OBJECT_REQUIRED';
    end if;

    v_symbol := btrim(coalesce(v_element ->> 'symbol', ''));
    v_name := btrim(coalesce(v_element ->> 'name', ''));
    v_market := upper(btrim(coalesce(v_element ->> 'market', '')));
    v_currency := upper(btrim(coalesce(v_element ->> 'currency', '')));
    v_quantity_text := nullif(btrim(coalesce(v_element ->> 'quantity', '')), '');
    v_avg_cost_text := nullif(btrim(coalesce(v_element ->> 'avg_cost', v_element ->> 'average_cost', '')), '');
    v_invested_cost_text := nullif(btrim(coalesce(v_element ->> 'invested_cost', v_element ->> 'total_cost', '')), '');
    v_last_price_text := nullif(btrim(coalesce(v_element ->> 'last_price', v_element ->> 'current_price', '')), '');
    v_market_value_text := nullif(btrim(coalesce(v_element ->> 'market_value', '')), '');
    v_unrealized_pnl_text := nullif(btrim(coalesce(v_element ->> 'unrealized_pnl', '')), '');
    v_unrealized_pct_text := nullif(btrim(coalesce(v_element ->> 'unrealized_pct', v_element ->> 'return_rate', '')), '');

    if v_symbol = '' or v_name = '' or v_market = '' or v_currency = ''
       or v_quantity_text is null or v_avg_cost_text is null
       or v_invested_cost_text is null or v_last_price_text is null
       or v_market_value_text is null or v_unrealized_pnl_text is null
       or v_unrealized_pct_text is null then
      raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_POSITION_REQUIRED_FIELD';
    end if;

    begin
      v_quantity := v_quantity_text::numeric;
      v_avg_cost := v_avg_cost_text::numeric;
      v_invested_cost := v_invested_cost_text::numeric;
      v_last_price := v_last_price_text::numeric;
      v_market_value := v_market_value_text::numeric;
      v_unrealized_pnl := v_unrealized_pnl_text::numeric;
      v_unrealized_pct := v_unrealized_pct_text::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_POSITION_NUMERIC_FIELD_INVALID';
    end;

    if v_quantity < 0 or v_avg_cost < 0 or v_invested_cost < 0
       or v_last_price < 0 or v_market_value < 0 then
      raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_POSITION_VALUE_INVALID';
    end if;

    v_raw := coalesce(v_element -> 'raw_broker_values', v_element -> 'raw');
    if v_raw is null or jsonb_typeof(v_raw) <> 'object' then
      v_raw := jsonb_build_object(
        'symbol', v_element -> 'symbol',
        'name', v_element -> 'name',
        'market', v_element -> 'market',
        'currency', v_element -> 'currency',
        'quantity', v_element -> 'quantity',
        'average_cost', coalesce(v_element -> 'average_cost', v_element -> 'avg_cost'),
        'total_cost', coalesce(v_element -> 'total_cost', v_element -> 'invested_cost'),
        'current_price', coalesce(v_element -> 'current_price', v_element -> 'last_price'),
        'market_value', v_element -> 'market_value',
        'unrealized_pnl', v_element -> 'unrealized_pnl',
        'return_rate', coalesce(v_element -> 'return_rate', v_element -> 'unrealized_pct')
      );
    end if;

    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'symbol', v_symbol,
      'name', v_name,
      'market', v_market,
      'currency', v_currency,
      'quantity', v_quantity,
      'avg_cost', v_avg_cost,
      'invested_cost', v_invested_cost,
      'last_price', v_last_price,
      'market_value', v_market_value,
      'unrealized_pnl', v_unrealized_pnl,
      'unrealized_pct', v_unrealized_pct,
      'market_value_source', 'broker_supplied',
      'raw_broker_values', v_raw
    ));
  end loop;

  select count(*)::integer
    into v_distinct_count
  from (
    select distinct value ->> 'market', value ->> 'symbol'
    from jsonb_array_elements(v_normalized)
  ) identities;

  if v_distinct_count <> v_position_count then
    raise exception using errcode = '22023', message = 'BROKER_SNAPSHOT_DUPLICATE_POSITION_IDENTITY';
  end if;

  select coalesce(jsonb_agg(value order by value ->> 'market', value ->> 'symbol'), '[]'::jsonb)
    into v_normalized
  from jsonb_array_elements(v_normalized) elements(value);

  v_content_hash := encode(
    extensions.digest(convert_to(v_normalized::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.broker_position_snapshots (
    user_id,
    portfolio_id,
    broker,
    snapshot_at,
    verification,
    position_count,
    source,
    content_hash,
    idempotency_key,
    created_by_auth_user_id
  ) values (
    v_user_id,
    p_portfolio_id,
    v_broker,
    p_snapshot_at,
    v_verification,
    v_position_count,
    v_source,
    v_content_hash,
    v_idempotency_key,
    v_auth_user_id
  )
  on conflict do nothing
  returning id, created_at into v_snapshot_id, v_created_at;

  if v_snapshot_id is null then
    select *
      into v_existing
    from public.broker_position_snapshots snapshot
    where snapshot.user_id = v_user_id
      and snapshot.portfolio_id = p_portfolio_id
      and snapshot.idempotency_key = v_idempotency_key
    limit 1;

    if found then
      if v_existing.content_hash <> v_content_hash
         or v_existing.broker <> v_broker
         or v_existing.snapshot_at is distinct from p_snapshot_at
         or v_existing.verification <> v_verification
         or v_existing.position_count <> v_position_count
         or v_existing.source <> v_source then
        raise exception using errcode = '23505', message = 'BROKER_SNAPSHOT_IDEMPOTENCY_KEY_REUSE_CONFLICT';
      end if;
      v_snapshot_id := v_existing.id;
      v_created_at := v_existing.created_at;
      v_was_existing := true;
    else
      select *
        into v_existing
      from public.broker_position_snapshots snapshot
      where snapshot.user_id = v_user_id
        and snapshot.portfolio_id = p_portfolio_id
        and snapshot.broker = v_broker
        and snapshot.snapshot_at = p_snapshot_at
        and snapshot.content_hash = v_content_hash
      limit 1;

      if found then
        if v_existing.verification <> v_verification
           or v_existing.position_count <> v_position_count
           or v_existing.source <> v_source then
          raise exception using errcode = '23505', message = 'BROKER_SNAPSHOT_CONTENT_METADATA_CONFLICT';
        end if;
        v_snapshot_id := v_existing.id;
        v_created_at := v_existing.created_at;
        v_was_existing := true;
      else
        raise exception using errcode = '40001', message = 'BROKER_SNAPSHOT_IDEMPOTENT_INSERT_UNRESOLVED';
      end if;
    end if;
  end if;

  if v_was_existing then
    select reconciliation.id
      into v_reconciliation_id
    from public.broker_position_reconciliations reconciliation
    where reconciliation.current_snapshot_id = v_snapshot_id
    limit 1;

    if v_reconciliation_id is null then
      raise exception using errcode = '40001', message = 'BROKER_SNAPSHOT_RECONCILIATION_MISSING';
    end if;

    insert into public.broker_position_snapshot_audits (
      snapshot_id,
      reconciliation_id,
      user_id,
      portfolio_id,
      auth_user_id,
      action,
      idempotency_key,
      content_hash,
      position_count
    ) values (
      v_snapshot_id,
      v_reconciliation_id,
      v_user_id,
      p_portfolio_id,
      v_auth_user_id,
      'idempotent_replay',
      v_idempotency_key,
      v_content_hash,
      v_position_count
    ) on conflict do nothing;

    return query
    select snapshot.id,
           reconciliation.id,
           reconciliation.previous_snapshot_id,
           snapshot.broker,
           snapshot.snapshot_at,
           snapshot.verification,
           snapshot.source,
           snapshot.content_hash,
           snapshot.idempotency_key,
           snapshot.position_count,
           snapshot.created_at,
           true
    from public.broker_position_snapshots snapshot
    join public.broker_position_reconciliations reconciliation
      on reconciliation.current_snapshot_id = snapshot.id
    where snapshot.id = v_snapshot_id;
    return;
  end if;

  insert into public.broker_position_snapshot_items (
    snapshot_id,
    symbol,
    name,
    market,
    currency,
    quantity,
    avg_cost,
    invested_cost,
    last_price,
    market_value,
    unrealized_pnl,
    unrealized_pct,
    market_value_source,
    raw_broker_values
  )
  select
    v_snapshot_id,
    value ->> 'symbol',
    value ->> 'name',
    value ->> 'market',
    value ->> 'currency',
    (value ->> 'quantity')::numeric,
    (value ->> 'avg_cost')::numeric,
    (value ->> 'invested_cost')::numeric,
    (value ->> 'last_price')::numeric,
    (value ->> 'market_value')::numeric,
    (value ->> 'unrealized_pnl')::numeric,
    (value ->> 'unrealized_pct')::numeric,
    value ->> 'market_value_source',
    value -> 'raw_broker_values'
  from jsonb_array_elements(v_normalized) elements(value);

  select snapshot.id, snapshot.snapshot_at
    into v_previous_snapshot_id, v_previous_snapshot_at
  from public.broker_position_snapshots snapshot
  where snapshot.user_id = v_user_id
    and snapshot.portfolio_id = p_portfolio_id
    and snapshot.verification = 'pm_confirmed'
    and (
      snapshot.snapshot_at < p_snapshot_at
      or (snapshot.snapshot_at = p_snapshot_at and snapshot.created_at < v_created_at)
    )
  order by snapshot.snapshot_at desc, snapshot.created_at desc, snapshot.id desc
  limit 1;

  if v_previous_snapshot_id is not null then
    v_previous_source := 'broker_position_snapshot';
  elsif exists (
    select 1
    from public.opening_positions opening
    where opening.user_id = v_user_id
      and opening.portfolio_id = p_portfolio_id
  ) then
    v_previous_source := 'legacy_opening_positions';
  end if;

  insert into public.broker_position_reconciliations (
    user_id,
    portfolio_id,
    previous_snapshot_id,
    previous_source,
    previous_snapshot_at,
    current_snapshot_id,
    created_by_auth_user_id
  ) values (
    v_user_id,
    p_portfolio_id,
    v_previous_snapshot_id,
    v_previous_source,
    v_previous_snapshot_at,
    v_snapshot_id,
    v_auth_user_id
  ) returning id into v_reconciliation_id;

  for v_compare in
    with current_rows as (
      select item.id as current_item_id,
             item.market,
             item.symbol,
             item.name as current_name,
             item.currency as current_currency,
             item.quantity as current_quantity,
             item.avg_cost as current_avg_cost,
             item.invested_cost as current_invested_cost,
             item.last_price as current_last_price,
             item.market_value as current_market_value,
             item.unrealized_pnl as current_unrealized_pnl,
             item.unrealized_pct as current_unrealized_pct,
             item.market_value_source as current_market_value_source,
             item.raw_broker_values as current_raw_broker_values
      from public.broker_position_snapshot_items item
      where item.snapshot_id = v_snapshot_id
    ),
    previous_rows as (
      select item.id as previous_item_id,
             null::uuid as previous_opening_position_id,
             item.market,
             item.symbol,
             item.name as previous_name,
             item.currency as previous_currency,
             item.quantity as previous_quantity,
             item.avg_cost as previous_avg_cost,
             item.invested_cost as previous_invested_cost,
             item.last_price as previous_last_price,
             item.market_value as previous_market_value,
             item.unrealized_pnl as previous_unrealized_pnl,
             item.unrealized_pct as previous_unrealized_pct,
             item.market_value_source as previous_market_value_source,
             item.raw_broker_values as previous_raw_broker_values
      from public.broker_position_snapshot_items item
      where item.snapshot_id = v_previous_snapshot_id
      union all
      select null::uuid as previous_item_id,
             opening.id as previous_opening_position_id,
             upper(btrim(opening.market)) as market,
             btrim(opening.symbol) as symbol,
             opening.name as previous_name,
             opening.currency as previous_currency,
             opening.quantity as previous_quantity,
             opening.avg_cost as previous_avg_cost,
             opening.invested_cost as previous_invested_cost,
             opening.last_price as previous_last_price,
             opening.market_value as previous_market_value,
             opening.unrealized_pnl as previous_unrealized_pnl,
             opening.unrealized_pct as previous_unrealized_pct,
             'legacy_opening_positions'::text as previous_market_value_source,
             null::jsonb as previous_raw_broker_values
      from public.opening_positions opening
      where v_previous_snapshot_id is null
        and opening.user_id = v_user_id
        and opening.portfolio_id = p_portfolio_id
    )
    select coalesce(current_rows.market, previous_rows.market) as market,
           coalesce(current_rows.symbol, previous_rows.symbol) as symbol,
           previous_rows.previous_item_id,
           previous_rows.previous_opening_position_id,
           current_rows.current_item_id,
           previous_rows.previous_name,
           current_rows.current_name,
           previous_rows.previous_currency,
           current_rows.current_currency,
           previous_rows.previous_quantity,
           current_rows.current_quantity,
           previous_rows.previous_avg_cost,
           current_rows.current_avg_cost,
           previous_rows.previous_invested_cost,
           current_rows.current_invested_cost,
           previous_rows.previous_last_price,
           current_rows.current_last_price,
           previous_rows.previous_market_value,
           current_rows.current_market_value,
           previous_rows.previous_unrealized_pnl,
           current_rows.current_unrealized_pnl,
           previous_rows.previous_unrealized_pct,
           current_rows.current_unrealized_pct,
           previous_rows.previous_market_value_source,
           current_rows.current_market_value_source,
           previous_rows.previous_raw_broker_values,
           current_rows.current_raw_broker_values
    from current_rows
    full outer join previous_rows
      on previous_rows.market = current_rows.market
     and previous_rows.symbol = current_rows.symbol
    order by coalesce(current_rows.market, previous_rows.market),
             coalesce(current_rows.symbol, previous_rows.symbol)
  loop
    v_item_count := v_item_count + 1;
    v_differences := '[]'::jsonb;

    if v_compare.current_item_id is null then
      v_status := 'MISSING_FROM_SNAPSHOT';
      v_reason := '上一份持倉證據有此標的，但本次 Broker Snapshot 未看到；這不代表已賣出。';
      v_missing_count := v_missing_count + 1;
    elsif v_compare.previous_item_id is null and v_compare.previous_opening_position_id is null then
      v_status := 'NEW';
      v_reason := '本次 Broker Snapshot 首次出現；沒有前一份對應持倉證據。';
      v_new_count := v_new_count + 1;
    elsif v_compare.current_name is null
       or v_compare.current_currency is null
       or v_compare.current_quantity is null
       or v_compare.current_avg_cost is null
       or v_compare.current_invested_cost is null
       or v_compare.current_last_price is null
       or v_compare.current_market_value is null
       or v_compare.current_unrealized_pnl is null
       or v_compare.current_unrealized_pct is null
       or v_compare.previous_name is null
       or v_compare.previous_currency is null
       or v_compare.previous_quantity is null
       or v_compare.previous_avg_cost is null
       or v_compare.previous_invested_cost is null
       or v_compare.previous_last_price is null
       or v_compare.previous_market_value is null
       or v_compare.previous_unrealized_pnl is null
       or v_compare.previous_unrealized_pct is null then
      v_status := 'UNKNOWN';
      v_reason := '前後持倉證據缺少可比較欄位，無法安全判定。';
      v_unknown_count := v_unknown_count + 1;
    else
      if v_compare.previous_name is distinct from v_compare.current_name then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'name', 'previous', v_compare.previous_name, 'current', v_compare.current_name));
      end if;
      if v_compare.previous_currency is distinct from v_compare.current_currency then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'currency', 'previous', v_compare.previous_currency, 'current', v_compare.current_currency));
      end if;
      if v_compare.previous_quantity is distinct from v_compare.current_quantity then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'quantity', 'previous', v_compare.previous_quantity, 'current', v_compare.current_quantity));
      end if;
      if v_compare.previous_avg_cost is distinct from v_compare.current_avg_cost then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'avg_cost', 'previous', v_compare.previous_avg_cost, 'current', v_compare.current_avg_cost));
      end if;
      if v_compare.previous_invested_cost is distinct from v_compare.current_invested_cost then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'invested_cost', 'previous', v_compare.previous_invested_cost, 'current', v_compare.current_invested_cost));
      end if;
      if v_compare.previous_last_price is distinct from v_compare.current_last_price then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'last_price', 'previous', v_compare.previous_last_price, 'current', v_compare.current_last_price));
      end if;
      if v_compare.previous_market_value is distinct from v_compare.current_market_value then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'market_value', 'previous', v_compare.previous_market_value, 'current', v_compare.current_market_value));
      end if;
      if v_compare.previous_unrealized_pnl is distinct from v_compare.current_unrealized_pnl then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'unrealized_pnl', 'previous', v_compare.previous_unrealized_pnl, 'current', v_compare.current_unrealized_pnl));
      end if;
      if v_compare.previous_unrealized_pct is distinct from v_compare.current_unrealized_pct then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'unrealized_pct', 'previous', v_compare.previous_unrealized_pct, 'current', v_compare.current_unrealized_pct));
      end if;
      if v_compare.previous_item_id is not null
         and v_compare.previous_market_value_source is distinct from v_compare.current_market_value_source then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'market_value_source', 'previous', v_compare.previous_market_value_source, 'current', v_compare.current_market_value_source));
      end if;
      if v_compare.previous_item_id is not null
         and v_compare.previous_raw_broker_values is distinct from v_compare.current_raw_broker_values then
        v_differences := v_differences || jsonb_build_array(jsonb_build_object('field', 'raw_broker_values', 'previous', v_compare.previous_raw_broker_values, 'current', v_compare.current_raw_broker_values));
      end if;

      if jsonb_array_length(v_differences) = 0 then
        v_status := 'UNCHANGED';
        v_reason := case
          when v_previous_source = 'legacy_opening_positions'
            then '與 Legacy Opening Position 的可比較欄位一致；Evidence Type 不同，未視為交易。'
          else '前後 Broker Snapshot 的可比較欄位一致。'
        end;
        v_unchanged_count := v_unchanged_count + 1;
      else
        v_status := 'CHANGED';
        v_reason := '前後持倉證據不同；差異已逐欄保留，未推導任何交易。';
        v_changed_count := v_changed_count + 1;
      end if;
    end if;

    insert into public.broker_position_reconciliation_items (
      reconciliation_id,
      market,
      symbol,
      status,
      previous_item_id,
      previous_opening_position_id,
      current_item_id,
      previous_name,
      current_name,
      previous_currency,
      current_currency,
      previous_quantity,
      current_quantity,
      previous_avg_cost,
      current_avg_cost,
      previous_invested_cost,
      current_invested_cost,
      previous_last_price,
      current_last_price,
      previous_market_value,
      current_market_value,
      previous_unrealized_pnl,
      current_unrealized_pnl,
      previous_unrealized_pct,
      current_unrealized_pct,
      previous_market_value_source,
      current_market_value_source,
      previous_raw_broker_values,
      current_raw_broker_values,
      quantity_delta,
      invested_cost_delta,
      differences,
      reason
    ) values (
      v_reconciliation_id,
      v_compare.market,
      v_compare.symbol,
      v_status,
      v_compare.previous_item_id,
      v_compare.previous_opening_position_id,
      v_compare.current_item_id,
      v_compare.previous_name,
      v_compare.current_name,
      v_compare.previous_currency,
      v_compare.current_currency,
      v_compare.previous_quantity,
      v_compare.current_quantity,
      v_compare.previous_avg_cost,
      v_compare.current_avg_cost,
      v_compare.previous_invested_cost,
      v_compare.current_invested_cost,
      v_compare.previous_last_price,
      v_compare.current_last_price,
      v_compare.previous_market_value,
      v_compare.current_market_value,
      v_compare.previous_unrealized_pnl,
      v_compare.current_unrealized_pnl,
      v_compare.previous_unrealized_pct,
      v_compare.current_unrealized_pct,
      v_compare.previous_market_value_source,
      v_compare.current_market_value_source,
      v_compare.previous_raw_broker_values,
      v_compare.current_raw_broker_values,
      case when v_compare.previous_quantity is not null and v_compare.current_quantity is not null then v_compare.current_quantity - v_compare.previous_quantity end,
      case when v_compare.previous_invested_cost is not null and v_compare.current_invested_cost is not null then v_compare.current_invested_cost - v_compare.previous_invested_cost end,
      v_differences,
      v_reason
    );
  end loop;

  update public.broker_position_reconciliations
  set item_count = v_item_count,
      unchanged_count = v_unchanged_count,
      changed_count = v_changed_count,
      new_count = v_new_count,
      missing_count = v_missing_count,
      unknown_count = v_unknown_count
  where id = v_reconciliation_id;

  insert into public.broker_position_snapshot_audits (
    snapshot_id,
    reconciliation_id,
    user_id,
    portfolio_id,
    auth_user_id,
    action,
    idempotency_key,
    content_hash,
    position_count
  ) values (
    v_snapshot_id,
    v_reconciliation_id,
    v_user_id,
    p_portfolio_id,
    v_auth_user_id,
    'created',
    v_idempotency_key,
    v_content_hash,
    v_position_count
  ) on conflict do nothing;

  return query
  select snapshot.id,
         reconciliation.id,
         reconciliation.previous_snapshot_id,
         snapshot.broker,
         snapshot.snapshot_at,
         snapshot.verification,
         snapshot.source,
         snapshot.content_hash,
         snapshot.idempotency_key,
         snapshot.position_count,
         snapshot.created_at,
         false
  from public.broker_position_snapshots snapshot
  join public.broker_position_reconciliations reconciliation
    on reconciliation.current_snapshot_id = snapshot.id
  where snapshot.id = v_snapshot_id;
end;
$$;

commit;
