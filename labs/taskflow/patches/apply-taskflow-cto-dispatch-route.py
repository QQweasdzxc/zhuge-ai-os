from pathlib import Path
import os


VENDOR_ROOT = Path(os.environ.get("TASKFLOW_VENDOR_ROOT", Path(__file__).resolve().parents[3] / "third_party" / "multica"))
ROUTER = VENDOR_ROOT / "server" / "cmd" / "server" / "router.go"
MARKER = 'r.Post("/rerun", h.RerunIssue)'
INSERTION = MARKER + '\n\t\t\t\t\tr.Post("/dispatch", h.CTODispatchIssue)'


def patch_router(path: Path = ROUTER) -> None:
    source = path.read_text()
    if 'r.Post("/dispatch", h.CTODispatchIssue)' in source:
        raise SystemExit("TaskFlow CTO dispatch route overlay already applied")
    count = source.count(MARKER)
    if count != 1:
        raise SystemExit(f"expected one CTO dispatch route marker, found {count}")
    path.write_text(source.replace(MARKER, INSERTION, 1))


if __name__ == "__main__":
    patch_router()
