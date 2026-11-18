begin;
-- Saved server preferences only; no caller-provided bypass, owner or assurance.
create or replace function private.investment_receivable_mfa_bypassed(p_operation text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth, private
as $policy$
 select exists (
  select 1 from public.app_users owner
  where owner.auth_user_id=(select auth.uid())
   and lower(trim(coalesce(owner.role,''))) in ('creator','owner')
   and case p_operation
    when 'read' then coalesce(
     (select setting_value from public.user_settings where user_id=owner.id and setting_key='investment_entry_mfa_required' and jsonb_typeof(setting_value)='boolean' limit 1),
     (select setting_value from public.user_settings where user_id=owner.id and setting_key='investment_mfa_required' and jsonb_typeof(setting_value)='boolean' limit 1), 'true'::jsonb)='false'::jsonb
    when 'write' then coalesce(
     (select setting_value from public.user_settings where user_id=owner.id and setting_key='investment_sensitive_write_mfa_required' and jsonb_typeof(setting_value)='boolean' limit 1), 'true'::jsonb)='false'::jsonb
    else false end
 );
$policy$;
revoke all on function private.investment_receivable_mfa_bypassed(text) from public, anon;
grant execute on function private.investment_receivable_mfa_bypassed(text) to authenticated;

drop policy if exists investment_receivables_select_aal2 on public.investment_receivables;
create policy investment_receivables_select_aal2 on public.investment_receivables
for select to authenticated using (
 (select auth.uid()) is not null
 and (coalesce((select auth.jwt() ->> 'aal'), '')='aal2' or
      (coalesce((select auth.jwt() ->> 'aal'), '')='aal1' and private.investment_receivable_mfa_bypassed('read')))
 and exists (select 1 from public.app_users owner where owner.id=investment_receivables.user_id and owner.auth_user_id=(select auth.uid()))
);

create or replace function public.create_investment_receivable(
  p_amount numeric,
  p_currency text,
  p_counterparty text,
  p_reason text,
  p_occurred_on date,
  p_task_ref text,
  p_visibility text,
  p_note text,
  p_idempotency_key text
)
returns table (
  receivable_id uuid,
  status text,
  amount numeric,
  currency text,
  counterparty text,
  reason text,
  occurred_on date,
  task_ref text,
  visibility text,
  note text,
  was_existing boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_user_id uuid;
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_counterparty text := btrim(coalesce(p_counterparty, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_visibility text := btrim(coalesce(p_visibility, 'private'));
  v_existing public.investment_receivables%rowtype;
  v_receivable_id uuid;
  v_created_at timestamptz;
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'RECEIVABLE_AUTH_REQUIRED';
  end if;

  if not (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' or (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal1' and private.investment_receivable_mfa_bypassed('write'))) then
    raise exception using errcode = '42501', message = 'RECEIVABLE_AAL2_REQUIRED';
  end if;

  select owner.id
    into v_user_id
  from public.app_users owner
  where owner.auth_user_id = v_auth_user_id
  limit 1;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'RECEIVABLE_OWNER_MAPPING_REQUIRED';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount >= 'Infinity'::numeric then
    raise exception using errcode = '22023', message = 'RECEIVABLE_AMOUNT_POSITIVE_REQUIRED';
  end if;

  if v_counterparty = '' or v_reason = '' then
    raise exception using errcode = '22023', message = 'RECEIVABLE_COUNTERPARTY_REASON_REQUIRED';
  end if;

  if p_occurred_on is null then
    raise exception using errcode = '22023', message = 'RECEIVABLE_OCCURRED_ON_REQUIRED';
  end if;

  if v_visibility not in ('private', 'shared') then
    raise exception using errcode = '22023', message = 'RECEIVABLE_VISIBILITY_INVALID';
  end if;

  if length(v_idempotency_key) < 8 then
    raise exception using errcode = '22023', message = 'RECEIVABLE_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  select existing.*
    into v_existing
  from public.investment_receivables existing
  where existing.user_id = v_user_id
    and existing.idempotency_key = v_idempotency_key
  limit 1;

  if found then
    return query
    select v_existing.id, v_existing.status, v_existing.amount, v_existing.currency,
           v_existing.counterparty, v_existing.reason, v_existing.occurred_on,
           v_existing.task_ref, v_existing.visibility, v_existing.note,
           true, v_existing.created_at;
    return;
  end if;

  insert into public.investment_receivables (
    user_id, amount, currency, counterparty, reason, occurred_on,
    status, task_ref, visibility, note, idempotency_key, created_by_auth_user_id
  ) values (
    v_user_id, p_amount, upper(btrim(coalesce(p_currency, 'TWD'))), v_counterparty, v_reason, p_occurred_on,
    'advanced', btrim(coalesce(p_task_ref, '')), v_visibility, btrim(coalesce(p_note, '')),
    v_idempotency_key, v_auth_user_id
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id, investment_receivables.created_at into v_receivable_id, v_created_at;

  if v_receivable_id is null then
    select existing.* into v_existing
    from public.investment_receivables existing
    where existing.user_id = v_user_id and existing.idempotency_key = v_idempotency_key;
    return query select v_existing.id, v_existing.status, v_existing.amount, v_existing.currency,
      v_existing.counterparty, v_existing.reason, v_existing.occurred_on,
      v_existing.task_ref, v_existing.visibility, v_existing.note, true, v_existing.created_at;
    return;
  end if;

  return query
  select r.id, r.status, r.amount, r.currency, r.counterparty, r.reason, r.occurred_on,
         r.task_ref, r.visibility, r.note, false, r.created_at
  from public.investment_receivables r
  where r.id = v_receivable_id;
end;
$$;

revoke all on function public.create_investment_receivable(numeric, text, text, text, date, text, text, text, text) from public, anon;
grant execute on function public.create_investment_receivable(numeric, text, text, text, date, text, text, text, text) to authenticated;

create or replace function public.update_investment_receivable_status(
  p_receivable_id uuid,
  p_status text
)
returns table (
  receivable_id uuid,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_user_id uuid;
  v_current public.investment_receivables%rowtype;
  v_next text := btrim(coalesce(p_status, ''));
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'RECEIVABLE_AUTH_REQUIRED';
  end if;

  if not (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' or (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal1' and private.investment_receivable_mfa_bypassed('write'))) then
    raise exception using errcode = '42501', message = 'RECEIVABLE_AAL2_REQUIRED';
  end if;

  select owner.id
    into v_user_id
  from public.app_users owner
  where owner.auth_user_id = v_auth_user_id
  limit 1;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'RECEIVABLE_OWNER_MAPPING_REQUIRED';
  end if;

  select r.*
    into v_current
  from public.investment_receivables r
  where r.id = p_receivable_id
    and r.user_id = v_user_id
  limit 1 for update;

  if not found then
    raise exception using errcode = '42501', message = 'RECEIVABLE_NOT_FOUND_OR_NOT_OWNED';
  end if;

  if not (
    (v_current.status = 'advanced' and v_next in ('billed', 'returned'))
    or (v_current.status = 'billed' and v_next in ('received', 'advanced'))
  ) then
    raise exception using errcode = '22023', message = 'RECEIVABLE_STATUS_TRANSITION_INVALID';
  end if;

  update public.investment_receivables r
     set status = v_next,
         updated_at = now()
   where r.id = v_current.id;

  return query
  select r.id, r.status, r.updated_at
  from public.investment_receivables r
  where r.id = v_current.id;
end;
$$;

revoke all on function public.update_investment_receivable_status(uuid, text) from public, anon;
grant execute on function public.update_investment_receivable_status(uuid, text) to authenticated;

create or replace function public.update_investment_receivable(
  p_receivable_id uuid,
  p_amount numeric,
  p_counterparty text,
  p_reason text,
  p_occurred_on date,
  p_task_ref text,
  p_visibility text,
  p_note text
)
returns table (
  receivable_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_user_id uuid;
  v_current public.investment_receivables%rowtype;
  v_visibility text := btrim(coalesce(p_visibility, 'private'));
begin
  if v_auth_user_id is null then
    raise exception using errcode = '42501', message = 'RECEIVABLE_AUTH_REQUIRED';
  end if;

  if not (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' or (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal1' and private.investment_receivable_mfa_bypassed('write'))) then
    raise exception using errcode = '42501', message = 'RECEIVABLE_AAL2_REQUIRED';
  end if;

  select owner.id
    into v_user_id
  from public.app_users owner
  where owner.auth_user_id = v_auth_user_id
  limit 1;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'RECEIVABLE_OWNER_MAPPING_REQUIRED';
  end if;

  select r.*
    into v_current
  from public.investment_receivables r
  where r.id = p_receivable_id
    and r.user_id = v_user_id
  limit 1 for update;

  if not found then
    raise exception using errcode = '42501', message = 'RECEIVABLE_NOT_FOUND_OR_NOT_OWNED';
  end if;

  if v_current.status in ('received', 'returned') then
    raise exception using errcode = '22023', message = 'RECEIVABLE_TERMINAL_STATUS_LOCKED';
  end if;

  if p_amount is not null and (p_amount <= 0 or p_amount >= 'Infinity'::numeric) then
    raise exception using errcode = '22023', message = 'RECEIVABLE_AMOUNT_POSITIVE_REQUIRED';
  end if;

  if v_visibility not in ('private', 'shared') then
    raise exception using errcode = '22023', message = 'RECEIVABLE_VISIBILITY_INVALID';
  end if;

  update public.investment_receivables r
     set amount = coalesce(p_amount, r.amount),
         counterparty = coalesce(nullif(btrim(coalesce(p_counterparty, '')), ''), r.counterparty),
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), r.reason),
         occurred_on = coalesce(p_occurred_on, r.occurred_on),
         task_ref = coalesce(btrim(p_task_ref), r.task_ref),
         visibility = v_visibility,
         note = coalesce(btrim(p_note), r.note),
         updated_at = now()
   where r.id = v_current.id;

  return query
  select r.id, r.updated_at
  from public.investment_receivables r
  where r.id = v_current.id;
end;
$$;

revoke all on function public.update_investment_receivable(uuid, numeric, text, text, date, text, text, text) from public, anon;
grant execute on function public.update_investment_receivable(uuid, numeric, text, text, date, text, text, text) to authenticated;

commit;
