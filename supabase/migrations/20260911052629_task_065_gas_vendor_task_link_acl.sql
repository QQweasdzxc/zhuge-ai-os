-- TASK-065 follow-up hardening
begin;
revoke execute on function public.board_instance_get_task_vendor_link(uuid) from public, anon;
revoke execute on function public.board_instance_set_task_vendor_link(uuid, text) from public, anon;
grant execute on function public.board_instance_get_task_vendor_link(uuid) to authenticated;
grant execute on function public.board_instance_set_task_vendor_link(uuid, text) to authenticated;
commit;