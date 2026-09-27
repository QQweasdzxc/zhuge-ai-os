-- TASK: Investment Broker Position Snapshot / Reconciliation Model
-- Scope: add a separate, append-only Broker Position Evidence model.
-- This migration never updates, deletes, or backfills legacy Investment data.

begin;

create table if not exists public.broker_position_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete restrict,
  portfolio_id uuid not null references public.portfolios(id) on delete restrict,
  broker text not null check (length(btrim(broker)) between 1 and 120),
  snapshot_at timestamptz not null,
  verification text not null check (verification = 'pm_confirmed'),
  position_count integer not null check (position_count between 1 and 100),
  source text not null check (length(btrim(source)) between 1 and 160),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 8 and 240),
  created_by_auth_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, portfolio_id, idempotency_key),
  unique (user_id, portfolio_id, broker, snapshot_at, content_hash)
);

comment on table public.broker_position_snapshots is
  'Append-only broker position evidence header. It is not a transaction or a replacement for legacy opening_positions.';

create table if not exists public.broker_position_snapshot_items (
  id uuid primary key default extensions.gen_random_uuid(),
  snapshot_id uuid not null references public.broker_position_snapshots(id) on delete cascade,
  symbol text not null check (length(btrim(symbol)) between 1 and 40),
  name text not null check (length(btrim(name)) between 1 and 240),
  market text not null check (length(btrim(market)) between 1 and 16),
  currency text not null check (length(btrim(currency)) between 1 and 8),
  quantity numeric not null check (quantity >= 0),
  avg_cost numeric not null check (avg_cost >= 0),
  invested_cost numeric not null check (invested_cost >= 0),
  last_price numeric not null check (last_price >= 0),
  market_value numeric not null check (market_value >= 0),
  unrealized_pnl numeric not null,
  unrealized_pct numeric not null,
  market_value_source text not null default 'broker_supplied' check (market_value_source = 'broker_supplied'),
  raw_broker_values jsonb not null check (jsonb_typeof(raw_broker_values) = 'object'),
  created_at timestamptz not null default now(),
  unique (snapshot_id, market, symbol)
);

comment on table public.broker_position_snapshot_items is
  'Normalized item values plus the broker-supplied raw value object. market_value is never recomputed by the database.';

create table if not exists public.broker_position_reconciliations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete restrict,
  portfolio_id uuid not null references public.portfolios(id) on delete restrict,
  previous_snapshot_id uuid references public.broker_position_snapshots(id) on delete restrict,
  previous_source text not null check (previous_source in ('broker_position_snapshot', 'legacy_opening_positions', 'none')),
  previous_snapshot_at timestamptz,
  current_snapshot_id uuid not null unique references public.broker_position_snapshots(id) on delete restrict,
  item_count integer not null default 0 check (item_count between 0 and 200),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  changed_count integer not null default 0 check (changed_count >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  unknown_count integer not null default 0 check (unknown_count >= 0),
  created_by_auth_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.broker_position_reconciliations is
  'Machine-generated comparison between the current broker snapshot and the previous evidence source.';

create table if not exists public.broker_position_reconciliation_items (
  id uuid primary key default extensions.gen_random_uuid(),
  reconciliation_id uuid not null references public.broker_position_reconciliations(id) on delete cascade,
  market text not null,
  symbol text not null,
  status text not null check (status in ('UNCHANGED', 'CHANGED', 'NEW', 'MISSING_FROM_SNAPSHOT', 'UNKNOWN')),
  previous_item_id uuid references public.broker_position_snapshot_items(id) on delete restrict,
  previous_opening_position_id uuid references public.opening_positions(id) on delete restrict,
  current_item_id uuid references public.broker_position_snapshot_items(id) on delete restrict,
  previous_name text,
  current_name text,
  previous_currency text,
  current_currency text,
  previous_quantity numeric,
  current_quantity numeric,
  previous_avg_cost numeric,
  current_avg_cost numeric,
  previous_invested_cost numeric,
  current_invested_cost numeric,
  previous_last_price numeric,
  current_last_price numeric,
  previous_market_value numeric,
  current_market_value numeric,
  previous_unrealized_pnl numeric,
  current_unrealized_pnl numeric,
  previous_unrealized_pct numeric,
  current_unrealized_pct numeric,
  previous_market_value_source text,
  current_market_value_source text,
  previous_raw_broker_values jsonb,
  current_raw_broker_values jsonb,
  quantity_delta numeric,
  invested_cost_delta numeric,
  differences jsonb not null default '[]'::jsonb check (jsonb_typeof(differences) = 'array'),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (reconciliation_id, market, symbol)
);

comment on column public.broker_position_reconciliation_items.status is
  'MISSING_FROM_SNAPSHOT means absent from this evidence only; it never means SOLD.';

create table if not exists public.broker_position_snapshot_audits (
  id uuid primary key default extensions.gen_random_uuid(),
  snapshot_id uuid not null references public.broker_position_snapshots(id) on delete restrict,
  reconciliation_id uuid not null references public.broker_position_reconciliations(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  portfolio_id uuid not null references public.portfolios(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('created', 'idempotent_replay')),
  idempotency_key text not null,
  content_hash text not null,
  position_count integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, portfolio_id, idempotency_key, action)
);

comment on table public.broker_position_snapshot_audits is
  'Controlled-write audit trail. It contains no screenshot bytes or secret material.';

create index if not exists broker_position_snapshots_latest_idx
  on public.broker_position_snapshots (user_id, portfolio_id, verification, snapshot_at desc, created_at desc, id desc);
create index if not exists broker_position_snapshot_items_lookup_idx
  on public.broker_position_snapshot_items (snapshot_id, market, symbol);
create index if not exists broker_position_reconciliations_lookup_idx
  on public.broker_position_reconciliations (user_id, portfolio_id, created_at desc);
create index if not exists broker_position_reconciliation_items_lookup_idx
  on public.broker_position_reconciliation_items (reconciliation_id, market, symbol);
create index if not exists broker_position_snapshot_audits_lookup_idx
  on public.broker_position_snapshot_audits (user_id, portfolio_id, created_at desc);

alter table public.broker_position_snapshots enable row level security;
alter table public.broker_position_snapshot_items enable row level security;
alter table public.broker_position_reconciliations enable row level security;
alter table public.broker_position_reconciliation_items enable row level security;
alter table public.broker_position_snapshot_audits enable row level security;

drop policy if exists broker_position_snapshots_select_aal2 on public.broker_position_snapshots;
drop policy if exists broker_position_snapshot_items_select_aal2 on public.broker_position_snapshot_items;
drop policy if exists broker_position_reconciliations_select_aal2 on public.broker_position_reconciliations;
drop policy if exists broker_position_reconciliation_items_select_aal2 on public.broker_position_reconciliation_items;
drop policy if exists broker_position_snapshot_audits_select_aal2 on public.broker_position_snapshot_audits;

create policy broker_position_snapshots_select_aal2
on public.broker_position_snapshots
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1
    from public.app_users owner
    where owner.id = broker_position_snapshots.user_id
      and owner.auth_user_id = (select auth.uid())
  )
);

create policy broker_position_snapshot_items_select_aal2
on public.broker_position_snapshot_items
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1
    from public.broker_position_snapshots snapshot
    join public.app_users owner on owner.id = snapshot.user_id
    where snapshot.id = broker_position_snapshot_items.snapshot_id
      and owner.auth_user_id = (select auth.uid())
  )
);

create policy broker_position_reconciliations_select_aal2
on public.broker_position_reconciliations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1
    from public.app_users owner
    where owner.id = broker_position_reconciliations.user_id
      and owner.auth_user_id = (select auth.uid())
  )
);

create policy broker_position_reconciliation_items_select_aal2
on public.broker_position_reconciliation_items
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1
    from public.broker_position_reconciliations reconciliation
    join public.app_users owner on owner.id = reconciliation.user_id
    where reconciliation.id = broker_position_reconciliation_items.reconciliation_id
      and owner.auth_user_id = (select auth.uid())
  )
);

create policy broker_position_snapshot_audits_select_aal2
on public.broker_position_snapshot_audits
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.jwt() ->> 'aal') = 'aal2'
  and exists (
    select 1
    from public.app_users owner
    where owner.id = broker_position_snapshot_audits.user_id
      and owner.auth_user_id = (select auth.uid())
  )
);

revoke all on table public.broker_position_snapshots from public, anon, authenticated;
revoke all on table public.broker_position_snapshot_items from public, anon, authenticated;
revoke all on table public.broker_position_reconciliations from public, anon, authenticated;
revoke all on table public.broker_position_reconciliation_items from public, anon, authenticated;
revoke all on table public.broker_position_snapshot_audits from public, anon, authenticated;

grant select on table public.broker_position_snapshots to authenticated;
grant select on table public.broker_position_snapshot_items to authenticated;
grant select on table public.broker_position_reconciliations to authenticated;
grant select on table public.broker_position_reconciliation_items to authenticated;
grant select on table public.broker_position_snapshot_audits to authenticated;

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

  if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
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

revoke all on function public.create_broker_position_snapshot(uuid, text, timestamptz, text, text, text, jsonb) from public, anon;
grant execute on function public.create_broker_position_snapshot(uuid, text, timestamptz, text, text, text, jsonb) to authenticated;

create or replace view public.current_broker_positions_view
with (security_invoker = true)
as
with latest_snapshot as (
  select distinct on (snapshot.user_id, snapshot.portfolio_id)
         snapshot.id,
         snapshot.user_id,
         snapshot.portfolio_id,
         snapshot.broker,
         snapshot.snapshot_at,
         snapshot.verification,
         snapshot.source,
         snapshot.content_hash,
         snapshot.idempotency_key,
         snapshot.position_count,
         snapshot.created_at
  from public.broker_position_snapshots snapshot
  where snapshot.verification = 'pm_confirmed'
  order by snapshot.user_id, snapshot.portfolio_id,
           snapshot.snapshot_at desc,
           snapshot.created_at desc,
           snapshot.id desc
)
select latest.id as snapshot_id,
       latest.user_id,
       latest.portfolio_id,
       latest.broker,
       latest.snapshot_at,
       latest.verification,
       latest.source,
       latest.content_hash,
       latest.idempotency_key,
       latest.position_count,
       latest.created_at as snapshot_created_at,
       item.id as item_id,
       item.symbol,
       item.name,
       item.market,
       item.currency,
       item.quantity,
       item.avg_cost,
       item.invested_cost,
       item.last_price,
       item.market_value,
       item.unrealized_pnl,
       item.unrealized_pct,
       item.market_value_source,
       item.raw_broker_values
from latest_snapshot latest
join public.broker_position_snapshot_items item on item.snapshot_id = latest.id;

revoke all on table public.current_broker_positions_view from public, anon, authenticated;
grant select on table public.current_broker_positions_view to authenticated;

commit;
