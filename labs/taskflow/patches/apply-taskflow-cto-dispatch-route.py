from pathlib import Path
import os


_vendor_root = os.environ.get("TASKFLOW_VENDOR_ROOT")
VENDOR_ROOT = Path(_vendor_root) if _vendor_root else Path(__file__).resolve().parents[3] / "third_party" / "multica"
ROUTER = VENDOR_ROOT / "server" / "cmd" / "server" / "router.go"
MARKER = 'r.Post("/rerun", h.RerunIssue)'
INSERTION = MARKER + (
    '\n\t\t\t\t\tr.Post("/dispatch", h.CTODispatchIssue)'
    '\n\t\t\t\t\tr.Get("/dispatch-runtime", h.GetDispatchRuntime)'
)


def patch_router(path: Path = ROUTER) -> None:
    source = path.read_text()
    native_marker = 'r.Get("/api/assignee-frequency", h.GetAssigneeFrequency)'
    if source.count(native_marker)!=1: raise SystemExit("native readback route marker missing or ambiguous")
    source=source.replace(native_marker,native_marker+'\n\t\t\tr.With(handler.RequireHumanActor).Get("/api/zhuge/native-executor-projects", h.ListZhugeNativeExecutorProjects)\n\t\t\tr.With(handler.RequireHumanActor).Get("/api/zhuge/native-ai-tasks", h.ListZhugeNativeAITasks)')
    if 'r.Post("/dispatch", h.CTODispatchIssue)' in source or 'r.Get("/dispatch-runtime", h.GetDispatchRuntime)' in source:
        raise SystemExit("TaskFlow CTO dispatch route overlay already applied")
    count = source.count(MARKER)
    if count != 1:
        raise SystemExit(f"expected one CTO dispatch route marker, found {count}")
    path.write_text(source.replace(MARKER, INSERTION, 1))


if __name__ == "__main__":
    patch_router()
