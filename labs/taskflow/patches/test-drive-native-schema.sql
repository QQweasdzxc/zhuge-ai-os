-- Disposable native-schema fixture only. This file is never a production migration.
BEGIN;
SET LOCAL search_path=taskflow,extensions,pg_catalog;
INSERT INTO workspace(id,name,slug) VALUES('10000000-0000-0000-0000-000000000001','Drive gate','drive-gate');
INSERT INTO issue(id,workspace_id,title,creator_type,creator_id) VALUES('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Drive cascade gate','member','10000000-0000-0000-0000-000000000003');
SET LOCAL ROLE taskflow_runtime;
INSERT INTO attachment_drive_object(object_key,file_id,sha256,folder_id,size_bytes,ready) VALUES('native-gate','native-file',repeat('a',64),'native-folder',8,true);
INSERT INTO attachment(id,workspace_id,issue_id,uploader_type,uploader_id,filename,url,content_type,size_bytes) VALUES
('10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','member','10000000-0000-0000-0000-000000000003','original.bin','/uploads/native-gate','application/octet-stream',8),
('10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',NULL,'member','10000000-0000-0000-0000-000000000003','copy.bin','/uploads/native-gate','application/octet-stream',8);
SAVEPOINT before_delete;
DELETE FROM attachment WHERE id='10000000-0000-0000-0000-000000000004';
ROLLBACK TO before_delete;
DO $$ BEGIN
 IF EXISTS(SELECT FROM attachment_drive_delete_queue WHERE object_key='native-gate') THEN RAISE EXCEPTION 'native delete rollback leaked queue';END IF;
END $$;
-- An actual native issue cascade queues the object atomically.
RESET ROLE;
DELETE FROM issue WHERE id='10000000-0000-0000-0000-000000000002';
SET LOCAL ROLE taskflow_runtime;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM attachment_drive_delete_queue WHERE object_key='native-gate') THEN RAISE EXCEPTION 'native cascade failed to queue';END IF;
 IF EXISTS(SELECT FROM claim_drive_trash('native-gate')) THEN RAISE EXCEPTION 'shared native reference eligible';END IF;
END $$;
DELETE FROM attachment WHERE id='10000000-0000-0000-0000-000000000005';
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM claim_drive_trash('native-gate')) THEN RAISE EXCEPTION 'last native reference did not become eligible';END IF;
 BEGIN
  INSERT INTO attachment(workspace_id,uploader_type,uploader_id,filename,url,content_type,size_bytes) VALUES('10000000-0000-0000-0000-000000000001','member','10000000-0000-0000-0000-000000000003','late.bin','/uploads/native-gate','application/octet-stream',8);
  RAISE EXCEPTION 'late reference accepted' USING ERRCODE='XX000';
 EXCEPTION WHEN raise_exception THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_table_privilege('taskflow_runtime','taskflow.attachment','TRIGGER') OR has_table_privilege('taskflow_runtime','taskflow.attachment_drive_delete_queue','INSERT,DELETE') OR has_table_privilege('anon','taskflow.attachment_drive_grant','SELECT') OR has_table_privilege('authenticated','taskflow.attachment_drive_grant','SELECT') THEN RAISE EXCEPTION 'native ACL widened';END IF;
END $$;
ROLLBACK;
SELECT 'native_schema/cascade/rollback/shared_reference/late_reference/ACL PASS' AS drive_gate;
