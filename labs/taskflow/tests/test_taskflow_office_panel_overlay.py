"""Fail-closed installation and frozen vendor regression contracts."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[3]
VENDOR = REPO / "third_party/multica"
OVERLAYS = REPO / "labs/taskflow/overrides"
SPEC = importlib.util.spec_from_file_location("office", REPO / "labs/taskflow/patches/apply-taskflow-office-panel.py")
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)


class OfficePanelOverlayTests(unittest.TestCase):
    def test_copy_only_and_preserves_shell(self):
        source = VENDOR / PATCH.LAYOUT
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            target = root / PATCH.LAYOUT
            target.parent.mkdir(parents=True)
            target.write_text(source.read_text())
            PATCH.apply(root, OVERLAYS)
            result = target.read_text()
            self.assertEqual(result.count("TASKFLOW_OFFICE_PANEL_V1"), 1)
            for marker in ("<GlobalShortcuts />", "<NavigationProgress />", "{children}", "{extra}", "<ModalRegistry />", "<AppSidebar searchSlot={searchSlot} />"):
                self.assertIn(marker, result)
            for name in PATCH.MODULES:
                self.assertEqual((root / PATCH.COMMON / name).read_bytes(), (OVERLAYS / name).read_bytes())
            with self.assertRaisesRegex(ValueError, "already patched"):
                PATCH.apply(root, OVERLAYS)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)

    def test_missing_and_duplicate_markers_fail_closed(self):
        native = (VENDOR / PATCH.LAYOUT).read_text()
        for marker in ('import { GlobalShortcuts } from "./global-shortcuts";', '        <WorkspacePresencePrefetch />'):
            for replacement in ("", marker + "\n" + marker):
                with self.subTest(marker=marker, replacement=replacement):
                    with self.assertRaisesRegex(ValueError, "exact upstream marker"):
                        PATCH.patch_layout(native.replace(marker, replacement))

    def test_frozen_root_rejected(self):
        with self.assertRaisesRegex(ValueError, "frozen"):
            PATCH.apply(VENDOR, OVERLAYS)

    def test_destination_collision_does_not_partially_modify_layout(self):
        native = (VENDOR / PATCH.LAYOUT).read_text()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            target = root / PATCH.LAYOUT
            target.parent.mkdir(parents=True)
            target.write_text(native)
            destination = root / PATCH.COMMON / PATCH.MODULES[-1]
            destination.parent.mkdir(parents=True)
            destination.write_text("existing")
            with self.assertRaisesRegex(ValueError, "already installed"):
                PATCH.apply(root, OVERLAYS)
            self.assertEqual(target.read_text(), native)
            self.assertFalse((root / PATCH.COMMON / PATCH.MODULES[0]).exists())


if __name__ == "__main__":
    unittest.main()
