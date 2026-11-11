-- PRIVATE CANDIDATE ONLY. Not a TaskFlow runtime migration. Do not auto-apply.
-- These objects belong to the original WorkLog Supabase worker. taskflow_runtime
-- gets no access and never calls these objects. Existing work entries unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS public.worklog_google_connections (
 user_uuid uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 calendar_id text NOT NULL, calendar_name text NOT NULL,
 credentials jsonb NOT NULL CHECK (credentials->>'v'='1'),
 enabled boolean NOT NULL DEFAULT false,
 activated_at timestamptz NOT NULL DEFAULT now(),
 sync_token text, local_cursor timestamptz,
 lease_id uuid, lease_until timestamptz,
 last_error text, last_synced_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.worklog_google_bindings (
 user_uuid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 calendar_id text NOT NULL, event_id text NOT NULL,
 entry_id uuid NOT NULL REFERENCES public.work_entries(id),
 event_etag text NOT NULL, entry_updated_at timestamptz NOT NULL,
 operation_id text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_uuid,calendar_id,event_id), UNIQUE(user_uuid,calendar_id,entry_id)
);
CREATE TABLE IF NOT EXISTS public.worklog_google_failures (
 user_uuid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 operation_id text NOT NULL, code text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_uuid,operation_id)
);
CREATE TABLE IF NOT EXISTS public.worklog_google_channels (
 user_uuid uuid NOT NULL REFERENCES public.worklog_google_connections(user_uuid) ON DELETE CASCADE,
 calendar_id text NOT NULL, channel_id text NOT NULL UNIQUE,
 nonce_hash text NOT NULL CHECK(length(nonce_hash)=64), resource_id text NOT NULL,
 expires_at timestamptz NOT NULL, last_message numeric(30,0) NOT NULL DEFAULT 0,
 last_notified_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_uuid,calendar_id)
);
ALTER TABLE public.worklog_google_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worklog_google_channels FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.worklog_google_channels TO service_role;
CREATE OR REPLACE FUNCTION public.worklog_google_push_receipt(p_channel text,p_message text,p_now timestamptz)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH receipt AS (UPDATE public.worklog_google_channels SET last_message=p_message::numeric,last_notified_at=p_now
 WHERE channel_id=p_channel AND expires_at>clock_timestamp() AND last_message<p_message::numeric RETURNING 1)
 SELECT EXISTS(SELECT 1 FROM receipt);
$$;
REVOKE ALL ON FUNCTION public.worklog_google_push_receipt(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worklog_google_push_receipt(text,text,timestamptz) TO service_role;
ALTER TABLE public.worklog_google_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worklog_google_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worklog_google_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worklog_google_connections,public.worklog_google_bindings,public.worklog_google_failures FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.worklog_google_connections,public.worklog_google_bindings,public.worklog_google_failures TO service_role;
CREATE OR REPLACE FUNCTION public.worklog_google_acquire(p_owner uuid,p_calendar text,p_lease uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH leased AS (UPDATE public.worklog_google_connections SET lease_id=p_lease,lease_until=clock_timestamp()+interval '5 minutes' WHERE user_uuid=p_owner AND calendar_id=p_calendar AND enabled AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING 1)
 SELECT EXISTS(SELECT 1 FROM leased);
$$;
CREATE OR REPLACE FUNCTION public.worklog_google_release(p_owner uuid,p_calendar text,p_lease uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE public.worklog_google_connections SET lease_id=NULL,lease_until=NULL WHERE user_uuid=p_owner AND calendar_id=p_calendar AND lease_id=p_lease;
$$;
CREATE OR REPLACE FUNCTION public.worklog_google_advance(p_owner uuid,p_calendar text,p_lease uuid,p_sync text,p_local timestamptz)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH advanced AS (UPDATE public.worklog_google_connections SET sync_token=p_sync,local_cursor=p_local,last_synced_at=clock_timestamp(),last_error=NULL,updated_at=clock_timestamp() WHERE user_uuid=p_owner AND calendar_id=p_calendar AND lease_id=p_lease AND lease_until>clock_timestamp() RETURNING 1)
 SELECT EXISTS(SELECT 1 FROM advanced);
$$;
CREATE OR REPLACE FUNCTION public.worklog_google_renew(p_owner uuid,p_calendar text,p_lease uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 WITH renewed AS (UPDATE public.worklog_google_connections SET lease_until=clock_timestamp()+interval '5 minutes' WHERE user_uuid=p_owner AND calendar_id=p_calendar AND lease_id=p_lease AND lease_until>clock_timestamp() AND enabled RETURNING 1)
 SELECT EXISTS(SELECT 1 FROM renewed);
$$;
REVOKE ALL ON FUNCTION public.worklog_google_renew(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worklog_google_renew(uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.worklog_google_acquire(uuid,text,uuid),public.worklog_google_release(uuid,text,uuid),public.worklog_google_advance(uuid,text,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worklog_google_acquire(uuid,text,uuid),public.worklog_google_release(uuid,text,uuid),public.worklog_google_advance(uuid,text,uuid,text,timestamptz) TO service_role;
-- Connection lifecycle serializes with worker acquire; never replaces credentials
-- while a worker owns the rotating session.
CREATE OR REPLACE FUNCTION public.worklog_google_connect(p_owner uuid,p_calendar text,p_name text,p_credentials jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old public.worklog_google_connections%ROWTYPE;
BEGIN
 SELECT * INTO old FROM public.worklog_google_connections WHERE user_uuid=p_owner FOR UPDATE;
 IF FOUND AND old.lease_until>clock_timestamp() THEN RETURN false; END IF;
 INSERT INTO public.worklog_google_connections(user_uuid,calendar_id,calendar_name,credentials,enabled)
 VALUES(p_owner,p_calendar,p_name,p_credentials,true)
 ON CONFLICT(user_uuid) DO UPDATE SET calendar_id=p_calendar,calendar_name=p_name,credentials=p_credentials,enabled=true,
 activated_at=CASE WHEN public.worklog_google_connections.calendar_id=p_calendar THEN public.worklog_google_connections.activated_at ELSE clock_timestamp() END,
 sync_token=CASE WHEN public.worklog_google_connections.calendar_id=p_calendar THEN public.worklog_google_connections.sync_token ELSE NULL END,
 local_cursor=CASE WHEN public.worklog_google_connections.calendar_id=p_calendar THEN public.worklog_google_connections.local_cursor ELSE NULL END,
 lease_id=NULL,lease_until=NULL,last_error=NULL,updated_at=clock_timestamp()
 WHERE public.worklog_google_connections.lease_until IS NULL OR public.worklog_google_connections.lease_until<clock_timestamp();
 RETURN FOUND;
END;
$$;
CREATE OR REPLACE FUNCTION public.worklog_google_disconnect(p_owner uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old public.worklog_google_connections%ROWTYPE;
BEGIN
 SELECT * INTO old FROM public.worklog_google_connections WHERE user_uuid=p_owner FOR UPDATE;
 IF NOT FOUND THEN RETURN true; END IF;
 IF old.lease_until>clock_timestamp() THEN RETURN false; END IF;
 DELETE FROM public.worklog_google_connections WHERE user_uuid=p_owner;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.worklog_google_connect(uuid,text,text,jsonb),public.worklog_google_disconnect(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.worklog_google_connect(uuid,text,text,jsonb),public.worklog_google_disconnect(uuid) TO service_role;
COMMIT;
-- No cron job, Google watch, triggers, global ACL changes, token values or backfill.
