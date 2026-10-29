import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "report_ingress_patch",
    Path(__file__).resolve().parents[1] / "patches" / "apply-taskflow-native-agent-report-ingress.py",
)
patch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(patch)

ROUTER = 'func x() {\n\tr.Get("/healthz", health.readyHandler)\n}\n'
HANDLER = "type Handler struct {\n\tWebhookRateLimiter           WebhookRateLimiter\n}\n"


class NativeAgentReportIngressPatchTest(unittest.TestCase):
    def files(self, router=ROUTER, handler=HANDLER):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        router_path, handler_path = Path(tmp.name) / "router.go", Path(tmp.name) / "handler.go"
        router_path.write_text(router)
        handler_path.write_text(handler)
        return router_path, handler_path

    def test_adds_one_public_route_and_verifier_field_only(self):
        router, handler = self.files()
        patch.apply(router, handler)
        self.assertEqual(router.read_text().count('h.ReceiveNativeAgentReport'), 1)
        self.assertEqual(handler.read_text().count("NativeAgentReportVerifier NativeAgentReportProviderVerifier"), 1)

    def test_rejects_reapply_and_missing_or_ambiguous_markers(self):
        router, handler = self.files()
        patch.apply(router, handler)
        with self.assertRaises(SystemExit):
            patch.apply(router, handler)
        for bad_router, bad_handler in ((ROUTER * 2, HANDLER), ("", HANDLER), (ROUTER, "type Handler struct{}\n")):
            r, h = self.files(bad_router, bad_handler)
            with self.assertRaises(SystemExit):
                patch.apply(r, h)
            self.assertNotIn("ReceiveNativeAgentReport", r.read_text())
            self.assertNotIn("NativeAgentReportVerifier", h.read_text())


if __name__ == "__main__":
    unittest.main()
