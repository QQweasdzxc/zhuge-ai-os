-- V9.0 Cloud Foundation Schema v2
create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  user_code text unique not null,
  display_name text not null,
  email text,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  base_currency text not null default 'TWD',
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  portfolio_id uuid references public.portfolios(id) on delete cascade,
  trade_date date not null,
  trade_type text not null check (trade_type in ('期初庫存','買進','賣出','定期定額','現金股利','股票股利','費用','調整')),
  symbol text not null,
  name text,
  market text default 'TW',
  quantity numeric(20,6) not null default 0,
  price numeric(20,6) not null default 0,
  gross_amount numeric(20,2) not null default 0,
  fee numeric(20,2) not null default 0,
  tax numeric(20,2) not null default 0,
  net_amount numeric(20,2) not null default 0,
  currency text not null default 'TWD',
  account text,
  source text,
  evidence_url text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  portfolio_id uuid references public.portfolios(id) on delete cascade,
  symbol text not null,
  name text,
  market text default 'TW',
  status text not null default '研究中',
  research_theme text,
  reason text,
  importance int not null default 3 check (importance between 1 and 5),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, symbol, market)
);

create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  portfolio_id uuid references public.portfolios(id) on delete cascade,
  symbol text not null,
  name text,
  strategy_type text,
  decision_status text,
  target_price numeric(20,6),
  support_price numeric(20,6),
  pressure_price numeric(20,6),
  strategist_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.decision_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  portfolio_id uuid references public.portfolios(id) on delete cascade,
  title text not null,
  advice text,
  reason text,
  confidence int check (confidence between 0 and 100),
  rule_id text,
  evidence jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace view public.holdings_view as
select
  t.user_id,
  t.portfolio_id,
  t.symbol,
  max(t.name) as name,
  max(t.market) as market,
  sum(case
    when t.trade_type in ('期初庫存','買進','定期定額','股票股利') then t.quantity
    when t.trade_type = '賣出' then -t.quantity
    else 0
  end) as quantity,
  sum(case
    when t.trade_type in ('期初庫存','買進','定期定額') then (t.gross_amount + t.fee + t.tax)
    else 0
  end) as invested_cost,
  case when sum(case
    when t.trade_type in ('期初庫存','買進','定期定額','股票股利') then t.quantity
    when t.trade_type = '賣出' then -t.quantity
    else 0 end) <> 0
  then sum(case when t.trade_type in ('期初庫存','買進','定期定額') then (t.gross_amount + t.fee + t.tax) else 0 end)
    / sum(case when t.trade_type in ('期初庫存','買進','定期定額','股票股利') then t.quantity when t.trade_type='賣出' then -t.quantity else 0 end)
  else 0 end as avg_cost
from public.transactions t
group by t.user_id, t.portfolio_id, t.symbol;

alter table public.app_users enable row level security;
alter table public.portfolios enable row level security;
alter table public.transactions enable row level security;
alter table public.watchlists enable row level security;
alter table public.strategies enable row level security;
alter table public.decision_logs enable row level security;

drop policy if exists phase1_read_app_users on public.app_users;
drop policy if exists phase1_write_app_users on public.app_users;
drop policy if exists phase1_read_portfolios on public.portfolios;
drop policy if exists phase1_write_portfolios on public.portfolios;
drop policy if exists phase1_read_transactions on public.transactions;
drop policy if exists phase1_write_transactions on public.transactions;
drop policy if exists phase1_read_watchlists on public.watchlists;
drop policy if exists phase1_write_watchlists on public.watchlists;
drop policy if exists phase1_read_strategies on public.strategies;
drop policy if exists phase1_write_strategies on public.strategies;
drop policy if exists phase1_read_decision_logs on public.decision_logs;
drop policy if exists phase1_write_decision_logs on public.decision_logs;

create policy phase1_read_app_users on public.app_users for select using (true);
create policy phase1_write_app_users on public.app_users for all using (true) with check (true);
create policy phase1_read_portfolios on public.portfolios for select using (true);
create policy phase1_write_portfolios on public.portfolios for all using (true) with check (true);
create policy phase1_read_transactions on public.transactions for select using (true);
create policy phase1_write_transactions on public.transactions for all using (true) with check (true);
create policy phase1_read_watchlists on public.watchlists for select using (true);
create policy phase1_write_watchlists on public.watchlists for all using (true) with check (true);
create policy phase1_read_strategies on public.strategies for select using (true);
create policy phase1_write_strategies on public.strategies for all using (true) with check (true);
create policy phase1_read_decision_logs on public.decision_logs for select using (true);
create policy phase1_write_decision_logs on public.decision_logs for all using (true) with check (true);

insert into public.app_users (user_code, display_name, email, role)
values ('001', 'Jackal', 'qq.1025@gmail.com', 'owner')
on conflict (user_code) do update set display_name = excluded.display_name, email = excluded.email, updated_at = now();

insert into public.portfolios (user_id, name, base_currency, is_default)
select u.id, 'Jackal 主投資組合', 'TWD', true
from public.app_users u
where u.user_code = '001'
and not exists (
  select 1 from public.portfolios p where p.user_id = u.id and p.is_default = true
);

create index if not exists idx_transactions_user_symbol on public.transactions(user_id, symbol);
create index if not exists idx_transactions_trade_date on public.transactions(trade_date);
create index if not exists idx_watchlists_user_symbol on public.watchlists(user_id, symbol);
create index if not exists idx_strategies_user_symbol on public.strategies(user_id, symbol);