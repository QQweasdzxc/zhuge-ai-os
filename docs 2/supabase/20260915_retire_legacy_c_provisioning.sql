-- C-03: retire the historical three-argument C provisioning application
-- authority.  The function definition remains in the database as historical
-- evidence; current C creation uses board_provision_c_consumer_v2.

begin;

revoke all on function public.board_provision_consumer(
  text, text, text
) from public, anon, authenticated;

grant execute on function public.board_provision_consumer(
  text, text, text
) to service_role;

comment on function public.board_provision_consumer(
  text, text, text
) is
  'Historical compatibility provisioning only. Application Execute is retired; service_role is temporarily retained for controlled maintenance. Current C provisioning uses board_provision_c_consumer_v2.';

commit;
