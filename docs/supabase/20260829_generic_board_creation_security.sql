-- Generic C Consumer Creation: close the legacy anonymous ACL on the low-level
-- instance primitive. The authenticated provisioning RPC remains the only
-- product entry point; no schema, RLS, or data change is performed here.
revoke execute on function public.board_create_instance(text, text, text) from anon;
grant execute on function public.board_create_instance(text, text, text) to authenticated;
