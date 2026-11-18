-- Reject a new ledger entry if its chronological position calculation is invalid.
-- Same reviewed write policy, owner scope, locks and calculation contract.
-- No existing transaction or baseline data is rewritten.
begin;
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

  -- A backdated entry can pass today's quantity check yet overdraw a later
  -- point in the ledger. Validate the same canonical calculation while the
  -- portfolio/stock locks are still held. Raising rolls this insert back.
  if exists (
    select 1 from public.investment_calculated_positions() position
    where position.user_id = v_owner_id
      and position.portfolio_id = p_portfolio_id
      and upper(trim(position.market)) = v_market
      and trim(position.symbol) = v_symbol
      and position.position_status = 'invalid'
  ) then
    raise exception using errcode = '22023', message = 'INVESTMENT_TRANSACTION_TIMELINE_INVALID';
  end if;

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
commit;
