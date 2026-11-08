#!/usr/bin/env python3
"""Fail-closed tests for the TaskFlow TRQN theme overlay."""

from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(os.environ.get(
    "TASKFLOW_TRON_THEME_PATCH",
    Path(__file__).resolve().parents[1] / "patches" / "apply-taskflow-tron-theme.py",
)).resolve()
SPEC = importlib.util.spec_from_file_location("taskflow_tron_theme_overlay", SCRIPT)
assert SPEC and SPEC.loader
OVERLAY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = OVERLAY
SPEC.loader.exec_module(OVERLAY)

CSS_SOURCE = Path(os.environ.get(
    "TASKFLOW_TRON_THEME_CSS",
    Path(__file__).resolve().parents[1] / "overrides" / "taskflow-tron-theme.css",
)).resolve()


def find_vendor_root() -> Path:
    configured = os.environ.get("TASKFLOW_VENDOR_SOURCE_ROOT")
    if configured:
        return Path(configured).resolve()
    for parent in Path(__file__).resolve().parents:
        if (parent / "third_party" / "multica").is_dir():
            return (parent / "third_party" / "multica").resolve()
    return Path("/src").resolve()


VENDOR_ROOT = find_vendor_root()
GLOBALS_CSS = Path("apps/web/app/globals.css")
THEME_PROVIDER = Path("packages/ui/components/common/theme-provider.tsx")
TOKENS_CSS = Path("packages/ui/styles/tokens.css")
TRON_IMPORT = '@import "./taskflow-tron-theme.css";'


class TaskFlowTronThemeOverlayTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="taskflow-tron-theme-"))
        for rel in (GLOBALS_CSS, THEME_PROVIDER):
            src = VENDOR_ROOT / rel
            if not src.is_file():
                self.fail(f"vendored marker file missing: {src}")
            dst = self.tmp / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_overlay_inserts_import_and_dark_default(self) -> None:
        OVERLAY.apply_tron_theme(self.tmp, CSS_SOURCE)
        globals_text = (self.tmp / GLOBALS_CSS).read_text()
        self.assertEqual(globals_text.count(TRON_IMPORT), 1)
        self.assertLess(globals_text.index('@import "./custom.css";'), globals_text.index(TRON_IMPORT))
        provider_text = (self.tmp / THEME_PROVIDER).read_text()
        vendor_provider = (VENDOR_ROOT / THEME_PROVIDER).read_text()
        self.assertEqual(provider_text, vendor_provider)
        self.assertEqual(provider_text.count('defaultTheme="system"'), 1)
        written = self.tmp / "apps/web/app/taskflow-tron-theme.css"
        self.assertTrue(written.is_file())
        self.assertEqual(written.read_text(), CSS_SOURCE.read_text())

    def test_overlay_is_idempotent(self) -> None:
        OVERLAY.apply_tron_theme(self.tmp, CSS_SOURCE)
        first_globals = (self.tmp / GLOBALS_CSS).read_text()
        first_provider = (self.tmp / THEME_PROVIDER).read_text()
        OVERLAY.apply_tron_theme(self.tmp, CSS_SOURCE)
        self.assertEqual((self.tmp / GLOBALS_CSS).read_text(), first_globals)
        self.assertEqual((self.tmp / THEME_PROVIDER).read_text(), first_provider)

    def test_vendored_tokens_file_is_never_touched(self) -> None:
        tokens = VENDOR_ROOT / TOKENS_CSS
        before = tokens.read_bytes()
        OVERLAY.apply_tron_theme(self.tmp, CSS_SOURCE)
        self.assertEqual(tokens.read_bytes(), before)

    def test_missing_import_marker_fails_closed(self) -> None:
        globals_path = self.tmp / GLOBALS_CSS
        globals_path.write_text(globals_path.read_text().replace('@import "./custom.css";', ""))
        with self.assertRaises(SystemExit):
            OVERLAY.apply_tron_theme(self.tmp, CSS_SOURCE)

    def test_drifted_theme_default_fails_closed(self) -> None:
        provider_path = self.tmp / THEME_PROVIDER
        provider_path.write_text(provider_path.read_text().replace('defaultTheme="system"', 'defaultTheme="sepia"'))
        with self.assertRaises(SystemExit):
            OVERLAY.apply_tron_theme(self.tmp, CSS_SOURCE)

    def test_theme_provider_is_never_modified(self) -> None:
        OVERLAY.apply_tron_theme(self.tmp, CSS_SOURCE)
        self.assertEqual(
            (self.tmp / THEME_PROVIDER).read_bytes(),
            (VENDOR_ROOT / THEME_PROVIDER).read_bytes(),
        )


if __name__ == "__main__":
    unittest.main()
