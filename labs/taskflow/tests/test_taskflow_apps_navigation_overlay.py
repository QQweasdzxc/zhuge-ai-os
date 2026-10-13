from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path


REPO = Path(os.environ["TASKFLOW_APPS_REPO"]).resolve() if os.environ.get("TASKFLOW_APPS_REPO") else Path(__file__).resolve().parents[3].resolve()
VENDOR = Path(os.environ.get("TASKFLOW_APPS_VENDOR", REPO / "third_party/multica")).resolve()
PATCH_PATH = Path(os.environ.get(
    "TASKFLOW_APPS_PATCH",
    REPO / "labs/taskflow/patches/apply-taskflow-apps-navigation.py",
)).resolve()
OVERLAY = Path(os.environ.get(
    "TASKFLOW_APPS_HANT_LAYOUT",
    REPO / "labs/taskflow/overrides/locales/zh-Hant/layout.json",
)).resolve()
PATCHED = [
    "packages/views/layout/app-sidebar.tsx",
    "packages/views/layout/app-sidebar.test.tsx",
    *[f"packages/views/locales/{locale}/layout.json" for locale in ("en", "zh-Hans", "ja", "fr")],
]
SPEC = importlib.util.spec_from_file_location("taskflow_apps_navigation", PATCH_PATH)
assert SPEC and SPEC.loader
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)


class TaskFlowAppsNavigationOverlayTests(unittest.TestCase):
    def test_apps_links_are_added_to_build_copy_with_truthful_module_states(self) -> None:
        before = {path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest() for path in PATCHED}
        with tempfile.TemporaryDirectory(prefix="taskflow-apps-navigation-") as temporary:
            root = Path(temporary)
            for path in PATCHED:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(VENDOR / path, target)
            zh_hant = root / "packages/views/locales/zh-Hant/layout.json"
            zh_hant.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(OVERLAY, zh_hant)

            PATCH.apply(root)

            sidebar = (root / PATCH.SIDEBAR).read_text()
            self.assertIn("TASKFLOW_AIOS_ORIGIN", sidebar)
            self.assertIn("/modules/worklog/?app=1&workspace=worklog", sidebar)
            self.assertIn("/app/dashboard/", sidebar)
            self.assertIn("/labs/investment/", sidebar)
            self.assertIn('state: "experimental"', sidebar)
            self.assertIn('state: "parked"', sidebar)
            self.assertIn('target="_blank" rel="noopener noreferrer"', sidebar)
            self.assertIn("TaskFlow Apps navigation", (root / PATCH.SIDEBAR_TEST).read_text())
            for locale in PATCH.APPS:
                document = json.loads((root / f"packages/views/locales/{locale}/layout.json").read_text())
                self.assertEqual(document["sidebar"]["apps_group"], PATCH.APPS[locale]["group"])
                self.assertEqual(set(document["sidebar"]["app_names"]), set(PATCH.APPS[locale]["names"]))
                self.assertEqual(set(document["sidebar"]["app_states"]), set(PATCH.APPS[locale]["states"]))
        after = {path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest() for path in before}
        self.assertEqual(before, after)

    def test_patch_fails_closed_on_source_drift_and_duplicate_application(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected one upstream marker"):
            PATCH.patch_sidebar("export function AppSidebar() {}")
        with self.assertRaisesRegex(ValueError, "already applied"):
            PATCH.patch_sidebar("// TASKFLOW_APP_LINKS")


if __name__ == "__main__":
    unittest.main()
