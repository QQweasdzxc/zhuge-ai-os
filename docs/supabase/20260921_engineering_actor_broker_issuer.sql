-- Protected Engineering Actor Broker issuance audit and replay guard.
--
-- The Broker Edge Function is the only caller. It authenticates the external
-- connector separately, signs the existing bounded GPT transition token, and
-- records only sanitized issuance metadata. No token, private key, service
-- credential, Board data, or Product data is stored here.

begin;

create table if not exists private.engineering_actor_token_issuances (
  issuance_id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null unique,
  jti uuid not null unique,
  caller_key_id text not null,
  actor_label text not null check (actor_label = 'GPT'),
  audience text not null check (audience = 'engineering-transition'),
  scope text not null check (scope = 'board:transition'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint engineering_actor_token_issuance_expiry_check
    check (expires_at > issued_at and expires_at <= issued_at + interval '5 minutes'),
  constraint engineering_actor_token_issuance_caller_key_check
    check (caller_key_id ~ '^[A-Za-z0-9._-]{1,80}$')
);

create index if not exists engineering_actor_token_issuances_expiry_idx
  on private.engineering_actor_token_issuances (expires_at desc);

alter table private.engineering_actor_token_issuances enable row level security;
revoke all on private.engineering_actor_token_issuances from public, anon, authenticated, service_role;

create or replace function public.record_engineering_actor_token_issuance(
  p_request_id uuid,
  p_jti uuid,
  p_caller_key_id text,
  p_actor_label text,
  p_audience text,
  p_scope text,
  p_issued_at timestamptz,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, auth, extensions, pg_temp
as $$
declare
  issuance_id_value uuid := extensions.gen_random_uuid();
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Engineering Actor Broker service path is required';
  end if;
  if p_request_id is null or p_jti is null then
    raise exception using errcode = '22023', message = 'Broker request and jti are required';
  end if;
  if p_actor_label <> 'GPT' or p_audience <> 'engineering-transition' or p_scope <> 'board:transition' then
    raise exception using errcode = '42501', message = 'Broker capability is not allowlisted';
  end if;
  if p_caller_key_id is null or p_caller_key_id !~ '^[A-Za-z0-9._-]{1,80}$' then
    raise exception using errcode = '22023', message = 'Broker caller key identity is invalid';
  end if;
  if p_issued_at is null or p_expires_at is null
     or p_expires_at <= p_issued_at
     or p_expires_at > p_issued_at + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Broker token expiry is outside the allowed window';
  end if;

  insert into private.engineering_actor_token_issuances (
    issuance_id, request_id, jti, caller_key_id, actor_label,
    audience, scope, issued_at, expires_at
  ) values (
    issuance_id_value, p_request_id, p_jti, p_caller_key_id, p_actor_label,
    p_audience, p_scope, p_issued_at, p_expires_at
  );

  return jsonb_build_object(
    'recorded', true,
    'issuance_id', issuance_id_value,
    'request_id', p_request_id,
    'jti', p_jti,
    'caller_key_id', p_caller_key_id,
    'actor', p_actor_label,
    'audience', p_audience,
    'scope', p_scope,
    'issued_at', p_issued_at,
    'expires_at', p_expires_at
  );
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Broker request id or jti has already been consumed';
end;
$$;

revoke all on function public.record_engineering_actor_token_issuance(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_engineering_actor_token_issuance(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz
) to service_role;

commit;
