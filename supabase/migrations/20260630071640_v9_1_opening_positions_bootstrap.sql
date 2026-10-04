-- V9.1 Opening Positions Bootstrap
create table if not exists public.opening_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  portfolio_id uuid references public.portfolios(id) on delete cascade,
  bootstrap_at timestamptz not null,
  symbol text not null,
  name text not null,
  market text not null,
  asset_type text not null default 'stock',
  quantity numeric(20,6) not null,
  avg_cost numeric(20,6) not null,
  invested_cost numeric(20,2) not null,
  last_price numeric(20,6),
  market_value numeric(20,2),
  unrealized_pnl numeric(20,2),
  unrealized_pct numeric(12,6),
  currency text not null,
  account text,
  source text not null default 'broker_app_screenshot',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, portfolio_id, symbol, market, bootstrap_at)
);

alter table public.opening_positions enable row level security;
drop policy if exists phase1_read_opening_positions on public.opening_positions;
drop policy if exists phase1_write_opening_positions on public.opening_positions;
create policy phase1_read_opening_positions on public.opening_positions for select using (true);
create policy phase1_write_opening_positions on public.opening_positions for all using (true) with check (true);

create or replace view public.current_positions_view as
select
  op.user_id,
  op.portfolio_id,
  op.bootstrap_at,
  op.symbol,
  op.name,
  op.market,
  op.asset_type,
  op.quantity,
  op.avg_cost,
  op.invested_cost,
  op.last_price,
  op.market_value,
  op.unrealized_pnl,
  op.unrealized_pct,
  op.currency,
  op.account,
  op.source,
  op.note
from public.opening_positions op
join (
  select user_id, portfolio_id, symbol, market, max(bootstrap_at) as bootstrap_at
  from public.opening_positions
  group by user_id, portfolio_id, symbol, market
) latest
on latest.user_id = op.user_id
and latest.portfolio_id = op.portfolio_id
and latest.symbol = op.symbol
and latest.market = op.market
and latest.bootstrap_at = op.bootstrap_at;

with jackal as (
  select u.id as user_id, p.id as portfolio_id
  from public.app_users u
  join public.portfolios p on p.user_id = u.id and p.is_default = true
  where u.user_code = '001'
)
insert into public.opening_positions (
  user_id, portfolio_id, bootstrap_at, symbol, name, market, asset_type,
  quantity, avg_cost, invested_cost, last_price, market_value,
  unrealized_pnl, unrealized_pct, currency, account, source, note
)
select user_id, portfolio_id, '2026-06-30 13:35:00+08'::timestamptz,
       symbol, name, market, asset_type, quantity, avg_cost, invested_cost,
       last_price, market_value, unrealized_pnl, unrealized_pct, currency,
       account, source, note
from jackal,
(values
  ('00400A','主動國泰動能高息','TW','ETF',1000::numeric,14.32::numeric,14320::numeric,14.80::numeric,14800::numeric,445::numeric,3.11::numeric,'TWD','證-營業部1230016-陳彥達','broker_app_screenshot','Day 0 Bootstrap 2026-06-30 13:35'),
  ('0050','元大台灣50','TW','ETF',651::numeric,62.81::numeric,40889::numeric,107.80::numeric,70177::numeric,29118::numeric,71.21::numeric,'TWD','證-營業部1230016-陳彥達','broker_app_screenshot','Day 0 Bootstrap 2026-06-30 13:35'),
  ('00878','國泰永續高股息','TW','ETF',879::numeric,20.86::numeric,18335::numeric,33.50::numeric,29446::numeric,11041::numeric,60.22::numeric,'TWD','證-營業部1230016-陳彥達','broker_app_screenshot','Day 0 Bootstrap 2026-06-30 13:35'),
  ('00929','復華台灣科技優息','TW','ETF',536::numeric,19.58::numeric,10496::numeric,30.78::numeric,16498::numeric,5963::numeric,56.81::numeric,'TWD','證-營業部1230016-陳彥達','broker_app_screenshot','Day 0 Bootstrap 2026-06-30 13:35'),
  ('009821','野村稀土關鍵資源','TW','ETF',2000::numeric,15.38::numeric,30752::numeric,14.21::numeric,28420::numeric,-2400::numeric,-7.80::numeric,'TWD','證-營業部1230016-陳彥達','broker_app_screenshot','Day 0 Bootstrap 2026-06-30 13:35'),
  ('6898','程曦資訊','TW','stock',5000::numeric,97.32::numeric,486612::numeric,92.00::numeric,460000::numeric,-28647::numeric,-5.89::numeric,'TWD','證-營業部1230016-陳彥達','broker_app_screenshot','Day 0 Bootstrap 2026-06-30 13:35'),
  ('MRVL','邁威爾科技','US','stock',1::numeric,253.71::numeric,253.71::numeric,277.75::numeric,277.06::numeric,23.35::numeric,9.20::numeric,'USD','複-營業部1230016-陳彥達','broker_app_screenshot','Day 0 Bootstrap 2026-06-30 13:35'),
  ('SPCX','太空探索技術','US','stock',3::numeric,162.483::numeric,487.449::numeric,164.19::numeric,491.34::numeric,3.89::numeric,0.80::numeric,'USD','複-營業部1230016-陳彥達','broker_app_screenshot','Day 0 Bootstrap 2026-06-30 13:35')
) as v(symbol, name, market, asset_type, quantity, avg_cost, invested_cost, last_price, market_value, unrealized_pnl, unrealized_pct, currency, account, source, note)
on conflict do nothing;

create index if not exists idx_opening_positions_user_symbol on public.opening_positions(user_id, symbol);
create index if not exists idx_opening_positions_bootstrap_at on public.opening_positions(bootstrap_at);