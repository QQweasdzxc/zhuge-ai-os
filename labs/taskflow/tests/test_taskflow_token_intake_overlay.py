#!/usr/bin/env python3
"""Fail-closed contract tests for the TaskFlow token intake overlay."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(os.environ.get(
    "TASKFLOW_TOKEN_INTAKE_PATCH",
    Path(__file__).resolve().parents[1] / "patches" / "apply-taskflow-token-intake.py",
)).resolve()
SPEC = importlib.util.spec_from_file_location("taskflow_token_intake", SCRIPT)
assert SPEC and SPEC.loader
OVERLAY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = OVERLAY
SPEC.loader.exec_module(OVERLAY)


def find_default_repo_root() -> Path:
    configured = os.environ.get("TASKFLOW_TOKEN_INTAKE_REPO_ROOT")
    if configured:
        return Path(configured).resolve()
    for parent in Path(__file__).resolve().parents:
        if (parent / "third_party" / "multica").is_dir():
            return parent
    return Path.cwd().resolve()


DEFAULT_REPO_ROOT = find_default_repo_root()
SOURCE_ROOT = Path(os.environ.get("TASKFLOW_TOKEN_INTAKE_VENDOR", DEFAULT_REPO_ROOT / "third_party/multica")).resolve()
INTAKE_INPUT = Path(os.environ.get(
    "TASKFLOW_TOKEN_INTAKE_INPUT",
    Path(__file__).resolve().parents[1] / "overrides" / "zhuge-token-intake-inline.ts",
)).resolve()

PRISTINE_LAYOUT = SOURCE_ROOT / "apps/web/app/layout.tsx"


class TokenIntakeOverlayTests(unittest.TestCase):
    def test_injects_once_into_pristine_layout(self):
        layout = PRISTINE_LAYOUT.read_text()
        patched = OVERLAY.inject_token_intake(layout)
        self.assertEqual(patched.count('id="zhuge-token-intake"'), 1)
        self.assertEqual(patched.count('import { ZHUGE_TOKEN_INTAKE_INLINE } from "./zhuge-token-intake-inline";'), 1)
        self.assertIn('strategy="beforeInteractive"', patched)
        self.assertIn("dangerouslySetInnerHTML={{ __html: ZHUGE_TOKEN_INTAKE_INLINE }}", patched)
        # The intake is the first element inside <body>: before every provider
        # (auth store init) and before the dev-only third-party react-grab script.
        body_at = patched.index('<body className="h-full overflow-hidden">')
        intake_at = patched.index('id="zhuge-token-intake"')
        providers_at = patched.index("<WebProviders")
        grab_at = patched.index("react-grab")
        self.assertLess(body_at, intake_at)
        self.assertLess(intake_at, providers_at)
        self.assertLess(intake_at, grab_at)

    def test_fail_closed_on_marker_drift(self):
        layout = PRISTINE_LAYOUT.read_text()
        with self.assertRaisesRegex(SystemExit, "already patched"):
            OVERLAY.inject_token_intake(OVERLAY.inject_token_intake(layout))
        with self.assertRaisesRegex(SystemExit, "Script import marker"):
            OVERLAY.inject_token_intake(layout.replace('import Script from "next/script";\n', "", 1))
        with self.assertRaisesRegex(SystemExit, "body marker"):
            OVERLAY.inject_token_intake(
                layout.replace('<body className="h-full overflow-hidden">', "<body>", 1)
            )

    def test_intake_module_keeps_security_invariants(self):
        module = INTAKE_INPUT.read_text()
        # Cheap gate, strip-before-validate, cap, plant, same-origin dest.
        self.assertIn('hash.indexOf("zhuge_token=")', module)
        self.assertIn("window.history.replaceState", module)
        self.assertIn("token.length > 16384", module)
        self.assertIn('localStorage.setItem("multica_token", token)', module)
        self.assertIn("resolved.origin !== window.location.origin", module)
        self.assertIn("window.location.replace(resolved.pathname", module)
        self.assertLess(
            module.index("window.history.replaceState"),
            module.index('localStorage.setItem("multica_token", token)'),
            "fragment must be stripped before the credential is planted",
        )
        # The credential is never logged, rendered, or sent by the intake.
        for forbidden in ("console.log", "console.error", "fetch(", "innerHTML =", "document.write"):
            self.assertNotIn(forbidden, module)
        self.assertNotIn("zhuge_token`,", module)  # no template-literal leak paths

    def test_patch_main_writes_module_and_layout_end_to_end(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "src"
            layout = root / "apps/web/app/layout.tsx"
            layout.parent.mkdir(parents=True)
            layout.write_text(PRISTINE_LAYOUT.read_text())
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--root", str(root), "--intake", str(INTAKE_INPUT)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            patched = layout.read_text()
            self.assertEqual(patched.count('id="zhuge-token-intake"'), 1)
            written = (root / "apps/web/app/zhuge-token-intake-inline.ts").read_text()
            self.assertEqual(written, INTAKE_INPUT.read_text())

    def test_patch_main_fails_closed_when_module_invariants_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "src"
            layout = root / "apps/web/app/layout.tsx"
            layout.parent.mkdir(parents=True)
            layout.write_text(PRISTINE_LAYOUT.read_text())
            bad = Path(temp) / "bad-intake.ts"
            bad.write_text("export const ZHUGE_TOKEN_INTAKE_INLINE = 'noop';\n")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--root", str(root), "--intake", str(bad)],
                capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("invariant missing", result.stderr + result.stdout)
            # The layout must be untouched when the module cannot be trusted.
            self.assertEqual(layout.read_text(), PRISTINE_LAYOUT.read_text())


if __name__ == "__main__":
    unittest.main()
