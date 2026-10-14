from __future__ import annotations

import hashlib
import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VENDOR = ROOT / "third_party/multica"
PATCH_PATH = ROOT / "labs/taskflow/patches/apply-taskflow-supabase-storage.py"
OVERLAYS = ROOT / "labs/taskflow/overrides"
SPEC = importlib.util.spec_from_file_location("taskflow_supabase_storage_patch", PATCH_PATH)
assert SPEC and SPEC.loader
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)

BACKEND_FILES = [
    "server/cmd/server/router.go",
    "server/internal/handler/file.go",
]
WEB_FILES = [
    "packages/core/api/client.ts",
    "packages/core/constants/upload.ts",
    "packages/core/hooks/use-file-upload.ts",
    "packages/core/hooks/use-file-upload.test.ts",
    "packages/views/editor/use-coordinated-uploads.ts",
    "packages/views/editor/use-editor-upload.test.tsx",
]


class TaskFlowSupabaseStorageOverlayTests(unittest.TestCase):
    def test_backend_overlay_selects_private_storage_and_gates_attachment_routes(self) -> None:
        before = {path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest() for path in BACKEND_FILES}
        with tempfile.TemporaryDirectory(prefix="taskflow-storage-backend-") as tmp:
            root = Path(tmp)
            for relative in BACKEND_FILES:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(VENDOR / relative, target)
            PATCH.apply_backend(root, OVERLAYS)
            router = (root / BACKEND_FILES[0]).read_text()
            handler = (root / BACKEND_FILES[1]).read_text()
            self.assertIn('case "supabase":', router)
            self.assertIn("TaskFlowSupabaseStorageFromEnv", router)
            self.assertIn("NewTaskFlowScopedStorage", router)
            self.assertIn('"X-Zhuge-Storage-Token"', router)
            self.assertEqual(router.count("RequireTaskFlowSupabaseStorageIdentity"), 5)
            self.assertIn("101 << 20", handler)
            self.assertIn("StatusRequestEntityTooLarge", handler)
            self.assertIn("writeTaskFlowStorageError", handler)
        after = {path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest() for path in BACKEND_FILES}
        self.assertEqual(before, after)

    def test_web_overlay_scopes_user_jwt_and_enforces_matching_upload_limit(self) -> None:
        before = {path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest() for path in WEB_FILES}
        with tempfile.TemporaryDirectory(prefix="taskflow-storage-web-") as tmp:
            root = Path(tmp)
            for relative in WEB_FILES:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(VENDOR / relative, target)
            handoff_path = root / "apps/web/public/zhuge-handoff.html"
            handoff_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(OVERLAYS / "zhuge-handoff.html", handoff_path)
            PATCH.apply_web(root, OVERLAYS)
            client = (root / "packages/core/api/client.ts").read_text()
            handoff = handoff_path.read_text()
            self.assertIn("taskFlowStorageHeaders(path)", client)
            self.assertIn('"X-Zhuge-Storage-Token"', client)
            self.assertIn('zhuge_storage_access_token', client)
            self.assertIn("100 * 1024 * 1024", (root / "packages/core/constants/upload.ts").read_text())
            self.assertIn("File exceeds 100 MB limit", (root / "packages/core/hooks/use-file-upload.ts").read_text())
            self.assertIn('params.get("zhuge_storage_token")', handoff)
            self.assertIn('window.sessionStorage.setItem("zhuge_storage_access_token", storageToken)', handoff)
            self.assertLess(handoff.index("window.history.replaceState"), handoff.index('params.get("zhuge_storage_token")'))
            self.assertLess(handoff.index('window.sessionStorage.setItem("zhuge_storage_access_token", storageToken)'), handoff.index("window.location.replace(safeDestination)"))
        after = {path: hashlib.sha256((VENDOR / path).read_bytes()).hexdigest() for path in WEB_FILES}
        self.assertEqual(before, after)

    def test_patch_fails_closed_if_attachment_markers_are_missing(self) -> None:
        with self.assertRaisesRegex(ValueError, "Storage JWT CORS header"):
            PATCH.patch_router('router with no known attachment routes')
        with self.assertRaisesRegex(ValueError, "expected one upstream marker"):
            PATCH.patch_api_client("client without api methods")
        with self.assertRaisesRegex(ValueError, "TaskFlow Handoff Storage credential contract"):
            PATCH.patch_handoff("handoff without known token flow")

    def test_storage_candidate_is_private_bucket_scoped_and_never_grants_runtime_dml(self) -> None:
        sql = (ROOT / "labs/taskflow/sql/taskflow_supabase_storage_candidate.sql").read_text()
        self.assertIn("'taskflow-attachments', 'taskflow-attachments', false, 104857600", sql)
        self.assertIn("auth.uid()", sql)
        self.assertIn("bucket_id = 'taskflow-attachments'", sql)
        self.assertIn("taskflow.member", sql)
        self.assertIn("GRANT CREATE ON SCHEMA storage TO taskflow_migrator", sql)
        self.assertIn("taskflow_migrator already has Storage CREATE", sql)
        self.assertIn("parts[1] = 'users'", sql)
        self.assertIn("parts[1] = 'workspaces'", sql)
        self.assertIn("REVOKE CREATE ON SCHEMA storage FROM taskflow_migrator", sql)
        self.assertNotIn("GRANT USAGE ON SCHEMA taskflow TO authenticated", sql)
        self.assertIn("storage.taskflow_storage_can_access_object(name)", sql)
        self.assertNotRegex(sql, r"GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|SELECT)\s+ON\s+ALL\s+TABLES")
        self.assertNotIn("service_role", sql)
        rollback = (ROOT / "labs/taskflow/sql/taskflow_supabase_storage_candidate_rollback.sql").read_text()
        self.assertNotIn("DELETE FROM storage.objects", rollback)
        self.assertNotIn("DELETE FROM storage.buckets", rollback)
        self.assertIn("DROP FUNCTION IF EXISTS storage.taskflow_storage_can_access_object", rollback)


if __name__ == "__main__":
    unittest.main()
