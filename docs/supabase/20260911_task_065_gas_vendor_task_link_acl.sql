-- TASK-065 follow-up hardening: Supabase defaults can grant EXECUTE to anon
-- when a new public function is created. Keep these C capability RPCs
-- authenticated-only; this does not change existing functions.

begin;

revoke execute on function public.board_instance_get_task_vendor_link(uuid) from public, anon;
revoke execute on function public.board_instance_set_task_vendor_link(uuid, text) from public, anon;
grant execute on function public.board_instance_get_task_vendor_link(uuid) to authenticated;
grant execute on function public.board_instance_set_task_vendor_link(uuid, text) to authenticated;

commit;
