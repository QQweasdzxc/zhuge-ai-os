-- AI Board Batch #2 security follow-up.
-- Explicitly revoke anon EXECUTE because Supabase projects may retain a direct
-- anon grant on SECURITY DEFINER RPCs even after PUBLIC privileges are revoked.
begin;
revoke execute on function public.board_transition_task(uuid, text, text, text, text, text) from anon;
revoke execute on function public.board_create_task(text, text, text, text, text) from anon;
revoke execute on function public.board_create_checklist_item(uuid, text, text, text, text, boolean, integer, text, text) from anon;
revoke execute on function public.board_update_checklist_item(uuid, text, text, text, text, text) from anon;
commit;
