import importlib.util
import pathlib
import tempfile
import shutil
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[3]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class IconOverlay(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
  shutil.copytree(ROOT/'third_party/multica/server',self.root/'server')
  for f in ['packages/core/api/client.ts','packages/views/settings/components/workspace-tab.tsx']:
   target=self.root/f;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy(ROOT/'third_party/multica'/f,target)
 def tearDown(self):self.tmp.cleanup()
 def test_backend_route_and_no_read_side_effects(self):
  m=module('drive',ROOT/'labs/taskflow/patches/apply-taskflow-drive-attachments.py');m.apply(self.root,ROOT/'labs/taskflow/patches/drive-attachments')
  router=(self.root/'server/cmd/server/router.go').read_text()
  self.assertIn('r.With(handler.RequireHumanActor).Post("/organize-icon",h.OrganizeTaskFlowWorkspaceIcon)',router)
  self.assertIn('r.Use(middleware.RequireWorkspaceRoleFromURL(queries, "id", "owner", "admin"))',router)
  avatar=(self.root/'server/internal/handler/avatar.go').read_text();self.assertNotIn('FileWorkspaceIcon',avatar)
  action=(self.root/'server/internal/handler/taskflow_drive_workspace_icon_handler.go').read_text()
  self.assertIn('member.Role != "owner" && member.Role != "admin"',action)
  self.assertIn('drive.GetReader',action);self.assertNotIn('Delete(',action)
 def test_web_explicit_action_and_safe_failure(self):
  m=module('web',ROOT/'labs/taskflow/patches/apply-taskflow-workspace-icon-web.py');m.apply(self.root)
  s=(self.root/'packages/views/settings/components/workspace-tab.tsx').read_text()
  for text in ['整理工作區圖示','disabled={iconFiling}','onClick={organizeIcon}','role="status"','result.status !== "filed"']:
   self.assertIn(text,s)
  api=(self.root/'packages/core/api/client.ts').read_text();self.assertIn('/organize-icon`, { method: "POST" }',api)
  with self.assertRaises(SystemExit):m.apply(self.root)
 def test_missing_anchor_fails_closed(self):
  p=self.root/'packages/core/api/client.ts';p.write_text('bad upstream')
  m=module('webbad',ROOT/'labs/taskflow/patches/apply-taskflow-workspace-icon-web.py')
  with self.assertRaises(SystemExit):m.apply(self.root)
if __name__=='__main__':unittest.main()
