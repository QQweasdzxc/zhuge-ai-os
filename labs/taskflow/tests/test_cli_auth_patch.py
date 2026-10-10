from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

PATCH_FILE = Path(__file__).resolve().parents[1] / "patches" / "patch-cli-auth-middleware.py"
SPEC = importlib.util.spec_from_file_location("taskflow_cli_auth_patch", PATCH_FILE)
PATCH = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(PATCH)


class TaskFlowCliAuthPatchTests(unittest.TestCase):
    def test_patch_inserts_single_route_scoped_one_time_auth_code_gate(self):
        marker = '\t\t\t// Agent task token: "mat_" prefix.'
        patched = PATCH.patch_cli_authorization_middleware_text(marker + "\n")
        self.assertIn("r.Method != http.MethodPost", patched)
        self.assertIn('strings.TrimRight(r.URL.Path, "/") != "/api/tokens"', patched)
        self.assertIn("auth.ConsumeCLIAuthorizationCode(tokenString)", patched)

    def test_patch_fails_closed_if_marker_is_missing_ambiguous_or_already_patched(self):
        marker = '\t\t\t// Agent task token: "mat_" prefix.'
        for source in ("", marker + "\n" + marker, marker + "\nauth.ConsumeCLIAuthorizationCode(tokenString)"):
            with self.assertRaisesRegex(SystemExit, "marker missing, ambiguous, or already patched"):
                PATCH.patch_cli_authorization_middleware_text(source)


if __name__ == "__main__":
    unittest.main()
