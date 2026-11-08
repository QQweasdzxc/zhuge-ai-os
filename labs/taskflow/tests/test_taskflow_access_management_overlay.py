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
            overlay.apply(root, ROOT / "labs/taskflow/overrides")
            result = target.read_text()
            self.assertLess(result.index('entry("app-access"'), result.index('entry("workspace"'))
            self.assertIn("accessManagement.visible", result)
            self.assertIn("accessActive ? null : active.content", result)
            with self.assertRaises(ValueError):
                overlay.apply(root, ROOT / "labs/taskflow/overrides")
        with self.assertRaises(ValueError):
            overlay.patch(original.replace('  const pluginsEnabled =', '  const changed ='))
        self.assertEqual((ROOT / "third_party/multica" / overlay.TARGET).read_text(), original)

    def test_refuses_vendor(self):
        with self.assertRaises(ValueError):
            overlay.apply(ROOT / "third_party/multica", ROOT / "labs/taskflow/overrides")

if __name__ == "__main__":
    unittest.main()
