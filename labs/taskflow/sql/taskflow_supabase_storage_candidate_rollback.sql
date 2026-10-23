-- TaskFlow helper-function rollback only.
-- First remove the three TaskFlow policies from the Supabase Storage Dashboard.
-- Then connect directly as taskflow_migrator. This deliberately does not
-- touch storage/auth, the bucket, Storage objects, attachment rows, or the
-- app-owned schema ACLs.

BEGIN;

DO $$
BEGIN
    IF session_user <> 'taskflow_migrator' OR current_user <> 'taskflow_migrator'
       OR session_user <> current_user THEN
        RAISE EXCEPTION 'connect directly as taskflow_migrator to remove TaskFlow helper functions';
    END IF;
END
$$;

DROP FUNCTION IF EXISTS taskflow_storage.taskflow_storage_can_delete_object(text, text);
DROP FUNCTION IF EXISTS taskflow_storage.taskflow_storage_can_access_object(text);

COMMIT;

-- Keep taskflow_storage and its narrow grants until a separate read-only check
-- confirms no TaskFlow object refers to it. Never delete the bucket or blobs.
