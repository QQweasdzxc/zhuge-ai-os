from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


TASKFLOW = Path(__file__).resolve().parents[1]
REPO = TASKFLOW.parents[1]
NATIVE = REPO / "labs" / "multica"


class TaskFlowBuildParityTests(unittest.TestCase):
    def test_wrappers_copy_the_pinned_vendor_and_do_not_clone_application_source(self):
        for wrapper in ("Dockerfile.backend", "Dockerfile.web"):
            text = (TASKFLOW / wrapper).read_text()
            self.assertIn("COPY third_party/multica/ /src/", text)
            self.assertIn("8db6cfe19ae6fd5c35ec71bd8fea42a3ef3861ec", text)
            self.assertNotRegex(
                text,
                r"(?im)^\s*RUN\s+git\s+clone\s+https://github\.com/multica-ai/multica",
            )
            self.assertIn("labs/taskflow/overrides/", text)
            self.assertIn("labs/taskflow/patches/", text)
            self.assertIn("/src/LICENSE /src/NOTICE", text)

    def test_taskflow_overlay_isolated_from_native_overlay(self):
        exact_copies = (
            "dbid.go",
            "zhuge_auth.go",
            "zhuge-help-launcher.tsx",
            "zhuge-ready-route.ts",
        )
        for name in exact_copies:
            self.assertEqual(
                (TASKFLOW / "overrides" / name).read_bytes(),
                (NATIVE / "overrides" / name).read_bytes(),
                name,
            )
        for name in ("apply-zhuge-identity.py",):
            self.assertEqual(
                (TASKFLOW / "patches" / name).read_bytes(),
                (NATIVE / "patches" / name).read_bytes(),
                name,
            )
        native_house_rules = (NATIVE / "patches/apply-zhuge-house-rules.py").read_text()
        taskflow_house_rules = (TASKFLOW / "patches/apply-zhuge-house-rules.py").read_text()
        self.assertEqual(
            taskflow_house_rules.replace(
                'copy_override("multica-brand-mark.tsx", "apps/web/components/zhuge-multica-brand.tsx")\n',
                "",
            ),
            native_house_rules,
        )

    def test_taskflow_replacement_pages_keep_multica_brand_and_attribution(self):
        for name in (
            "zhuge-root-page.tsx",
            "zhuge-login-page.tsx",
            "zhuge-handoff-page.tsx",
        ):
            text = (TASKFLOW / "overrides" / name).read_text()
            self.assertIn("MulticaBrandMark", text, name)
            self.assertIn("multica", text.lower(), name)
            self.assertIn("All rights reserved.", text, name)
            self.assertIn("https://github.com/multica-ai/multica", text, name)
        self.assertIn(
            "MulticaIcon",
            (TASKFLOW / "overrides/multica-brand-mark.tsx").read_text(),
        )

    def test_boundary_defaults_match_native_lab_and_keep_cloud_telemetry_off(self):
        backend = (TASKFLOW / "Dockerfile.backend").read_text()
        web = (TASKFLOW / "Dockerfile.web").read_text()
        self.assertIn("DISABLE_WORKSPACE_CREATION=true", backend)
        self.assertIn("MULTICA_CLOUD_URL=", backend)
        self.assertIn("DO_NOT_TRACK=1", backend)
        self.assertIn("ANALYTICS_DISABLED=true", backend)
        self.assertIn("NEXT_TELEMETRY_DISABLED=1", web)
        self.assertIn("NEXT_PUBLIC_ENABLE_CLOUD_RUNTIME=false", web)
        self.assertIn("REMOTE_API_URL=http://backend:8080", web)
        boundary = (TASKFLOW / "DB_BOUNDARY.md").read_text()
        self.assertIn("lab_multica, extensions", boundary)
        self.assertIn("must not receive Zhuge Production credentials", boundary)

    def test_identity_patch_fails_closed_when_upstream_router_marker_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "source"
            overrides = Path(temp) / "overrides"
            router = root / "server/cmd/server/router.go"
            router.parent.mkdir(parents=True)
            router.write_text("package server\n// expected auth route intentionally absent\n")
            overrides.mkdir()
            script = self._relocate_script(
                TASKFLOW / "patches/apply-zhuge-identity.py", root, overrides
            )
            result = subprocess.run(
                [sys.executable, str(script)], capture_output=True, text=True
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Multica router auth marker not found", result.stderr + result.stdout)

    def test_house_rules_patch_fails_closed_when_required_marker_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "source"
            overrides = Path(temp) / "overrides"
            tmpdir = Path(temp) / "patch-inputs"
            router = root / "server/cmd/server/router.go"
            router.parent.mkdir(parents=True)
            router.write_text("package server\n// expected managed-only routes intentionally absent\n")
            tmpdir.mkdir()
            for name in (
                "zhuge-root-page.tsx",
                "zhuge-login-page.tsx",
                "zhuge-help-launcher.tsx",
                "multica-brand-mark.tsx",
            ):
                (tmpdir / name).write_text("// fixture\n")
            script = self._relocate_script(
                TASKFLOW / "patches/apply-zhuge-house-rules.py", root, tmpdir
            )
            result = subprocess.run(
                [sys.executable, str(script)], capture_output=True, text=True
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("marker missing", result.stderr + result.stdout)

    @staticmethod
    def _relocate_script(source: Path, root: Path, tmpdir: Path) -> Path:
        text = source.read_text()
        text = text.replace(
            'Path("/src/server/cmd/server/router.go")',
            f"Path({os.fspath(root / 'server/cmd/server/router.go')!r})",
        )
        text = text.replace('Path("/src")', f"Path({os.fspath(root)!r})")
        text = text.replace('Path("/tmp")', f"Path({os.fspath(tmpdir)!r})")
        relocated = tmpdir / source.name
        relocated.write_text(text)
        return relocated


if __name__ == "__main__":
    unittest.main()
