-- TASK: Investment Broker Position Snapshot / Reconciliation Model hardening
-- Scope: optimize the already-approved append-only Snapshot model only.
-- This migration changes policies and indexes; it does not mutate Investment data.

begin;

create index if not exists broker_position_snapshots_portfolio_fk_idx
  on public.broker_position_snapshots (portfolio_id);
create index if not exists broker_position_snapshots_created_by_auth_fk_idx
  on public.broker_position_snapshots (created_by_auth_user_id);
create index if not exists broker_position_reconciliations_portfolio_fk_idx
  on public.broker_position_reconciliations (portfolio_id);
create index if not exists broker_position_reconciliations_previous_snapshot_fk_idx
  on public.broker_position_reconciliations (previous_snapshot_id);
create index if not exists broker_position_reconciliations_created_by_auth_fk_idx
  on public.broker_position_reconciliations (created_by_auth_user_id);
create index if not exists broker_position_reconciliation_items_previous_item_fk_idx
  on public.broker_position_reconciliation_items (previous_item_id);
create index if not exists broker_position_reconciliation_items_previous_opening_fk_idx
  on public.broker_position_reconciliation_items (previous_opening_position_id);
create index if not exists broker_position_reconciliation_items_current_item_fk_idx
  on public.broker_position_reconciliation_items (current_item_id);
create index if not exists broker_position_snapshot_audits_reconciliation_fk_idx
  on public.broker_position_snapshot_audits (reconciliation_id);
create index if not exists broker_position_snapshot_audits_snapshot_fk_idx
  on public.broker_position_snapshot_audits (snapshot_id);
create index if not exists broker_position_snapshot_audits_portfolio_fk_idx
  on public.broker_position_snapshot_audits (portfolio_id);
create index if not exists broker_position_snapshot_audits_auth_user_fk_idx
  on public.broker_position_snapshot_audits (auth_user_id);

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
  and ((select auth.jwt()) ->> 'aal') = 'aal2'
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
  and ((select auth.jwt()) ->> 'aal') = 'aal2'
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
  and ((select auth.jwt()) ->> 'aal') = 'aal2'
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
  and ((select auth.jwt()) ->> 'aal') = 'aal2'
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
  and ((select auth.jwt()) ->> 'aal') = 'aal2'
  and exists (
    select 1
    from public.app_users owner
    where owner.id = broker_position_snapshot_audits.user_id
      and owner.auth_user_id = (select auth.uid())
  )
);

commit;
