begin;

-- board_create_instance is an internal primitive. Generic consumer creation
-- must go through the complete, authorized provisioning contract instead.
revoke execute on function public.board_create_instance(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.board_create_instance(text, text, text)
  to postgres;

commit;
