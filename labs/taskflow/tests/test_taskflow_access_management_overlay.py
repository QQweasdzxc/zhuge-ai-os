import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("access_overlay", ROOT / "labs/taskflow/patches/apply-taskflow-access-management.py")
overlay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(overlay)

class AccessOverlayTest(unittest.TestCase):
    def test_installs_on_copy_and_fails_closed_on_marker_drift(self):
        original = (ROOT / "third_party/multica" / overlay.TARGET).read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / overlay.TARGET
            target.parent.mkdir(parents=True)
            target.write_text(original)
            (target.parent / "settings-page.test.tsx").write_text((ROOT / "third_party/multica/packages/views/settings/components/settings-page.test.tsx").read_text())
            overlay.apply(root, ROOT / "labs/taskflow/overrides")
            result = target.read_text()
            self.assertLess(result.index('entry("app-access"'), result.index('entry("workspace"'))
            self.assertNotIn("accessManagement.visible", result)
            self.assertNotIn("useTaskFlowAccessManagement", result)
            self.assertIn("<TaskFlowAccessManagement />, { adminOnly: true }", result)
            self.assertIn('role === "owner" || role === "admin"', result)
            with self.assertRaises(ValueError):
                overlay.apply(root, ROOT / "labs/taskflow/overrides")
        with self.assertRaises(ValueError):
            overlay.patch(original.replace('            entry("workspace",', '            entry("changed",'))
        self.assertEqual((ROOT / "third_party/multica" / overlay.TARGET).read_text(), original)

    def test_refuses_vendor(self):
        with self.assertRaises(ValueError):
            overlay.apply(ROOT / "third_party/multica", ROOT / "labs/taskflow/overrides")

if __name__ == "__main__":
    unittest.main()
