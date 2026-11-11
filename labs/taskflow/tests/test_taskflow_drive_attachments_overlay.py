import importlib.util
from pathlib import Path
import tempfile,shutil,unittest
REPO=Path(__file__).resolve().parents[3]
SCRIPT=REPO/'labs/taskflow/patches/apply-taskflow-drive-attachments.py'
spec=importlib.util.spec_from_file_location('drive_overlay',SCRIPT);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class DriveOverlayTests(unittest.TestCase):
 def fixture(self,root):
  for name in ['server/cmd/server/router.go','server/cmd/server/main.go','server/internal/handler/file.go','server/internal/handler/workspace.go','server/internal/handler/issue.go','server/internal/service/issue.go','server/internal/handler/handler.go']:
   p=root/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(REPO/'third_party/multica'/name,p)
  (root/'server/internal/storage').mkdir(parents=True)
 def test_apply_private_callback_and_no_db_body(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);self.fixture(root);before=(root/'server/internal/handler/file.go').read_text();module.apply(root,SCRIPT.parent/'drive-attachments');router=(root/'server/cmd/server/router.go').read_text();after=(root/'server/internal/handler/file.go').read_text()
   self.assertIn('refusing ephemeral fallback',router);self.assertIn('drive-readonly',router);self.assertIn('TaskFlowDriveCallbackPath',router);self.assertIn('RequireHumanActor).Post("/api/taskflow-drive/setup"',router);self.assertNotIn('attachment_object',router)
   self.assertIn('multipartMemory=1<<20',after);self.assertIn('RunTrashWorker(sweepCtx)',(root/'server/cmd/server/main.go').read_text())
   self.assertIn('WithTaskFlowDriveFolderLabel',after);self.assertIn('getIssuePrefix',after)
   issue=(root/'server/internal/handler/issue.go').read_text()
   self.assertEqual(issue.count('taskFlowDriveFileBoundAttachments'),1);self.assertIn('issue, attachmentIDs',issue)
   svc=(root/'server/internal/service/issue.go').read_text();self.assertIn('Filer func(ctx context.Context',svc);self.assertEqual(svc.count('s.Filer(ctx, issue, p.AttachmentIDs)'),1)
   hh=(root/'server/internal/handler/handler.go').read_text();self.assertIn('h.IssueService.Filer = h.taskFlowDriveFileBoundAttachments',hh)
   self.assertIn('taskFlowDriveFileAttachment(context.WithoutCancel',after)
   self.assertTrue((root/'server/internal/storage/taskflow_drive_subfolder.go').exists())
   self.assertTrue((root/'server/internal/storage/taskflow_drive_move.go').exists());self.assertTrue((root/'server/internal/handler/taskflow_drive_move_handler.go').exists())
   # All native membership/delete authorization is preserved.
   self.assertEqual(before[before.index('func (h *Handler) DeleteAttachment'):],after[after.index('func (h *Handler) DeleteAttachment'):])
   with self.assertRaises(SystemExit):module.apply(root,SCRIPT.parent/'drive-attachments')
 def test_missing_anchor_no_partial_write(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);self.fixture(root);main=root/'server/cmd/server/main.go';main.write_text('bad anchor');router=root/'server/cmd/server/router.go';before=router.read_bytes()
   with self.assertRaises(SystemExit):module.apply(root,SCRIPT.parent/'drive-attachments')
   self.assertEqual(before,router.read_bytes());self.assertFalse((root/'server/internal/storage/taskflow_drive.go').exists())
 def test_vendor_is_readonly(self):
  with self.assertRaises(SystemExit):module.apply(REPO/'third_party/multica',SCRIPT.parent/'drive-attachments')
