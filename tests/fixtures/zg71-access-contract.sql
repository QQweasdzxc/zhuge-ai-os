-- TEST DATA ONLY. Run in the disposable PGlite harness after its fixtures.
-- Never run this file against production.
do $$
declare before_no bigint; after_no bigint;
begin
  perform set_config('request.uid','00000000-0000-4000-8000-000000000001',false);
  update private.app_access_settings set value='true';
  select max(event_no) into before_no from private.app_access_application_events;
  perform public.set_app_access_user_enabled('00000000-0000-4000-8000-000000000003',false,'SQL contract','sql-off');
  perform set_config('request.uid','00000000-0000-4000-8000-000000000003',false);
  if public.is_app_access_approved() or public.resolve_app_access()->>'status'<>'REJECTED' then
    raise exception 'Explicit Off must deny even during pause';
  end if;
  perform set_config('request.uid','00000000-0000-4000-8000-000000000001',false);
  begin
    perform public.set_app_access_user_enabled(auth.uid(),false,null,'sql-self');
    raise exception 'Creator self-disable unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  perform public.set_app_access_user_enabled('00000000-0000-4000-8000-000000000003',true,null,'sql-on');
  select max(event_no) into after_no from private.app_access_application_events;
  if after_no<=before_no then raise exception 'Expected append-only decisions'; end if;
end $$;
