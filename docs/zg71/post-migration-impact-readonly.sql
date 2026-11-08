-- OWNER READ ONLY, after reviewed ZG71 migration, before or after activation.
-- Use this instead of pre-migration impact-readonly.sql once new membership exists.
with classified as (
 select private.app_access_effective_allowed(u.id) as effective_allowed,
 exists(select 1 from private.app_access_member_identities() m where m.user_id=u.id) as app_evidence,
 coalesce((select event_type from private.app_access_application_events e
   where e.applicant_user_id=u.id order by event_no desc limit 1),'NEW') as latest_event
 from auth.users u
)
select latest_event,app_evidence,effective_allowed,count(*) as users
from classified group by 1,2,3 order by 1,2,3;
