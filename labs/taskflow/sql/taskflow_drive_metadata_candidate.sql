-- Private Drive metadata only. No file bodies or plaintext OAuth secrets live here.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $taskflow_migration_role_guard$
BEGIN
    IF current_user <> 'taskflow_migrator' THEN
        RAISE EXCEPTION 'migration path requires taskflow_migrator, got %', current_user;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user
          AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
        RAISE EXCEPTION 'taskflow_migrator holds elevated attributes';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_namespace
        WHERE nspname = 'taskflow' AND nspowner = current_user::regrole
    ) THEN
        RAISE EXCEPTION 'taskflow schema owner is not taskflow_migrator';
    END IF;
END
$taskflow_migration_role_guard$;



SET LOCAL search_path=taskflow,pg_catalog;
CREATE TABLE taskflow.attachment_drive_object(
 object_key text PRIMARY KEY CHECK(length(object_key) BETWEEN 1 AND 1024),
 file_id text UNIQUE NOT NULL CHECK(length(file_id) BETWEEN 1 AND 256 AND file_id ~ '^[a-zA-Z0-9_-]+$'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 folder_id text NOT NULL CHECK(length(folder_id) BETWEEN 1 AND 256 AND folder_id ~ '^[a-zA-Z0-9_-]+$'),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 0 AND 104857600),
 ready boolean NOT NULL DEFAULT false,
 deleted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE taskflow.attachment_drive_object ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachment_drive_runtime ON taskflow.attachment_drive_object FOR ALL TO taskflow_runtime USING(true) WITH CHECK(true);
DO $acl$ DECLARE g record;BEGIN
 FOR g IN SELECT DISTINCT x.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x WHERE c.oid='taskflow.attachment_drive_object'::regclass AND x.grantee<>c.relowner LOOP
 EXECUTE format('REVOKE ALL ON taskflow.attachment_drive_object FROM %s',CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
 END LOOP;
END $acl$;
GRANT SELECT,INSERT ON taskflow.attachment_drive_object TO taskflow_runtime;
GRANT UPDATE(ready,deleted) ON taskflow.attachment_drive_object TO taskflow_runtime;
CREATE FUNCTION taskflow.guard_drive_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,taskflow AS $$
BEGIN
 IF NEW.object_key<>OLD.object_key OR NEW.file_id<>OLD.file_id OR NEW.sha256<>OLD.sha256 OR NEW.folder_id<>OLD.folder_id OR NEW.size_bytes<>OLD.size_bytes OR NEW.created_at<>OLD.created_at OR (OLD.ready AND NOT NEW.ready) OR (OLD.deleted AND NOT NEW.deleted) THEN
 RAISE EXCEPTION 'Drive original binding is immutable';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION taskflow.guard_drive_binding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION taskflow.guard_drive_binding() TO taskflow_runtime;
CREATE TRIGGER attachment_drive_immutable BEFORE UPDATE ON taskflow.attachment_drive_object FOR EACH ROW EXECUTE FUNCTION taskflow.guard_drive_binding();
DO $postflight$ BEGIN
 IF (SELECT relowner<>current_user::regrole OR NOT relrowsecurity FROM pg_class WHERE oid='taskflow.attachment_drive_object'::regclass)
 OR NOT has_table_privilege('taskflow_runtime','taskflow.attachment_drive_object','SELECT')
 OR NOT has_table_privilege('taskflow_runtime','taskflow.attachment_drive_object','INSERT')
 OR NOT has_column_privilege('taskflow_runtime','taskflow.attachment_drive_object','ready','UPDATE')
 OR NOT has_column_privilege('taskflow_runtime','taskflow.attachment_drive_object','deleted','UPDATE')
 OR has_table_privilege('taskflow_runtime','taskflow.attachment_drive_object','DELETE,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
 OR has_table_privilege('anon','taskflow.attachment_drive_object','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('authenticated','taskflow.attachment_drive_object','SELECT,INSERT,UPDATE,DELETE') THEN
 RAISE EXCEPTION 'Drive attachment metadata ACL mismatch';END IF;
END $postflight$;
CREATE TABLE taskflow.attachment_drive_folder(id integer PRIMARY KEY CHECK(id=1),file_id text UNIQUE NOT NULL CHECK(length(file_id) BETWEEN 1 AND 256 AND file_id ~ '^[a-zA-Z0-9_-]+$'));
ALTER TABLE taskflow.attachment_drive_folder ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_folder_runtime ON taskflow.attachment_drive_folder FOR ALL TO taskflow_runtime USING(true) WITH CHECK(true);
CREATE TABLE taskflow.attachment_drive_setup_state(
 state_hash text PRIMARY KEY CHECK(state_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,
 verifier_cipher bytea NOT NULL CHECK(octet_length(verifier_cipher) BETWEEN 40 AND 512),
 claimed boolean NOT NULL DEFAULT false
);
CREATE TABLE taskflow.attachment_drive_grant(
 id integer PRIMARY KEY CHECK(id=1),
 grant_cipher bytea NOT NULL CHECK(octet_length(grant_cipher) BETWEEN 40 AND 16384),
 owner_email text NOT NULL CHECK(length(owner_email) BETWEEN 3 AND 320),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE taskflow.attachment_drive_setup_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE taskflow.attachment_drive_grant ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_setup_runtime ON taskflow.attachment_drive_setup_state FOR ALL TO taskflow_runtime USING(true) WITH CHECK(true);
CREATE POLICY drive_grant_runtime ON taskflow.attachment_drive_grant FOR ALL TO taskflow_runtime USING(true) WITH CHECK(true);
DO $setup_acl$ DECLARE tab text;g record;BEGIN
 FOREACH tab IN ARRAY ARRAY['attachment_drive_setup_state','attachment_drive_grant','attachment_drive_folder'] LOOP
 FOR g IN SELECT DISTINCT x.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x WHERE c.oid=format('taskflow.%I',tab)::regclass AND x.grantee<>c.relowner LOOP
 EXECUTE format('REVOKE ALL ON taskflow.%I FROM %s',tab,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
 END LOOP;END LOOP;
END $setup_acl$;
GRANT SELECT,INSERT ON taskflow.attachment_drive_folder TO taskflow_runtime;
GRANT SELECT,INSERT,DELETE ON taskflow.attachment_drive_setup_state TO taskflow_runtime;
GRANT UPDATE(claimed) ON taskflow.attachment_drive_setup_state TO taskflow_runtime;
GRANT SELECT,INSERT ON taskflow.attachment_drive_grant TO taskflow_runtime;
GRANT UPDATE(grant_cipher,owner_email,updated_at) ON taskflow.attachment_drive_grant TO taskflow_runtime;
DO $setup_postflight$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['attachment_drive_setup_state','attachment_drive_grant','attachment_drive_folder'] LOOP
 IF (SELECT relowner<>current_user::regrole OR NOT relrowsecurity FROM pg_class WHERE oid=format('taskflow.%I',tab)::regclass)
 OR has_table_privilege('anon',format('taskflow.%I',tab),'SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('authenticated',format('taskflow.%I',tab),'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'private Drive setup ACL mismatch';END IF;
 END LOOP;
END $setup_postflight$;
CREATE TABLE taskflow.attachment_drive_delete_queue(
 object_key text PRIMARY KEY REFERENCES taskflow.attachment_drive_object(object_key),
 queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 processing boolean NOT NULL DEFAULT false,
 done boolean NOT NULL DEFAULT false,
 finished_at timestamptz
);
ALTER TABLE taskflow.attachment_drive_delete_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_delete_runtime ON taskflow.attachment_drive_delete_queue FOR ALL TO taskflow_runtime USING(true) WITH CHECK(true);
DO $queue_acl$ DECLARE g record;BEGIN
 FOR g IN SELECT DISTINCT x.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))x WHERE c.oid='taskflow.attachment_drive_delete_queue'::regclass AND x.grantee<>c.relowner LOOP
 EXECUTE format('REVOKE ALL ON taskflow.attachment_drive_delete_queue FROM %s',CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);END LOOP;
END $queue_acl$;
GRANT SELECT ON taskflow.attachment_drive_delete_queue TO taskflow_runtime;
GRANT UPDATE(processing,done,finished_at) ON taskflow.attachment_drive_delete_queue TO taskflow_runtime;
CREATE FUNCTION taskflow.queue_drive_attachment_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,taskflow AS $$
BEGIN
 INSERT INTO taskflow.attachment_drive_delete_queue(object_key)
 SELECT object_key FROM taskflow.attachment_drive_object WHERE OLD.url='/uploads/'||object_key AND ready AND NOT deleted
 ON CONFLICT(object_key) DO NOTHING;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION taskflow.queue_drive_attachment_delete() FROM PUBLIC;
CREATE TRIGGER drive_attachment_delete AFTER DELETE ON taskflow.attachment FOR EACH ROW EXECUTE FUNCTION taskflow.queue_drive_attachment_delete();
-- Serialize per-object native references with the cleanup claim. This avoids
-- a new captured-context row racing between the last-reference check and trash.
CREATE FUNCTION taskflow.guard_drive_attachment_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,taskflow AS $$
DECLARE k text;
BEGIN
 IF TG_OP='DELETE' THEN k:=substring(OLD.url FROM 10);ELSE k:=substring(NEW.url FROM 10);END IF;
 IF (CASE WHEN TG_OP='DELETE' THEN OLD.url ELSE NEW.url END) LIKE '/uploads/%' THEN
 PERFORM pg_advisory_xact_lock(hashtextextended(k,8925101002));
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM taskflow.attachment_drive_delete_queue WHERE object_key=k AND (processing OR done)) THEN
 RAISE EXCEPTION 'original attachment removal is already committed';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
REVOKE ALL ON FUNCTION taskflow.guard_drive_attachment_reference() FROM PUBLIC;
CREATE TRIGGER drive_attachment_reference BEFORE INSERT OR UPDATE OF url OR DELETE ON taskflow.attachment FOR EACH ROW EXECUTE FUNCTION taskflow.guard_drive_attachment_reference();
CREATE FUNCTION taskflow.claim_drive_trash(k text) RETURNS SETOF taskflow.attachment_drive_object LANGUAGE plpgsql SET search_path=pg_catalog,taskflow AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(k,8925101002));
 IF EXISTS(SELECT 1 FROM taskflow.attachment WHERE url='/uploads/'||k) THEN RETURN;END IF;
 UPDATE taskflow.attachment_drive_delete_queue SET processing=true WHERE object_key=k AND NOT done;
 IF NOT FOUND THEN RETURN;END IF;
 RETURN QUERY SELECT * FROM taskflow.attachment_drive_object WHERE object_key=k;
END $$;
REVOKE ALL ON FUNCTION taskflow.claim_drive_trash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION taskflow.claim_drive_trash(text) TO taskflow_runtime;
COMMIT;
