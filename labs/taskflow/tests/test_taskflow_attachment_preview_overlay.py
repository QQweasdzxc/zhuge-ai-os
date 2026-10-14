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
INLINE_MEDIA_TARGET = "packages/views/editor/hooks/use-inline-media-url.ts"
SPEC = importlib.util.spec_from_file_location("taskflow_attachment_preview", PATCH_PATH)
assert SPEC and SPEC.loader
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)


class TaskFlowAttachmentPreviewOverlayTests(unittest.TestCase):
    def test_staged_patch_re_signs_token_mode_and_fails_closed_without_exposing_raw_media_url(self) -> None:
        vendor_files = [VENDOR / TARGET, VENDOR / INLINE_MEDIA_TARGET]
        before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in vendor_files}
        with tempfile.TemporaryDirectory(prefix="taskflow-attachment-preview-") as temporary:
            staged_root = Path(temporary)
            for vendor_file in vendor_files:
                staged = staged_root / vendor_file.relative_to(VENDOR)
                staged.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(vendor_file, staged)
            PATCH.apply(Path(temporary))
            modal = (staged_root / TARGET).read_text()
            hook = (staged_root / INLINE_MEDIA_TARGET).read_text()
            self.assertIn("TASKFLOW_AUTHENTICATED_PDF_PREVIEW", modal)
            self.assertIn("mediaUrl={pdfPreviewUrl}", modal)
            self.assertIn("mediaUnavailable={pdfNeedsAuthenticatedFallback}", modal)
            self.assertIn("resigned.unavailable ? (", modal)
            self.assertIn("TASKFLOW_TOKEN_AUTH_ATTACHMENT_RESIGN", hook)
            self.assertIn("!!api.getToken?.()", hook)
            self.assertIn("unavailable: boolean", hook)
            self.assertIn("resigned.pending || resigned.unavailable ? \"\" : resigned.url", modal)
            self.assertIn("state.sizeBytes <= 8 * 1024 * 1024", modal)
            pdf = modal[modal.index('case "pdf":'):modal.index('case "video":')]
            self.assertIn("src={mediaUrl}", pdf)
            self.assertNotIn("src={state.mediaUrl}", pdf)
        for vendor_file in vendor_files:
            self.assertEqual(before[vendor_file], hashlib.sha256(vendor_file.read_bytes()).hexdigest())

    def test_patch_fails_closed_on_upstream_drift_and_duplicate_application(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected one upstream marker"):
            PATCH.patch("export function PreviewContent() {}")
        with self.assertRaisesRegex(ValueError, "already applied"):
            PATCH.patch("// TASKFLOW_AUTHENTICATED_PDF_PREVIEW")
        with self.assertRaisesRegex(ValueError, "expected one upstream marker"):
            PATCH.patch_inline_media("export function useResignedInlineMedia() {}")
        with self.assertRaisesRegex(ValueError, "already applied"):
            PATCH.patch_inline_media("// TASKFLOW_TOKEN_AUTH_ATTACHMENT_RESIGN")


if __name__ == "__main__":
    unittest.main()
