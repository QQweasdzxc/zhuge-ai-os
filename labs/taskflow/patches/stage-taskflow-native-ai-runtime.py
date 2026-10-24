"""Stage native AI readback source and PG16 test into an isolated Multica copy."""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def stage(server_root: Path) -> None:
    server_root = server_root.resolve()
    if server_root.name != "server" or not (server_root / "go.mod").is_file():
        raise SystemExit("expected a temporary Multica server directory")
    handler = server_root / "internal" / "handler"
    command = server_root / "cmd" / "taskflow-native-ai-runtime"
    handler.mkdir(parents=True, exist_ok=True)
    command.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / "labs/taskflow/overrides/taskflow_native_ai_readback.go", handler / "taskflow_native_ai_readback.go")
    for name in ("main.go", "main_test.go"):
        shutil.copyfile(ROOT / "labs/taskflow/tests/native-ai-runtime" / name, command / name)

    env = os.environ.copy()
    env["TASKFLOW_VENDOR_ROOT"] = str(server_root.parent)
    subprocess.run(
        [sys.executable, str(ROOT / "labs/taskflow/patches/apply-taskflow-native-ai-readback.py")],
        env=env,
        check=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-root", type=Path, required=True)
    args = parser.parse_args()
    stage(args.server_root)
