"""Install the fail-closed native agent report ingress in a build copy.

Adds only the Handler verifier field and one public Provider ingress route.
The route returns 503 until a server-side verifier is bound; this patch never
binds a verifier, Provider, credential, or database.
"""
from pathlib import Path
import os

_vendor_root = os.environ.get("TASKFLOW_VENDOR_ROOT")
VENDOR_ROOT = Path(_vendor_root) if _vendor_root else Path(__file__).resolve().parents[3] / "third_party" / "multica"
ROUTER = VENDOR_ROOT / "server" / "cmd" / "server" / "router.go"
HANDLER = VENDOR_ROOT / "server" / "internal" / "handler" / "handler.go"
PUBLIC_MARKER = '\tr.Get("/healthz", health.readyHandler)'
PUBLIC_INSERTION = PUBLIC_MARKER + '''
\t// Provider reports use a dedicated server-side verifier; no browser/user identity is trusted here.
\tr.Post("/api/provider/taskflow/native-agent-reports", h.ReceiveNativeAgentReport)'''
HANDLER_MARKER = "\tWebhookRateLimiter           WebhookRateLimiter"
HANDLER_FIELD = "\tNativeAgentReportVerifier NativeAgentReportProviderVerifier"


def apply(router_path: Path = ROUTER, handler_path: Path = HANDLER) -> None:
    router = router_path.read_text()
    handler = handler_path.read_text()
    if "h.ReceiveNativeAgentReport" in router or "NativeAgentReportVerifier NativeAgentReportProviderVerifier" in handler:
        raise SystemExit("TaskFlow native agent report ingress already applied")
    if router.count(PUBLIC_MARKER) != 1:
        raise SystemExit(f"expected one public route marker, found {router.count(PUBLIC_MARKER)}")
    if handler.count(HANDLER_MARKER) != 1:
        raise SystemExit(f"expected one Handler field marker, found {handler.count(HANDLER_MARKER)}")
    router_path.write_text(router.replace(PUBLIC_MARKER, PUBLIC_INSERTION, 1))
    handler_path.write_text(handler.replace(HANDLER_MARKER, HANDLER_MARKER + "\n" + HANDLER_FIELD, 1))


if __name__ == "__main__":
    apply()
