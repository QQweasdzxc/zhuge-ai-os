begin;
revoke execute on function public.board_transition_task(uuid, text, text, text, text, text) from anon;
revoke execute on function public.board_create_task(text, text, text, text, text) from anon;
revoke execute on function public.board_create_checklist_item(uuid, text, text, text, text, boolean, integer, text, text) from anon;
revoke execute on function public.board_update_checklist_item(uuid, text, text, text, text, text) from anon;
commit;