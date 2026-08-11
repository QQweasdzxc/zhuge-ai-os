-- Sprint 3 SIT: Investment real-data read path with Legacy Mapping + AAL2.
-- This migration does not move or rewrite Investment rows.
-- It replaces insecure Phase 1 policies and exposes read-only records owned by
-- app_users.auth_user_id = auth.uid() after an AAL2 session is established.

begin;

alter table public.app_users enable row level security;
alter table public.portfolios enable row level security;
alter table public.opening_positions enable row level security;
alter table public.transactions enable row level security;
alter table public.watchlists enable row level security;
alter table public.strategies enable row level security;
alter table public.decision_logs enable row level security;
alter table public.user_settings enable row level security;
alter table public.onboarding_state enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'app_users', 'portfolios', 'opening_positions', 'transactions',
        'watchlists', 'strategies', 'decision_logs', 'user_settings',
        'onboarding_state'
      ])
  loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end
$$;

create policy investment_app_users_select_aal2
on public.app_users
for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  and coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
);

create policy investment_portfolios_select_aal2
on public.portfolios
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  and user_id in (select id from public.app_users where auth_user_id = (select auth.uid()))
);

create policy investment_opening_positions_select_aal2
on public.opening_positions
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  and user_id in (select id from public.app_users where auth_user_id = (select auth.uid()))
);

create policy investment_transactions_select_aal2
on public.transactions
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  and user_id in (select id from public.app_users where auth_user_id = (select auth.uid()))
);

create policy investment_watchlists_select_aal2
on public.watchlists
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  and user_id in (select id from public.app_users where auth_user_id = (select auth.uid()))
);

create policy investment_strategies_select_aal2
on public.strategies
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  and user_id in (select id from public.app_users where auth_user_id = (select auth.uid()))
);

create policy investment_decision_logs_select_aal2
on public.decision_logs
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  and user_id in (select id from public.app_users where auth_user_id = (select auth.uid()))
);

create policy investment_user_settings_select_aal2
on public.user_settings
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  and user_id in (select id from public.app_users where auth_user_id = (select auth.uid()))
);

create policy investment_onboarding_state_select_aal2
on public.onboarding_state
for select
to authenticated
using (
  coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  and user_id in (select id from public.app_users where auth_user_id = (select auth.uid()))
);

create index if not exists app_users_auth_user_id_idx on public.app_users (auth_user_id);
create index if not exists portfolios_user_id_idx on public.portfolios (user_id);
create index if not exists opening_positions_user_id_idx on public.opening_positions (user_id);
create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists watchlists_user_id_idx on public.watchlists (user_id);
create index if not exists strategies_user_id_idx on public.strategies (user_id);
create index if not exists decision_logs_user_id_idx on public.decision_logs (user_id);
create index if not exists user_settings_user_id_idx on public.user_settings (user_id);
create index if not exists onboarding_state_user_id_idx on public.onboarding_state (user_id);

commit;
