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
    "packages/views/attachments/attachment-preview-page.test.tsx",
    "packages/views/editor/attachment-preview-modal.tsx",
    "packages/core/types/attachment.ts",
    "packages/views/editor/hooks/use-inline-media-url.ts",
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
            self.assertIn("51_000_000", handler)
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
            self.assertIn("50_000_000", (root / "packages/core/constants/upload.ts").read_text())
            self.assertIn("${MAX_FILE_SIZE / 1_000_000} MB limit", (root / "packages/core/hooks/use-file-upload.ts").read_text())
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
        self.assertIn("CREATE OR REPLACE FUNCTION taskflow_storage.taskflow_storage_can_access_object", sql)
        self.assertIn("CREATE OR REPLACE FUNCTION taskflow_storage.taskflow_storage_can_delete_object", sql)
        self.assertIn("SET search_path = pg_catalog, pg_temp", sql)
        self.assertIn("session_user <> 'taskflow_migrator'", sql)
        self.assertIn("taskflow.member", sql)
        self.assertIn("parts[1] = 'users'", sql)
        self.assertIn("parts[1] = 'workspaces'", sql)
        self.assertNotRegex(sql, r"(?im)^\s*(?:CREATE|ALTER|DROP)\s+(?:POLICY|TABLE|FUNCTION|SCHEMA)\s+storage\.")
        self.assertNotRegex(sql, r"(?im)^\s*GRANT\s+.*\s+ON\s+SCHEMA\s+(?:storage|auth)\b")
        self.assertNotRegex(sql, r"GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|SELECT)\s+ON\s+ALL\s+TABLES")
        self.assertNotRegex(sql, r"(?im)^\s*GRANT\s+.*\bservice_role\b")

        bootstrap = (ROOT / "labs/taskflow/sql/taskflow_supabase_storage_schema_bootstrap.sql").read_text()
        self.assertIn("CREATE SCHEMA taskflow_storage", bootstrap)
        self.assertIn("GRANT USAGE, CREATE ON SCHEMA taskflow_storage TO taskflow_migrator", bootstrap)
        self.assertIn("GRANT USAGE ON SCHEMA taskflow_storage TO authenticated", bootstrap)
        self.assertIn("has_schema_privilege(current_user, 'storage', 'CREATE')", bootstrap)
        self.assertNotRegex(bootstrap, r"(?im)^\s*(?:GRANT|REVOKE)\s+.*\s+ON\s+SCHEMA\s+(?:storage|auth)\b")

        policies = (ROOT / "labs/taskflow/tests/taskflow_supabase_storage_ci_policies.sql").read_text()
        self.assertIn("taskflow_storage.taskflow_storage_can_access_object(name)", policies)
        self.assertIn("taskflow_storage.taskflow_storage_can_delete_object(name, owner_id)", policies)
        self.assertNotIn("CREATE POLICY taskflow_attachments_update", policies)

        rollback = (ROOT / "labs/taskflow/sql/taskflow_supabase_storage_candidate_rollback.sql").read_text()
        self.assertNotIn("DELETE FROM storage.objects", rollback)
        self.assertNotIn("DELETE FROM storage.buckets", rollback)
        self.assertNotIn("DROP POLICY", rollback)
        self.assertIn("DROP FUNCTION IF EXISTS taskflow_storage.taskflow_storage_can_access_object", rollback)

    def test_storage_errors_fail_closed_in_inline_and_download_response_paths(self) -> None:
        with tempfile.TemporaryDirectory(prefix="taskflow-storage-handler-") as tmp:
            root = Path(tmp)
            for relative in BACKEND_FILES:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(VENDOR / relative, target)
            PATCH.apply_backend(root, OVERLAYS)
            handler = (root / BACKEND_FILES[1]).read_text()
            self.assertGreaterEqual(handler.count("writeTaskFlowStorageError(w, err, http.StatusBadGateway"), 4)
            for marker in (
                "private attachment preview is unavailable",
                "private attachment download is unavailable",
                "private attachment storage is unavailable",
            ):
                self.assertIn(marker, handler)
            for marker in (
                "failed to presign inline attachment URL",
                "failed to presign attachment download URL",
                "failed to presign attachment download",
            ):
                position = handler.index(marker)
                recovery = handler[position:position + 700]
                self.assertIn("writeTaskFlowStorageError", recovery)
                self.assertIn("return", recovery)


if __name__ == "__main__":
    unittest.main()
