-- Investment development-mode MFA pause.
--
-- The Creator-controlled investment_mfa_required=false preference permits
-- authenticated AAL1 read-only access to the current owner's Investment data.
-- It does not grant cross-owner access and does not relax the controlled
-- Broker Snapshot write RPC, which remains AAL2-only.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.investment_current_owner_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
  select owner.id
  from public.app_users owner
  where owner.auth_user_id = (select auth.uid())
  order by owner.id
  limit 1
$$;

create or replace function private.investment_mfa_bypassed()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
  select exists (
    select 1
    from public.app_users owner
    join public.user_settings preference on preference.user_id = owner.id
    where owner.id = private.investment_current_owner_id()
      and lower(trim(coalesce(owner.role, ''))) in ('creator', 'owner')
      and preference.setting_key = 'investment_mfa_required'
      and preference.setting_value = 'false'::jsonb
  )
$$;

revoke all on function private.investment_current_owner_id() from public, anon;
revoke all on function private.investment_mfa_bypassed() from public, anon;
grant execute on function private.investment_current_owner_id() to authenticated;
grant execute on function private.investment_mfa_bypassed() to authenticated;

drop policy if exists investment_app_users_select_aal2 on public.app_users;
drop policy if exists investment_portfolios_select_aal2 on public.portfolios;
drop policy if exists investment_opening_positions_select_aal2 on public.opening_positions;
drop policy if exists investment_transactions_select_aal2 on public.transactions;
drop policy if exists investment_watchlists_select_aal2 on public.watchlists;
drop policy if exists investment_strategies_select_aal2 on public.strategies;
drop policy if exists investment_decision_logs_select_aal2 on public.decision_logs;
drop policy if exists investment_user_settings_select_aal2 on public.user_settings;
drop policy if exists investment_onboarding_state_select_aal2 on public.onboarding_state;
drop policy if exists broker_position_snapshots_select_aal2 on public.broker_position_snapshots;
drop policy if exists broker_position_snapshot_items_select_aal2 on public.broker_position_snapshot_items;
drop policy if exists broker_position_reconciliations_select_aal2 on public.broker_position_reconciliations;
drop policy if exists broker_position_reconciliation_items_select_aal2 on public.broker_position_reconciliation_items;
drop policy if exists broker_position_snapshot_audits_select_aal2 on public.broker_position_snapshot_audits;

create policy investment_app_users_select_aal2_or_paused
on public.app_users
for select
to authenticated
using (
  id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy investment_portfolios_select_aal2_or_paused
on public.portfolios
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy investment_opening_positions_select_aal2_or_paused
on public.opening_positions
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy investment_transactions_select_aal2_or_paused
on public.transactions
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy investment_watchlists_select_aal2_or_paused
on public.watchlists
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy investment_strategies_select_aal2_or_paused
on public.strategies
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy investment_decision_logs_select_aal2_or_paused
on public.decision_logs
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy investment_user_settings_select_aal2_or_paused
on public.user_settings
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy investment_onboarding_state_select_aal2_or_paused
on public.onboarding_state
for select
to authenticated
using (
  user_id = private.investment_current_owner_id()
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
);

create policy broker_position_snapshots_select_aal2_or_paused
on public.broker_position_snapshots
for select
to authenticated
using (
  (select auth.uid()) is not null
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
  and user_id = private.investment_current_owner_id()
);

create policy broker_position_snapshot_items_select_aal2_or_paused
on public.broker_position_snapshot_items
for select
to authenticated
using (
  (select auth.uid()) is not null
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
  and exists (
    select 1
    from public.broker_position_snapshots snapshot
    where snapshot.id = broker_position_snapshot_items.snapshot_id
      and snapshot.user_id = private.investment_current_owner_id()
  )
);

create policy broker_position_reconciliations_select_aal2_or_paused
on public.broker_position_reconciliations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
  and user_id = private.investment_current_owner_id()
);

create policy broker_position_reconciliation_items_select_aal2_or_paused
on public.broker_position_reconciliation_items
for select
to authenticated
using (
  (select auth.uid()) is not null
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
  and exists (
    select 1
    from public.broker_position_reconciliations reconciliation
    where reconciliation.id = broker_position_reconciliation_items.reconciliation_id
      and reconciliation.user_id = private.investment_current_owner_id()
  )
);

create policy broker_position_snapshot_audits_select_aal2_or_paused
on public.broker_position_snapshot_audits
for select
to authenticated
using (
  (select auth.uid()) is not null
  and ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed())
  and user_id = private.investment_current_owner_id()
);

commit;
