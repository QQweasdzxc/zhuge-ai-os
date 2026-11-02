#!/usr/bin/env python3
"""Fail-closed tests for the timeline bootstrap overlay against the pinned vendor snapshot."""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(os.environ.get(
    "TASKFLOW_TIMELINE_BOOTSTRAP_PATCH_SCRIPT",
    Path(__file__).resolve().parents[1] / "patches" / "apply-taskflow-timeline-bootstrap.py",
)).resolve()
SPEC = importlib.util.spec_from_file_location("taskflow_timeline_bootstrap_overlay", SCRIPT)
assert SPEC and SPEC.loader
OVERLAY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = OVERLAY
SPEC.loader.exec_module(OVERLAY)


def find_default_repo_root() -> Path:
    configured_root = os.environ.get("TASKFLOW_TIMELINE_BOOTSTRAP_REPO_ROOT")
    if configured_root:
        return Path(configured_root).resolve()
    for parent in Path(__file__).resolve().parents:
        if (parent / "third_party" / "multica").is_dir():
            return parent
    source_root = os.environ.get("TASKFLOW_VENDOR_SOURCE_ROOT")
    if source_root:
        return Path(source_root).resolve().parent.parent.parent
    return Path.cwd().resolve()


DEFAULT_REPO_ROOT = find_default_repo_root()
SOURCE_ROOT = Path(os.environ.get("TASKFLOW_VENDOR_SOURCE_ROOT", DEFAULT_REPO_ROOT / "third_party/multica")).resolve()
ISSUE_DETAIL = "packages/views/issues/components/issue-detail.tsx"


class TimelineBootstrapOverlayTests(unittest.TestCase):
    def test_pinned_vendor_source_hash_matches(self) -> None:
        for relative, expected in OVERLAY.EXPECTED_SHA256.items():
            with self.subTest(path=relative):
                self.assertEqual(OVERLAY.hashlib.sha256((SOURCE_ROOT / relative).read_bytes()).hexdigest(), expected)

    def test_overlay_applies_to_temporary_copy_without_mutating_vendor(self) -> None:
        vendor_before = (SOURCE_ROOT / ISSUE_DETAIL).read_bytes()
        with tempfile.TemporaryDirectory(prefix="taskflow-timeline-bootstrap-test-") as temporary:
            target_root = Path(temporary) / "source"
            target = target_root / ISSUE_DETAIL
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE_ROOT / ISSUE_DETAIL, target)
            OVERLAY.verify_and_patch(target_root, ISSUE_DETAIL, OVERLAY.patch_issue_detail)
            patched = target.read_text()
            self.assertIn("defaultItemHeight={64}", patched)
            self.assertEqual(patched.count("defaultItemHeight"), 1)
            self.assertNotIn(OVERLAY.TIMELINE_VIRTUOSO_ANCHOR, patched)
            self.assertIn('scrollContainerEl.dispatchEvent(new Event("scroll"))', patched)
            self.assertEqual(patched.count("dispatchEvent(new Event"), 1)
            self.assertNotIn(OVERLAY.SCROLL_CONTAINER_ANCHOR, patched)
        self.assertEqual((SOURCE_ROOT / ISSUE_DETAIL).read_bytes(), vendor_before)

    def test_missing_upstream_marker_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected one upstream marker, found 0"):
            OVERLAY.patch_issue_detail("const x = 1;\n")

    def test_already_patched_source_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected one upstream marker, found 0"):
            OVERLAY.patch_issue_detail(OVERLAY.TIMELINE_VIRTUOSO_PATCHED)


if __name__ == "__main__":
    unittest.main()
