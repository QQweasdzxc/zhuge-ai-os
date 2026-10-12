from __future__ import annotations

import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path


_TEST_PATH = Path(__file__).resolve()
REPO = _TEST_PATH.parents[3] if len(_TEST_PATH.parents) > 3 else Path.cwd()
SOURCE_ROOT = Path(__import__("os").environ.get("TASKFLOW_PROJECT_NAV_SOURCE", REPO / "third_party/multica")).resolve()
PATCH_PATH = Path(__import__("os").environ.get(
    "TASKFLOW_PROJECT_NAV_PATCH",
    REPO / "labs/taskflow/patches/apply-taskflow-project-navigation.py",
)).resolve()
SPEC = importlib.util.spec_from_file_location("taskflow_project_navigation", PATCH_PATH)
assert SPEC and SPEC.loader
OVERLAY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OVERLAY)

SIDEBAR = Path("packages/views/layout/app-sidebar.tsx")
SIDEBAR_TESTS = Path("packages/views/layout/app-sidebar.test.tsx")


class TaskFlowProjectNavigationOverlayTests(unittest.TestCase):
    def test_workspace_project_menu_overlay_applies_without_mutating_frozen_source(self) -> None:
        source_path = SOURCE_ROOT / SIDEBAR
        source_tests_path = SOURCE_ROOT / SIDEBAR_TESTS
        original = source_path.read_text()
        original_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
        original_tests = source_tests_path.read_text()
        original_tests_hash = hashlib.sha256(source_tests_path.read_bytes()).hexdigest()

        with tempfile.TemporaryDirectory(prefix="taskflow-project-nav-") as temporary:
            target_root = Path(temporary) / "source"
            target_sidebar = target_root / SIDEBAR
            target_sidebar_tests = target_root / SIDEBAR_TESTS
            target_sidebar.parent.mkdir(parents=True)
            target_sidebar.write_text(original)
            target_sidebar_tests.write_text(original_tests)

            OVERLAY.apply(target_root)
            patched = target_sidebar.read_text()
            patched_tests = target_sidebar_tests.read_text()

        self.assertEqual(hashlib.sha256(source_path.read_bytes()).hexdigest(), original_hash)
        self.assertEqual(hashlib.sha256(source_tests_path.read_bytes()).hexdigest(), original_tests_hash)
        self.assertIn('import { useIsMobile } from "@multica/ui/hooks/use-mobile";', patched)
        self.assertIn("projectListOptions(wsId ?? \"\")", patched)
        self.assertIn("enabled: Boolean(wsId)", patched)
        self.assertIn("const projectsExpanded = projectsExpandedOverride ?? !isMobile;", patched)
        self.assertIn("onOpenChange={(open) => setProjectsExpandedOverride(open)}", patched)
        self.assertIn("render={<AppLink href={href} />}", patched)
        self.assertIn("render={<AppLink href={projectHref} />}", patched)
        self.assertIn("isNavActive(pathname, projectHref)", patched)
        self.assertIn("max-h-56 gap-0.5 overflow-y-auto", patched)
        self.assertIn("ChevronRight", patched)
        self.assertIn("TASKFLOW_PROJECT_NAV_OVERLAY", patched)
        self.assertNotIn("Project A", patched)
        self.assertNotIn("QA | Project B", patched)
        self.assertIn('data-testid="project-navigation-toggle"', patched)
        self.assertIn("TASKFLOW_PROJECT_NAV_TESTS", patched_tests)
        self.assertIn("updates rows when the current workspace changes", patched_tests)
        self.assertIn("defaults collapsed on mobile", patched_tests)

    def test_work_navigation_order_and_existing_entries_are_preserved(self) -> None:
        original = (SOURCE_ROOT / SIDEBAR).read_text()
        patched = OVERLAY.patch_sidebar(original)
        project_index = patched.index('{ key: "projects", labelKey: "projects" }', patched.index("const workNav"))
        tasks_index = patched.index('{ key: "issues", labelKey: "issues" }', patched.index("const workNav"))
        automation_index = patched.index('{ key: "autopilots", labelKey: "autopilots" }', patched.index("const workNav"))
        self.assertLess(project_index, tasks_index)
        self.assertLess(tasks_index, automation_index)
        self.assertIn("p.projectDetail(project.id)", patched)
        self.assertIn("ProjectIcon project={project} size=\"sm\"", patched)
        self.assertIn("<CollapsibleTrigger", patched)
        self.assertIn("<CollapsibleContent>", patched)

    def test_overlay_is_fail_closed_and_not_reapplicable(self) -> None:
        original = (SOURCE_ROOT / SIDEBAR).read_text()
        patched = OVERLAY.patch_sidebar(original)
        with self.assertRaisesRegex(ValueError, "already applied"):
            OVERLAY.patch_sidebar(patched)
        with self.assertRaisesRegex(ValueError, "expected one upstream marker, found 0"):
            OVERLAY.patch_sidebar("// unrelated sidebar source\n")
        with self.assertRaisesRegex(ValueError, "expected one upstream marker, found 2"):
            OVERLAY.replace_once("marker marker", "marker", "replacement", "ambiguous test")


if __name__ == "__main__":
    unittest.main()
