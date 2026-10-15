"""TaskFlow AI engineering v1 frozen-source / fail-closed overlay checks."""
from __future__ import annotations
import hashlib
import importlib.util
import os
import shutil
import tempfile
import unittest
from pathlib import Path

REPO = (Path(os.environ["TASKFLOW_AI_REPO"]) if "TASKFLOW_AI_REPO" in os.environ else Path(__file__).resolve().parents[3]).resolve()
VENDOR = Path(os.environ.get("TASKFLOW_AI_VENDOR", REPO / "third_party/multica")).resolve()
OVERLAYS = Path(os.environ.get("TASKFLOW_AI_OVERLAYS", REPO / "labs/taskflow/overrides")).resolve()
PATCH_PATH = Path(os.environ.get("TASKFLOW_AI_PATCH", REPO / "labs/taskflow/patches/apply-taskflow-ai-engineering.py")).resolve()
SPEC = importlib.util.spec_from_file_location("tf_ai_overlay", PATCH_PATH)
assert SPEC and SPEC.loader
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)

class TaskFlowAIEngineeringOverlayTests(unittest.TestCase):
    def test_copy_only_no_vendor_mutation_and_native_sections_preserved(self):
        upstream = [PATCH.ISSUE, PATCH.PROJECT]
        hashes = {path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest() for path in upstream}
        with tempfile.TemporaryDirectory(prefix="tf-ai-v1-") as td:
            root = Path(td)
            for path in upstream:
                to = root / path
                to.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(VENDOR / path, to)
            PATCH.apply(root, OVERLAYS)
            issue = (root / PATCH.ISSUE).read_text()
            project = (root / PATCH.PROJECT).read_text()
            self.assertIn("TASKFLOW_AI_EXECUTION_V1", issue)
            self.assertIn("<WakeupsSection", issue)
            self.assertIn("<PullRequestsSection", issue)
            self.assertIn("<PluginPanelSection", issue)
            self.assertIn("TaskFlowAIIssueSection workspaceId={wsId}", issue)
            self.assertLess(issue.index("TaskFlowAIIssueSection workspaceId="),issue.index("<PullRequestsSection"))
            self.assertIn("TASKFLOW_AI_PROJECT_V1", project)
            self.assertIn("TaskFlowAIProjectSettings workspaceId={wsId}", project)
            self.assertIn("{/* Properties */}", project)
            for name in PATCH.MODULES:
                target = root / PATCH.COMMON / name
                self.assertEqual(target.read_text(), (OVERLAYS / name).read_text())
            with self.assertRaisesRegex(ValueError,"already patched"):
                PATCH.patch_issue(issue)
            with self.assertRaisesRegex(ValueError,"already patched"):
                PATCH.patch_project(project)
        for path in upstream:
            self.assertEqual(hashes[path], hashlib.sha256((VENDOR / path).read_bytes()).hexdigest())

    def test_upstream_marker_changed_or_ambiguous_fail_closed(self):
        with self.assertRaisesRegex(ValueError,"exact upstream marker"):
            PATCH.patch_issue('import { PluginPanelSection } from "../../plugins";')
        with self.assertRaisesRegex(ValueError,"exact upstream marker"):
            PATCH.patch_project("export function ProjectDetail() {}")
        native = (VENDOR / PATCH.ISSUE).read_text()
        with self.assertRaisesRegex(ValueError,"exact upstream marker"):
            PATCH.patch_issue(native.replace("      <PluginPanelSection issueId={issue.id} />",""))
        with self.assertRaisesRegex(ValueError,"exact upstream marker"):
            PATCH.patch_issue(native.replace(
                "      <PluginPanelSection issueId={issue.id} />",
                "      <PluginPanelSection issueId={issue.id} />\n      <PluginPanelSection issueId={issue.id} />"))

    def test_preview_never_exposes_provider_or_persistence(self):
        ui = (OVERLAYS / "taskflow-ai-engineering.tsx").read_text()
        store = (OVERLAYS / "taskflow-ai-preview-store.ts").read_text()
        policy = (OVERLAYS / "taskflow-ai-engineering-policy.ts").read_text()
        self.assertIn("disabled aria-disabled=\"true\"", ui)
        self.assertNotIn("if (!projectId || !project.enabled) return null;", ui)
        self.assertIn("useState(true)", ui)
        self.assertIn("此區位於正式 TaskFlow 任務側欄", ui)
        self.assertIn('providerQuota: "unknown"', ui)
        self.assertIn("useSyncExternalStore", store)
        self.assertNotIn("localStorage",store)
        self.assertNotIn("fetch(",ui)
        self.assertNotIn("fetch(",store)
        self.assertNotIn("RUNNING",policy.split("return block(")[-1])
        self.assertIn('export const DEFAULT_ENGINEER: Engineer = "co"',policy)

if __name__ == "__main__":
    unittest.main()
