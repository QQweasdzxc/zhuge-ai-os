\set ON_ERROR_STOP on

-- Isolated CI administrator step representing Supabase Dashboard > Storage >
-- Policies. Production uses the Dashboard; this file is never run against the
-- hosted project.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('taskflow-attachments', 'taskflow-attachments', false, 50000000, NULL);

CREATE POLICY taskflow_attachments_select
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'taskflow-attachments'
        AND taskflow_storage.taskflow_storage_can_access_object(name)
    );

CREATE POLICY taskflow_attachments_insert
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'taskflow-attachments'
        AND owner_id = (SELECT auth.uid()::text)
        AND taskflow_storage.taskflow_storage_can_access_object(name)
    );

CREATE POLICY taskflow_attachments_delete
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'taskflow-attachments'
        AND taskflow_storage.taskflow_storage_can_delete_object(name, owner_id)
    );
