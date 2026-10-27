"""TaskFlow-owned source overlay: bind Co/Codex dispatcher at router assembly.

Never patches the frozen third_party tree in place. Docker stages a disposable
copy under /src and supplies TASKFLOW_VENDOR_ROOT=/src.
"""
from pathlib import Path
import os

ROOT = (
    Path(os.environ["TASKFLOW_VENDOR_ROOT"])
    if os.environ.get("TASKFLOW_VENDOR_ROOT")
    else Path(__file__).resolve().parents[3] / "third_party" / "multica"
)
ROUTER = ROOT / "server" / "cmd" / "server" / "router.go"
ANCHOR = '\th := handler.New(queries, pool, hub, bus, emailSvc, store, cfSigner, analyticsClient, signupConfig, daemonHub)'
INSERTION = ANCHOR + (
    '\n\t// Server-owned configuration; a selected mode retains denied PM/cost/ACK gates.'
    '\n\thandler.ConfigureTaskFlowProviderDispatcherFromEnv(os.Getenv("TASKFLOW_PROVIDER_DISPATCH_MODE"))'
)


def patch_router(path: Path = ROUTER) -> None:
    data = path.read_text(encoding="utf-8")
    if 'handler.ConfigureTaskFlowProviderDispatcherFromEnv(' in data:
        raise SystemExit("TaskFlow provider binding already installed")
    if data.count(ANCHOR) != 1:
        raise SystemExit("TaskFlow provider binding: expected exactly one Handler construction")
    path.write_text(data.replace(ANCHOR, INSERTION, 1), encoding="utf-8")


if __name__ == "__main__":
    patch_router()
