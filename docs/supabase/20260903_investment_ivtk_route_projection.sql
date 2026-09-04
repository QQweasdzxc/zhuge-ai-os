-- Route the Investment projection only to the PM-created Investment C
-- Consumer. The previous function selected the oldest IVTK prefix, which
-- could target the archived/legacy Co-created Board Instance.

begin;

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
  v_watchlist_workspace public.board_workspaces%rowtype;
  v_position record;
  v_watchlist record;
  v_link public.investment_ivtk_card_links%rowtype;
  v_task public.board_tasks%rowtype;
  v_relinked boolean;
  v_position_count integer := 0;
  v_watchlist_count integer := 0;
  v_created_count integer := 0;
  v_relinked_count integer := 0;
  v_deactivated_count integer := 0;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'INVESTMENT_IVTK_AUTH_REQUIRED';
  end if;
  if not ((select auth.jwt() ->> 'aal') = 'aal2' or private.investment_mfa_bypassed()) then
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
    and is_template_instance = false
    and template_key = 'c'
    and upper(task_code_prefix) = 'IVTK'
    and lower(legacy_application_scope) = 'investment'
  limit 1
  for update;
  if not found or not public.board_instance_can_write(v_instance.id) then
    raise exception using errcode = '42501', message = 'INVESTMENT_IVTK_BOARD_SCOPE_REQUIRED';
  end if;

  select * into v_stocks_workspace
  from public.board_workspaces
  where board_instance_id = v_instance.id and workspace_key = 'ivtk-stocks' and active = true
  order by sort_order limit 1;
  select * into v_watchlist_workspace
  from public.board_workspaces
  where board_instance_id = v_instance.id and workspace_key = 'ivtk-watchlist' and active = true
  order by sort_order limit 1;
  if v_stocks_workspace.id is null or v_watchlist_workspace.id is null then
    raise exception using errcode = 'P0002', message = 'INVESTMENT_IVTK_WORKSPACES_REQUIRED';
  end if;

  update public.investment_ivtk_card_links link
  set active = false, updated_at = now()
  where link.board_instance_id = v_instance.id
    and link.user_id = v_owner_id
    and link.active = true
    and (
      (
        link.source_kind in ('opening_position', 'broker_snapshot_item')
        and not exists (
          select 1 from public.investment_current_positions_view current_position
          where current_position.user_id = v_owner_id
            and current_position.source_kind = link.source_kind
            and current_position.source_id = link.source_id
        )
      )
      or (
        link.source_kind = 'watchlist'
        and not exists (
          select 1 from public.watchlists current_watchlist
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
    order by current_position.market asc, current_position.symbol asc, current_position.source_id asc
  loop
    v_position_count := v_position_count + 1;
    v_relinked := false;

    select * into v_link
    from public.investment_ivtk_card_links link
    where link.board_instance_id = v_instance.id
      and link.source_kind = v_position.source_kind
      and link.source_id = v_position.source_id
    for update;

    if not found and v_position.source_kind = 'broker_snapshot_item' then
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
      if found then
        update public.investment_ivtk_card_links link
        set source_kind = 'broker_snapshot_item', source_id = v_position.source_id,
            portfolio_id = v_position.portfolio_id, active = true, updated_at = now()
        where link.id = v_link.id;
        v_relinked := true;
        v_relinked_count := v_relinked_count + 1;
      end if;
    end if;

    if not found and not v_relinked then
      v_task := public.board_instance_create_task(
        v_instance.id,
        'Investment Position Projection',
        'Card projection owned by Investment Cloud; financial values are read from the Investment source.',
        'not_started', null, v_stocks_workspace.id
      );
      insert into public.investment_ivtk_card_links (
        board_instance_id, board_task_id, user_id, portfolio_id, source_kind,
        source_id, card_kind, active, created_by_auth_user_id
      ) values (
        v_instance.id, v_task.id, v_owner_id, v_position.portfolio_id,
        v_position.source_kind, v_position.source_id, 'position', true, v_auth_user_id
      );
      v_created_count := v_created_count + 1;
    elsif not v_relinked and (not v_link.active or v_link.portfolio_id is distinct from v_position.portfolio_id) then
      update public.investment_ivtk_card_links link
      set portfolio_id = v_position.portfolio_id, active = true, updated_at = now()
      where link.id = v_link.id;
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
        'not_started', null, v_watchlist_workspace.id
      );
      insert into public.investment_ivtk_card_links (
        board_instance_id, board_task_id, user_id, portfolio_id, source_kind,
        source_id, card_kind, active, created_by_auth_user_id
      ) values (
        v_instance.id, v_task.id, v_owner_id, v_watchlist.portfolio_id,
        'watchlist', v_watchlist.id, 'watchlist', true, v_auth_user_id
      );
      v_created_count := v_created_count + 1;
    elsif not v_link.active or v_link.portfolio_id is distinct from v_watchlist.portfolio_id then
      update public.investment_ivtk_card_links link
      set portfolio_id = v_watchlist.portfolio_id, active = true, updated_at = now()
      where link.id = v_link.id;
    end if;
  end loop;

  return jsonb_build_object(
    'board_instance_id', v_instance.id,
    'position_count', v_position_count,
    'watchlist_count', v_watchlist_count,
    'created_count', v_created_count,
    'relinked_count', v_relinked_count,
    'deactivated_count', v_deactivated_count,
    'idempotent', v_created_count = 0 and v_relinked_count = 0 and v_deactivated_count = 0
  );
end;
$function$;

revoke all on function public.sync_investment_ivtk_projection() from public, anon;
grant execute on function public.sync_investment_ivtk_projection() to authenticated;

commit;
