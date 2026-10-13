from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path


REPO = Path(os.environ.get("TASKFLOW_PROJECT_STATUS_REPO_ROOT", Path(__file__).resolve().parents[3])).resolve()
VENDOR = Path(os.environ.get("TASKFLOW_PROJECT_STATUS_VENDOR_ROOT", REPO / "third_party/multica")).resolve()
PATCH_PATH = Path(os.environ.get("TASKFLOW_PROJECT_STATUS_PATCH", REPO / "labs/taskflow/patches/apply-taskflow-project-status.py")).resolve()
OVERLAY = Path(os.environ.get("TASKFLOW_PROJECT_STATUS_OVERLAY_ROOT", REPO / "labs/taskflow/overrides")).resolve()
SPEC = importlib.util.spec_from_file_location("taskflow_project_status", PATCH_PATH)
assert SPEC and SPEC.loader
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)

PATCHED_PATHS = [
    "packages/core/issue-statuses/hooks.ts",
    "packages/views/issues/surface/issue-surface.tsx",
    "packages/views/issues/surface/use-issue-surface-controller.ts",
    "packages/views/issues/components/issues-header.tsx",
    "packages/views/issues/components/hidden-columns-panel.tsx",
    "packages/views/issues/components/board-column.tsx",
    "packages/views/issues/components/swimlane-view.tsx",
    "packages/core/issue-views/preferences.ts",
    "packages/core/package.json",
    *[f"packages/views/locales/{locale}/issues.json" for locale in ("en", "zh-Hant", "zh-Hans", "ja", "fr")],
]


class TaskFlowProjectStatusOverlayTests(unittest.TestCase):
    def test_overlay_applies_to_build_copy_and_leaves_frozen_vendor_unchanged(self) -> None:
        before = {
            path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest()
            for path in PATCHED_PATHS
            if (VENDOR / path).is_file()
        }
        with tempfile.TemporaryDirectory(prefix="taskflow-project-status-") as temporary:
            root = Path(temporary) / "source"
            for relative in PATCHED_PATHS:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                source = VENDOR / relative
                if relative == "packages/views/locales/zh-Hant/issues.json" and not source.is_file():
                    source = OVERLAY / "locales/zh-Hant/issues.json"
                shutil.copy2(source, target)

            PATCH.apply(root, OVERLAY)

            self.assertIn("TASKFLOW_PROJECT_STATUS_SCOPE", (root / PATCHED_PATHS[0]).read_text())
            self.assertIn("TaskFlowProjectStatusScopeProvider", (root / PATCHED_PATHS[1]).read_text())
            self.assertIn("TASKFLOW_PROJECT_STATUS_VISIBILITY", (root / PATCHED_PATHS[2]).read_text())
            self.assertIn("TaskFlowProjectStatusSettings", (root / PATCHED_PATHS[3]).read_text())
            self.assertIn("TASKFLOW_PRESERVE_PROJECT_STATUS_PREFS", (root / PATCHED_PATHS[7]).read_text())
            core_package = json.loads((root / "packages/core/package.json").read_text())
            self.assertEqual(
                core_package["exports"]["./issue-statuses/taskflow-project-status-scope"],
                "./issue-statuses/taskflow-project-status-scope.tsx",
            )

            for locale in ("en", "zh-Hant", "zh-Hans", "ja", "fr"):
                document = json.loads((root / f"packages/views/locales/{locale}/issues.json").read_text())
                translated = document["taskflow_project_status"]
                expected = json.loads((OVERLAY / "taskflow-project-status-locales.json").read_text())[locale]
                self.assertEqual(set(translated), set(expected))
                self.assertEqual(translated["visibility"], expected["visibility"])
                self.assertEqual(set(translated["categories"]), {"unstarted", "started", "done", "closed"})

        after = {
            path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest()
            for path in before
        }
        self.assertEqual(before, after)

    def test_overlay_fails_closed_when_expected_source_markers_change(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected one upstream marker"):
            PATCH.patch_status_hook("export function useIssueStatuses() { return null; }")
        with self.assertRaisesRegex(ValueError, "already applied"):
            PATCH.patch_status_hook("// TASKFLOW_PROJECT_STATUS_SCOPE")


if __name__ == "__main__":
    unittest.main()
