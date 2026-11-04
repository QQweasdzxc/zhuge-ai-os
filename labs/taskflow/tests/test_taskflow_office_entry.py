"""Fail-closed installation and frozen vendor regression contracts."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[3]
VENDOR = REPO / "third_party/multica"
SPEC = importlib.util.spec_from_file_location("office_entry", REPO / "labs/taskflow/patches/apply-taskflow-office-entry.py")
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)

STAGED = (PATCH.SIDEBAR, PATCH.SIDEBAR_TEST)


class OfficeEntryOverlayTests(unittest.TestCase):
    def _stage(self, root):
        for rel in STAGED:
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text((VENDOR / rel).read_text())

    def test_installs_native_entry_and_preserves_vendor(self):
        before = {rel: hashlib.sha256((VENDOR / rel).read_bytes()).hexdigest() for rel in STAGED}
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._stage(root)
            PATCH.apply(root)
            result = (root / PATCH.SIDEBAR).read_text()
            self.assertEqual(result.count("TASKFLOW_OFFICE_ENTRY_V1"), 1)
            self.assertIn('const TASKFLOW_OFFICE_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/";', result)
            self.assertIn("render={<a href={TASKFLOW_OFFICE_URL} />}", result)
            self.assertIn("辦公室", result)
            # The entry must be a plain same-tab link, never a new tab or overlay.
            entry = result.split("TASKFLOW_OFFICE_ENTRY_V1", 1)[1]
            self.assertNotIn('target=', entry.split("</SidebarMenuItem>", 1)[0])
            self.assertIn("TaskFlow office entry", (root / PATCH.SIDEBAR_TEST).read_text())
            # Only the two sidebar files are written.
            written = sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())
            self.assertEqual(written, sorted(STAGED))
            with self.assertRaisesRegex(ValueError, "already patched"):
                PATCH.apply(root)
        for rel, digest in before.items():
            self.assertEqual(hashlib.sha256((VENDOR / rel).read_bytes()).hexdigest(), digest)

    def test_missing_and_duplicate_markers_fail_closed(self):
        native = (VENDOR / PATCH.SIDEBAR).read_text()
        for marker in (PATCH.ICON_IMPORT, PATCH.URL_ANCHOR, PATCH.CHAT_ITEM_TAIL):
            for replacement in ("", marker + "\n" + marker):
                with self.subTest(marker=marker[:40], replacement=replacement[:40]):
                    with self.assertRaisesRegex(ValueError, "exact upstream marker"):
                        PATCH.patch_sidebar(native.replace(marker, replacement))

    def test_frozen_root_rejected(self):
        with self.assertRaisesRegex(ValueError, "frozen"):
            PATCH.apply(VENDOR)

    def test_sidebar_test_marker_required(self):
        native = (VENDOR / PATCH.SIDEBAR_TEST).read_text()
        with self.assertRaisesRegex(ValueError, "exact upstream marker"):
            PATCH.patch_sidebar_test(native.replace(PATCH.TEST_MARKER, ""))

    def test_no_overlay_remnants(self):
        # The floating overlay module and its dashboard-layout mount are gone.
        overlays = REPO / "labs/taskflow/overrides"
        self.assertFalse((overlays / "taskflow-office-panel.tsx").exists())
        self.assertFalse((overlays / "taskflow-office-panel.test.tsx").exists())
        layout = (VENDOR / "packages/views/layout/dashboard-layout.tsx").read_text()
        self.assertNotIn("TASKFLOW_OFFICE_PANEL", layout)
        self.assertNotIn("TaskFlowOfficePanel", layout)


if __name__ == "__main__":
    unittest.main()
