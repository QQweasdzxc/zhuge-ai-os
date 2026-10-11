#!/usr/bin/env python3
from pathlib import Path


def enable_router_contract_only(source: str) -> str:
    marker = "func TestMain(m *testing.M) {\n\tctx := context.Background()"
    replacement = (
        "func TestMain(m *testing.M) {\n"
        "\tif os.Getenv(\"TASKFLOW_ROUTER_CONTRACT_ONLY\") == \"1\" {\n"
        "\t\tos.Exit(m.Run())\n"
        "\t}\n"
        "\tctx := context.Background()"
    )
    if source.count(marker) != 1 or "TASKFLOW_ROUTER_CONTRACT_ONLY" in source:
        raise SystemExit("Multica server test-main marker missing, ambiguous, or already patched")
    return source.replace(marker, replacement, 1)


if __name__ == "__main__":
    test_main = Path("/src/server/cmd/server/integration_test.go")
    test_main.write_text(enable_router_contract_only(test_main.read_text()))
    print("TaskFlow router contract test can run without the unrelated integration database")
