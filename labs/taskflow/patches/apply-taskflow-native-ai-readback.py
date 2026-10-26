"""Install TaskFlow-owned native AI readback/report ingress in a build copy."""
from pathlib import Path
import os

_vendor_root = os.environ.get("TASKFLOW_VENDOR_ROOT")
VENDOR_ROOT = Path(_vendor_root) if _vendor_root else Path(__file__).resolve().parents[3] / "third_party" / "multica"
ROUTER = VENDOR_ROOT / "server" / "cmd" / "server" / "router.go"
HANDLER = VENDOR_ROOT / "server" / "internal" / "handler" / "handler.go"
MARKER = "\t\t\t// Assignee frequency\n\t\t\tr.Get(\"/api/assignee-frequency\", h.GetAssigneeFrequency)"
PUBLIC_MARKER = '\tr.Get("/healthz", health.readyHandler)'
HANDLER_MARKER = "\tWebhookRateLimiter           WebhookRateLimiter"
INSERTION = '''\t\t\t// Native AI readback derives identity from TaskFlow Agent, Project, Issue and task queue rows.
\t\t\tr.Route("/api/zhuge/ai", func(r chi.Router) {
\t\t\t\tr.With(handler.RequireHumanActor).Get("/project-mappings", h.ListZhugeNativeExecutorProjects)
\t\t\t\tr.With(handler.RequireHumanActor).Get("/tasks", h.ListZhugeNativeAITasks)
\t\t\t})

\t\t\t// Assignee frequency
\t\t\tr.Get("/api/assignee-frequency", h.GetAssigneeFrequency)'''
PUBLIC_INSERTION = PUBLIC_MARKER + '''
\t// Provider reports use a dedicated server-side verifier; no browser/user identity is trusted here.
\tr.Post("/api/provider/taskflow/native-agent-reports", h.ReceiveNativeAgentReport)'''


def apply(path: Path = ROUTER, handler_path: Path | None = None) -> None:
    source = path.read_text()
    if "/api/zhuge/ai/project-mappings" in source or "h.ListZhugeNativeAITasks" in source or "h.ReceiveNativeAgentReport" in source:
        raise SystemExit("TaskFlow native AI routes already applied")
    count = source.count(MARKER)
    if count != 1:
        raise SystemExit(f"expected one native AI readback insertion marker, found {count}")
    public_count = source.count(PUBLIC_MARKER)
    if public_count != 1:
        raise SystemExit(f"expected one provider-ingress route marker, found {public_count}")

    handler_source = None
    if handler_path is not None:
        handler_source = handler_path.read_text()
        if "NativeAgentReportVerifier NativeAgentReportProviderVerifier" in handler_source:
            raise SystemExit("TaskFlow native agent report verifier field already applied")
        handler_count = handler_source.count(HANDLER_MARKER)
        if handler_count != 1:
            raise SystemExit(f"expected one Handler webhook field marker, found {handler_count}")

    path.write_text(source.replace(MARKER, INSERTION, 1).replace(PUBLIC_MARKER, PUBLIC_INSERTION, 1))
    if handler_path is not None and handler_source is not None:
        handler_path.write_text(handler_source.replace(
            HANDLER_MARKER,
            HANDLER_MARKER + "\n\tNativeAgentReportVerifier NativeAgentReportProviderVerifier",
            1,
        ))


if __name__ == "__main__":
    apply(ROUTER, HANDLER)
