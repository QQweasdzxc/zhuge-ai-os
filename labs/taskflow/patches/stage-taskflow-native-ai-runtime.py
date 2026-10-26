"""Stage TaskFlow native AI readback/report write and PG16 tests into an isolated Multica copy."""
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
    shutil.copyfile(ROOT / "labs/taskflow/overrides/taskflow_native_agent_reporting_write.go", handler / "taskflow_native_agent_reporting_write.go")
    shutil.copyfile(ROOT / "labs/taskflow/overrides/taskflow_native_agent_report_ingress.go", handler / "taskflow_native_agent_report_ingress.go")
    shutil.copyfile(ROOT / "labs/taskflow/overrides/taskflow_native_agent_reporting_write_test.go", handler / "taskflow_native_agent_reporting_write_test.go")
    for name in ("main.go", "main_test.go"):
        shutil.copyfile(ROOT / "labs/taskflow/tests/native-ai-runtime" / name, command / name)

    # The upstream Handler TestMain constructs a full application fixture from
    # DATABASE_URL and exits the test process when that schema is absent. This
    # dedicated PG16 runtime test owns its schema in TASKFLOW_NATIVE_AI_DATABASE_URL,
    # so its temporary copy skips only the unrelated shared fixture setup.
    handler_test = handler / "handler_test.go"
    handler_test_source = handler_test.read_text()
    marker = "func TestMain(m *testing.M) {\n\tctx := context.Background()"
    if "TASKFLOW_NATIVE_AI_REPORTING_TEST_ONLY" in handler_test_source:
        raise SystemExit("reporting-test-only TestMain guard already applied")
    if handler_test_source.count(marker) != 1:
        raise SystemExit("expected one upstream Handler TestMain marker")
    handler_test.write_text(handler_test_source.replace(
        marker,
        "func TestMain(m *testing.M) {\n\tif os.Getenv(\"TASKFLOW_NATIVE_AI_REPORTING_TEST_ONLY\") == \"1\" {\n\t\tos.Exit(m.Run())\n\t}\n\tctx := context.Background()",
        1,
    ))

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
