"""Install TaskFlow-owned native AI readback routes in a temporary build copy."""
from pathlib import Path
import os

_vendor_root = os.environ.get("TASKFLOW_VENDOR_ROOT")
VENDOR_ROOT = Path(_vendor_root) if _vendor_root else Path(__file__).resolve().parents[3] / "third_party" / "multica"
ROUTER = VENDOR_ROOT / "server" / "cmd" / "server" / "router.go"
MARKER = "\t\t\t// Assignee frequency\n\t\t\tr.Get(\"/api/assignee-frequency\", h.GetAssigneeFrequency)"
INSERTION = '''\t\t\t// Native AI readback derives identity from TaskFlow Agent, Project, Issue and task queue rows.
\t\t\tr.Route("/api/zhuge/ai", func(r chi.Router) {
\t\t\t\tr.With(handler.RequireHumanActor).Get("/project-mappings", h.ListZhugeNativeExecutorProjects)
\t\t\t\tr.With(handler.RequireHumanActor).Get("/tasks", h.ListZhugeNativeAITasks)
\t\t\t})

\t\t\t// Assignee frequency
\t\t\tr.Get("/api/assignee-frequency", h.GetAssigneeFrequency)'''


def apply(path: Path = ROUTER) -> None:
    source = path.read_text()
    if "/api/zhuge/ai/project-mappings" in source or "h.ListZhugeNativeAITasks" in source:
        raise SystemExit("TaskFlow native AI readback routes already applied")
    count = source.count(MARKER)
    if count != 1:
        raise SystemExit(f"expected one native AI readback insertion marker, found {count}")
    path.write_text(source.replace(MARKER, INSERTION, 1))


if __name__ == "__main__":
    apply()
