with evidence as (
select auth_user_id as id from public.app_users union select user_uuid from public.user_profiles
union select auth_user_id from public.worklog_users union select applicant_user_id from private.app_access_application_events
), missing as (
select u.id from auth.users u where not exists(select 1 from evidence e where e.id=u.id)
and (public.app_access_review_paused() or exists(select 1 from private.app_access_application_events e where e.applicant_user_id=u.id and e.event_type in ('approved_bootstrap','application_approved') and e.event_no=(select max(event_no) from private.app_access_application_events where applicant_user_id=u.id)))
)
select 'gap_users' as metric,'all' as bucket,count(*) as count from missing
union all select 'provider',i.provider,count(*) from auth.identities i join missing m on m.id=i.user_id group by i.provider
union all select 'last_sign_in',case when u.last_sign_in_at is null then 'never' when u.last_sign_in_at>=now()-interval '1 day' then 'within_24h' when u.last_sign_in_at>=now()-interval '7 days' then '1_to_7_days' when u.last_sign_in_at>=now()-interval '30 days' then '7_to_30_days' else 'over_30_days' end,count(*) from auth.users u join missing m on m.id=u.id group by 2
union all select 'account_created',case when u.created_at>=now()-interval '1 day' then 'within_24h' when u.created_at>=now()-interval '7 days' then '1_to_7_days' when u.created_at>=now()-interval '30 days' then '7_to_30_days' else 'over_30_days' end,count(*) from auth.users u join missing m on m.id=u.id group by 2
union all select 'anonymous_users',coalesce(u.is_anonymous,false)::text,count(*) from auth.users u join missing m on m.id=u.id group by 2
union all select 'sessions','total',count(*) from auth.sessions s join missing m on m.id=s.user_id
union all select 'sessions','not_after_unexpired_or_unbounded',count(*) from auth.sessions s join missing m on m.id=s.user_id where s.not_after is null or s.not_after>now()
union all select 'sessions','refreshed_within_7_days',count(*) from auth.sessions s join missing m on m.id=s.user_id where s.refreshed_at at time zone 'UTC'>=now()-interval '7 days'
union all select 'refresh_tokens','unrevoked',count(*) from auth.refresh_tokens r join missing m on r.user_id=m.id::text where not coalesce(r.revoked,false)
union all select 'refresh_tokens','unrevoked_updated_within_7_days',count(*) from auth.refresh_tokens r join missing m on r.user_id=m.id::text where not coalesce(r.revoked,false) and coalesce(r.updated_at,r.created_at)>=now()-interval '7 days'
union all select 'taskflow_user_email_correspondence','aggregate_only',count(*) from taskflow."user" t join auth.users u on lower(t.email)=lower(u.email) join missing m on m.id=u.id
union all select 'auth_audit_action',coalesce(a.payload->>'action','unknown'),count(*) from auth.audit_log_entries a where a.payload->>'actor_id' in(select id::text from missing) group by 2
order by 1,2;

-- Server test markers: presence/count only, not names or metadata values.
with evidence as (
select auth_user_id as id from public.app_users union select user_uuid from public.user_profiles
union select auth_user_id from public.worklog_users union select applicant_user_id from private.app_access_application_events
), missing as (
select u.id from auth.users u where not exists(select 1 from evidence e where e.id=u.id)
and (public.app_access_review_paused() or exists(select 1 from private.app_access_application_events e where e.applicant_user_id=u.id and e.event_type in ('approved_bootstrap','application_approved') and e.event_no=(select max(event_no) from private.app_access_application_events where applicant_user_id=u.id)))
) select count(*) filter(where u.raw_app_meta_data ? 'is_test' or u.raw_app_meta_data ? 'test_account') as accounts_with_server_test_marker,count(*) filter(where u.deleted_at is not null) as deleted_accounts from auth.users u join missing m on m.id=u.id;
