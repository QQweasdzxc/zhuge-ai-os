from __future__ import annotations

import hashlib
import importlib.util
import os
import shutil
import tempfile
import unittest
from pathlib import Path


REPO = Path(os.environ["TASKFLOW_ATTACHMENT_REPO"]).resolve() if os.environ.get("TASKFLOW_ATTACHMENT_REPO") else Path(__file__).resolve().parents[3].resolve()
VENDOR = Path(os.environ.get("TASKFLOW_ATTACHMENT_VENDOR", REPO / "third_party/multica")).resolve()
PATCH_PATH = Path(os.environ.get(
    "TASKFLOW_ATTACHMENT_PATCH",
    REPO / "labs/taskflow/patches/apply-taskflow-attachment-preview.py",
)).resolve()
TARGET = "packages/views/editor/attachment-preview-modal.tsx"
SPEC = importlib.util.spec_from_file_location("taskflow_attachment_preview", PATCH_PATH)
assert SPEC and SPEC.loader
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)


class TaskFlowAttachmentPreviewOverlayTests(unittest.TestCase):
    def test_staged_patch_uses_re_signed_pdf_url_and_never_falls_back_to_raw_protected_url(self) -> None:
        vendor_file = VENDOR / TARGET
        before = hashlib.sha256(vendor_file.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(prefix="taskflow-attachment-preview-") as temporary:
            staged = Path(temporary) / TARGET
            staged.parent.mkdir(parents=True)
            shutil.copy2(vendor_file, staged)
            PATCH.apply(Path(temporary))
            result = staged.read_text()
            self.assertIn("TASKFLOW_AUTHENTICATED_PDF_PREVIEW", result)
            self.assertIn("mediaUrl={pdfPreviewUrl}", result)
            self.assertIn("mediaUnavailable={pdfNeedsAuthenticatedFallback}", result)
            self.assertIn("src={mediaUrl}", result)
            self.assertNotIn("src={state.mediaUrl}", result[result.index('case "pdf":'):result.index('case "video":')])
            self.assertIn("state.sizeBytes <= 8 * 1024 * 1024", result)
        self.assertEqual(before, hashlib.sha256(vendor_file.read_bytes()).hexdigest())

    def test_patch_fails_closed_on_upstream_drift_and_duplicate_application(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected one upstream marker"):
            PATCH.patch("export function PreviewContent() {}")
        with self.assertRaisesRegex(ValueError, "already applied"):
            PATCH.patch("// TASKFLOW_AUTHENTICATED_PDF_PREVIEW")


if __name__ == "__main__":
    unittest.main()
