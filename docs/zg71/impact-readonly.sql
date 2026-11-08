-- READ ONLY: inline the pg_get_functiondef-verified live policy per auth ID.
-- Return aggregates only. This does NOT run a migration, set JWT claims, call
-- submit/review/set_*, or treat auth.users as a browser membership directory.
with latest as (
 select distinct on(applicant_user_id) applicant_user_id,event_type
 from private.app_access_application_events order by applicant_user_id,event_no desc
), evidence as (
 select auth_user_id as id from public.app_users
 union select user_uuid from public.user_profiles
 union select auth_user_id from public.worklog_users
 union select applicant_user_id from private.app_access_application_events
), classified as (
 select coalesce(latest.event_type,'NEW') as event_type,
 exists(select 1 from evidence where evidence.id=u.id) as app_evidence,
 public.app_access_review_paused() or coalesce(latest.event_type in ('approved_bootstrap','application_approved'),false) as live_allowed,
 case when latest.event_type='access_disabled' then false
 else public.app_access_review_paused() or coalesce(latest.event_type in ('approved_bootstrap','application_approved','access_enabled'),false) end as no_cutoff_allowed,
 coalesce(latest.event_type in ('approved_bootstrap','application_approved','access_enabled'),false)
 or (public.app_access_review_paused() and exists(select 1 from evidence where evidence.id=u.id)) as proposed_snapshot_allowed
 from auth.users u left join latest on latest.applicant_user_id=u.id
)
select event_type,app_evidence,live_allowed,no_cutoff_allowed,proposed_snapshot_allowed,count(*) as users
from classified group by 1,2,3,4,5 order by 1,2;
