"""Fail-closed checks for the TaskFlow-owned CTO dispatch route overlay."""

import importlib.util
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]
PATCH = REPO / "labs/taskflow/patches/apply-taskflow-cto-dispatch-route.py"
SPEC = importlib.util.spec_from_file_location("taskflow_cto_dispatch_overlay", PATCH)
assert SPEC and SPEC.loader
OVERLAY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OVERLAY)


class TaskFlowCTODispatchOverlayTests(unittest.TestCase):
    def test_route_is_added_once_to_a_temporary_vendor_copy(self):
        original = (
            'r.Route("/{id}", func(r chi.Router) {\n'
            '\t\t\t\tr.Post("/rerun", h.RerunIssue)\n'
            '\t\t\t})\n'
        )
        with tempfile.TemporaryDirectory(prefix="taskflow-cto-dispatch-") as temporary:
            router = Path(temporary) / "router.go"
            router.write_text(original)
            OVERLAY.patch_router(router)
            patched = router.read_text()

        self.assertEqual(patched.count('r.Post("/dispatch", h.CTODispatchIssue)'), 1)
        self.assertEqual(patched.count('r.Get("/dispatch-runtime", h.GetDispatchRuntime)'), 1)
        self.assertIn('r.Post("/rerun", h.RerunIssue)', patched)

    def test_overlay_fails_closed_for_reapplication_or_marker_drift(self):
        patched = (
            'r.Post("/rerun", h.RerunIssue)\n'
            '\t\t\t\tr.Post("/dispatch", h.CTODispatchIssue)\n'
            '\t\t\t\tr.Get("/dispatch-runtime", h.GetDispatchRuntime)\n'
        )
        with tempfile.TemporaryDirectory(prefix="taskflow-cto-dispatch-") as temporary:
            router = Path(temporary) / "router.go"
            router.write_text(patched)
            with self.assertRaisesRegex(SystemExit, "already applied"):
                OVERLAY.patch_router(router)
            router.write_text("// upstream route changed\n")
            with self.assertRaisesRegex(SystemExit, "found 0"):
                OVERLAY.patch_router(router)

    def test_source_keeps_authority_overlay_outside_frozen_vendor(self):
        authority = (REPO / "labs/taskflow/overrides/taskflow_dispatch_authority.go").read_text()
        handler = (REPO / "labs/taskflow/overrides/taskflow_cto_dispatch.go").read_text()
        runtime = (REPO / "labs/taskflow/overrides/taskflow_dispatch_runtime.go").read_text()
        self.assertIn("AuthorizeCTODispatchRequest", authority)
        self.assertIn("TASKFLOW_CTO_ALLOWLIST_USER_IDS", handler)
        self.assertIn("RerunIssue(w, r)", handler)
        self.assertIn("GetDispatchRuntime", runtime)
        self.assertIn("PROVIDER_RUNTIME_NOT_BOUND", runtime)
        self.assertNotIn("r.URL.Query().Get(\"authorization\")", runtime)


if __name__ == "__main__":
    unittest.main()
