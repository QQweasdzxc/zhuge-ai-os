-- Candidate rollback only. This removes TaskFlow policies/helpers.
-- It intentionally does NOT delete the bucket or any stored attachment blob.
-- Do not roll back the code to a Render-local-only build after the first
-- Supabase object is written: that older build cannot read these objects.

BEGIN;

-- Names are reserved by this installation; a missing policy is harmless.
DROP POLICY IF EXISTS taskflow_attachments_select ON storage.objects;
DROP POLICY IF EXISTS taskflow_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS taskflow_attachments_delete ON storage.objects;

DROP FUNCTION IF EXISTS storage.taskflow_storage_can_delete_object(text, text);
DROP FUNCTION IF EXISTS storage.taskflow_storage_can_access_object(text);

COMMIT;

-- Do not revoke the temporary CREATE ACL blindly; the install transaction
-- revokes it after transferring helper ownership. Verify role ACLs read-only.
-- Keep `storage.buckets.id = 'taskflow-attachments'` and its objects intact.
-- Revoke the narrow schema/role grants only after comparing their exact
-- before-state; they may predate this candidate and are not blindly reversed.
