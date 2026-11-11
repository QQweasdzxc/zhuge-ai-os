#!/usr/bin/env python3
import importlib.util,json,shutil,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
worklog=module('worklog',ROOT/'labs/taskflow/patches/apply-taskflow-worklog.py')
office=module('office',ROOT/'labs/taskflow/patches/apply-taskflow-office-entry.py')
class WorklogOverlayTest(unittest.TestCase):
 def test_mount_is_native_below_office_idempotent_and_has_real_export_assets(self):
  with tempfile.TemporaryDirectory() as temporary:
   target=Path(temporary)
   for name in ['packages/views/layout/app-sidebar.tsx','packages/views/layout/app-sidebar.test.tsx','packages/views/package.json','apps/web/config/runtime-urls.ts']:
    dst=target/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/'third_party/multica'/name,dst)
   office.apply(target)
   for _ in range(2):worklog.apply(target,ROOT/'modules/worklog/native',ROOT/'modules/worklog/resources')
   sidebar=(target/'packages/views/layout/app-sidebar.tsx').read_text()
   self.assertEqual(sidebar.count('TASKFLOW_WORKLOG_ENTRY_V1'),1)
   self.assertLess(sidebar.index('TASKFLOW_OFFICE_ENTRY_V1'),sidebar.index('TASKFLOW_WORKLOG_ENTRY_V1'))
   self.assertIn('<AppLink href={`/${workspace.slug}/worklog`}',sidebar)
   self.assertIn('TaskFlowWorklogPage',(target/'apps/web/app/[workspaceSlug]/(dashboard)/worklog/page.tsx').read_text())
   self.assertTrue((target/'apps/web/app/auth/worklog/page.tsx').exists())
   self.assertEqual((target/'packages/views/common/taskflow-worklog/worklog-sync-conflicts.tsx').read_bytes(),(ROOT/'modules/worklog/native/worklog-sync-conflicts.tsx').read_bytes())
   self.assertEqual((target/'apps/web/public/worklog-assets/templates/ecp-export-template.xlsx').read_bytes(),(ROOT/'modules/worklog/resources/templates/ecp-export-template.xlsx').read_bytes())
   self.assertIn('./common/taskflow-worklog',json.loads((target/'packages/views/package.json').read_text())['exports'])
 def test_actual_runtime_proxy_keeps_only_exact_frontend_worklog_routes(self):
  import subprocess
  with tempfile.TemporaryDirectory() as temporary:
   target=Path(temporary)
   for name in ['packages/views/layout/app-sidebar.tsx','packages/views/layout/app-sidebar.test.tsx','packages/views/package.json','apps/web/config/runtime-urls.ts']:
    dst=target/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/'third_party/multica'/name,dst)
   office.apply(target);worklog.apply(target,ROOT/'modules/worklog/native',ROOT/'modules/worklog/resources')
   source=target/'apps/web/config/runtime-urls.ts'
   # Node22's native type stripping executes the actual patched resolver.
   script='import {runtimeRewriteDestination as r} from '+json.dumps(source.as_uri())+'; const e={REMOTE_API_URL:"https://api.example"}; for(const p of ["/auth/worklog","/api/worklog/suspensions"]) if(r(p,e)!==undefined) throw Error(p); for(const p of ["/auth/zhuge","/auth/google","/api/issues","/api/worklog/other","/auth/worklog/other"]) if(r(p,e)!=="https://api.example"+p) throw Error(p);'
   subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',script],check=True,capture_output=True)
 def test_frozen_vendor_rejected(self):
  with self.assertRaises(ValueError):worklog.apply(ROOT/'third_party/multica',ROOT/'modules/worklog/native',ROOT/'modules/worklog/resources')
if __name__=='__main__':unittest.main()
