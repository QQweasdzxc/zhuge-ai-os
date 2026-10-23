import hashlib
import importlib.util
import tempfile
import shutil
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VENDOR = ROOT / "third_party/multica"
SPEC = importlib.util.spec_from_file_location("dispatch_center", ROOT / "labs/taskflow/patches/apply-taskflow-dispatch-center.py")
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)

class DispatchCenterOverlayTests(unittest.TestCase):
    def test_native_route_sidebar_and_auth_only_modify_build_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = ["packages/core/paths/paths.ts", "packages/core/api/client.ts", "packages/views/layout/app-sidebar.tsx", "packages/views/package.json"]
            hashes = {name: hashlib.sha256((VENDOR / name).read_bytes()).hexdigest() for name in files}
            for name in files:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(VENDOR / name, target)
            common = root / "packages/views/common"
            common.mkdir(exist_ok=True)
            shutil.copyfile(ROOT / "labs/taskflow/overrides/taskflow-ai-engineering.tsx", common / "taskflow-ai-engineering.tsx")
            PATCH.apply(root, ROOT / "labs/taskflow/overrides", ROOT / "labs/taskflow/pages-client/dispatch-workbench.mjs")
            self.assertTrue((root / "apps/web/app/[workspaceSlug]/(dashboard)/ai-dispatch/page.tsx").is_file())
            self.assertIn("p.aiDispatch()", (root / files[2]).read_text())
            self.assertIn("this.fetch<unknown>", (root / files[1]).read_text())
            self.assertIn("getZhugeAIProjectMappings", (root / files[1]).read_text())
            self.assertIn("listZhugeAITasks", (root / files[1]).read_text())
            for name in files:
                self.assertEqual(hashes[name], hashlib.sha256((VENDOR / name).read_bytes()).hexdigest())
            self.assertFalse((root / "packages/views/dashboard").exists())
            with self.assertRaises(ValueError):
                PATCH.apply(root, ROOT / "labs/taskflow/overrides", ROOT / "labs/taskflow/pages-client/dispatch-workbench.mjs")

    def test_missing_upstream_marker_fails_closed(self):
        with self.assertRaises(ValueError):
            PATCH.replace("changed", "expected", "replacement")
