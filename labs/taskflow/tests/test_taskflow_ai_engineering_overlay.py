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
        upstream = [PATCH.ISSUE, PATCH.PROJECT, PATCH.API_INDEX]
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
            api = (root / PATCH.API_INDEX).read_text()
            self.assertIn("TASKFLOW_AI_EXECUTION_V1", issue)
            self.assertIn("<WakeupsSection", issue)
            self.assertIn("<PullRequestsSection", issue)
            self.assertIn("<PluginPanelSection", issue)
            self.assertIn("TaskFlowAIIssueSection workspaceId={wsId}", issue)
            self.assertIn('canApprove={currentUserRole === "owner"}', issue)
            self.assertIn("issueRevision={issue.revision ?? 0}", issue)
            self.assertLess(issue.index("TaskFlowAIIssueSection workspaceId="),issue.index("<PullRequestsSection"))
            self.assertIn("TASKFLOW_AI_PROJECT_V1", project)
            self.assertIn("TaskFlowAIProjectSettings workspaceId={wsId}", project)
            self.assertIn("{/* Properties */}", project)
            self.assertIn('TaskFlowAIEngineeringRunListSchema } from "./taskflow-ai-run-schema"', api)
            for name in PATCH.MODULES:
                target = root / PATCH.COMMON / name
                self.assertEqual(target.read_text(), (OVERLAYS / name).read_text())
            for name in PATCH.API_MODULES:
                target = root / "packages/core/api" / name
                self.assertEqual(target.read_text(), (OVERLAYS / name).read_text())
            with self.assertRaisesRegex(ValueError,"already patched"):
                PATCH.patch_issue(issue)
            with self.assertRaisesRegex(ValueError,"already patched"):
                PATCH.patch_project(project)
            with self.assertRaisesRegex(ValueError,"already patched"):
                PATCH.patch_api_index(api)
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

    def test_settings_are_taskflow_persisted_and_dispatch_stays_closed(self):
        ui = (OVERLAYS / "taskflow-ai-engineering.tsx").read_text()
        store = (OVERLAYS / "taskflow-ai-settings-store.ts").read_text()
        policy = (OVERLAYS / "taskflow-ai-engineering-policy.ts").read_text()
        self.assertIn("<TaskFlowAIRunReadback workspaceId={workspaceId}", ui)
        self.assertIn("enabledForDispatch={canApprove && project.enabled && card.enabled && card.engineer === \"co\"}", ui)
        self.assertNotIn("if (!projectId || !project.enabled) return null;", ui)
        self.assertIn("useState(true)", ui)
        self.assertIn("派工只會透過已連結的公開 GitHub PR 要求 Codex", ui)
        self.assertIn('providerQuota: "unknown"', ui)
        self.assertIn('requestSetting(kind, workspaceId, objectId, "GET", undefined, controller.signal)', store)
        self.assertIn('requestSetting(kind, workspaceId, objectId, "PUT", next)', store)
        self.assertIn('/zhuge-ai/settings', store)
        self.assertNotIn("localStorage",store)
        self.assertNotIn("fetch(",ui)
        self.assertIn('Authorization: "Bearer " + token',store)
        self.assertIn("已保留最後一次讀回的設定",store)
        self.assertIn("activeKey.current !== requestKey",store)
        self.assertIn("signal?: AbortSignal",store)
        self.assertIn("signal,",store)
        self.assertNotIn("RUNNING",policy.split("return block(")[-1])
        self.assertIn('export const DEFAULT_ENGINEER: Engineer = "co"',policy)
        readback = (OVERLAYS / "taskflow-ai-run-readback.tsx").read_text()
        self.assertIn('github_pr_updated: "GitHub PR 更新已保存"', readback)
        self.assertIn('github_pr_merged: "GitHub PR 合併已保存"', readback)
        self.assertIn('核准或 GitHub 註解不代表 Codex 已執行', readback)
        self.assertIn('method: "POST"', readback)
        self.assertIn('/zhuge-ai/approve', readback)
        self.assertIn('target.searchParams.set("workspace_id", workspaceId)', readback)
        self.assertIn('expected_issue_revision: issueRevision', readback)
        self.assertIn('requestKey.current ??= newIdempotencyKey()', readback)
        self.assertIn('confirm_public_github_dispatch: dispatch', readback)
        self.assertIn('window.confirm(', readback)
        self.assertIn('dispatch_request_posted', readback)
        self.assertIn('provider_thread_id', readback)
        self.assertIn('result_summary', readback)
        self.assertIn('/zhuge-ai/accept', readback)
        self.assertIn("Codex 派工待啟用", readback)
        self.assertIn("github_checks_state", readback)
        self.assertIn("item.github_head_sha === item.github_snapshot_head_sha", readback)
        schema = (OVERLAYS / "taskflow-ai-run-schema.ts").read_text()
        self.assertIn('dispatch_enabled: z.boolean()', schema)
        self.assertIn('github_dispatch_url: z.string().url().nullable()', schema)
        self.assertIn('result_summary: z.string().max(4000).nullable()', schema)

if __name__ == "__main__":
    unittest.main()
