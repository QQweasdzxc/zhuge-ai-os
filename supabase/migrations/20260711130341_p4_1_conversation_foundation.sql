create extension if not exists pgcrypto;

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references auth.users(id) on delete cascade,
  thread_key text not null default 'main',
  title text not null default '諸葛先生',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_conversations_thread_key_not_blank check (length(trim(thread_key)) > 0),
  constraint assistant_conversations_status_check check (status in ('active', 'archived'))
);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  client_message_id text not null,
  role text not null,
  content text not null default '',
  card jsonb,
  channel text not null default 'web',
  created_at timestamptz not null default now(),
  constraint assistant_messages_role_check check (role in ('user', 'assistant', 'system')),
  constraint assistant_messages_channel_check check (channel in ('web', 'chrome', 'mobile', 'api')),
  constraint assistant_messages_client_id_not_blank check (length(trim(client_message_id)) > 0)
);

create table if not exists public.assistant_conversation_states (
  id uuid primary key default gen_random_uuid(),
  user_uuid uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  state_key text not null default 'main',
  state_type text not null default 'idle',
  pending_action jsonb,
  channel text not null default 'web',
  updated_at timestamptz not null default now(),
  constraint assistant_conversation_states_state_key_not_blank check (length(trim(state_key)) > 0),
  constraint assistant_conversation_states_channel_check check (channel in ('web', 'chrome', 'mobile', 'api'))
);

create unique index if not exists assistant_conversations_user_thread_uidx
  on public.assistant_conversations(user_uuid, thread_key);

create unique index if not exists assistant_messages_user_client_uidx
  on public.assistant_messages(user_uuid, client_message_id);

create index if not exists assistant_messages_user_created_idx
  on public.assistant_messages(user_uuid, created_at desc);

create index if not exists assistant_messages_conversation_created_idx
  on public.assistant_messages(conversation_id, created_at asc);

create unique index if not exists assistant_conversation_states_user_key_uidx
  on public.assistant_conversation_states(user_uuid, state_key);

create index if not exists assistant_conversation_states_user_updated_idx
  on public.assistant_conversation_states(user_uuid, updated_at desc);

grant select, insert, update, delete on public.assistant_conversations to authenticated;
grant select, insert, update, delete on public.assistant_messages to authenticated;
grant select, insert, update, delete on public.assistant_conversation_states to authenticated;

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_conversation_states enable row level security;

drop policy if exists "assistant_conversations_select_own" on public.assistant_conversations;
create policy "assistant_conversations_select_own"
on public.assistant_conversations
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_conversations_insert_own" on public.assistant_conversations;
create policy "assistant_conversations_insert_own"
on public.assistant_conversations
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_conversations_update_own" on public.assistant_conversations;
create policy "assistant_conversations_update_own"
on public.assistant_conversations
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_conversations_delete_own" on public.assistant_conversations;
create policy "assistant_conversations_delete_own"
on public.assistant_conversations
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_messages_select_own" on public.assistant_messages;
create policy "assistant_messages_select_own"
on public.assistant_messages
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_messages_insert_own" on public.assistant_messages;
create policy "assistant_messages_insert_own"
on public.assistant_messages
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_messages_update_own" on public.assistant_messages;
create policy "assistant_messages_update_own"
on public.assistant_messages
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_messages_delete_own" on public.assistant_messages;
create policy "assistant_messages_delete_own"
on public.assistant_messages
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_conversation_states_select_own" on public.assistant_conversation_states;
create policy "assistant_conversation_states_select_own"
on public.assistant_conversation_states
for select
to authenticated
using ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_conversation_states_insert_own" on public.assistant_conversation_states;
create policy "assistant_conversation_states_insert_own"
on public.assistant_conversation_states
for insert
to authenticated
with check ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_conversation_states_update_own" on public.assistant_conversation_states;
create policy "assistant_conversation_states_update_own"
on public.assistant_conversation_states
for update
to authenticated
using ((select auth.uid()) = user_uuid)
with check ((select auth.uid()) = user_uuid);

drop policy if exists "assistant_conversation_states_delete_own" on public.assistant_conversation_states;
create policy "assistant_conversation_states_delete_own"
on public.assistant_conversation_states
for delete
to authenticated
using ((select auth.uid()) = user_uuid);

comment on table public.assistant_conversations is 'P4.1 Conversation Foundation: one shared ZhuGe assistant conversation per user_uuid.';
comment on table public.assistant_messages is 'P4.1 Conversation Foundation: shared chat history across web/chrome/mobile channels.';
comment on table public.assistant_conversation_states is 'P4.1 Conversation Foundation: shared pending action / waiting user reply state.';