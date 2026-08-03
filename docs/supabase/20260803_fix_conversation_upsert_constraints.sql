-- v0.9.0-alpha.9.7
-- Fix Conversation Cloud upsert contracts used by PostgREST on_conflict.
create unique index if not exists assistant_conversations_user_thread_uidx
  on public.assistant_conversations (user_uuid, thread_key);

create unique index if not exists assistant_messages_user_client_uidx
  on public.assistant_messages (user_uuid, client_message_id);

create unique index if not exists assistant_conversation_states_user_state_uidx
  on public.assistant_conversation_states (user_uuid, state_key);
